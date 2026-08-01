/**
 * Supported storage ACL actions
 */
export type AclAction = 'READ' | 'WRITE' | 'DELETE' | 'LIST' | 'ADMIN' | '*';

/**
 * Access decision effect
 */
export type AclEffect = 'ALLOW' | 'DENY';

/**
 * Attribute comparison operator for ABAC
 */
export type AbacOperator =
  | 'EQUALS'
  | 'NOT_EQUALS'
  | 'CONTAINS'
  | 'GREATER_THAN'
  | 'LESS_THAN'
  | 'IN_ARRAY';

/**
 * ABAC condition definition
 */
export interface AclCondition {
  field: string; // e.g. "subject.department", "resource.sensitivity", "env.timestamp"
  operator: AbacOperator;
  value: unknown;
}

/**
 * Granular Storage ACL Rule
 */
export interface AclRule {
  id: string;
  name: string;
  subjectOrRole: string; // Subject ID, Role name, or "*"
  originPattern: string; // e.g. "https://*.example.com", "*"
  keyPattern: string;    // e.g. "user:*", "auth:session", "*"
  actions: AclAction[];  // Array of allowed/denied actions
  effect: AclEffect;     // "ALLOW" or "DENY"
  conditions?: AclCondition[]; // Optional ABAC conditions
  priority?: number;     // Higher number evaluated first (default: 0)
}

/**
 * Role definition aggregating multiple rules
 */
export interface AclRoleDefinition {
  roleName: string;
  description?: string;
  rules: AclRule[];
}

/**
 * Subject context for evaluation
 */
export interface AclSubjectContext {
  subjectId: string;
  roles: string[];
  attributes?: Record<string, unknown>;
}

/**
 * Environment context for evaluation
 */
export interface AclEnvironmentContext {
  origin: string;
  timestamp: number;
  ipAddress?: string;
  extra?: Record<string, unknown>;
}

/**
 * Resource context for evaluation
 */
export interface AclResourceContext {
  key: string;
  tags?: string[];
  attributes?: Record<string, unknown>;
}

/**
 * Scoped access token representation
 */
export interface AclToken {
  tokenId: string;
  subjectId: string;
  roles: string[];
  scopes: string[]; // e.g., ["READ:user:*", "WRITE:session:*"]
  issuedAt: number;
  expiresAt: number;
  issuer: string;
  signature: string;
}

/**
 * Result of an access control decision
 */
export interface StorageAclDecision {
  allowed: boolean;
  effect: AclEffect;
  action: AclAction;
  key: string;
  origin: string;
  subjectId: string;
  ruleId?: string;
  reason: string;
}

/**
 * Domain Error Codes for Storage ACL Operations
 */
export type StorageAclErrorCode =
  | 'UNAUTHORIZED'
  | 'TOKEN_EXPIRED'
  | 'INVALID_TOKEN'
  | 'INVALID_RULE'
  | 'POLICY_DENIED'
  | 'REPOSITORY_ERROR'
  | 'CRYPTO_ERROR'
  | 'ACL_ORIGIN_DENIED'
  | 'ACL_SCOPE_INSUFFICIENT'
  | 'ACL_KEY_RESTRICTED'
  | 'ACL_TOKEN_EXPIRED'
  | 'ACL_TOKEN_INVALID'
  | 'ACL_TOKEN_NOT_YET_VALID'
  | 'ACL_TOKEN_REVOKED';

/**
 * Domain Error for Storage ACL Operations
 */
export class StorageAclError extends Error {
  public readonly type: StorageAclErrorCode;

  constructor(
    public readonly code: StorageAclErrorCode,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.type = code;
    this.name = 'StorageAclError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
