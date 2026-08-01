import { Result } from './result';
import {
  AclAction,
  AclCondition,
  AclEffect,
  AclEnvironmentContext,
  AclResourceContext,
  AclRoleDefinition,
  AclRule,
  AclSubjectContext,
  AclToken,
  StorageAclDecision,
  StorageAclError,
  StorageAclErrorCode,
} from '../src/domain/model/storageAcl';
import { StorageAclPort } from '../src/domain/ports/primary/storageAclPort';
import { StorageAclRepositoryPort } from '../src/domain/ports/secondary/storageAclRepositoryPort';
import { StorageAclAdapter } from '../src/infrastructure/adapters/storageAclAdapter';
import { HmacSignerPort } from '../src/domain/ports/secondary/hmacSignerPort';
import { HmacSignerAdapter } from '../src/infrastructure/adapters/hmacSignerAdapter';

export interface StorageAclEngineOptions {
  repository?: StorageAclRepositoryPort;
  hmacSigner?: HmacSignerPort;
  defaultEffect?: AclEffect;
}

export class StorageAclEngine implements StorageAclPort {
  private readonly repository: StorageAclRepositoryPort;
  private readonly hmacSigner: HmacSignerPort;
  private defaultEffect: AclEffect;
  private revocationRegistry: Set<string> = new Set();

  constructor(options?: StorageAclEngineOptions) {
    this.repository = options?.repository ?? new StorageAclAdapter();
    this.hmacSigner = options?.hmacSigner ?? new HmacSignerAdapter();
    this.defaultEffect = options?.defaultEffect ?? 'DENY';
  }

  /**
   * Sets default fallback effect ('ALLOW' or 'DENY')
   */
  public setDefaultEffect(effect: AclEffect): void {
    this.defaultEffect = effect;
  }

  /**
   * Adds a tokenId to the revocation registry
   */
  public revokeToken(tokenId: string): void {
    if (tokenId) {
      this.revocationRegistry.add(tokenId);
    }
  }

  /**
   * Checks if a token ID is revoked
   */
  public isTokenRevoked(tokenId: string): boolean {
    return this.revocationRegistry.has(tokenId);
  }

  /**
   * Evaluates access permission for a subject, origin, key, and action.
   */
  public async evaluateAccess(
    subject: AclSubjectContext,
    env: AclEnvironmentContext,
    resource: AclResourceContext,
    action: AclAction
  ): Promise<Result<StorageAclDecision, StorageAclError>> {
    try {
      if (!subject || !env || !resource || !action) {
        const error = new StorageAclError(
          'INVALID_RULE',
          'Missing required parameters for access evaluation'
        );
        return Result.err(error);
      }

      // Load all rules and roles
      const rulesRes = await this.repository.loadRules();
      if (!rulesRes.ok) return Result.err(rulesRes.error);
      const rolesRes = await this.repository.loadRoles();
      if (!rolesRes.ok) return Result.err(rolesRes.error);

      const allDirectRules = rulesRes.value;
      const roleMap = rolesRes.value;

      // Expand subject rules from roles
      const candidateRules: AclRule[] = [...allDirectRules];
      if (subject.roles && Array.isArray(subject.roles)) {
        for (const roleName of subject.roles) {
          const roleDef = roleMap.get(roleName);
          if (roleDef && roleDef.rules) {
            candidateRules.push(...roleDef.rules);
          }
        }
      }

      // Filter matching rules
      const matchingRules: AclRule[] = [];
      const normalizedOrigin = this.normalizeOrigin(env.origin);

      for (const rule of candidateRules) {
        // 1. Subject match
        if (!this.matchSubject(rule.subjectOrRole, subject)) {
          continue;
        }

        // 2. Origin match
        if (!this.matchOrigin(rule.originPattern, normalizedOrigin)) {
          continue;
        }

        // 3. Key pattern match
        if (!this.matchKeyPattern(rule.keyPattern, resource.key)) {
          continue;
        }

        // 4. Action match
        if (!this.matchAction(rule.actions, action)) {
          continue;
        }

        // 5. ABAC conditions match
        if (rule.conditions && rule.conditions.length > 0) {
          const condPassed = rule.conditions.every((cond) =>
            this.evaluateCondition(cond, subject, env, resource)
          );
          if (!condPassed) continue;
        }

        matchingRules.push(rule);
      }

      // Sort by priority descending (higher number evaluated first)
      matchingRules.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

      // Deny-First semantics: If any matching rule has DENY, decision is DENY
      const denyRule = matchingRules.find((r) => r.effect === 'DENY');
      if (denyRule) {
        return Result.ok({
          allowed: false,
          effect: 'DENY',
          action,
          key: resource.key,
          origin: env.origin,
          subjectId: subject.subjectId,
          ruleId: denyRule.id,
          reason: `Access explicitly denied by rule '${denyRule.name}' (${denyRule.id})`,
        });
      }

      const allowRule = matchingRules.find((r) => r.effect === 'ALLOW');
      if (allowRule) {
        return Result.ok({
          allowed: true,
          effect: 'ALLOW',
          action,
          key: resource.key,
          origin: env.origin,
          subjectId: subject.subjectId,
          ruleId: allowRule.id,
          reason: `Access allowed by rule '${allowRule.name}' (${allowRule.id})`,
        });
      }

      // Default policy fallback
      const allowed = this.defaultEffect === 'ALLOW';
      const errorCode: StorageAclErrorCode = allowed ? 'UNAUTHORIZED' : 'ACL_ORIGIN_DENIED';
      
      if (!allowed) {
        return Result.ok({
          allowed: false,
          effect: 'DENY',
          action,
          key: resource.key,
          origin: env.origin,
          subjectId: subject.subjectId,
          reason: `No matching ALLOW rule found; default policy DENY applied for origin '${env.origin}'`,
        });
      }

      return Result.ok({
        allowed: true,
        effect: 'ALLOW',
        action,
        key: resource.key,
        origin: env.origin,
        subjectId: subject.subjectId,
        reason: 'No matching rule found; default policy ALLOW applied',
      });
    } catch (err) {
      return Result.err(
        new StorageAclError(
          'POLICY_DENIED',
          `Policy evaluation failed: ${err instanceof Error ? err.message : String(err)}`,
          err
        )
      );
    }
  }

