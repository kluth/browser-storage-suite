# ADR-0006: AI-Powered Test Data Synthesizer

- **Status**: Approved
- **Date**: 2026-08-01
- **Deciders**: Core Architecture Team

## Context
Developers testing edge-case storage behavior (such as JSON schema changes, auth token expirations, cart item mutations, and quota limits) manually craft fake storage items. This process is time-consuming and error-prone.

## Decision
Integrate an AI-Powered Test Data Synthesizer that inspects existing storage key patterns and schema shapes, then generates realistic mock datasets (e.g. JWT tokens, e-commerce shopping carts, user session metadata) tailored to the application context.

## Consequences
### Positive
- One-click realistic data seeding for local storage and IndexedDB testing.
- Support for domain-aware templates (E-Commerce, OAuth Auth, Feature Flags, Analytics).
- Fully offline deterministic generator fallback when API keys are absent.

### Negative / Tradeoffs
- Requires client-side seed templates to remain lightweight (< 20 KB overhead).
