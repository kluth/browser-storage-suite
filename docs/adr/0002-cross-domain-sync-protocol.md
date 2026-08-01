# 0002. Cross-Domain Storage Synchronization Protocol

* **Status:** Accepted
* **Deciders:** Lead Security Architect, Infrastructure Team
* **Date:** 2026-08-01

## Context and Problem Statement
Modern multi-origin web applications (e.g., `app.example.com`, `auth.example.com`, `checkout.example.com`) isolate client storage (LocalStorage, SessionStorage, IndexedDB) per origin under the browser's Same-Origin Policy (SOP). 

Synchronizing state changes across these domains presents major challenges:
1. **Unauthenticated Transport Security**: Naive cross-domain broadcasting using unauthenticated `window.postMessage` exposes application state to cross-site messaging forgery, origin spoofing, and payload tampering.
2. **Replay & Timestamp Drift Attacks**: Malicious scripts or intercepted messages can be replayed to roll back application state or inject outdated keys.
3. **Concurrent Data Conflicts**: Concurrent writes across multiple tabs or origins cause race conditions and lost updates without a conflict-free replication model.

The system requires a secure, peer-to-peer cross-domain storage synchronization protocol using CRDT Last-Write-Wins Element-Set (LWW-Element-Set) state convergence, HMAC-SHA-256 payload signing via Web Crypto API, origin whitelisting, anti-replay nonce filtering, and hexagonal architecture with zero-throw `Result<T, E>` monads.

## Decision Drivers
* **Eventual Consistency**: Guarantee multi-origin storage state convergence via state-based CRDT LWW-Element-Set mathematical properties (commutativity, associativity, idempotency).
* **Cryptographic Security**: Enforce origin authenticity and payload integrity using native Web Crypto API (`crypto.subtle`) HMAC-SHA-256 signatures over pre-shared or derived keys.
* **Anti-Replay & Origin Filtering**: Require strict origin whitelisting, timestamp drift validation ($\pm 30,000$ ms), and sliding window LRU nonce deduplication.
* **Hexagonal Decoupling**: Decouple CRDT domain logic from transport and crypto adapters via primary/secondary ports and zero-throw `Result<T, E>` error monads.
* **Multi-Browser & Extension Compatibility**: Operable in standard DOM window contexts, content scripts, and extension execution environments across Chrome MV3, Firefox MV2, and Edge MV3.

## Considered Options
1. **Unsigned postMessage JSON Broadcast**: Simple but zero security; susceptible to XSS eavesdropping, message forgery, and data corruption.
2. **Centralized WebSocket Backend Relay**: High infrastructure cost, operational complexity, and network dependency for client-side state.
3. **CRDT LWW-Element-Set with HMAC-SHA-256 Signed Envelope over postMessage Relay**: Decentralized peer-to-peer synchronization featuring mathematical state convergence, cryptographic integrity, origin control, and anti-replay protection.

## Decision Outcome
Chosen option: **Option 3 (CRDT LWW-Element-Set with HMAC-SHA-256 Signed Envelope over postMessage Relay)**.

### Positives
* **Conflict-Free Synchronization**: State merges are mathematically guaranteed to converge regardless of message ordering or delivery delays.
* **Tamper Proof & Authentic**: HMAC-SHA-256 verification rejects untrusted or altered messages before state application.
* **Replay Protection**: Nonce tracking and timestamp drift bounds prevent message replay attacks.
* **Hexagonal Clean Architecture**: Pure domain models (`crdtLwwSet`, `syncMessage`) decoupled from secondary adapters (`hmacSignerAdapter`, `postMessageRelayAdapter`) and utility facade (`crossDomainSyncEngine`).

### Negatives / Tradeoffs
* **Timestamp Dependency**: Relies on physical system clocks for Last-Write-Wins resolution; tie-breaking via peer ID resolves clock equality.
* **Tombstone Overhead**: Deletions persist tombstones in memory/storage until tombstone garbage collection prunes expired entries.

## Implementation Details

### CRDT LWW-Element-Set Mathematical Model
- **Add Set ($A$)**: Map of `key -> LwwElement<T>` containing `key`, `value`, `timestamp` ($t_{add}$), `peerId`, and `sequence`.
- **Remove Set ($R$)**: Map of `key -> LwwTombstone` containing `key`, `timestamp` ($t_{rem}$), `peerId`, and `sequence`.
- **Existence Semantics**: Key $k$ exists if $k \in A$, and either $k \notin R$ or $t_{add}(k) > t_{rem}(k)$. If $t_{add}(k) == t_{rem}(k)$, tie-breaking favors addition if $peerId_{add} \ge peerId_{rem}$, ensuring deterministic convergence.
- **Merge Operation**: $A_{new} = A_1 \cup A_2$ (keeping max timestamp per key), $R_{new} = R_1 \cup R_2$ (keeping max timestamp per key).

### Signed Sync Envelope Structure
```json
{
  "protocolVersion": "1.0",
  "messageId": "msg_nonce_12345",
  "timestamp": 1785596400000,
  "sourceOrigin": "https://auth.example.com",
  "targetOrigin": "https://app.example.com",
  "action": "CRDT_SYNC_MERGE",
  "payload": "{\"addSet\":{...},\"removeSet\":{...}}",
  "signature": "a1b2c3d4e5f6..."
}
```

### File Inventory
* **Domain Models**:
  - `src/domain/model/crdtLwwSet.ts`
  - `src/domain/model/syncMessage.ts`
* **Primary Port**:
  - `src/domain/ports/primary/crossDomainSyncPort.ts`
* **Secondary Ports**:
  - `src/domain/ports/secondary/postMessageRelayPort.ts`
  - `src/domain/ports/secondary/hmacSignerPort.ts`
* **Infrastructure Adapters**:
  - `src/infrastructure/adapters/hmacSignerAdapter.ts`
  - `src/infrastructure/adapters/postMessageRelayAdapter.ts`
* **Engine Facade**:
  - `utils/crossDomainSyncEngine.ts`
* **Tests**:
  - `tests/crdtLwwSet.test.ts`
  - `tests/crossDomainSyncProtocol.test.ts`
  - `tests/e2e/tier1_feature_coverage/feature_02_cross_domain_sync.test.ts`