  /**
   * Issues a signed ACL access token.
   */
  public async issueAccessToken(
    subject: AclSubjectContext,
    scopes: string[],
    expiresInSeconds: number,
    secret: string
  ): Promise<Result<string, StorageAclError>> {
    try {
      if (!subject || !scopes || !secret) {
        return Result.err(
          new StorageAclError('INVALID_RULE', 'Subject, scopes, and secret are required')
        );
      }

      const now = Date.now();
      const expiresAt = now + expiresInSeconds * 1000;
      const tokenId = `tok_${Math.random().toString(36).slice(2)}_${now}`;

      const tokenData = {
        tokenId,
        subjectId: subject.subjectId,
        roles: subject.roles ?? [],
        scopes,
        issuedAt: now,
        expiresAt,
        issuer: 'StorageAclEngine',
      };

      const payloadStr = JSON.stringify(tokenData);
      const signRes = await this.hmacSigner.sign(payloadStr, secret);
      if (!signRes.ok) {
        return Result.err(
          new StorageAclError('CRYPTO_ERROR', `Failed to sign token: ${signRes.error.message}`, signRes.error)
        );
      }

      const fullToken: AclToken = {
        ...tokenData,
        signature: signRes.value,
      };

      const encoded = btoa(JSON.stringify(fullToken));
      return Result.ok(encoded);
    } catch (err) {
      return Result.err(
        new StorageAclError(
          'CRYPTO_ERROR',
          `Token generation failed: ${err instanceof Error ? err.message : String(err)}`,
          err
        )
      );
    }
  }

