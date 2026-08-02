# ADR-0024: Storage Memory Leak & Retainer Inspector

- **Status**: Approved
- **Date**: 2026-08-01
- **Deciders**: Core Architecture Team

## Context
Single-page applications (SPAs) frequently leak memory by accumulating uncleaned temporary keys in `sessionStorage` or `localStorage` across route navigations, leading to browser slowdowns.

## Decision
Create an automated Storage Memory Leak & Retainer Inspector. It tracks key longevity, navigation frequency, and value growth rate to highlight zombie keys that were set but never read or cleaned up after page unmounts.

## Consequences
### Positive
- Automatic detection of orphaned storage keys in SPAs.
- Reports memory waste metrics per route or component lifecycle.
- Recommends explicit TTL (Time-To-Live) policies for transient storage keys.

### Negative / Tradeoffs
- Tracking key read access requires content script hook instrumentation.
