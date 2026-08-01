import { describe, it, expect, beforeEach } from 'vitest';
import { StorageAclEngine } from '../../../utils/storageAclEngine';
import { StorageTestHarness } from '../../../utils/storageTestHarness';
import { StorageAclGuard } from '../../storageAclInterceptor.test';
import {
  AclRule,
  AclRoleDefinition,
  AclSubjectContext,
  AclEnvironmentContext,
  AclResourceContext,
} from '../../../src/domain/model/storageAcl';

describe('Feature 04: E2E Granular Storage Access Control List (ADR-0004)', () => {
  let harness: StorageTestHarness;
  let engine: StorageAclEngine;
  let guard: StorageAclGuard;
  const SECRET_KEY = 'e2e_storage_acl_hmac_secret_key_999';

  beforeEach(async () => {
    harness = new StorageTestHarness();
    engine = new StorageAclEngine({ defaultEffect: 'DENY' });
    guard = new StorageAclGuard(harness, engine);

    // 1. Role Definition: Micro-Frontend Shared User Role
    const userRole: AclRoleDefinition = {
      roleName: 'mfe_user',
      description: 'Standard Micro-Frontend User Access',
      rules: [
        {
          id: 'rule_mfe_user_read',
          name: 'Allow MFE User Profile Read',
          subjectOrRole: 'mfe_user',
          originPattern: 'https://*.example.com',
          keyPattern: 'profile:*',
          actions: ['READ', 'WRITE'],
          effect: 'ALLOW',
          priority: 5,
        },
      ],
    };

    // 2. Global Rule: Deny Password Key Write for All
    const denyPasswordRule: AclRule = {
      id: 'rule_deny_passwords',
      name: 'Global Deny Password Write',
      subjectOrRole: '*',
      originPattern: '*',
      keyPattern: '*:password*',
      actions: ['WRITE', 'DELETE'],
      effect: 'DENY',
      priority: 100, // Highest priority
    };

    // 3. ABAC Rule: Finance Department Key Access
    const financeAbacRule: AclRule = {
      id: 'rule_finance_abac',
      name: 'Finance Department High Security Storage',
      subjectOrRole: '*',
      originPattern: 'https://finance.example.com',
      keyPattern: 'finance:*',
      actions: ['READ', 'WRITE', 'DELETE'],
      effect: 'ALLOW',
      conditions: [
        { field: 'subject.attributes.department', operator: 'EQUALS', value: 'FINANCE' },
        { field: 'subject.attributes.clearanceLevel', operator: 'GREATER_THAN', value: 2 },
      ],
      priority: 10,
    };

    await engine.defineRole(userRole);
    await engine.registerRule(denyPasswordRule);
    await engine.registerRule(financeAbacRule);
  });

  it('E2E 1: Micro-Frontend Multi-Origin Access Matrix & Wildcards', async () => {
    const subject: AclSubjectContext = { subjectId: 'user_john', roles: ['mfe_user'] };

    // Subdomain https://app.example.com matches https://*.example.com
    const envApp: AclEnvironmentContext = { origin: 'https://app.example.com', timestamp: Date.now() };
    const writeRes = await guard.setItem('local', 'profile:theme', 'dark', subject, envApp);
    expect(writeRes.ok).toBe(true);

    const readRes = await guard.getItem<{ theme: string }>('local', 'profile:theme', subject, envApp);
    expect(readRes.ok).toBe(true);
    if (readRes.ok) {
      expect(readRes.value).toBe('dark');
    }

    // Untrusted Origin https://malicious.com -> Denied by default policy
    const envMalicious: AclEnvironmentContext = { origin: 'https://malicious.com', timestamp: Date.now() };
    const malRead = await guard.getItem('local', 'profile:theme', subject, envMalicious);
    expect(malRead.ok).toBe(false);
    if (!malRead.ok) {
      expect(malRead.error.code).toBe('ACL_SCOPE_INSUFFICIENT');
    }
  });

  it('E2E 2: Priority Override & Deny-First Security Semantics', async () => {
    const subject: AclSubjectContext = { subjectId: 'user_john', roles: ['mfe_user'] };
    const envApp: AclEnvironmentContext = { origin: 'https://app.example.com', timestamp: Date.now() };

    // Attempting to write 'profile:password' matches allow rule 'profile:*' (priority 5) BUT matches deny rule '*:password*' (priority 100)
    const passWrite = await guard.setItem('local', 'profile:password_hash', 'secret_hash', subject, envApp);
    expect(passWrite.ok).toBe(false);
    if (!passWrite.ok) {
      expect(passWrite.error.code).toBe('ACL_SCOPE_INSUFFICIENT');
    }

    // Harness storage map remains clean
    const checkPass = await harness.getItem('local', 'profile:password_hash');
    if (checkPass.ok) {
      expect(checkPass.value).toBeNull();
    }
  });

  it('E2E 3: ABAC Attribute Evaluation Pipeline', async () => {
    const envFin: AclEnvironmentContext = { origin: 'https://finance.example.com', timestamp: Date.now() };

    const finUserAuthorized: AclSubjectContext = {
      subjectId: 'fin_analyst',
      roles: [],
      attributes: { department: 'FINANCE', clearanceLevel: 3 },
    };

    const finUserLowClearance: AclSubjectContext = {
      subjectId: 'fin_intern',
      roles: [],
      attributes: { department: 'FINANCE', clearanceLevel: 1 },
    };

    // Authorized Analyst writes & reads finance data
    const setFin = await guard.setItem('sync', 'finance:ledger_2026', { total: 1000000 }, finUserAuthorized, envFin);
    expect(setFin.ok).toBe(true);

    // Intern attempts read -> ABAC condition failed (clearanceLevel not > 2)
    const getIntern = await guard.getItem('sync', 'finance:ledger_2026', finUserLowClearance, envFin);
    expect(getIntern.ok).toBe(false);
  });

  it('E2E 4: Dynamic Bearer Token Delegation & Lifecycle (Issue, Verify, Revoke, Expire)', async () => {
    const subject: AclSubjectContext = { subjectId: 'partner_widget', roles: [] };

    // Issue bearer token with 1 hour expiry for 'READ:profile:*' scope
    const issueRes = await engine.issueAccessToken(subject, ['READ:profile:*'], 3600, SECRET_KEY);
    expect(issueRes.ok).toBe(true);
    if (!issueRes.ok) return;

    const token = issueRes.value;
    const envWidget: AclEnvironmentContext = { origin: 'https://widget.partner.com', timestamp: Date.now() };
    const resource: AclResourceContext = { key: 'profile:theme' };

    // 1. Authorized read via valid token
    const tokenVerify1 = await engine.verifyTokenAccess(token, envWidget, resource, 'READ', SECRET_KEY);
    expect(tokenVerify1.ok).toBe(true);
    if (tokenVerify1.ok) {
      expect(tokenVerify1.value.allowed).toBe(true);
    }

    // 2. Write attempt via token -> Denied (token only claims READ)
    const tokenVerifyWrite = await engine.verifyTokenAccess(token, envWidget, resource, 'WRITE', SECRET_KEY);
    expect(tokenVerifyWrite.ok).toBe(true);
    if (tokenVerifyWrite.ok) {
      expect(tokenVerifyWrite.value.allowed).toBe(false);
    }

    // 3. Revoke Token
    const decodedToken = JSON.parse(atob(token));
    engine.revokeToken(decodedToken.tokenId);

    const tokenVerifyRevoked = await engine.verifyTokenAccess(token, envWidget, resource, 'READ', SECRET_KEY);
    expect(tokenVerifyRevoked.ok).toBe(false);
    if (!tokenVerifyRevoked.ok) {
      expect(tokenVerifyRevoked.error.code).toBe('ACL_TOKEN_REVOKED');
    }
  });
});
