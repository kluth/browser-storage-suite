# ADR-0011: Virtualized Data Grid for Ultra-Large Storage Keys

- **Status**: Approved
- **Date**: 2026-08-01
- **Deciders**: Core Architecture Team

## Context
Rendering storage tables with thousands of keys or multi-megabyte JSON values freezes the Extension Popup DOM due to excessive memory usage and layout reflows.

## Decision
Implement a custom Virtualized Data Grid (`VirtualizedDataGrid.tsx`) using fixed row heights, dynamic windowing, and incremental DOM recycling.

## Consequences
### Positive
- Smooth 60 FPS scrolling through 100,000+ storage keys.
- Constant memory footprint regardless of total storage entry count.
- Search and filter responsiveness under 5ms.

### Negative / Tradeoffs
- Requires fixed or pre-calculated row heights in grid renderers.
