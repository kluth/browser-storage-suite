# ADR-0013: Storage Mutation Provenance & Code Blame Tracker

- **Status**: Approved
- **Date**: 2026-08-01
- **Deciders**: Core Architecture Team

## Context
When web applications alter storage state unexpectedly, engineers struggle to trace which script line or third-party SDK performed the write operation.

## Decision
Build a Storage Mutation Provenance & Code Blame Tracker (`utils/dataBlamer.ts`). It captures Javascript execution stack traces at the exact moment `setItem`, `removeItem`, or `cookie` assignments occur and maps them to origin scripts and line numbers.

## Consequences
### Positive
- Instant script attribution for every storage key change.
- Historical revision timeline showing who changed what key and when.
- Detects rogue third-party tracking scripts mutating browser storage without permission.

### Negative / Tradeoffs
- Stack trace parsing requires CPU cycles during high-frequency write loops.
