# ADR-0021: Offline PWA Storage Hydration & Cache Sync Adapter

- **Status**: Approved
- **Date**: 2026-08-01
- **Deciders**: Core Architecture Team

## Context
Progressive Web Apps (PWAs) rely on Cache Storage (`caches`) and IndexedDB for offline functionality. Debugging cache invalidation and storage rehydration when connectivity is restored is challenging.

## Decision
Develop an Offline PWA Storage Hydration Adapter. It monitors network online/offline events, simulates offline storage states, inspects CacheStorage entries alongside IndexedDB, and validates sync queue rehydration.

## Consequences
### Positive
- Live visualization of CacheStorage responses and offline IndexedDB write queues.
- One-click trigger for ServiceWorker `sync` events.
- Easy testing of app behavior under intermittent network conditions.

### Negative / Tradeoffs
- Intersecting with ServiceWorker Cache API requires host permissions for target domain origins.
