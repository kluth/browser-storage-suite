# 2. Off-Main-Thread Spatial 3D Layout Worker

* **Status:** Accepted
* **Deciders:** Lead Architect
* **Date:** 2026-07-28

## Context and Problem Statement
Rendering complex 3D object graphs of site storage ecosystems with 100,000+ relational entries can freeze the main UI thread during force-directed layout calculations.

## Decision Outcome
Offload all layout matrix calculations to a dedicated Web Worker (`src/infrastructure/workers/spatialLayoutWorker.ts`).

### Positives
* 60 FPS WebGL rendering in React Three Fiber without UI frame drops.
* Asynchronous message-based layout synchronization over Transferable Objects.
