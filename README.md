# Browser (in browser)

A high-performance Rust web server that serves [HeyPuter/browser.js](https://github.com/HeyPuter/browser.js) and [HeyPuter/firefox-wasm](https://github.com/HeyPuter/firefox-wasm) static assets while handling [epoxy-tls](https://github.com/MercuryWorkshop/epoxy-tls) Wisp WebSocket proxying over a single HTTP port (8080).

---

## 🚀 Quick Start

### Run container:
```bash
docker run -d -p 8080:8080 ghcr.io/winguse/browser:latest
```

Open `http://localhost:8080` in your browser.

### Available Endpoints:
- **`http://localhost:8080/`**: Chrome UI (browser.js)
- **`http://localhost:8080/ff/`**: Firefox WASM UI

---

## 🏷 Submodules & Automated Releases

This repository tracks three Git submodules:
- `browser.js`: `https://github.com/HeyPuter/browser.js`
- `firefox-wasm`: `https://github.com/HeyPuter/firefox-wasm`
- `epoxy-tls`: `https://github.com/MercuryWorkshop/epoxy-tls` (branch `multiplexed`)

### Release Trigger:
Publishing to `ghcr.io` triggers automatically on any Git tag matching `v*` (e.g. `v1.0.0`, `v-2026.07`).

```bash
git tag v1.0.0
git push origin v1.0.0
```

---

## 🏗 System Architecture

1. **Rust HTTP Web Server (`src/main.rs`)**:
   - Listens on `0.0.0.0:8080` (HTTP).
   - Serves static assets for Chrome UI (`/`), and Firefox WASM UI (`/ff/`) with SPA fallback routing.
   - Detects WebSocket upgrade headers and routes Wisp multiplexed proxy traffic.
2. **Multi-Stage Build Pipeline & Dockerfile**:
   - **`browser-assets`**: Compiles `browser.js` static assets using Node.js & PNPM.
   - **`firefox-assets`**: Compiles `firefox-wasm` WebAssembly binary and UI static assets using LLVM, Rust (`wasm32-unknown-emscripten`), and Emscripten.
   - **`browser-server`**: Compiles the native Rust binary.
   - **Runtime Image**: Assembles a minimal `debian:bookworm-slim` container exposing port 8080.

---

## ⚙️ Environment Variables

| Variable | Description | Default |
|---|---|---|
| `PORT` | Web server listening port | `8080` |
| `HOST` | Web server listening host | `0.0.0.0` |
| `STATIC_DIR` | Path to Chrome UI static assets | `./browser.js/packages/chrome/dist` |
| `SANDBOX_DIR` | Path to Sandbox isolation static assets | `./browser.js/packages/sandbox` |
| `FIREFOX_DIR` | Path to Firefox WASM static assets | `./firefox-wasm/demo/chrome/dist` |

For technical details and maintenance instructions, see [AGENTS.md](AGENTS.md).
