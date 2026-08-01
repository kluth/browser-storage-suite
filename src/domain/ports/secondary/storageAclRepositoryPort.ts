import { Result } from '../../../../utils/result';
import { AclRule, AclRoleDefinition, StorageAclError } from '../../model/storageAcl';

export interface StorageAclRepositoryPort {
  /**
   * Loads all active ACL rules from persistence.
   */
  loadRules(): Promise<Result<AclRule[], StorageAclError>>;

  /**
   * Persists an ACL rule.
   */
  saveRule(rule: AclRule): Promise<Result<void, StorageAclError>>;

  /**
   * Deletes an ACL rule by ID.
   */
  deleteRule(ruleId: string): Promise<Result<void, StorageAclError>>;

  /**
   * Loads all defined roles from persistence.
   */
  loadRoles(): Promise<Result<Map<string, AclRoleDefinition>, StorageAclError>>;

  /**
   * Persists a role definition.
   */
  saveRole(role: AclRoleDefinition): Promise<Result<void, StorageAclError>>;

  /**
   * Clears all stored rules and roles.
   */
  clearAll(): Promise<Result<void, StorageAclError>>;
}
