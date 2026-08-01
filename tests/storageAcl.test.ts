import { describe, it, expect, beforeEach } from 'vitest';
import {
  StorageAclError,
  AclRule,
  AclRoleDefinition,
} from '../src/domain/model/storageAcl';
import { StorageAclAdapter } from '../src/infrastructure/adapters/storageAclAdapter';

describe('Storage ACL Model & Adapter Unit Tests', () => {
  let adapter: StorageAclAdapter;

  beforeEach(() => {
    adapter = new StorageAclAdapter();
  });

  describe('StorageAclError', () => {
    it('should correctly initialize code, type, message, and details', () => {
      const err = new StorageAclError('ACL_ORIGIN_DENIED', 'Origin access denied', { origin: 'https://bad.com' });
      expect(err.code).toBe('ACL_ORIGIN_DENIED');
      expect(err.type).toBe('ACL_ORIGIN_DENIED');
      expect(err.message).toBe('Origin access denied');
      expect(err.details).toEqual({ origin: 'https://bad.com' });
      expect(err.name).toBe('StorageAclError');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(StorageAclError);
    });

    it('should handle undefined details gracefully', () => {
      const err = new StorageAclError('UNAUTHORIZED', 'Unauthorized access');
      expect(err.code).toBe('UNAUTHORIZED');
      expect(err.type).toBe('UNAUTHORIZED');
      expect(err.details).toBeUndefined();
    });
  });

  describe('StorageAclAdapter (Repository Operations)', () => {
    it('should save, load, and delete ACL rules cleanly', async () => {
      const rule: AclRule = {
        id: 'rule_101',
        name: 'Allow User Storage Read',
        subjectOrRole: 'user_123',
        originPattern: 'https://app.example.com',
        keyPattern: 'user:*',
        actions: ['READ'],
        effect: 'ALLOW',
        priority: 10,
      };

      const saveRes = await adapter.saveRule(rule);
      expect(saveRes.ok).toBe(true);

      const loadRes = await adapter.loadRules();
      expect(loadRes.ok).toBe(true);
      if (loadRes.ok) {
        expect(loadRes.value).toHaveLength(1);
        expect(loadRes.value[0].id).toBe('rule_101');
        expect(loadRes.value[0].name).toBe('Allow User Storage Read');
        expect(loadRes.value[0].priority).toBe(10);
      }

      const delRes = await adapter.deleteRule('rule_101');
      expect(delRes.ok).toBe(true);

      const loadResAfter = await adapter.loadRules();
      expect(loadResAfter.ok).toBe(true);
      if (loadResAfter.ok) {
        expect(loadResAfter.value).toHaveLength(0);
      }
    });

    it('should return error when saving rule with missing id, null, or empty subjectOrRole', async () => {
      const res1 = await adapter.saveRule(null as any);
      expect(res1.ok).toBe(false);
      if (!res1.ok) expect(res1.error.code).toBe('INVALID_RULE');

      const res2 = await adapter.saveRule({ id: '', subjectOrRole: 'user' } as AclRule);
      expect(res2.ok).toBe(false);
      if (!res2.ok) expect(res2.error.code).toBe('INVALID_RULE');

      const res3 = await adapter.saveRule({ id: 'r1', subjectOrRole: '' } as AclRule);
      expect(res3.ok).toBe(false);
      if (!res3.ok) expect(res3.error.code).toBe('INVALID_RULE');
    });

    it('should return error when attempting to delete non-existent rule', async () => {
      const delRes = await adapter.deleteRule('non_existent_rule_id');
      expect(delRes.ok).toBe(false);
      if (!delRes.ok) {
        expect(delRes.error.code).toBe('INVALID_RULE');
        expect(delRes.error.message).toContain('non_existent_rule_id');
      }
    });

    it('should save, load, and clear role definitions', async () => {
      const roleDef: AclRoleDefinition = {
        roleName: 'admin_role',
        description: 'Full Storage Admin',
        rules: [
          {
            id: 'rule_admin',
            name: 'Admin All',
            subjectOrRole: 'admin_role',
            originPattern: '*',
            keyPattern: '*',
            actions: ['*'],
            effect: 'ALLOW',
          },
        ],
      };

      const saveRes = await adapter.saveRole(roleDef);
      expect(saveRes.ok).toBe(true);

      const loadRes = await adapter.loadRoles();
      expect(loadRes.ok).toBe(true);
      if (loadRes.ok) {
        expect(loadRes.value.has('admin_role')).toBe(true);
        const role = loadRes.value.get('admin_role');
        expect(role?.roleName).toBe('admin_role');
        expect(role?.description).toBe('Full Storage Admin');
        expect(role?.rules).toHaveLength(1);
      }

      const clearRes = await adapter.clearAll();
      expect(clearRes.ok).toBe(true);

      const loadResAfter = await adapter.loadRoles();
      expect(loadResAfter.ok).toBe(true);
      if (loadResAfter.ok) {
        expect(loadResAfter.value.size).toBe(0);
      }
    });

    it('should return error when saving invalid role definition with missing roleName', async () => {
      const res1 = await adapter.saveRole(null as any);
      expect(res1.ok).toBe(false);
      if (!res1.ok) expect(res1.error.code).toBe('INVALID_RULE');

      const res2 = await adapter.saveRole({ roleName: '', rules: [] } as AclRoleDefinition);
      expect(res2.ok).toBe(false);
      if (!res2.ok) expect(res2.error.code).toBe('INVALID_RULE');
    });
  });
});