  /**
   * Verifies access using a signed access token.
   */
  public async verifyTokenAccess(
    tokenString: string,
    env: AclEnvironmentContext,
    resource: AclResourceContext,
    action: AclAction,
    secret: string
  ): Promise<Result<StorageAclDecision, StorageAclError>> {
    try {
      if (!tokenString || typeof tokenString !== 'string') {
        return Result.err(
          new StorageAclError('ACL_TOKEN_INVALID', 'Token string is empty or invalid')
        );
      }

      let token: AclToken;
      try {
        const decodedStr = atob(tokenString);
        token = JSON.parse(decodedStr);
      } catch {
        try {
          token = JSON.parse(tokenString);
        } catch {
          return Result.err(
            new StorageAclError('ACL_TOKEN_INVALID', 'Failed to decode token JSON')
          );
        }
      }

      if (!token || !token.tokenId || !token.signature) {
        return Result.err(
          new StorageAclError('ACL_TOKEN_INVALID', 'Token missing required fields or signature')
        );
      }

      // Check Revocation
      if (this.isTokenRevoked(token.tokenId)) {
        return Result.err(
          new StorageAclError('ACL_TOKEN_REVOKED', `Token '${token.tokenId}' has been revoked`)
        );
      }

      // Check Expiration (Off-by-one boundary checks: now > expiresAt -> expired)
      const now = env?.timestamp ?? Date.now();
      if (now > token.expiresAt) {
        return Result.err(
          new StorageAclError('ACL_TOKEN_EXPIRED', `Token expired at ${token.expiresAt}, current time ${now}`)
        );
      }

      // Check Not Yet Valid (now < issuedAt)
      if (now < token.issuedAt) {
        return Result.err(
          new StorageAclError('ACL_TOKEN_NOT_YET_VALID', `Token issued in future at ${token.issuedAt}, current time ${now}`)
        );
      }

      // Verify HMAC Signature
      const tokenPayload = {
        tokenId: token.tokenId,
        subjectId: token.subjectId,
        roles: token.roles,
        scopes: token.scopes,
        issuedAt: token.issuedAt,
        expiresAt: token.expiresAt,
        issuer: token.issuer,
      };

      const payloadStr = JSON.stringify(tokenPayload);
      const verifyRes = await this.hmacSigner.verify(payloadStr, token.signature, secret);
      if (!verifyRes.ok || !verifyRes.value) {
        return Result.err(
          new StorageAclError('ACL_TOKEN_INVALID', 'Invalid token signature or secret key mismatch')
        );
      }

      // Check Token Scopes against action and resource key
      const scopeMatched = token.scopes.some((scopeStr) =>
        this.matchTokenScope(scopeStr, action, resource.key)
      );

      if (!scopeMatched) {
        // Distinguish between key restriction vs scope action failure
        const hasActionScope = token.scopes.some((s) => {
          const [act] = s.split(':');
          return act === '*' || act.toUpperCase() === action;
        });

        const code: StorageAclErrorCode = hasActionScope
          ? 'ACL_KEY_RESTRICTED'
          : 'ACL_SCOPE_INSUFFICIENT';

        return Result.ok({
          allowed: false,
          effect: 'DENY',
          action,
          key: resource.key,
          origin: env.origin,
          subjectId: token.subjectId,
          reason: `Token scope claim '${token.scopes.join(', ')}' does not permit action '${action}' on key '${resource.key}'`,
        });
      }

      return Result.ok({
        allowed: true,
        effect: 'ALLOW',
        action,
        key: resource.key,
        origin: env.origin,
        subjectId: token.subjectId,
        reason: 'Access granted by valid signed ACL bearer token',
      });
    } catch (err) {
      return Result.err(
        new StorageAclError(
          'INVALID_TOKEN',
          `Token verification failed: ${err instanceof Error ? err.message : String(err)}`,
          err
        )
      );
    }
  }

  /**
   * Registers a new ACL rule.
   */
  public async registerRule(rule: AclRule): Promise<Result<void, StorageAclError>> {
    return this.repository.saveRule(rule);
  }

  /**
   * Revokes an existing ACL rule by ID.
   */
  public async revokeRule(ruleId: string): Promise<Result<void, StorageAclError>> {
    return this.repository.deleteRule(ruleId);
  }

  /**
   * Defines or updates a role definition.
   */
  public async defineRole(roleDef: AclRoleDefinition): Promise<Result<void, StorageAclError>> {
    return this.repository.saveRole(roleDef);
  }

  /**
   * Retrieves all registered rules.
   */
  public async getAllRules(): Promise<Result<AclRule[], StorageAclError>> {
    return this.repository.loadRules();
  }

  // --- Helper Methods ---

  public normalizeOrigin(origin: string): string {
    if (!origin || origin === '*') return '*';
    try {
      // Check if origin has scheme
      const url = new URL(origin.includes('://') ? origin : `https://${origin}`);
      const protocol = url.protocol.toLowerCase();
      const hostname = url.hostname.toLowerCase();
      const port = url.port;

      if ((protocol === 'http:' && port === '80') || (protocol === 'https:' && port === '443') || !port) {
        return `${protocol}//${hostname}`;
      }
      return `${protocol}//${hostname}:${port}`;
    } catch {
      return origin.trim().toLowerCase();
    }
  }

  private matchSubject(ruleSubject: string, subject: AclSubjectContext): boolean {
    if (ruleSubject === '*' || ruleSubject === subject.subjectId) {
      return true;
    }
    if (subject.roles && subject.roles.includes(ruleSubject)) {
      return true;
    }
    return false;
  }

  public matchOrigin(pattern: string, origin: string): boolean {
    if (!pattern || pattern === '*') return true;
    const normPattern = pattern.trim().toLowerCase();
    const normOrigin = origin.trim().toLowerCase();

    if (normPattern === normOrigin) return true;

    // Wildcard scheme check: *://domain.com
    if (normPattern.startsWith('*://')) {
      const targetDomainPattern = normPattern.slice(4);
      const originParts = normOrigin.split('://');
      const originDomain = originParts.length > 1 ? originParts[1] : originParts[0];
      return this.matchDomainHost(targetDomainPattern, originDomain);
    }

    // Scheme with domain wildcard: https://*.example.com or http://localhost:*
    if (normPattern.includes('://')) {
      const [patScheme, patHost] = normPattern.split('://');
      const [origScheme, origHost] = normOrigin.split('://');

      if (patScheme !== '*' && patScheme !== origScheme) {
        return false;
      }
      return this.matchDomainHost(patHost, origHost ?? '');
    }

    return this.matchDomainHost(normPattern, normOrigin);
  }

