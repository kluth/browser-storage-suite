import { describe, it, expect, beforeEach } from 'vitest';
import { StorageAclEngine } from '../utils/storageAclEngine';
import {
  AclRule,
  AclSubjectContext,
  AclEnvironmentContext,
  AclResourceContext,
  AclAction,
} from '../src/domain/model/storageAcl';

describe('StorageAclEngine Empirical Adversarial Security Harness', () => {
  let engine: StorageAclEngine;
  const SECRET_KEY = 'super_secret_hmac_key_for_adversarial_testing_2026';
  const WRONG_SECRET = 'evil_attacker_secret_key_666';

  beforeEach(() => {
    engine = new StorageAclEngine({ defaultEffect: 'DENY' });
  });

  // =========================================================================
  // 1. Origin Domain Boundary Spoofing Tests
  // =========================================================================
  describe('1. Origin Domain Boundary Spoofing', () => {
    it('should DENY origin example.com.attacker.com matching pattern *.example.com', () => {
      const pattern = '*.example.com';
      const origin = 'https://example.com.attacker.com';
      const isMatched = engine.matchOrigin(pattern, origin);
      expect(isMatched).toBe(false);
    });

    it('should DENY origin attacker-example.com matching pattern *.example.com', () => {
      const pattern = '*.example.com';
      const origin = 'https://attacker-example.com';
      const isMatched = engine.matchOrigin(pattern, origin);
      expect(isMatched).toBe(false);
    });

    it('should DENY origin example.com.org matching pattern *.example.com', () => {
      const pattern = '*.example.com';
      const origin = 'https://example.com.org';
      const isMatched = engine.matchOrigin(pattern, origin);
      expect(isMatched).toBe(false);
    });

    it('should ALLOW valid subdomains for pattern *.example.com', () => {
      expect(engine.matchOrigin('*.example.com', 'https://sub.example.com')).toBe(true);
      expect(engine.matchOrigin('*.example.com', 'https://deep.sub.example.com')).toBe(true);
      expect(engine.matchOrigin('*.example.com', 'https://example.com')).toBe(true);
    });

    it('should check origin pattern matching with scheme constraint https://*.example.com', () => {
      // Valid HTTPS origin
      expect(engine.matchOrigin('https://*.example.com', 'https://sub.example.com')).toBe(true);
      // Boundary spoofing attempt
      expect(engine.matchOrigin('https://*.example.com', 'https://example.com.attacker.com')).toBe(false);
      // Scheme mismatch
      expect(engine.matchOrigin('https://*.example.com', 'http://sub.example.com')).toBe(false);
    });

    it('should check wildcard scheme origin matching *://sub.example.com', () => {
      expect(engine.matchOrigin('*://sub.example.com', 'https://sub.example.com')).toBe(true);
      expect(engine.matchOrigin('*://sub.example.com', 'http://sub.example.com')).toBe(true);
      expect(engine.matchOrigin('*://sub.example.com', 'https://sub.example.com.attacker.com')).toBe(false);
    });

    it('should test port matching in origin patterns', () => {
      expect(engine.matchOrigin('http://localhost:*', 'http://localhost:3000')).toBe(true);
      expect(engine.matchOrigin('http://localhost:*', 'http://localhost:8080')).toBe(true);
      expect(engine.matchOrigin('http://localhost:*', 'http://attacker.com:3000')).toBe(false);
    });

    it('should test full access evaluation policy with origin spoofing attempts', async () => {
      const rule: AclRule = {
        id: 'rule_subdomain_only',
        name: 'Subdomain Only Rule',
        subjectOrRole: '*',
        originPattern: 'https://*.trusted-partner.com',
        keyPattern: 'partner:*',
        actions: ['READ'],
        effect: 'ALLOW',
      };
      await engine.registerRule(rule);

      const subject: AclSubjectContext = { subjectId: 'user_1', roles: [] };
      const resource: AclResourceContext = { key: 'partner:data' };

      // Legitimate origin -> ALLOW
      const resLegit = await engine.evaluateAccess(
        subject,
        { origin: 'https://api.trusted-partner.com', timestamp: Date.now() },
        resource,
        'READ'
      );
      expect(resLegit.ok && resLegit.value.allowed).toBe(true);

      // Spoofed origin -> DENY
      const resSpoofed = await engine.evaluateAccess(
        subject,
        { origin: 'https://trusted-partner.com.evil.com', timestamp: Date.now() },
        resource,
        'READ'
      );
      expect(resSpoofed.ok && resSpoofed.value.allowed).toBe(false);
    });
  });

  // =========================================================================
  // 2. Forged HMAC Bearer Tokens Tests
  // =========================================================================
  describe('2. Forged HMAC Bearer Tokens', () => {
    it('should REJECT token signed with wrong secret key', async () => {
      const subject: AclSubjectContext = { subjectId: 'user_alice', roles: ['user'] };
      const env: AclEnvironmentContext = { origin: 'https://app.com', timestamp: Date.now() + 5000 };

      // Token signed with SECRET_KEY
      const tokenRes = await engine.issueAccessToken(subject, ['READ:user:*'], 3600, SECRET_KEY);
      expect(tokenRes.ok).toBe(true);
      if (!tokenRes.ok) return;

      const tokenString = tokenRes.value;

      // Verify with WRONG_SECRET -> must fail
      const verifyRes = await engine.verifyTokenAccess(
        tokenString,
        env,
        { key: 'user:profile' },
        'READ',
        WRONG_SECRET
      );

      expect(verifyRes.ok).toBe(false);
      if (!verifyRes.ok) {
        expect(verifyRes.error.code).toBe('ACL_TOKEN_INVALID');
      }
    });

    it('should REJECT token when payload bit subjectId is altered', async () => {
      const subject: AclSubjectContext = { subjectId: 'user_regular', roles: ['user'] };
      const env: AclEnvironmentContext = { origin: 'https://app.com', timestamp: Date.now() + 5000 };

      const tokenRes = await engine.issueAccessToken(subject, ['READ:user:*'], 3600, SECRET_KEY);
      expect(tokenRes.ok).toBe(true);
      if (!tokenRes.ok) return;

      // Decode token, alter subjectId to super_admin, re-encode without updating signature
      const decoded = JSON.parse(atob(tokenRes.value));
      decoded.subjectId = 'super_admin';
      const forgedTokenStr = btoa(JSON.stringify(decoded));

      const verifyRes = await engine.verifyTokenAccess(
        forgedTokenStr,
        env,
        { key: 'user:profile' },
        'READ',
        SECRET_KEY
      );

      expect(verifyRes.ok).toBe(false);
      if (!verifyRes.ok) {
        expect(verifyRes.error.code).toBe('ACL_TOKEN_INVALID');
      }
    });

    it('should REJECT token when payload bit scopes is escalated', async () => {
      const subject: AclSubjectContext = { subjectId: 'user_regular', roles: ['user'] };
      const env: AclEnvironmentContext = { origin: 'https://app.com', timestamp: Date.now() + 5000 };

      const tokenRes = await engine.issueAccessToken(subject, ['READ:user:own_*'], 3600, SECRET_KEY);
      expect(tokenRes.ok).toBe(true);
      if (!tokenRes.ok) return;

      // Escalate scopes to '*'
      const decoded = JSON.parse(atob(tokenRes.value));
      decoded.scopes = ['*'];
      const forgedTokenStr = btoa(JSON.stringify(decoded));

      const verifyRes = await engine.verifyTokenAccess(
        forgedTokenStr,
        env,
        { key: 'admin:secret' },
        'WRITE',
        SECRET_KEY
      );

      expect(verifyRes.ok).toBe(false);
      if (!verifyRes.ok) {
        expect(verifyRes.error.code).toBe('ACL_TOKEN_INVALID');
      }
    });

    it('should REJECT token when payload bit expiresAt is extended into future', async () => {
      const subject: AclSubjectContext = { subjectId: 'user_1', roles: [] };

      // Issue token expiring in 1 second
      const tokenRes = await engine.issueAccessToken(subject, ['READ:*'], 1, SECRET_KEY);
      expect(tokenRes.ok).toBe(true);
      if (!tokenRes.ok) return;

      const decoded = JSON.parse(atob(tokenRes.value));
      // Tamper expiresAt to 10 years in future
      decoded.expiresAt = Date.now() + 10 * 365 * 86400 * 1000;
      const forgedTokenStr = btoa(JSON.stringify(decoded));

      // Wait 1.1s so real token would be expired
      const futureEnv: AclEnvironmentContext = {
        origin: 'https://app.com',
        timestamp: decoded.issuedAt + 2000,
      };

      const verifyRes = await engine.verifyTokenAccess(
        forgedTokenStr,
        futureEnv,
        { key: 'any:key' },
        'READ',
        SECRET_KEY
      );

      expect(verifyRes.ok).toBe(false);
      if (!verifyRes.ok) {
        expect(verifyRes.error.code).toBe('ACL_TOKEN_INVALID');
      }
    });

    it('should REJECT token with truncated or corrupted signature', async () => {
      const subject: AclSubjectContext = { subjectId: 'user_1', roles: [] };
      const env: AclEnvironmentContext = { origin: 'https://app.com', timestamp: Date.now() };

      const tokenRes = await engine.issueAccessToken(subject, ['READ:*'], 3600, SECRET_KEY);
      expect(tokenRes.ok).toBe(true);
      if (!tokenRes.ok) return;

      const decoded = JSON.parse(atob(tokenRes.value));
      decoded.signature = decoded.signature.slice(0, 10); // truncate signature
      const corruptedTokenStr = btoa(JSON.stringify(decoded));

      const verifyRes = await engine.verifyTokenAccess(
        corruptedTokenStr,
        env,
        { key: 'any:key' },
        'READ',
        SECRET_KEY
      );

      expect(verifyRes.ok).toBe(false);
      if (!verifyRes.ok) {
        expect(verifyRes.error.code).toBe('ACL_TOKEN_INVALID');
      }
    });

    it('should REJECT random non-JSON base64 strings', async () => {
      const env: AclEnvironmentContext = { origin: 'https://app.com', timestamp: Date.now() };
      const randomBase64 = btoa('this is not json at all');

      const verifyRes = await engine.verifyTokenAccess(
        randomBase64,
        env,
        { key: 'key' },
        'READ',
        SECRET_KEY
      );

      expect(verifyRes.ok).toBe(false);
      if (!verifyRes.ok) {
        expect(verifyRes.error.code).toBe('ACL_TOKEN_INVALID');
      }
    });
  });

  // =========================================================================
  // 3. Token Lifecycle: Expired, Future-Dated, and Revoked Tokens
  // =========================================================================
  describe('3. Token Lifecycle: Expired, Future-Dated, and Revoked Tokens', () => {
    it('should REJECT expired token when current timestamp > expiresAt', async () => {
      const subject: AclSubjectContext = { subjectId: 'user_exp', roles: [] };
      const now = 1700000000000;

      const tokenRes = await engine.issueAccessToken(subject, ['READ:*'], 60, SECRET_KEY);
      expect(tokenRes.ok).toBe(true);
      if (!tokenRes.ok) return;

      const decoded = JSON.parse(atob(tokenRes.value));
      const expiresAt = decoded.expiresAt;

      // Timestamp past expiresAt
      const expiredEnv: AclEnvironmentContext = {
        origin: 'https://app.com',
        timestamp: expiresAt + 1,
      };

      const verifyRes = await engine.verifyTokenAccess(
        tokenRes.value,
        expiredEnv,
        { key: 'data' },
        'READ',
        SECRET_KEY
      );

      expect(verifyRes.ok).toBe(false);
      if (!verifyRes.ok) {
        expect(verifyRes.error.code).toBe('ACL_TOKEN_EXPIRED');
      }
    });

    it('should ALLOW token when current timestamp is exactly equal to expiresAt', async () => {
      const subject: AclSubjectContext = { subjectId: 'user_exp', roles: [] };

      const tokenRes = await engine.issueAccessToken(subject, ['READ:*'], 60, SECRET_KEY);
      expect(tokenRes.ok).toBe(true);
      if (!tokenRes.ok) return;

      const decoded = JSON.parse(atob(tokenRes.value));

      const boundaryEnv: AclEnvironmentContext = {
        origin: 'https://app.com',
        timestamp: decoded.expiresAt, // exactly equal
      };

      const verifyRes = await engine.verifyTokenAccess(
        tokenRes.value,
        boundaryEnv,
        { key: 'data' },
        'READ',
        SECRET_KEY
      );

      expect(verifyRes.ok).toBe(true);
    });

    it('should REJECT future-dated token when current timestamp < issuedAt', async () => {
      const subject: AclSubjectContext = { subjectId: 'user_fut', roles: [] };
      const now = Date.now();

      const tokenRes = await engine.issueAccessToken(subject, ['READ:*'], 3600, SECRET_KEY);
      expect(tokenRes.ok).toBe(true);
      if (!tokenRes.ok) return;

      const decoded = JSON.parse(atob(tokenRes.value));

      // Timestamp before issuedAt
      const pastEnv: AclEnvironmentContext = {
        origin: 'https://app.com',
        timestamp: decoded.issuedAt - 1000,
      };

      const verifyRes = await engine.verifyTokenAccess(
        tokenRes.value,
        pastEnv,
        { key: 'data' },
        'READ',
        SECRET_KEY
      );

      expect(verifyRes.ok).toBe(false);
      if (!verifyRes.ok) {
        expect(verifyRes.error.code).toBe('ACL_TOKEN_NOT_YET_VALID');
      }
    });

    it('should REJECT revoked token present in revocation registry', async () => {
      const subject: AclSubjectContext = { subjectId: 'user_rev', roles: [] };
      const env: AclEnvironmentContext = { origin: 'https://app.com', timestamp: Date.now() };

      const tokenRes = await engine.issueAccessToken(subject, ['READ:*'], 3600, SECRET_KEY);
      expect(tokenRes.ok).toBe(true);
      if (!tokenRes.ok) return;

      const decoded = JSON.parse(atob(tokenRes.value));

      // Verify token BEFORE revocation -> ALLOW
      const verifyBefore = await engine.verifyTokenAccess(
        tokenRes.value,
        env,
        { key: 'data' },
        'READ',
        SECRET_KEY
      );
      expect(verifyBefore.ok && verifyBefore.value.allowed).toBe(true);

      // Revoke token
      engine.revokeToken(decoded.tokenId);
      expect(engine.isTokenRevoked(decoded.tokenId)).toBe(true);

      // Verify token AFTER revocation -> REJECT
      const verifyAfter = await engine.verifyTokenAccess(
        tokenRes.value,
        env,
        { key: 'data' },
        'READ',
        SECRET_KEY
      );

      expect(verifyAfter.ok).toBe(false);
      if (!verifyAfter.ok) {
        expect(verifyAfter.error.code).toBe('ACL_TOKEN_REVOKED');
      }
    });
  });

  // =========================================================================
  // 4. Scope Claims & Key Pattern Wildcard Traversal
  // =========================================================================
  describe('4. Scope Claims & Key Pattern Wildcard Traversal', () => {
    it('should evaluate empty key pattern in scope claim READ:', async () => {
      const subject: AclSubjectContext = { subjectId: 'user_scope', roles: [] };
      const env: AclEnvironmentContext = { origin: 'https://app.com', timestamp: Date.now() };

      // Scope with empty key pattern
      const tokenRes = await engine.issueAccessToken(subject, ['READ:'], 3600, SECRET_KEY);
      expect(tokenRes.ok).toBe(true);
      if (!tokenRes.ok) return;

      const verifyRes = await engine.verifyTokenAccess(
        tokenRes.value,
        env,
        { key: 'secret:vault:key' },
        'READ',
        SECRET_KEY
      );

      expect(verifyRes.ok).toBe(true);
      if (verifyRes.ok) {
        expect(verifyRes.value.allowed).toBe(false);
      }

      // Document empirical behavior of empty key pattern scope
      console.log(
        `[ADVERSARIAL CHECK] Scope 'READ:' on key 'secret:vault:key': ok=${verifyRes.ok}, allowed=${
          verifyRes.ok ? verifyRes.value.allowed : 'error'
        }`
      );
    });

    it('should evaluate action scope mismatch and return ACL_SCOPE_INSUFFICIENT', async () => {
      const subject: AclSubjectContext = { subjectId: 'user_read_only', roles: [] };
      const env: AclEnvironmentContext = { origin: 'https://app.com', timestamp: Date.now() };

      const tokenRes = await engine.issueAccessToken(subject, ['READ:user:*'], 3600, SECRET_KEY);
      expect(tokenRes.ok).toBe(true);
      if (!tokenRes.ok) return;

      // Request WRITE action with READ-only scope
      const verifyRes = await engine.verifyTokenAccess(
        tokenRes.value,
        env,
        { key: 'user:profile' },
        'WRITE',
        SECRET_KEY
      );

      expect(verifyRes.ok).toBe(true);
      if (verifyRes.ok) {
        expect(verifyRes.value.allowed).toBe(false);
        expect(verifyRes.value.reason).toContain('does not permit action');
      }
    });

    it('should evaluate key scope mismatch and return ACL_KEY_RESTRICTED', async () => {
      const subject: AclSubjectContext = { subjectId: 'user_restricted', roles: [] };
      const env: AclEnvironmentContext = { origin: 'https://app.com', timestamp: Date.now() };

      const tokenRes = await engine.issueAccessToken(subject, ['READ:public:*'], 3600, SECRET_KEY);
      expect(tokenRes.ok).toBe(true);
      if (!tokenRes.ok) return;

      // Request READ action on admin key
      const verifyRes = await engine.verifyTokenAccess(
        tokenRes.value,
        env,
        { key: 'admin:config' },
        'READ',
        SECRET_KEY
      );

      expect(verifyRes.ok).toBe(true);
      if (verifyRes.ok) {
        expect(verifyRes.value.allowed).toBe(false);
      }
    });

    it('should test directory traversal attempt in storage key user/../../system', () => {
      const pattern = 'user:*';
      const keyTraversal = 'user:123/../../system:config';

      const match = engine.matchKeyPattern(pattern, keyTraversal);
      // Check prefix matching behavior on path traversal strings
      expect(match).toBe(true); // prefix 'user:' matches key starting with 'user:'
    });
  });

  // =========================================================================
  // 5. Prototype Pollution in ABAC Condition Evaluation
  // =========================================================================
  describe('5. Prototype Pollution in ABAC Condition Evaluation', () => {
    it('should not pollute Object.prototype when evaluating ABAC condition targeting __proto__', async () => {
      const rule: AclRule = {
        id: 'rule_proto_test',
        name: 'Prototype Pollution Test',
        subjectOrRole: '*',
        originPattern: '*',
        keyPattern: '*',
        actions: ['READ'],
        effect: 'ALLOW',
        conditions: [
          { field: 'subject.attributes.__proto__.polluted', operator: 'EQUALS', value: 'yes' },
        ],
      };
      await engine.registerRule(rule);

      const subject: AclSubjectContext = {
        subjectId: 'user_proto',
        roles: [],
        attributes: {},
      };
      const env: AclEnvironmentContext = { origin: 'https://app.com', timestamp: Date.now() };
      const resource: AclResourceContext = { key: 'data' };

      const res = await engine.evaluateAccess(subject, env, resource, 'READ');
      expect(res.ok).toBe(true);

      // Ensure global Object.prototype was NOT polluted
      expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
    });

    it('should handle constructor.prototype path safely in ABAC evaluation', async () => {
      const rule: AclRule = {
        id: 'rule_constructor_test',
        name: 'Constructor Prototype Test',
        subjectOrRole: '*',
        originPattern: '*',
        keyPattern: '*',
        actions: ['READ'],
        effect: 'ALLOW',
        conditions: [
          { field: 'subject.attributes.constructor.prototype.admin', operator: 'EQUALS', value: true },
        ],
      };
      await engine.registerRule(rule);

      const subject: AclSubjectContext = {
        subjectId: 'user_ctor',
        roles: [],
        attributes: { admin: false },
      };
      const env: AclEnvironmentContext = { origin: 'https://app.com', timestamp: Date.now() };

      const res = await engine.evaluateAccess(subject, env, { key: 'data' }, 'READ');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.allowed).toBe(false);
      }

      // Ensure global Object.prototype was NOT polluted
      expect((Object.prototype as Record<string, unknown>).admin).toBeUndefined();
    });
  });
});
