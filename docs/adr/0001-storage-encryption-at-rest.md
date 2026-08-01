# 0001. Storage Encryption at Rest

* **Status:** Accepted
* **Deciders:** Lead Security Architect, Infrastructure Team
* **Date:** 2026-08-01

## Context and Problem Statement
Web browser storage engines (LocalStorage, SessionStorage, IndexedDB, Cookies, OPFS, Cache API) persist key-value data in unencrypted plaintext on disk. Unencrypted client storage presents significant security risks:
1. Physical device theft or forensic disk extraction exposes stored auth tokens, PII, and sensitive application state.
2. Cross-Site Scripting (XSS) or browser extension compromise allows unauthorized scripts to inspect unencrypted storage.
3. Lack of integrity validation enables silent data tampering or bit-flipping attacks on client-side state.

The system requires a robust, zero-dependency, high-performance client-side encryption engine to transparently encrypt and decrypt stored values at rest while guaranteeing data authenticity and tamper detection.

## Decision Drivers
* **Confidentiality & Integrity:** Provide military-grade encryption alongside cryptographically verified tamper detection (AEAD).
* **Native Platform Security:** Utilize standard W3C Web Crypto API (`crypto.subtle`) for hardware-accelerated performance without external dependencies.
* **Hexagonal Architecture Decoupling:** Decouple domain storage operations from specific cryptographic implementations via a secondary port (`CryptoPort`).
* **Zero-Throw Exception Handling:** Ensure all cryptographic failures (wrong key, corrupted payload, tampered tag) return functional `Result<T, CryptoError>` objects without throwing uncaught runtime exceptions.
* **Compact Storage Overhead:** Standardize on a compact serialized string envelope for easy storage in browser string-only engines (LocalStorage/Cookies).

## Considered Options
1. **Plaintext Storage with Base64 Encoding:** Obfuscates data but offers 0% security against basic inspection.
2. **Third-Party Pure JS Libraries (e.g., CryptoJS, Forge):** Introduces bundle bloat, potential timing side-channel attacks, and maintenance overhead.
3. **Web Crypto API with AES-CBC + HMAC-SHA-256:** Provides security but requires two separate crypto passes and manual key management for encryption and authentication.
4. **Web Crypto API with AES-GCM-256 and PBKDF2-HMAC-SHA-256 Key Derivation:** Native hardware-accelerated Authenticated Encryption with Associated Data (AEAD), automatic 128-bit authentication tag validation, and secure passphrase key derivation.

## Decision Outcome
Chosen option: **Option 4 (Web Crypto API with AES-GCM-256 and PBKDF2)**.

### Positives
* **Authenticated Encryption (AEAD):** AES-GCM automatically appends a 128-bit authentication tag. Any tampering with IV, salt, or ciphertext results in immediate decryption failure.
* **Hardware Acceleration:** Uses native browser/V8 C++ bindings (`crypto.subtle`), processing tens of megabytes per second with zero bundle overhead.
* **Nonce & Salt Isolation:** Every encryption pass generates a fresh 16-byte CSPRNG salt and 12-byte CSPRNG IV, preventing key/IV reuse attacks.
* **Hexagonal Purity:** Exposed strictly through `src/domain/ports/secondary/cryptoPort.ts` and `utils/cryptoManager.ts`.

### Negatives / Tradeoffs
* Async API signature (`Promise<Result<...>>`) due to `crypto.subtle` promise-based nature.
* Key management requirement: Application must maintain passphrase/key in memory during session.

## Implementation Details

### Cryptographic Configuration
* **Algorithm:** AES-GCM (Galois/Counter Mode)
* **Key Length:** 256 bits (32 bytes)
* **Key Derivation (KDF):** PBKDF2 with HMAC-SHA-256, 100,000 iterations, 16-byte random salt.
* **Initialization Vector (IV):** 12 bytes (96 bits) generated via `crypto.getRandomValues()`.
* **Authentication Tag Length:** 128 bits.

### Serialized Payload Envelope Format
Data is stored as a formatted string envelope:
`enc:v1:<salt_base64>:<iv_base64>:<ciphertext_and_tag_base64>`

### File Inventory
* Primary Secondary Port: `src/domain/ports/secondary/cryptoPort.ts`
* Primary Secondary Adapter: `src/infrastructure/adapters/aesCryptoAdapter.ts`
* Domain Facade Utility: `utils/cryptoManager.ts`
* Test Suite: `tests/cryptoManager.test.ts`
