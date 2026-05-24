# Agents

## Cursor Cloud specific instructions

### Project Overview

Telegram Drive is a Tauri v2 desktop app (React + Rust) that turns Telegram into cloud storage. The app lives entirely in the `app/` directory.

### System Dependencies (Linux)

The following must be installed for the Rust/Tauri backend to compile:

```
libwebkit2gtk-4.1-dev build-essential libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev
```

### Development Commands

All commands run from `app/`:

| Task | Command |
|------|---------|
| Install deps | `npm install` |
| Type check | `npx tsc --noEmit` |
| Frontend dev server only | `npm run dev` (port 1420) |
| Full Tauri dev | `npm run tauri dev` |
| Frontend build | `npm run build` |
| Rust check | `cd src-tauri && cargo check` |

### Key Caveats

- **Rust 1.85+ required.** The patched `grammers-mtsender` crate uses `edition = "2024"`, which needs Rust 1.85+. If the pre-installed Rust is older, run `rustup update stable && rustup default stable`.
- **First Rust build takes ~2 minutes** to compile 700+ crates. Subsequent builds are incremental and fast (~5s for Rust changes).
- **`npm run tauri dev`** starts both the Vite dev server (port 1420) and compiles/runs the Rust backend. The Vite `beforeDevCommand` is already configured in `src-tauri/tauri.conf.json`.
- **DRI3/EGL warnings** (e.g., "Could not get DRI3 device") are expected in cloud VMs and do not affect functionality. The app renders fine via software rendering.
- **Updater endpoint error** (`update endpoint did not respond`) is expected—it queries GitHub releases which requires network access to a specific URL.
- **Dev Mode** on the auth screen bypasses Telegram API authentication for local UI development/testing.
- **No linter or test framework** is configured in this repo. Validation is done via `tsc --noEmit` (type check) and `cargo check` (Rust compilation).
- The frontend is served at `http://localhost:1420` and the embedded media streaming server runs on port `14201`.
