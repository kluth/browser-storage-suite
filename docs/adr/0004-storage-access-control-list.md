# 0004. Granular Storage Access Control List

* **Status:** Accepted
* **Deciders:** Lead Security Architect, Infrastructure Team, Storage Suite Team
* **Date:** 2026-08-01

## Context and Problem Statement
Modern client-side web applications, micro-frontends, iframe-embedded modules, and extension environments store sensitive state within browser storage mechanisms (`localStorage`, `sessionStorage`, `IndexedDB`). While the browser's Same-Origin Policy (SOP) provides coarse-grained origin-level isolation, it fails to provide granular authorization within single-origin or cross-origin client contexts.

Key security and architectural challenges include:
1. **Unrestricted In-Origin Storage Access**: Scripts executing within the same origin possess unrestricted read, write, and delete permissions over all keys in local or session storage, leading to potential data leakage or cross-component state corruption.
2. **Lack of Fine-Grained Action Scopes**: Standard browser storage APIs do not distinguish between read-only inspection (`READ`, `LIST`), mutation (`WRITE`), deletion (`DELETE`), or administrative policy management (`ADMIN`).
3. **Static Origin Constraints**: Embedded iframe components, web workers, and third-party partner applications often require dynamic or temporary storage delegation without granting permanent full storage permissions.
4. **Complex Authorization Requirements**: Enterprise applications require hybrid Role-Based Access Control (RBAC) and Attribute-Based Access Control (ABAC) policies evaluating subject identities, key patterns (globs/regex), origin wildcards, environment attributes, and expiration constraints.

The system requires a Granular Storage Access Control List (ACL) engine using Hexagonal Architecture, zero-throw `Result<T, StorageAclError>` monads, RBAC role expansion, ABAC condition evaluation, wildcard origin matching, key glob matching, and HMAC-SHA-256 signed bearer token validation.

## Decision Drivers
* **Granular Action Scopes**: Support explicit authorization actions (`READ`, `WRITE`, `DELETE`, `LIST`, `ADMIN`, `*`).
* **Origin Permission Matrix**: Support exact origin matching (`https://app.example.com:443`), domain wildcards (`https://*.example.com`), scheme wildcards (`*://domain.com`), and universal wildcard (`*`) with canonical URL normalization.
* **Key Pattern Rules**: Support exact key matching, prefix wildcards (`user:*`), glob patterns (`cache:**.json`), and regular expressions (`^auth:(jwt|session)_[a-z0-9]+$`).
* **Hybrid RBAC / ABAC Policies**: Role-to-rule aggregation alongside attribute comparison operators (`EQUALS`, `NOT_EQUALS`, `CONTAINS`, `GREATER_THAN`, `LESS_THAN`, `IN_ARRAY`).
* **Cryptographic Token Delegation**: Cryptographically signed access tokens (`AclToken`) using HMAC-SHA-256 containing subject ID, roles, explicit scope claims, issued time, and expiration timestamp.
* **Hexagonal Decoupling & Monad Standard**: Strict separation of domain models, primary ports, secondary repository ports, infrastructure adapters, and policy engines using `Result<T, StorageAclError>` to ensure zero uncaught runtime exceptions.
* **Multi-Browser Quality Gates**: TypeScript zero errors (`npx tsc --noEmit`), Vitest 100% pass (`npx vitest run`), extension production builds clean for Chrome MV3, Firefox MV2, and Edge MV3, and Stryker mutation score $\ge 75\%$.

## Considered Options
1. **Coarse-Grained Origin Whitelist**: Simple domain lookup table mapping origins to boolean allow/deny flags. Lacks key pattern matching, action scopes, ABAC conditions, and dynamic token delegation.
2. **Static Key-Prefix Config File**: Hardcoded JSON configuration matching key prefixes. Static, inflexible, difficult to audit or revoke dynamically, and lacks crypto token verification.
3. **Hybrid RBAC/ABAC Policy Engine with HMAC Bearer Tokens & Hexagonal Ports**: Decentralized, granular security engine evaluating origin matrices, key globs, action scopes, ABAC condition trees, and HMAC-signed access tokens via clean hexagonal ports and `Result<T, E>` monads.

## Decision Outcome
Chosen option: **Option 3 (Hybrid RBAC/ABAC Policy Engine with HMAC Bearer Tokens & Hexagonal Ports)**.

