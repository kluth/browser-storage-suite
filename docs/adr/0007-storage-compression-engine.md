# 0007. Storage Compression Engine

* **Status:** Accepted
* **Deciders:** Lead Storage Architect, Performance & Optimization Team
* **Date:** 2026-08-01

## Context and Problem Statement
Web browser client-side storage mechanisms (LocalStorage, SessionStorage, Cookies, IndexedDB, Cache API) enforce strict quota boundaries (typically 5 MB per domain for LocalStorage/SessionStorage, 4 KB for Cookies). Storing large JSON documents, state snapshots, offline cache data, or audit logs quickly exhausts these quota limits, triggering `QuotaExceededError` exceptions and causing data loss or degraded application experience.

Furthermore, string encoding for complex JSON structures in LocalStorage or Cookies incurs high redundancy (repeated key names, structural formatting). The system requires a lightweight, zero-dependency, high-performance client-side compression engine to transparently compress stored values at rest, minimize storage footprint, prevent quota exhaustion, and ensure data integrity.

## Decision Drivers
* **Storage Efficiency & Savings:** Reduce client state size by 50% to 90% for repetitive text and JSON objects.
* **Quota Exhaustion Prevention:** Extend browser storage capacity by compressing payloads before writing to disk.
* **Hexagonal Architecture Decoupling:** Decouple domain storage operations from concrete compression algorithms via a secondary port (`CompressionPort`).
* **Zero-Throw Exception Handling:** Guarantee all compression/decompression operations return functional `Result<T, StorageCompressionError>` objects without throwing uncaught runtime exceptions.
* **Automatic Bypass Heuristics:** Automatically bypass compression for small payloads (< 128 bytes) or high-entropy uncompressible data (ratio >= 95%) to prevent storage inflation overhead.
* **Compact Storage Envelope:** Standardize on a prefixed, string envelope format (`cmp:v1:...`) suitable for string-only storage engines (LocalStorage/Cookies).
* **Data Integrity Verification:** Compute and verify fast Adler-32 checksums during decompression to detect bit-rot or storage corruption.

## Considered Options
1. **Raw Uncompressed Storage:** Zero overhead for CPU, but rapidly hits browser quota limits (5 MB LocalStorage limit).
2. **Third-Party Heavy JS Compression Libraries (e.g. pako, lz-string NPM package):** Adds NPM dependency risk, increases extension bundle size, and lacks standard zero-throw Result integration.
3. **Native Web Streams API (`CompressionStream`/`DecompressionStream`) Only:** Hardware-accelerated deflate/gzip, but async stream setup overhead can be unsuited for simple synchronous string storage, and is missing in legacy contexts.
4. **Hexagonal LZ-String Engine with Native Web Streams Fallback and Automatic Bypass:** Pure TypeScript bit-packing LZ algorithm for string environments with native `CompressionStream` support, Adler-32 checksum integrity, and automatic threshold bypass heuristics.

## Decision Outcome
Chosen option: **Option 4 (Hexagonal LZ-String Engine with Web Streams Fallback)**.

### Positives
* **Multi-Algorithm Support:** Native LZ bit-packing for synchronous string storage (`lz-base64`, `lz-utf16`) combined with native Web Streams API support (`deflate`, `gzip`).
* **Automatic Bypass Protection:** Automatically skips compression when payload size is under 128 bytes or when compressed output size exceeds 95% of original size, preventing inflation.
* **Integrity Validation:** Adler-32 checksum validation ensures corrupted or tampered storage data is detected immediately.
* **Zero External Dependencies:** 100% self-contained in TypeScript, avoiding bundle bloat and third-party dependency vulnerabilities.

### Negatives / Tradeoffs
* Small CPU overhead during compression/decompression operations (< 150ms for 1 MB payloads).
* Pipeline ordering requirement: Compression MUST occur BEFORE encryption (`encrypt(compress(data))`). Encrypted data exhibits near-maximum entropy, making post-encryption compression ineffective.

## Implementation Details

### Serialized Payload Envelope Format
Compressed data is stored as a formatted string envelope:
`cmp:v1:<algorithm>:<flags>:<uncompressedSize>:<compressedSize>:<checksum>:<data>`

* **Prefix:** `cmp:v1:` (Version 1 magic header).
* **Algorithm:** `lz-base64` | `lz-utf16` | `deflate` | `gzip` | `raw`.
* **Flags:** Bitmask integer (`0` = compressed, `1` = bypassed/raw).
* **Uncompressed Size:** Original UTF-8 byte length.
* **Compressed Size:** Compressed UTF-8 byte length.
* **Checksum:** 8-character hex string (Adler-32 hash of original uncompressed UTF-8 bytes).
* **Data:** Encoded payload string.

### Threshold Heuristics
* **Minimum Size Threshold:** Payloads under 128 bytes (UTF-8) are bypassed (`algorithm = 'raw'`, `flags = 1`).
* **Compression Ratio Threshold:** If `compressedSize >= 0.95 * originalSize`, payload is bypassed (`algorithm = 'raw'`, `flags = 1`).
* **Force Override:** Passing `force: true` bypasses threshold checks.

### File Inventory
* Secondary Port Interface: `src/domain/ports/secondary/compressionPort.ts`
* Infrastructure Adapter: `src/infrastructure/adapters/lzCompressionAdapter.ts`
* Domain Facade Utility: `utils/storageCompressionEngine.ts`
* Test Suite: `tests/storageCompressionEngine.test.ts`
