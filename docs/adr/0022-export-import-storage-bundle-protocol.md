# ADR-0022: Export/Import Storage Bundle Protocol (JSON / YAML / CSV)

- **Status**: Approved
- **Date**: 2026-08-01
- **Deciders**: Core Architecture Team

## Context
Developers need to share complete storage states with team members, attach storage snapshots to bug reports, or import test fixtures into local environments.

## Decision
Establish an Export/Import Storage Bundle Protocol. It supports exporting full domain storage states into structured `JSON`, `YAML`, or `CSV` formats, as well as single-click import with schema validation and conflict resolution (overwrite, merge, skip).

## Consequences
### Positive
- Standardized snapshot format including metadata (domain, timestamp, storage types).
- Easy attachment of storage state to Jira tickets or GitHub issues.
- Fast restoration of complex multi-key test scenarios.

### Negative / Tradeoffs
- YAML export requires a lightweight inline serializer to avoid heavy external dependencies.
