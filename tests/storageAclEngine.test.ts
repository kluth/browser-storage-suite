import { describe, it, expect, beforeEach } from 'vitest';
import { StorageAclEngine } from '../utils/storageAclEngine';
import {
  AclRule,
  AclRoleDefinition,
  AclSubjectContext,
  AclEnvironmentContext,
  AclResourceContext,
  AclAction,
} from '../src/domain/model/storageAcl';

describe('StorageAclEngine (RBAC / ABAC / Token Authorization)', () => {
  let engine: StorageAclEngine;
  const SECRET = 'super_secret_hmac_key_1234567890';

  beforeEach(() => {
    engine = new StorageAclEngine({ defaultEffect: 'DENY' });
  });

  describe('Engine Options & Default Policy Fallback', () => {
    it('should support setting default effect to ALLOW and DENY', async () => {
      engine.setDefaultEffect('ALLOW');

      const subject: AclSubjectContext = { subjectId: 'unlisted_sub', roles: [] };
      const env: AclEnvironmentContext = { origin: 'https://unlisted.example.com', timestamp: Date.now() };
      const resource: AclResourceContext = { key: 'any:key' };

      const resAllow = await engine.evaluateAccess(subject, env, resource, 'READ');
      expect(resAllow.ok).toBe(true);
      if (resAllow.ok) {
        expect(resAllow.value.allowed).toBe(true);
        expect(resAllow.value.effect).toBe('ALLOW');
        expect(resAllow.value.reason).toContain('default policy ALLOW applied');
      }

      engine.setDefaultEffect('DENY');
      const resDeny = await engine.evaluateAccess(subject, env, resource, 'READ');
      expect(resDeny.ok).toBe(true);
      if (resDeny.ok) {
        expect(resDeny.value.allowed).toBe(false);
        expect(resDeny.value.effect).toBe('DENY');
        expect(resDeny.value.reason).toContain('default policy DENY applied');
      }
    });

    it('should return error when evaluateAccess receives missing or null required arguments', async () => {
      const subject: AclSubjectContext = { subjectId: 'sub1', roles: [] };
      const env: AclEnvironmentContext = { origin: 'https://app.com', timestamp: Date.now() };
      const resource: AclResourceContext = { key: 'k1' };

      const res1 = await engine.evaluateAccess(null as any, env, resource, 'READ');
      expect(res1.ok).toBe(false);
      if (!res1.ok) expect(res1.error.code).toBe('INVALID_RULE');

      const res2 = await engine.evaluateAccess(subject, null as any, resource, 'READ');
      expect(res2.ok).toBe(false);

      const res3 = await engine.evaluateAccess(subject, env, null as any, 'READ');
      expect(res3.ok).toBe(false);

      const res4 = await engine.evaluateAccess(subject, env, resource, null as any);
      expect(res4.ok).toBe(false);
    });
  });

  describe('Origin Normalization & Wildcard Domain Matching', () => {
    it('should normalize origin URLs stripping default 80 and 443 ports', () => {
      expect(engine.normalizeOrigin('HTTPS://App.Example.COM:443')).toBe('https://app.example.com');
      expect(engine.normalizeOrigin('http://localhost:80')).toBe('http://localhost');
      expect(engine.normalizeOrigin('https://sub.example.com:8080')).toBe('https://sub.example.com:8080');
      expect(engine.normalizeOrigin('*')).toBe('*');
      expect(engine.normalizeOrigin('')).toBe('*');
    });

    it('should match exact origins', () => {
      expect(engine.matchOrigin('https://app.example.com', 'https://app.example.com')).toBe(true);
      expect(engine.matchOrigin('https://app.example.com', 'https://other.example.com')).toBe(false);
      expect(engine.matchOrigin('*', 'https://any.com')).toBe(true);
    });

    it('should match single and multi-level subdomains with wildcard patterns', () => {
      expect(engine.matchOrigin('https://*.example.com', 'https://sub.example.com')).toBe(true);
      expect(engine.matchOrigin('https://*.example.com', 'https://v1.api.example.com')).toBe(true);
      expect(engine.matchOrigin('https://*.example.com', 'https://example.com')).toBe(true);
    });

    it('should REJECT domain boundary spoofing attempts', () => {
      expect(engine.matchOrigin('https://*.example.com', 'https://example.com.attacker.com')).toBe(false);
      expect(engine.matchOrigin('https://*.example.com', 'https://anotherexample.com')).toBe(false);
    });

    it('should match scheme wildcards and port wildcards', () => {
      expect(engine.matchOrigin('*://example.com', 'http://example.com')).toBe(true);
      expect(engine.matchOrigin('*://example.com', 'https://example.com')).toBe(true);
      expect(engine.matchOrigin('http://localhost:*', 'http://localhost:3000')).toBe(true);
      expect(engine.matchOrigin('http://localhost:*', 'http://localhost:8080')).toBe(true);
      expect(engine.matchOrigin('http://localhost:*', 'http://otherhost:3000')).toBe(false);
    });
  });

  describe('Key Pattern Glob & Regex Matching', () => {
    it('should match exact key strings', () => {
      expect(engine.matchKeyPattern('user:session', 'user:session')).toBe(true);
      expect(engine.matchKeyPattern('user:session', 'user:profile')).toBe(false);
      expect(engine.matchKeyPattern('*', 'anything')).toBe(true);
    });

    it('should match prefix wildcards', () => {
      expect(engine.matchKeyPattern('user:*', 'user:123')).toBe(true);
      expect(engine.matchKeyPattern('user:*', 'user')).toBe(true);
      expect(engine.matchKeyPattern('user:*', 'user:profile:settings')).toBe(true);
      expect(engine.matchKeyPattern('user:*', 'system:config')).toBe(false);
    });

    it('should match globs and regex patterns', () => {
      expect(engine.matchKeyPattern('cache:**.json', 'cache:data.json')).toBe(true);
      expect(engine.matchKeyPattern('cache:**.json', 'cache:a:b:c.json')).toBe(true);
      expect(engine.matchKeyPattern('^auth:(jwt|session)_[a-z0-9]+$', 'auth:jwt_abc123')).toBe(true);
      expect(engine.matchKeyPattern('^auth:(jwt|session)_[a-z0-9]+$', 'auth:other_123')).toBe(false);
      expect(engine.matchKeyPattern('^[invalid_regex', 'test')).toBe(false);
    });
  });

  describe('RBAC & Priority Policy Evaluation', () => {
    it('should evaluate direct subject rules and grant access when ALLOW rule matches', async () => {
      const rule: AclRule = {
        id: 'rule_1',
        name: 'Allow User Read',
        subjectOrRole: 'user_1',
        originPattern: 'https://app.example.com',
        keyPattern: 'user:*',
        actions: ['READ'],
        effect: 'ALLOW',
      };

      await engine.registerRule(rule);

      const subject: AclSubjectContext = { subjectId: 'user_1', roles: [] };
      const env: AclEnvironmentContext = { origin: 'https://app.example.com', timestamp: Date.now() };
      const resource: AclResourceContext = { key: 'user:settings' };

      const res = await engine.evaluateAccess(subject, env, resource, 'READ');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.allowed).toBe(true);
        expect(res.value.effect).toBe('ALLOW');
        expect(res.value.ruleId).toBe('rule_1');
      }
    });

    it('should evaluate rule priorities correctly (higher number evaluated first)', async () => {
      const lowPriorityAllow: AclRule = {
        id: 'rule_low',
        name: 'Low Priority Allow',
        subjectOrRole: 'user_1',
        originPattern: '*',
        keyPattern: 'data:*',
        actions: ['READ'],
        effect: 'ALLOW',
        priority: 5,
      };

      const highPriorityDeny: AclRule = {
        id: 'rule_high',
        name: 'High Priority Deny',
        subjectOrRole: 'user_1',
        originPattern: '*',
        keyPattern: 'data:secret',
        actions: ['READ'],
        effect: 'DENY',
        priority: 100,
      };

      await engine.registerRule(lowPriorityAllow);
      await engine.registerRule(highPriorityDeny);

      const subject: AclSubjectContext = { subjectId: 'user_1', roles: [] };
      const env: AclEnvironmentContext = { origin: 'https://app.example.com', timestamp: Date.now() };

      const resDeny = await engine.evaluateAccess(subject, env, { key: 'data:secret' }, 'READ');
      expect(resDeny.ok).toBe(true);
      if (resDeny.ok) {
        expect(resDeny.value.allowed).toBe(false);
        expect(resDeny.value.ruleId).toBe('rule_high');
      }

      const resAllow = await engine.evaluateAccess(subject, env, { key: 'data:public' }, 'READ');
      expect(resAllow.ok).toBe(true);
      if (resAllow.ok) {
        expect(resAllow.value.allowed).toBe(true);
        expect(resAllow.value.ruleId).toBe('rule_low');
      }
    });

    it('should expand rules inherited from subject roles', async () => {
      const roleDef: AclRoleDefinition = {
        roleName: 'editor',
        rules: [
          {
            id: 'role_rule_1',
            name: 'Role Editor Write',
            subjectOrRole: 'editor',
            originPattern: 'https://editor.example.com',
            keyPattern: 'article:*',
            actions: ['WRITE'],
            effect: 'ALLOW',
          },
        ],
      };

      await engine.defineRole(roleDef);

      const subject: AclSubjectContext = { subjectId: 'user_editor', roles: ['editor'] };
      const env: AclEnvironmentContext = { origin: 'https://editor.example.com', timestamp: Date.now() };
      const resource: AclResourceContext = { key: 'article:101' };

      const res = await engine.evaluateAccess(subject, env, resource, 'WRITE');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.allowed).toBe(true);
        expect(res.value.ruleId).toBe('role_rule_1');
      }
    });

    it('should support rule management via engine (getAllRules, revokeRule)', async () => {
      const rule: AclRule = {
        id: 'r_manage',
        name: 'Manageable Rule',
        subjectOrRole: '*',
        originPattern: '*',
        keyPattern: 'm:*',
        actions: ['READ'],
        effect: 'ALLOW',
      };

      await engine.registerRule(rule);

      const allRes = await engine.getAllRules();
      expect(allRes.ok).toBe(true);
      if (allRes.ok) {
        expect(allRes.value.some((r) => r.id === 'r_manage')).toBe(true);
      }

      const revokeRes = await engine.revokeRule('r_manage');
      expect(revokeRes.ok).toBe(true);

      const allResAfter = await engine.getAllRules();
      if (allResAfter.ok) {
        expect(allResAfter.value.some((r) => r.id === 'r_manage')).toBe(false);
      }
    });
  });

  describe('ABAC Condition Evaluation (Operators: EQUALS, NOT_EQUALS, CONTAINS, GREATER_THAN, LESS_THAN, IN_ARRAY)', () => {
    it('should evaluate EQUALS operator correctly', async () => {
      const rule: AclRule = {
        id: 'abac_eq',
        name: 'ABAC Equals',
        subjectOrRole: '*',
        originPattern: '*',
        keyPattern: 'k:*',
        actions: ['READ'],
        effect: 'ALLOW',
        conditions: [{ field: 'subject.attributes.dept', operator: 'EQUALS', value: 'Finance' }],
      };
      await engine.registerRule(rule);

      const env: AclEnvironmentContext = { origin: 'https://a.com', timestamp: Date.now() };

      const pass = await engine.evaluateAccess({ subjectId: 's1', roles: [], attributes: { dept: 'Finance' } }, env, { key: 'k:1' }, 'READ');
      expect(pass.ok && pass.value.allowed).toBe(true);

      const fail = await engine.evaluateAccess({ subjectId: 's2', roles: [], attributes: { dept: 'HR' } }, env, { key: 'k:1' }, 'READ');
      expect(fail.ok && fail.value.allowed).toBe(false);
    });

    it('should evaluate NOT_EQUALS operator correctly', async () => {
      const rule: AclRule = {
        id: 'abac_neq',
        name: 'ABAC Not Equals',
        subjectOrRole: '*',
        originPattern: '*',
        keyPattern: 'k:*',
        actions: ['READ'],
        effect: 'ALLOW',
        conditions: [{ field: 'subject.attributes.status', operator: 'NOT_EQUALS', value: 'BANNED' }],
      };
      await engine.registerRule(rule);

      const env: AclEnvironmentContext = { origin: 'https://a.com', timestamp: Date.now() };

      const pass = await engine.evaluateAccess({ subjectId: 's1', roles: [], attributes: { status: 'ACTIVE' } }, env, { key: 'k:1' }, 'READ');
      expect(pass.ok && pass.value.allowed).toBe(true);

      const fail = await engine.evaluateAccess({ subjectId: 's2', roles: [], attributes: { status: 'BANNED' } }, env, { key: 'k:1' }, 'READ');
      expect(fail.ok && fail.value.allowed).toBe(false);
    });

    it('should evaluate CONTAINS operator for strings and arrays', async () => {
      const ruleStr: AclRule = {
        id: 'abac_contains_str',
        name: 'ABAC Contains String',
        subjectOrRole: '*',
        originPattern: '*',
        keyPattern: 'k:*',
        actions: ['READ'],
        effect: 'ALLOW',
        conditions: [{ field: 'resource.key', operator: 'CONTAINS', value: 'sensitive' }],
      };
      await engine.registerRule(ruleStr);

      const env: AclEnvironmentContext = { origin: 'https://a.com', timestamp: Date.now() };
      const sub: AclSubjectContext = { subjectId: 's1', roles: [] };

      const passStr = await engine.evaluateAccess(sub, env, { key: 'k:sensitive_data' }, 'READ');
      expect(passStr.ok && passStr.value.allowed).toBe(true);

      const failStr = await engine.evaluateAccess(sub, env, { key: 'k:public_data' }, 'READ');
      expect(failStr.ok && failStr.value.allowed).toBe(false);
    });

    it('should evaluate GREATER_THAN and LESS_THAN with strict boundary checks', async () => {
      const ruleNum: AclRule = {
        id: 'abac_num',
        name: 'ABAC Number Boundaries',
        subjectOrRole: '*',
        originPattern: '*',
        keyPattern: 'k:*',
        actions: ['READ'],
        effect: 'ALLOW',
        conditions: [
          { field: 'env.timestamp', operator: 'GREATER_THAN', value: 100 },
          { field: 'env.timestamp', operator: 'LESS_THAN', value: 200 },
        ],
      };
      await engine.registerRule(ruleNum);

      const sub: AclSubjectContext = { subjectId: 's1', roles: [] };

      // 150 is > 100 AND < 200 -> pass
      const pass = await engine.evaluateAccess(sub, { origin: 'https://a.com', timestamp: 150 }, { key: 'k:1' }, 'READ');
      expect(pass.ok && pass.value.allowed).toBe(true);

      // 100 is NOT > 100 -> fail
      const failLow = await engine.evaluateAccess(sub, { origin: 'https://a.com', timestamp: 100 }, { key: 'k:1' }, 'READ');
      expect(failLow.ok && failLow.value.allowed).toBe(false);

      // 200 is NOT < 200 -> fail
      const failHigh = await engine.evaluateAccess(sub, { origin: 'https://a.com', timestamp: 200 }, { key: 'k:1' }, 'READ');
      expect(failHigh.ok && failHigh.value.allowed).toBe(false);
    });

    it('should evaluate IN_ARRAY operator correctly', async () => {
      const ruleArr: AclRule = {
        id: 'abac_in_arr',
        name: 'ABAC In Array',
        subjectOrRole: '*',
        originPattern: '*',
        keyPattern: 'k:*',
        actions: ['READ'],
        effect: 'ALLOW',
        conditions: [{ field: 'subject.subjectId', operator: 'IN_ARRAY', value: ['alice', 'bob'] }],
      };
      await engine.registerRule(ruleArr);

      const env: AclEnvironmentContext = { origin: 'https://a.com', timestamp: Date.now() };

      const pass = await engine.evaluateAccess({ subjectId: 'alice', roles: [] }, env, { key: 'k:1' }, 'READ');
      expect(pass.ok && pass.value.allowed).toBe(true);

      const fail = await engine.evaluateAccess({ subjectId: 'charlie', roles: [] }, env, { key: 'k:1' }, 'READ');
      expect(fail.ok && fail.value.allowed).toBe(false);
    });

    it('should return false for invalid or unknown ABAC operator', async () => {
      const ruleBadOp: AclRule = {
        id: 'abac_bad_op',
        name: 'ABAC Bad Operator',
        subjectOrRole: '*',
        originPattern: '*',
        keyPattern: 'k:*',
        actions: ['READ'],
        effect: 'ALLOW',
        conditions: [{ field: 'subject.subjectId', operator: 'UNKNOWN' as any, value: 'test' }],
      };
      await engine.registerRule(ruleBadOp);

      const env: AclEnvironmentContext = { origin: 'https://a.com', timestamp: Date.now() };
      const res = await engine.evaluateAccess({ subjectId: 'test', roles: [] }, env, { key: 'k:1' }, 'READ');
      expect(res.ok && res.value.allowed).toBe(false);
    });
  });

  describe('HMAC Bearer Token Issuance & Verification', () => {
    it('should issue and verify valid signed ACL bearer token', async () => {
      const subject: AclSubjectContext = { subjectId: 'subject_token_1', roles: ['user'] };
      const issueRes = await engine.issueAccessToken(subject, ['READ:user:*', 'WRITE:session:*'], 3600, SECRET);
      expect(issueRes.ok).toBe(true);
      if (!issueRes.ok) return;

      const tokenString = issueRes.value;
      const env: AclEnvironmentContext = { origin: 'https://app.com', timestamp: Date.now() };
      const resource: AclResourceContext = { key: 'user:profile' };

      const verifyRes = await engine.verifyTokenAccess(tokenString, env, resource, 'READ', SECRET);
      expect(verifyRes.ok).toBe(true);
      if (verifyRes.ok) {
        expect(verifyRes.value.allowed).toBe(true);
        expect(verifyRes.value.subjectId).toBe('subject_token_1');
      }
    });

    it('should support wildcard token scope "*"', async () => {
      const subject: AclSubjectContext = { subjectId: 'wild_token_user', roles: [] };
      const issueRes = await engine.issueAccessToken(subject, ['*'], 3600, SECRET);
      expect(issueRes.ok).toBe(true);
      if (!issueRes.ok) return;

      const env: AclEnvironmentContext = { origin: 'https://app.com', timestamp: Date.now() };
      const verifyRes = await engine.verifyTokenAccess(issueRes.value, env, { key: 'any:key' }, 'DELETE', SECRET);
      expect(verifyRes.ok && verifyRes.value.allowed).toBe(true);
    });

    it('should distinguish between ACL_KEY_RESTRICTED vs ACL_SCOPE_INSUFFICIENT in token verification', async () => {
      const subject: AclSubjectContext = { subjectId: 'scope_user', roles: [] };
      // Scope has WRITE on user:* only
      const issueRes = await engine.issueAccessToken(subject, ['WRITE:user:*'], 3600, SECRET);
      if (!issueRes.ok) return;

      const env: AclEnvironmentContext = { origin: 'https://app.com', timestamp: Date.now() };

      // Case A: Action is WRITE, but key is 'system:config' -> ACL_KEY_RESTRICTED
      const resKeyRestricted = await engine.verifyTokenAccess(issueRes.value, env, { key: 'system:config' }, 'WRITE', SECRET);
      expect(resKeyRestricted.ok).toBe(true);
      if (resKeyRestricted.ok) {
        expect(resKeyRestricted.value.allowed).toBe(false);
      }

      // Case B: Action is DELETE on 'user:123' -> Action mismatch
      const resScopeInsuf = await engine.verifyTokenAccess(issueRes.value, env, { key: 'user:123' }, 'DELETE', SECRET);
      expect(resScopeInsuf.ok).toBe(true);
      if (resScopeInsuf.ok) {
        expect(resScopeInsuf.value.allowed).toBe(false);
      }
    });

    it('should return error when issuing token with missing or null parameters', async () => {
      const subject: AclSubjectContext = { subjectId: 's1', roles: [] };

      const res1 = await engine.issueAccessToken(null as any, ['READ:*'], 3600, SECRET);
      expect(res1.ok).toBe(false);

      const res2 = await engine.issueAccessToken(subject, null as any, 3600, SECRET);
      expect(res2.ok).toBe(false);

      const res3 = await engine.issueAccessToken(subject, ['READ:*'], 3600, '');
      expect(res3.ok).toBe(false);
    });

    it('should reject invalid or malformed token strings with ACL_TOKEN_INVALID', async () => {
      const env: AclEnvironmentContext = { origin: 'https://app.com', timestamp: Date.now() };
      const resource: AclResourceContext = { key: 'any:key' };

      const res1 = await engine.verifyTokenAccess('', env, resource, 'READ', SECRET);
      expect(res1.ok).toBe(false);
      if (!res1.ok) expect(res1.error.code).toBe('ACL_TOKEN_INVALID');

      const res2 = await engine.verifyTokenAccess('not_a_valid_json_or_b64!!!', env, resource, 'READ', SECRET);
      expect(res2.ok).toBe(false);
      if (!res2.ok) expect(res2.error.code).toBe('ACL_TOKEN_INVALID');

      const res3 = await engine.verifyTokenAccess(btoa(JSON.stringify({ missingId: 1 })), env, resource, 'READ', SECRET);
      expect(res3.ok).toBe(false);
      if (!res3.ok) expect(res3.error.code).toBe('ACL_TOKEN_INVALID');
    });

    it('should reject expired bearer tokens (now > expiresAt) with ACL_TOKEN_EXPIRED', async () => {
      const subject: AclSubjectContext = { subjectId: 'exp_user', roles: [] };
      const issueRes = await engine.issueAccessToken(subject, ['READ:*'], -10, SECRET);
      expect(issueRes.ok).toBe(true);
      if (!issueRes.ok) return;

      const env: AclEnvironmentContext = { origin: 'https://app.com', timestamp: Date.now() };
      const resource: AclResourceContext = { key: 'any:key' };

      const verifyRes = await engine.verifyTokenAccess(issueRes.value, env, resource, 'READ', SECRET);
      expect(verifyRes.ok).toBe(false);
      if (!verifyRes.ok) {
        expect(verifyRes.error.code).toBe('ACL_TOKEN_EXPIRED');
      }
    });

    it('should test exact boundary timestamp for token expiration (off-by-one killer test)', async () => {
      const now = 1000000;
      const tokenData = {
        tokenId: 'tok_boundary',
        subjectId: 'sub_b',
        roles: [],
        scopes: ['READ:*'],
        issuedAt: now - 1000,
        expiresAt: now,
        issuer: 'StorageAclEngine',
      };

      const signer = engine['hmacSigner'];
      const signRes = await signer.sign(JSON.stringify(tokenData), SECRET);
      expect(signRes.ok).toBe(true);
      if (!signRes.ok) return;

      const tokenString = btoa(JSON.stringify({ ...tokenData, signature: signRes.value }));

      // exact boundary now == expiresAt (1000000 > 1000000 is false, so NOT expired)
      const resExact = await engine.verifyTokenAccess(
        tokenString,
        { origin: 'https://app.com', timestamp: now },
        { key: 'test:key' },
        'READ',
        SECRET
      );
      expect(resExact.ok).toBe(true);

      // now == expiresAt + 1 (1000001 > 1000000 is true, so EXPIRED)
      const resAfter = await engine.verifyTokenAccess(
        tokenString,
        { origin: 'https://app.com', timestamp: now + 1 },
        { key: 'test:key' },
        'READ',
        SECRET
      );
      expect(resAfter.ok).toBe(false);
      if (!resAfter.ok) {
        expect(resAfter.error.code).toBe('ACL_TOKEN_EXPIRED');
      }
    });

    it('should reject future tokens (now < issuedAt) with ACL_TOKEN_NOT_YET_VALID', async () => {
      const now = Date.now();
      const tokenData = {
        tokenId: 'tok_future',
        subjectId: 'sub_f',
        roles: [],
        scopes: ['READ:*'],
        issuedAt: now + 10000,
        expiresAt: now + 20000,
        issuer: 'StorageAclEngine',
      };

      const signer = engine['hmacSigner'];
      const signRes = await signer.sign(JSON.stringify(tokenData), SECRET);
      if (!signRes.ok) return;

      const tokenString = btoa(JSON.stringify({ ...tokenData, signature: signRes.value }));

      const verifyRes = await engine.verifyTokenAccess(
        tokenString,
        { origin: 'https://app.com', timestamp: now },
        { key: 'test:key' },
        'READ',
        SECRET
      );

      expect(verifyRes.ok).toBe(false);
      if (!verifyRes.ok) {
        expect(verifyRes.error.code).toBe('ACL_TOKEN_NOT_YET_VALID');
      }
    });

    it('should reject revoked tokens with ACL_TOKEN_REVOKED', async () => {
      const subject: AclSubjectContext = { subjectId: 'rev_user', roles: [] };
      const issueRes = await engine.issueAccessToken(subject, ['READ:*'], 3600, SECRET);
      if (!issueRes.ok) return;

      const tokenString = issueRes.value;
      const decoded = JSON.parse(atob(tokenString));

      engine.revokeToken(decoded.tokenId);
      expect(engine.isTokenRevoked(decoded.tokenId)).toBe(true);

      const env: AclEnvironmentContext = { origin: 'https://app.com', timestamp: Date.now() };
      const resource: AclResourceContext = { key: 'any:key' };

      const verifyRes = await engine.verifyTokenAccess(tokenString, env, resource, 'READ', SECRET);
      expect(verifyRes.ok).toBe(false);
      if (!verifyRes.ok) {
        expect(verifyRes.error.code).toBe('ACL_TOKEN_REVOKED');
      }
    });

    it('should reject tampered HMAC signature with ACL_TOKEN_INVALID', async () => {
      const subject: AclSubjectContext = { subjectId: 'tamper_user', roles: [] };
      const issueRes = await engine.issueAccessToken(subject, ['READ:*'], 3600, SECRET);
      if (!issueRes.ok) return;

      const env: AclEnvironmentContext = { origin: 'https://app.com', timestamp: Date.now() };
      const resource: AclResourceContext = { key: 'any:key' };

      const verifyRes = await engine.verifyTokenAccess(issueRes.value, env, resource, 'READ', 'wrong_secret_key');
      expect(verifyRes.ok).toBe(false);
      if (!verifyRes.ok) {
        expect(verifyRes.error.code).toBe('ACL_TOKEN_INVALID');
      }
    });
  });

  describe('Engine Delegate Methods & ABAC Edge Cases', () => {
    it('should delegate getAllRules, revokeRule, and defineRole to repository', async () => {
      const rule: AclRule = {
        id: 'r_del',
        name: 'Del Rule',
        subjectOrRole: 'sub_del',
        originPattern: '*',
        keyPattern: '*',
        actions: ['READ'],
        effect: 'ALLOW',
      };
      const regRes = await engine.registerRule(rule);
      expect(regRes.ok).toBe(true);

      const allRes = await engine.getAllRules();
      expect(allRes.ok).toBe(true);
      if (allRes.ok) {
        expect(allRes.value).toHaveLength(1);
        expect(allRes.value[0].id).toBe('r_del');
      }

      const revRes = await engine.revokeRule('r_del');
      expect(revRes.ok).toBe(true);

      const allResAfter = await engine.getAllRules();
      expect(allResAfter.ok && allResAfter.value).toHaveLength(0);

      const roleDef: AclRoleDefinition = {
        roleName: 'custom_role',
        rules: [rule],
      };
      const defRoleRes = await engine.defineRole(roleDef);
      expect(defRoleRes.ok).toBe(true);
    });

    it('should evaluate ABAC conditions with env and resource fieldPaths', async () => {
      const rule: AclRule = {
        id: 'r_abac_env',
        name: 'ABAC Env Rule',
        subjectOrRole: 'user_abac',
        originPattern: '*',
        keyPattern: '*',
        actions: ['READ'],
        effect: 'ALLOW',
        conditions: [
          { field: 'origin', operator: 'EQUALS', value: 'https://app.com' },
          { field: 'env_custom', operator: 'EQUALS', value: 'secret_env' },
          { field: 'res_type', operator: 'EQUALS', value: 'confidential' },
        ],
      };
      await engine.registerRule(rule);

      const subject: AclSubjectContext = { subjectId: 'user_abac', roles: [] };
      const env: AclEnvironmentContext = { origin: 'https://app.com', timestamp: Date.now() } as any;
      (env as any).env_custom = 'secret_env';
      const resource: AclResourceContext = { key: 'data:1', res_type: 'confidential' } as any;

      const evalRes = await engine.evaluateAccess(subject, env, resource, 'READ');
      expect(evalRes.ok).toBe(true);
      if (evalRes.ok) {
        expect(evalRes.value.allowed).toBe(true);
      }
    });

    it('should support wildcard token scope *', async () => {
      const subject: AclSubjectContext = { subjectId: 'star_scope_user', roles: [] };
      const issueRes = await engine.issueAccessToken(subject, ['*'], 3600, SECRET);
      expect(issueRes.ok).toBe(true);
      if (!issueRes.ok) return;

      const env: AclEnvironmentContext = { origin: 'https://app.com', timestamp: Date.now() + 1000 };
      const resource: AclResourceContext = { key: 'any:secret:key' };

      const verifyRes = await engine.verifyTokenAccess(issueRes.value, env, resource, 'DELETE', SECRET);
      expect(verifyRes.ok).toBe(true);
      if (verifyRes.ok) {
        expect(verifyRes.value.allowed).toBe(true);
      }
    });
  });
});
