# ADR-0017: SQL-to-IndexedDB Live Query & Cursor Engine

- **Status**: Approved
- **Date**: 2026-08-01
- **Deciders**: Core Architecture Team

## Context
Querying complex nested JSON stored in IndexedDB or LocalStorage using imperative Javascript code is slow and unwieldy.

## Decision
Build a lightweight SQL-to-IndexedDB query engine (`utils/sqlToIdb.ts`). It parses standard `SELECT ... FROM ... WHERE ... ORDER BY ... LIMIT` statements into IndexedDB key ranges and cursors.

## Consequences
### Positive
- Allows querying browser storage using intuitive SQL syntax.
- Supports filtering, projection, sorting, and limit parameters.
- Provides interactive SQL Console in extension popup with auto-completion.

### Negative / Tradeoffs
- SQL parser supports a subset of ANSI SQL suited for document/key-value storage.
