# ADR-0016: Backend API Discovery & Out-of-the-Box Mock Server Generator

- **Status**: Approved
- **Date**: 2026-08-01
- **Deciders**: Core Architecture Team

## Context
Frontend developers frequently need to mock backend REST endpoints based on data stored in `localStorage` or `sessionStorage` (e.g. auth tokens, user profiles, feature flags) for offline or isolated development.

## Decision
Implement a zero-dependency Standalone Node.js Mock Server Generator (`utils/mockServerGenerator.ts`). It analyzes current browser storage states and intercepted backend fetch routes, producing a single-file executable `mock-server.js` package with full CORS support and REST endpoints.

## Consequences
### Positive
- One-click export of runnable Node.js mock servers for local dev environments.
- Zero external dependencies (`node:http`, `node:url` native modules).
- Automatic generation of storage state seed bundles.

### Negative / Tradeoffs
- Generated code must be compatible with Node.js 18+ runtime environments.
