import { Result } from '../../../utils/result';
import { StorageAclRepositoryPort } from '../../domain/ports/secondary/storageAclRepositoryPort';
import { AclRule, AclRoleDefinition, StorageAclError } from '../../domain/model/storageAcl';

export class StorageAclAdapter implements StorageAclRepositoryPort {
  private rules: Map<string, AclRule> = new Map();
  private roles: Map<string, AclRoleDefinition> = new Map();

  public async loadRules(): Promise<Result<AclRule[], StorageAclError>> {
    try {
      return Result.ok(Array.from(this.rules.values()).map((r) => JSON.parse(JSON.stringify(r))));
    } catch (err) {
      return Result.err(
        new StorageAclError(
          'REPOSITORY_ERROR',
          `Failed to load rules: ${err instanceof Error ? err.message : String(err)}`,
          err
        )
      );
    }
  }

  public async saveRule(rule: AclRule): Promise<Result<void, StorageAclError>> {
    try {
      if (!rule || !rule.id || !rule.subjectOrRole) {
        return Result.err(
          new StorageAclError('INVALID_RULE', 'Rule must contain valid id and subjectOrRole')
        );
      }
      this.rules.set(rule.id, JSON.parse(JSON.stringify(rule)));
      return Result.ok(undefined);
    } catch (err) {
      return Result.err(
        new StorageAclError(
          'REPOSITORY_ERROR',
          `Failed to save rule: ${err instanceof Error ? err.message : String(err)}`,
          err
        )
      );
    }
  }

  public async deleteRule(ruleId: string): Promise<Result<void, StorageAclError>> {
    try {
      if (!this.rules.has(ruleId)) {
        return Result.err(
          new StorageAclError('INVALID_RULE', `Rule ID ${ruleId} not found`)
        );
      }
      this.rules.delete(ruleId);
      return Result.ok(undefined);
    } catch (err) {
      return Result.err(
        new StorageAclError(
          'REPOSITORY_ERROR',
          `Failed to delete rule: ${err instanceof Error ? err.message : String(err)}`,
          err
        )
      );
    }
  }

  public async loadRoles(): Promise<Result<Map<string, AclRoleDefinition>, StorageAclError>> {
    try {
      const clonedMap = new Map<string, AclRoleDefinition>();
      for (const [k, v] of this.roles.entries()) {
        clonedMap.set(k, JSON.parse(JSON.stringify(v)));
      }
      return Result.ok(clonedMap);
    } catch (err) {
      return Result.err(
        new StorageAclError(
          'REPOSITORY_ERROR',
          `Failed to load roles: ${err instanceof Error ? err.message : String(err)}`,
          err
        )
      );
    }
  }

  public async saveRole(role: AclRoleDefinition): Promise<Result<void, StorageAclError>> {
    try {
      if (!role || !role.roleName) {
        return Result.err(
          new StorageAclError('INVALID_RULE', 'Role definition must have a valid roleName')
        );
      }
      this.roles.set(role.roleName, JSON.parse(JSON.stringify(role)));
      return Result.ok(undefined);
    } catch (err) {
      return Result.err(
        new StorageAclError(
          'REPOSITORY_ERROR',
          `Failed to save role: ${err instanceof Error ? err.message : String(err)}`,
          err
        )
      );
    }
  }

  public async clearAll(): Promise<Result<void, StorageAclError>> {
    try {
      this.rules.clear();
      this.roles.clear();
      return Result.ok(undefined);
    } catch (err) {
      return Result.err(
        new StorageAclError(
          'REPOSITORY_ERROR',
          `Failed to clear repository: ${err instanceof Error ? err.message : String(err)}`,
          err
        )
      );
    }
  }
}