### Positives
* **Principle of Least Privilege**: Access can be restricted to specific keys (e.g. `user:profile:*`), actions (e.g. `READ` only), origins, and dynamic conditions.
* **Deny-First Security Semantics**: Default policy is `DENY`. Explicit `DENY` rules override `ALLOW` rules.
* **Cryptographic Delegation**: Signed bearer tokens enable safe temporary delegation to sub-modules, third-party frames, or background workers without persisting global rules.
* **Zero Exception Overhead**: All domain operations return `Result<T, StorageAclError>` monads for robust fault tolerance.

### Negatives / Tradeoffs
* **Evaluation Latency**: Evaluating complex ABAC conditions and key pattern globs adds CPU overhead per storage call; mitigated by rule indexing, priority ordering, and fast-path exact key matches.
* **Secret Management**: Requires secure pre-shared or derived secrets for HMAC token signing and verification.

## Implementation Details

### Domain Data Structures (`src/domain/model/storageAcl.ts`)
- **`AclAction`**: `'READ' | 'WRITE' | 'DELETE' | 'LIST' | 'ADMIN' | '*'`
- **`AclEffect`**: `'ALLOW' | 'DENY'`
- **`AbacOperator`**: `'EQUALS' | 'NOT_EQUALS' | 'CONTAINS' | 'GREATER_THAN' | 'LESS_THAN' | 'IN_ARRAY'`
- **`AclCondition`**: `{ field: string; operator: AbacOperator; value: unknown }`
- **`AclRule`**: `{ id: string; name: string; subjectOrRole: string; originPattern: string; keyPattern: string; actions: AclAction[]; effect: AclEffect; conditions?: AclCondition[]; priority?: number }`
- **`AclRoleDefinition`**: `{ roleName: string; description?: string; rules: AclRule[] }`
- **`AclSubjectContext`**: `{ subjectId: string; roles: string[]; attributes?: Record<string, unknown> }`
- **`AclEnvironmentContext`**: `{ origin: string; timestamp: number; ipAddress?: string; extra?: Record<string, unknown> }`
- **`AclResourceContext`**: `{ key: string; tags?: string[]; attributes?: Record<string, unknown> }`
- **`AclToken`**: `{ tokenId: string; subjectId: string; roles: string[]; scopes: string[]; issuedAt: number; expiresAt: number; issuer: string; signature: string }`
- **`StorageAclDecision`**: `{ allowed: boolean; effect: AclEffect; action: AclAction; key: string; origin: string; subjectId: string; ruleId?: string; reason: string }`
- **`StorageAclError`**: Domain error class with types `'UNAUTHORIZED' | 'TOKEN_EXPIRED' | 'INVALID_TOKEN' | 'INVALID_RULE' | 'POLICY_DENIED' | 'REPOSITORY_ERROR' | 'CRYPTO_ERROR'`.

### Architecture & Port Definitions
- **Primary Port (`src/domain/ports/primary/storageAclPort.ts`)**: Defines `evaluateAccess`, `verifyTokenAccess`, `issueAccessToken`, `registerRule`, `revokeRule`, `defineRole`, and `getAllRules`.
- **Secondary Repository Port (`src/domain/ports/secondary/storageAclRepositoryPort.ts`)**: Persistence interface defining `loadRules`, `saveRule`, `deleteRule`, `loadRoles`, `saveRole`, and `clearAll`.
- **Infrastructure Adapter (`src/infrastructure/adapters/storageAclAdapter.ts`)**: Storage ACL repository adapter maintaining persistent or in-memory rules and role definitions.
- **Utility Engine (`utils/storageAclEngine.ts`)**: Policy evaluation facade implementing `StorageAclPort` with origin wildcard matching, key glob matching, ABAC condition tree resolution, token signing/verification using `HmacSignerAdapter`, and zero-throw `Result` wrapping.

### File Inventory
- **ADR Document**: `docs/adr/0004-storage-access-control-list.md`
- **Domain Models**: `src/domain/model/storageAcl.ts`
- **Primary Port**: `src/domain/ports/primary/storageAclPort.ts`
- **Secondary Port**: `src/domain/ports/secondary/storageAclRepositoryPort.ts`
- **Infrastructure Adapter**: `src/infrastructure/adapters/storageAclAdapter.ts`
- **Utility Engine**: `utils/storageAclEngine.ts`
- **Tests**:
  - `tests/storageAcl.test.ts`
  - `tests/storageAclEngine.test.ts`
  - `tests/storageAclInterceptor.test.ts`
  - `tests/e2e/tier1_feature_coverage/feature_04_storage_acl.test.ts`