  private matchDomainHost(patternHost: string, originHost: string): boolean {
    if (patternHost === '*' || patternHost === originHost) return true;

    // Wildcard port check: e.g. localhost:*
    if (patternHost.endsWith(':*')) {
      const basePat = patternHost.slice(0, -2);
      const baseOrig = originHost.split(':')[0];
      return basePat === baseOrig;
    }

    // Subdomain wildcard: *.example.com or *.sub.example.com
    if (patternHost.startsWith('*.')) {
      const parentDomain = patternHost.slice(2); // e.g. "example.com"
      const hostWithoutPort = originHost.split(':')[0];

      // Exact parent domain match or ends with .parentDomain (with subdomain boundary)
      if (hostWithoutPort === parentDomain) return true;
      if (hostWithoutPort.endsWith('.' + parentDomain)) {
        return true;
      }
      return false;
    }

    return false;
  }

  public matchKeyPattern(pattern: string, key: string): boolean {
    if (!pattern || pattern === '*') return true;
    if (pattern === key) return true;

    // Prefix wildcard: user:*
    if (pattern.endsWith(':*')) {
      const prefix = pattern.slice(0, -1); // e.g. "user:"
      return key.startsWith(prefix) || key === pattern.slice(0, -2);
    }

    // Regex format: ^...$
    if (pattern.startsWith('^') && pattern.endsWith('$')) {
      try {
        const regex = new RegExp(pattern);
        return regex.test(key);
      } catch {
        return false;
      }
    }

    // Glob wildcard: cache:**.json or user.*
    if (pattern.includes('*') || pattern.includes('?')) {
      const escaped = pattern
        .replace(/[-[\]{}()+.,\\^$|#\s]/g, '\\$&')
        .replace(/\*\*/g, '.*')
        .replace(/(?<!\.)\*/g, '[^:]*');
      try {
        const regex = new RegExp(`^${escaped}$`);
        return regex.test(key);
      } catch {
        return false;
      }
    }

    return false;
  }

  private matchAction(ruleActions: AclAction[], requestedAction: AclAction): boolean {
    if (!ruleActions || ruleActions.length === 0) return false;
    if (ruleActions.includes('*')) return true;
    return ruleActions.includes(requestedAction);
  }

  private evaluateCondition(
    cond: AclCondition,
    subject: AclSubjectContext,
    env: AclEnvironmentContext,
    resource: AclResourceContext
  ): boolean {
    const actual = this.extractFieldValue(cond.field, subject, env, resource);
    const expected = cond.value;

    switch (cond.operator) {
      case 'EQUALS':
        return actual === expected;
      case 'NOT_EQUALS':
        return actual !== expected;
      case 'CONTAINS':
        if (typeof actual === 'string') return actual.includes(String(expected));
        if (Array.isArray(actual)) return actual.includes(expected);
        return false;
      case 'GREATER_THAN':
        return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
      case 'LESS_THAN':
        return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
      case 'IN_ARRAY':
        return Array.isArray(expected) && expected.includes(actual);
      default:
        return false;
    }
  }

  private extractFieldValue(
    fieldPath: string,
    subject: AclSubjectContext,
    env: AclEnvironmentContext,
    resource: AclResourceContext
  ): unknown {
    const parts = fieldPath.split('.');
    let current: unknown = { subject, env, resource };

    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        current = undefined;
        break;
      }
      current = (current as Record<string, unknown>)[part];
    }

    if (current !== undefined) return current;

    return (
      subject.attributes?.[fieldPath] ??
      (env as unknown as Record<string, unknown>)[fieldPath] ??
      (resource as unknown as Record<string, unknown>)[fieldPath]
    );
  }

  private matchTokenScope(scopeStr: string, action: AclAction, key: string): boolean {
    if (scopeStr === '*') return true;

    let scopeAction: string;
    let scopeKeyPattern: string;

    if (scopeStr.includes(':')) {
      const firstColon = scopeStr.indexOf(':');
      scopeAction = scopeStr.slice(0, firstColon).toUpperCase();
      scopeKeyPattern = scopeStr.slice(firstColon + 1);
    } else {
      scopeAction = scopeStr.toUpperCase();
      scopeKeyPattern = '*';
    }

    const actionMatch = scopeAction === '*' || scopeAction === action;
    const keyMatch = this.matchKeyPattern(scopeKeyPattern, key);

    return actionMatch && keyMatch;
  }
}
