# ADR-0018: Storage Access Security & Cookie SameSite Auditor

- **Status**: Approved
- **Date**: 2026-08-01
- **Deciders**: Core Architecture Team

## Context
Insecure cookie configurations (missing `Secure`, `HttpOnly`, or `SameSite=None` without SSL) expose web applications to Cross-Site Request Forgery (CSRF) and cross-site data leaks.

## Decision
Incorporate an automated Cookie & Storage Security Auditor. It scans active tab cookies and storage keys, flagging vulnerabilities such as plain-text JWT storage, unencrypted session IDs, and unsafe `SameSite=Lax` or missing `Secure` flags on HTTPS domains.

## Consequences
### Positive
- One-click security health score for active domain storage.
- Immediate action recommendations for web developers and security auditors.
- Automated compliance check against modern browser cookie security policies.

### Negative / Tradeoffs
- Cannot inspect `HttpOnly` cookie values from document scripts (requires Chrome extension `cookies` API permissions).
