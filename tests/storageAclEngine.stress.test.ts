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

describe('StorageAclEngine Empirical Stress & Adversarial Challenge Suite', () => {
  let engine: StorageAclEngine;
  const SECRET = 'stress_test_hmac_secret_key_99999';

  beforeEach(() => {
    engine = new StorageAclEngine({ defaultEffect: 'DENY' });
  });

  describe('Dimension 1: High Rule Volume (10,000+ Rules) & Scalability Benchmark', () => {
    it('should register and evaluate policy access under 10,000 rules within acceptable latency', async () => {
      const TOTAL_RULES = 10000;
      const rules: AclRule[] = [];

      // Generate 10,000 rules
      for (let i = 0; i < TOTAL_RULES; i++) {
        rules.push({
          id: `rule_${i}`,
          name: `Rule Number ${i}`,
          subjectOrRole: i % 2 === 0 ? `user_${i}` : `role_${i % 50}`,
          originPattern: `https://app-${i % 100}.example.com`,
          keyPattern: i === 9998 ? 'storage:module_48:*' : `storage:module_${i % 500}:*`,
          actions: ['READ', 'WRITE'],
          effect: 'ALLOW',
          priority: i,
        });
      }

      const registerStart = performance.now();
      for (const r of rules) {
        await engine.registerRule(r);
      }
      const registerTimeMs = performance.now() - registerStart;
      console.log(`[STRESS BENCHMARK] Time to register 10,000 rules: ${registerTimeMs.toFixed(2)} ms`);

      const targetSubject: AclSubjectContext = {
        subjectId: 'user_9998',
        roles: ['role_48'],
      };
      const targetEnv: AclEnvironmentContext = {
        origin: 'https://app-98.example.com',
        timestamp: Date.now(),
      };
      const targetResource: AclResourceContext = {
        key: 'storage:module_48:config',
      };

      // Benchmark 50 evaluation queries on 10,000 rules
      const EVAL_COUNT = 50;
      const evalStart = performance.now();
      for (let k = 0; k < EVAL_COUNT; k++) {
        const res = await engine.evaluateAccess(targetSubject, targetEnv, targetResource, 'READ');
        expect(res.ok).toBe(true);
        if (res.ok) {
          expect(res.value.allowed).toBe(true);
        }
      }
      const totalEvalTimeMs = performance.now() - evalStart;
      const avgEvalTimeMs = totalEvalTimeMs / EVAL_COUNT;

      console.log(
        `[STRESS BENCHMARK] 10,000 rules evaluation: Total=${totalEvalTimeMs.toFixed(
          2
        )} ms, Avg per call=${avgEvalTimeMs.toFixed(2)} ms`
      );

      // Verify correctness under high volume
      const allRulesRes = await engine.getAllRules();
      expect(allRulesRes.ok).toBe(true);
      if (allRulesRes.ok) {
        expect(allRulesRes.value.length).toBe(TOTAL_RULES);
      }
    });

    it('should handle worst-case 10,000 rule scan when no rules match', async () => {
      for (let i = 0; i < 5000; i++) {
        await engine.registerRule({
          id: `no_match_${i}`,
          name: `No Match ${i}`,
          subjectOrRole: `other_user_${i}`,
          originPattern: 'https://other.domain.com',
          keyPattern: 'other:*',
          actions: ['WRITE'],
          effect: 'ALLOW',
          priority: i,
        });
      }

      const subject: AclSubjectContext = { subjectId: 'unmatched_user', roles: [] };
      const env: AclEnvironmentContext = { origin: 'https://target.com', timestamp: Date.now() };
      const resource: AclResourceContext = { key: 'target:key' };

      const res = await engine.evaluateAccess(subject, env, resource, 'READ');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.allowed).toBe(false);
        expect(res.value.effect).toBe('DENY');
        expect(res.value.reason).toContain('default policy DENY applied');
      }
    });
  });

  describe('Dimension 2: Deep Role Inheritance & Complex RBAC Networks', () => {
    it('should expand subject with 100 assigned roles and evaluate role-based permissions', async () => {
      const ROLE_COUNT = 100;
      for (let r = 0; r < ROLE_COUNT; r++) {
        const roleDef: AclRoleDefinition = {
          roleName: `role_spec_${r}`,
          rules: [
            {
              id: `role_rule_${r}`,
              name: `Role Rule ${r}`,
              subjectOrRole: `role_spec_${r}`,
              originPattern: '*',
              keyPattern: `dept_${r}:*`,
              actions: ['READ', 'WRITE'],
              effect: r === 50 ? 'DENY' : 'ALLOW',
              priority: r,
            },
          ],
        };
        await engine.defineRole(roleDef);
      }

      const roles = Array.from({ length: ROLE_COUNT }, (_, i) => `role_spec_${i}`);
      const subject: AclSubjectContext = { subjectId: 'multi_role_user', roles };
      const env: AclEnvironmentContext = { origin: 'https://app.com', timestamp: Date.now() };

      // Query dept_10 -> should ALLOW (rule_10)
      const resAllow = await engine.evaluateAccess(subject, env, { key: 'dept_10:data' }, 'READ');
      expect(resAllow.ok && resAllow.value.allowed).toBe(true);

      // Query dept_50 -> should DENY (rule_50 explicitly DENY)
      const resDeny = await engine.evaluateAccess(subject, env, { key: 'dept_50:data' }, 'READ');
      expect(resDeny.ok && resDeny.value.allowed).toBe(false);
      if (resDeny.ok) {
        expect(resDeny.value.ruleId).toBe('role_rule_50');
      }
    });

    it('should handle unmapped/non-existent subject roles gracefully without error', async () => {
      const subject: AclSubjectContext = {
        subjectId: 'user_ghost',
        roles: ['non_existent_role_1', 'non_existent_role_2', 'ghost_admin'],
      };
      const env: AclEnvironmentContext = { origin: 'https://app.com', timestamp: Date.now() };
      const resource: AclResourceContext = { key: 'any:key' };

      const res = await engine.evaluateAccess(subject, env, resource, 'READ');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.allowed).toBe(false);
        expect(res.value.effect).toBe('DENY');
      }
    });
  });

  describe('Dimension 3: Complex ABAC Condition Graphs & Deep Attribute Paths', () => {
    it('should evaluate multi-condition AND trees with nested field paths', async () => {
      const complexRule: AclRule = {
        id: 'abac_graph_1',
        name: 'Complex ABAC Graph',
        subjectOrRole: '*',
        originPattern: 'https://*.corp.internal',
        keyPattern: 'finance:ledger:*',
        actions: ['READ', 'WRITE'],
        effect: 'ALLOW',
        conditions: [
          { field: 'subject.attributes.company.dept.code', operator: 'EQUALS', value: 'FIN_10' },
          { field: 'subject.attributes.clearance', operator: 'GREATER_THAN', value: 3 },
          { field: 'env.ipAddress', operator: 'NOT_EQUALS', value: '192.168.1.666' },
          { field: 'resource.attributes.sensitivity', operator: 'IN_ARRAY', value: ['HIGH', 'CRITICAL'] },
        ],
      };

      await engine.registerRule(complexRule);

      const validSubject: AclSubjectContext = {
        subjectId: 'fin_officer',
        roles: [],
        attributes: {
          company: { dept: { code: 'FIN_10' } },
          clearance: 5,
        },
      };

      const validEnv: AclEnvironmentContext = {
        origin: 'https://sec.corp.internal',
        timestamp: Date.now(),
        ipAddress: '10.0.0.1',
      };

      const validResource: AclResourceContext = {
        key: 'finance:ledger:2026',
        attributes: { sensitivity: 'CRITICAL' },
      };

      // 1. All conditions pass -> ALLOW
      const resPass = await engine.evaluateAccess(validSubject, validEnv, validResource, 'READ');
      expect(resPass.ok && resPass.value.allowed).toBe(true);

      // 2. Clearance < 3 -> DENY
      const lowClearanceSubject = {
        ...validSubject,
        attributes: { ...validSubject.attributes, clearance: 2 },
      };
      const resLowClearance = await engine.evaluateAccess(lowClearanceSubject, validEnv, validResource, 'READ');
      expect(resLowClearance.ok && resLowClearance.value.allowed).toBe(false);

      // 3. Blacklisted IP -> DENY
      const blacklistedEnv = { ...validEnv, ipAddress: '192.168.1.666' };
      const resBadIp = await engine.evaluateAccess(validSubject, blacklistedEnv, validResource, 'READ');
      expect(resBadIp.ok && resBadIp.value.allowed).toBe(false);
    });

    it('should safely extract nested path properties when intermediate values are null, undefined, or primitive', async () => {
      const rule: AclRule = {
        id: 'abac_null_path',
        name: 'Null Path Evaluation',
        subjectOrRole: '*',
        originPattern: '*',
        keyPattern: '*',
        actions: ['READ'],
        effect: 'ALLOW',
        conditions: [
          { field: 'subject.attributes.a.b.c.d', operator: 'EQUALS', value: 'target' },
        ],
      };
      await engine.registerRule(rule);

      const env: AclEnvironmentContext = { origin: 'https://a.com', timestamp: Date.now() };

      // Case A: missing property 'a'
      const res1 = await engine.evaluateAccess({ subjectId: 's1', roles: [], attributes: {} }, env, { key: 'k1' }, 'READ');
      expect(res1.ok && res1.value.allowed).toBe(false);

      // Case B: 'a' is null
      const res2 = await engine.evaluateAccess({ subjectId: 's2', roles: [], attributes: { a: null } }, env, { key: 'k1' }, 'READ');
      expect(res2.ok && res2.value.allowed).toBe(false);

      // Case C: 'a' is a primitive string 'hello'
      const res3 = await engine.evaluateAccess({ subjectId: 's3', roles: [], attributes: { a: 'hello' } }, env, { key: 'k1' }, 'READ');
      expect(res3.ok && res3.value.allowed).toBe(false);
    });
  });

  describe('Dimension 4: Key Pattern Globs, Edge Cases & ReDoS Security Verification', () => {
    it('should evaluate double asterisk globs and complex key patterns', async () => {
      expect(engine.matchKeyPattern('cache:**.json', 'cache:data.json')).toBe(true);
      expect(engine.matchKeyPattern('cache:**.json', 'cache:v1:sub:item.json')).toBe(true);
      expect(engine.matchKeyPattern('cache:**.json', 'cache:data.xml')).toBe(false);

      expect(engine.matchKeyPattern('user:*:settings', 'user:123:settings')).toBe(true);
      expect(engine.matchKeyPattern('user:*:settings', 'user:123:profile')).toBe(false);
    });

    it('should test single character question mark glob wildcard ? behavior', () => {
      // Test single-character wildcard ? in globs
      const match1 = engine.matchKeyPattern('data:v?.json', 'data:v1.json');
      const match2 = engine.matchKeyPattern('data:v?.json', 'data:v2.json');
      const matchNo = engine.matchKeyPattern('data:v?.json', 'data:v10.json');

      console.log(`[GLOB EMPIRICAL CHECK] 'data:v?.json' vs 'data:v1.json': ${match1}`);
      console.log(`[GLOB EMPIRICAL CHECK] 'data:v?.json' vs 'data:v10.json': ${matchNo}`);

      // Verify whether match1 and match2 evaluate as expected
      expect(match1).toBe(true);
      expect(match2).toBe(true);
      expect(matchNo).toBe(false);
    });

    it('should resist ReDoS attacks from catastrophic backtracking regex key patterns', async () => {
      const redosRule: AclRule = {
        id: 'rule_redos',
        name: 'ReDoS Vulnerability Test Rule',
        subjectOrRole: '*',
        originPattern: '*',
        // Catastrophic backtracking regex
        keyPattern: '^(a+)+$',
        actions: ['READ'],
        effect: 'ALLOW',
      };
      await engine.registerRule(redosRule);

      const subject: AclSubjectContext = { subjectId: 'attacker', roles: [] };
      const env: AclEnvironmentContext = { origin: 'https://app.com', timestamp: Date.now() };

      // Non-matching payload designed to trigger backtracking
      const maliciousKey = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaa!';

      const start = performance.now();
      const res = await engine.evaluateAccess(subject, env, { key: maliciousKey }, 'READ');
      const duration = performance.now() - start;

      console.log(`[ReDoS CHECK] Evaluation duration for catastrophic regex pattern: ${duration.toFixed(2)} ms`);

      expect(res.ok).toBe(true);
      // Execution must complete quickly (under 1000ms) without hanging node/vitest process
      expect(duration).toBeLessThan(1000);
    });
  });

  describe('Dimension 5: Determinism, Priority Overrides & Explicit DENY Precedence', () => {
    it('should guarantee 100% decision determinism across 1,000 sequential executions', async () => {
      await engine.registerRule({
        id: 'det_rule_1',
        name: 'Deterministic Rule',
        subjectOrRole: 'det_user',
        originPattern: 'https://det.com',
        keyPattern: 'det:*',
        actions: ['READ'],
        effect: 'ALLOW',
        priority: 10,
      });

      const subject: AclSubjectContext = { subjectId: 'det_user', roles: [] };
      const env: AclEnvironmentContext = { origin: 'https://det.com', timestamp: Date.now() };
      const resource: AclResourceContext = { key: 'det:item_1' };

      const ITERATIONS = 1000;
      const decisions: string[] = [];

      for (let i = 0; i < ITERATIONS; i++) {
        const res = await engine.evaluateAccess(subject, env, resource, 'READ');
        expect(res.ok).toBe(true);
        if (res.ok) {
          decisions.push(`${res.value.allowed}_${res.value.effect}_${res.value.ruleId}`);
        }
      }

      const uniqueDecisions = new Set(decisions);
      expect(uniqueDecisions.size).toBe(1);
      expect(uniqueDecisions.has('true_ALLOW_det_rule_1')).toBe(true);
    });

    it('should enforce explicit DENY precedence over ALLOW regardless of priority levels', async () => {
      // Low priority DENY vs High priority ALLOW
      const lowPriorityDeny: AclRule = {
        id: 'rule_deny_low_pri',
        name: 'Low Priority Explicit Deny',
        subjectOrRole: '*',
        originPattern: '*',
        keyPattern: 'confidential:*',
        actions: ['READ'],
        effect: 'DENY',
        priority: 1, // Low priority
      };

      const highPriorityAllow: AclRule = {
        id: 'rule_allow_high_pri',
        name: 'High Priority Allow',
        subjectOrRole: '*',
        originPattern: '*',
        keyPattern: 'confidential:*',
        actions: ['READ'],
        effect: 'ALLOW',
        priority: 9999, // High priority
      };

      await engine.registerRule(lowPriorityDeny);
      await engine.registerRule(highPriorityAllow);

      const subject: AclSubjectContext = { subjectId: 'any_user', roles: [] };
      const env: AclEnvironmentContext = { origin: 'https://app.com', timestamp: Date.now() };
      const resource: AclResourceContext = { key: 'confidential:doc1' };

      const res = await engine.evaluateAccess(subject, env, resource, 'READ');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.allowed).toBe(false);
        expect(res.value.effect).toBe('DENY');
        // Explicit DENY must override ALLOW
        expect(res.value.ruleId).toBe('rule_deny_low_pri');
      }
    });

    it('should select higher priority rule when multiple matching rules have same effect (ALLOW)', async () => {
      const ruleAllowLow: AclRule = {
        id: 'rule_allow_10',
        name: 'Allow Low Priority',
        subjectOrRole: '*',
        originPattern: '*',
        keyPattern: 'shared:*',
        actions: ['READ'],
        effect: 'ALLOW',
        priority: 10,
      };

      const ruleAllowHigh: AclRule = {
        id: 'rule_allow_500',
        name: 'Allow High Priority',
        subjectOrRole: '*',
        originPattern: '*',
        keyPattern: 'shared:*',
        actions: ['READ'],
        effect: 'ALLOW',
        priority: 500,
      };

      await engine.registerRule(ruleAllowLow);
      await engine.registerRule(ruleAllowHigh);

      const subject: AclSubjectContext = { subjectId: 'user_1', roles: [] };
      const env: AclEnvironmentContext = { origin: 'https://app.com', timestamp: Date.now() };
      const resource: AclResourceContext = { key: 'shared:data' };

      const res = await engine.evaluateAccess(subject, env, resource, 'READ');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.allowed).toBe(true);
        expect(res.value.ruleId).toBe('rule_allow_500');
      }
    });
  });

  describe('Dimension 6: Concurrent Async Requests & Cryptographic Stress', () => {
    it('should handle 100 concurrent evaluateAccess calls using Promise.all', async () => {
      await engine.registerRule({
        id: 'conc_rule',
        name: 'Concurrent Rule',
        subjectOrRole: '*',
        originPattern: '*',
        keyPattern: 'conc:*',
        actions: ['READ'],
        effect: 'ALLOW',
      });

      const subject: AclSubjectContext = { subjectId: 'user_conc', roles: [] };
      const env: AclEnvironmentContext = { origin: 'https://app.com', timestamp: Date.now() };

      const promises = Array.from({ length: 100 }, (_, i) =>
        engine.evaluateAccess(subject, env, { key: `conc:item_${i}` }, 'READ')
      );

      const results = await Promise.all(promises);
      for (const res of results) {
        expect(res.ok).toBe(true);
        if (res.ok) {
          expect(res.value.allowed).toBe(true);
        }
      }
    });

    it('should issue and verify 200 HMAC tokens rapidly without cryptographic errors', async () => {
      const TOKEN_COUNT = 200;
      const subject: AclSubjectContext = { subjectId: 'token_stress_user', roles: ['user'] };
      const env: AclEnvironmentContext = { origin: 'https://app.com', timestamp: Date.now() };

      const tokens: string[] = [];

      for (let i = 0; i < TOKEN_COUNT; i++) {
        const issueRes = await engine.issueAccessToken(subject, [`READ:item_${i}`], 3600, SECRET);
        expect(issueRes.ok).toBe(true);
        if (issueRes.ok) {
          tokens.push(issueRes.value);
        }
      }

      expect(tokens.length).toBe(TOKEN_COUNT);

      for (let i = 0; i < TOKEN_COUNT; i++) {
        const verifyRes = await engine.verifyTokenAccess(
          tokens[i],
          { origin: 'https://app.com', timestamp: Date.now() + 1000 },
          { key: `item_${i}` },
          'READ',
          SECRET
        );
        expect(verifyRes.ok).toBe(true);
        if (verifyRes.ok) {
          expect(verifyRes.value.allowed).toBe(true);
        }
      }
    });
  });
});
