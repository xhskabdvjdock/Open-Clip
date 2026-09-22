# Open Clip

**A lightweight, private, native-feeling clipboard manager for everyday use.**

> "نسخت شيئًا قبل خمس دقائق وأحتاجه الآن." → **Ctrl/Cmd + Shift + V → Search → Enter**

## Stack

- **Tauri 2** (Rust backend, native WebView)
- **React + TypeScript + Vite**
- **Tailwind CSS** + **Lucide Icons**
- **SQLite** (via rusqlite, local-only)
- IBM Plex Sans Arabic for Arabic RTL

## Features (all real, no mocks)

1. Real system clipboard monitoring (poll-optimized, low CPU)
2. Local SQLite storage (100 / 500 / 1000 limit, default 500)
3. History with duplicate detection (hash-based, updates `last_copied_at`)
4. Fast search (content / type / date)
5. Quick Picker via global shortcut `Ctrl+Shift+V` (macOS `Cmd+Shift+V`)
6. Copy back, Pin / Unpin, Delete, Details
7. Local sensitive-content detection (passwords, OTP, cards, API keys, private keys)
8. Settings: General / Clipboard / Privacy / Shortcuts / About
9. System tray + minimize-to-tray + pause monitoring
10. Autostart, theme (light/dark/system), English/العربية RTL
11. Export / Import JSON + CSV with validation, Backup / Restore
12. First-run onboarding (2 screens max), empty state, error handling

## Privacy

- 100% local. No network requests for clipboard data.
- No account, no backend, no cloud, no AI, no analytics.
- Sensitive content is **never saved** by default.

## Dev

```bash
npm install
npm run tauri:dev
```

Requires Rust 1.77+ and Tauri 2 prerequisites:
https://v2.tauri.app/start/prerequisites/

## Build

```bash
npm run tauri:build
```

## Releasing a new version

One command bumps the version everywhere (`package.json`,
`src/version.ts`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`):

```bash
npm run version:patch   # 1.0.0 -> 1.0.1  (fixes)
npm run version:minor   # 1.0.0 -> 1.1.0  (features)
npm run version:major   # 1.0.0 -> 2.0.0  (breaking)
```

Then build, and publish a GitHub Release tagged `vX.Y.Z` with the new
setup exe attached — the in-app update banner picks it up automatically.

## Project layout

```
src/                  React frontend (main window + picker in one bundle)
src-tauri/            Rust backend (monitor, db, tray, shortcuts, autostart)
```

## License

MIT
