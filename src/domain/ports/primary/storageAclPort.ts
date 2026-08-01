import { Result } from '../../../../utils/result';
import {
  AclAction,
  AclRule,
  AclRoleDefinition,
  AclSubjectContext,
  AclEnvironmentContext,
  AclResourceContext,
  StorageAclDecision,
  StorageAclError,
} from '../../model/storageAcl';

export interface StorageAclPort {
  /**
   * Evaluates access permission for a subject, origin, key, and action.
   */
  evaluateAccess(
    subject: AclSubjectContext,
    env: AclEnvironmentContext,
    resource: AclResourceContext,
    action: AclAction
  ): Promise<Result<StorageAclDecision, StorageAclError>>;

  /**
   * Verifies access using a signed access token.
   */
  verifyTokenAccess(
    tokenString: string,
    env: AclEnvironmentContext,
    resource: AclResourceContext,
    action: AclAction,
    secret: string
  ): Promise<Result<StorageAclDecision, StorageAclError>>;

  /**
   * Issues a signed ACL access token.
   */
  issueAccessToken(
    subject: AclSubjectContext,
    scopes: string[],
    expiresInSeconds: number,
    secret: string
  ): Promise<Result<string, StorageAclError>>;

  /**
   * Registers a new ACL rule.
   */
  registerRule(rule: AclRule): Promise<Result<void, StorageAclError>>;

  /**
   * Revokes an existing ACL rule by ID.
   */
  revokeRule(ruleId: string): Promise<Result<void, StorageAclError>>;

  /**
   * Defines or updates a role definition.
   */
  defineRole(roleDef: AclRoleDefinition): Promise<Result<void, StorageAclError>>;

  /**
   * Retrieves all registered rules.
   */
  getAllRules(): Promise<Result<AclRule[], StorageAclError>>;
}
