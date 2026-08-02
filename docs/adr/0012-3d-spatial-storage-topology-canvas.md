# ADR-0012: 3D Spatial Storage Topology Canvas Engine

- **Status**: Approved
- **Date**: 2026-08-01
- **Deciders**: Core Architecture Team

## Context
Understanding relationships between storage domains, cookies, session keys, and IndexedDB stores is difficult with flat tabular views.

## Decision
Create an interactive 3D/2D Spatial Storage Topology Canvas (`SpatialGraphCanvas.tsx`) powered by an off-main-thread Web Worker (`spatialLayoutWorker.ts`). Nodes represent storage entities and edges represent origin domain, parent-child, or cross-key references.

## Consequences
### Positive
- Intuitive visual representation of complex storage topologies.
- Offloads heavy force-directed graph calculations to a background Web Worker, ensuring popup UI thread remains smooth.
- Supports zoom, pan, node pinning, and double-click detail views.

### Negative / Tradeoffs
- Web Worker message passing overhead for graph node position updates.
