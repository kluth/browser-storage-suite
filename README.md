# Browser Storage Suite (Cross-Browser Extension)

Eine moderne, leistungsfähige Browser-Erweiterung zur Verwaltung von **LocalStorage**, **SessionStorage**, **Cookies** und **IndexedDB** – entwickelt nach dem Prinzip **"Write Once, Deploy Everywhere!"**.

Unterstützt **Chrome**, **Firefox**, **Microsoft Edge**, **Brave**, **Opera** und andere WebExtension-kompatible Browser.

---

## 🚀 Key Features

- **Cross-Browser Native**: Ausführung über einheitliche W3C / WebExtension APIs für Chrome (MV3), Firefox (Gecko MV3/MV2) und Edge.
- **Live Storage Inspector**: Echtzeit-Ansicht & Bearbeitung von LocalStorage & SessionStorage der aktiven Website.
- **Cookie Manager**: Übersicht, Filterung & Entfernung von Website-Cookies.
- **Dark-Mode UI**: Modernes, reaktives React & Tailwind-inspiriertes Interface mit Lucide Icons.
- **Export & Import**: Speichern & Wiederherstellen von Storage-Snapshots als JSON.

---

## 📁 Projektstruktur

```
browser-storage-suite/
├── entrypoints/
│   ├── background.ts      # Service Worker / Background Script (Cross-Browser Message Hub)
│   ├── content.ts         # Content Script (Safe Storage Access in Webpages)
│   ├── popup/             # Main Extension Popup UI (React + TypeScript)
│   │   ├── index.html
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   └── style.css
│   └── options/           # Extension Settings Page (React + TypeScript)
│       ├── index.html
│       ├── main.tsx
│       ├── Options.tsx
│       └── style.css
├── utils/
│   └── browserApi.ts      # Abstraktionsschicht für browser.storage & chrome.cookies
├── public/                # Extension Icons & statische Assets
├── package.json           # Dependencies & Multi-Browser Build Scripts
├── wxt.config.ts          # WXT Framework & Manifest V3 Konfiguration
└── tsconfig.json          # TypeScript Compiler Options
```

---

## 🛠️ Entwicklung & Installation

### 1. Abhängigkeiten installieren
```bash
npm install
```

### 2. Entwicklungsmodus mit Hot-Reload (HMR)

- **Für Chrome / Chromium / Edge / Brave:**
  ```bash
  npm run dev
  ```

- **Für Firefox:**
  ```bash
  npm run dev:firefox
  ```

---

## 📦 Production Builds ("Deploy Everywhere")

Erstellt die fertigen Erweiterungs-Dateien im Ordner `.output/`:

```bash
# Build für Chrome & Chromium-Browser (Output: .output/chrome-mv3)
npm run build

# Build für Firefox (Output: .output/firefox-mv3)
npm run build:firefox

# Build für Microsoft Edge (Output: .output/edge-mv3)
npm run build:edge
```

### ✉️ Web Store ZIP-Pakete generieren
```bash
npm run zip         # Erstellt Chrome Store .zip
npm run zip:firefox # Erstellt Firefox Add-ons .zip
```

---

## 🔌 Erweiterung im Browser laden

### Chrome / Edge / Brave:
1. Öffne `chrome://extensions/` bzw. `edge://extensions/`
2. Aktiviere den **Entwicklermodus** (Developer Mode) oben rechts.
3. Klicke auf **"Entpackte Erweiterung laden"** (*Load unpacked*).
4. Wähle den Ordner `.output/chrome-mv3` aus.

### Firefox:
1. Öffne `about:debugging#/runtime/this-firefox`
2. Klicke auf **"Temporäres Add-on laden..."** (*Load Temporary Add-on...*).
3. Wähle die `manifest.json` aus dem Ordner `.output/firefox-mv3`.

---

## 📜 Lizenz
MIT License