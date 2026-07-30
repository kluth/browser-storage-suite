# 🚀 Browser Storage Suite — Automated CI/CD Deploy & Store Publishing Guide

This repository includes a fully automated **GitHub Actions CI/CD Pipeline** (`.github/workflows/deploy.yml`) that performs:

1. 🧪 **Automated Quality Gate**: TypeScript type checking (`tsc --noEmit`) and complete Vitest test execution (522+ unit & E2E stress tests).
2. 📦 **Extension Packaging**: Compiles and creates `.zip` production artifacts for **Chrome (MV3)** and **Firefox (MV2)** via WXT.
3. 🚀 **GitHub Release Creation**: Automatically generates a GitHub Release with version tag notes and attaches release zip binaries.
4. 🛒 **Chrome Web Store Auto-Publish**: Submits the zip directly to Google Chrome Web Store.
5. 🦊 **Firefox Add-ons (AMO) Auto-Publish**: Submits the zip directly to Mozilla AMO.

---

## 🔑 Required GitHub Repository Secrets

To enable automatic store publishing, navigate to your GitHub Repository:
`Settings > Secrets and variables > Actions > New repository secret` and add the following keys:

### 🌐 1. Chrome Web Store Credentials

| Secret Name | Description | Where to get it |
| :--- | :--- | :--- |
| `CHROME_EXTENSION_ID` | The 32-character extension ID assigned in Chrome Web Store | Chrome Developer Dashboard URL (`/item/YOUR_ID`) |
| `CHROME_CLIENT_ID` | Google Cloud OAuth2 Client ID | Google Cloud Console -> APIs & Services -> Credentials |
| `CHROME_CLIENT_SECRET` | Google Cloud OAuth2 Client Secret | Google Cloud Console -> APIs & Services -> Credentials |
| `CHROME_REFRESH_TOKEN` | OAuth2 Refresh Token generated via Google OAuth Playground | Google Developer Account |

#### How to generate Chrome OAuth Tokens:
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project and enable the **Chrome Web Store API**.
3. Create an **OAuth 2.0 Client ID** (Application type: *Desktop App*).
4. Obtain a `Refresh Token` using OAuth2 Playground with scope `https://www.googleapis.com/auth/chromewebstore`.

---

### 🦊 2. Firefox Add-ons (AMO) Credentials

| Secret Name | Description | Where to get it |
| :--- | :--- | :--- |
| `FIREFOX_EXTENSION_ID` | Extension UUID / GUID (e.g. `{12345678-abcd-1234-abcd-123456789abc}` or `storage-suite@domain.com`) | `manifest.json` `browser_specific_settings.gecko.id` |
| `FIREFOX_JWT_ISSUER` | Mozilla AMO API Key (JWT Issuer) | [Mozilla Add-ons API Keys](https://addons.mozilla.org/developers/addon/api/key/) |
| `FIREFOX_JWT_SECRET` | Mozilla AMO API Secret (JWT Secret) | [Mozilla Add-ons API Keys](https://addons.mozilla.org/developers/addon/api/key/) |

---

## 🏷️ How to Trigger a Release & Publish

### Method A: Git Version Tag (Recommended)
Push a git tag matching `v*.*.*` (e.g., `v1.1.0`):

```bash
git tag v1.1.0
git push origin v1.1.0
```

The GitHub Action will automatically run tests, build the zip files, create a GitHub release, and submit the release to both store developer portals.

### Method B: Manual Trigger via GitHub UI
1. Go to `Actions` tab on GitHub.
2. Select **CI/CD Build, Release & Store Auto-Publish Pipeline**.
3. Click **Run workflow** (select `publish_stores: true`).
