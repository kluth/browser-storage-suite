# ADR-0019: Cross-Storage Type Converter & Serializer

- **Status**: Approved
- **Date**: 2026-08-01
- **Deciders**: Core Architecture Team

## Context
Migrating items between `localStorage`, `sessionStorage`, `cookies`, and `IndexedDB` requires manual copy-pasting and serialization adjustments.

## Decision
Build a unified Cross-Storage Type Converter & Serializer. It enables one-click key migration between any browser storage mechanism, handling automatic JSON parsing/stringification, cookie expiration defaults, and IndexedDB key-value wrapping.

## Consequences
### Positive
- Effortless conversion of LocalStorage items to IndexedDB entries or Cookies.
- Automatic handling of binary data (ArrayBuffer, Blob) when moving to IndexedDB.
- Reduces developer iteration time during storage refactoring.

### Negative / Tradeoffs
- Moving large IndexedDB objects to Cookies will fail if item exceeds 4 KB cookie size limits (handled with explicit validation warnings).
