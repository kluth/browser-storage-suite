# ADR-0023: Storage Mutation Webhooks Exporter & Live Event Relay

- **Status**: Approved
- **Date**: 2026-08-01
- **Deciders**: Core Architecture Team

## Context
Automated testing pipelines and external dev tools need real-time streams of browser storage mutations as they occur during end-to-end user journeys.

## Decision
Implement a Storage Mutation Webhook & Live Event Relay module. It relays storage write events over WebSockets or HTTP POST webhooks to local dev servers, enabling automated test assertion and external telemetry collection.

## Consequences
### Positive
- Real-time stream of storage events delivered to external test runners (Playwright, Cypress).
- Configurable event filter rules by key prefix or storage type.
- Decouples storage observation from the browser extension popup UI.

### Negative / Tradeoffs
- Webhook dispatch requires configurable rate limiting to prevent network saturation during rapid write loops.
