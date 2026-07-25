# Browser (in browser)

A high-performance Rust web server that serves [HeyPuter/browser.js](https://github.com/HeyPuter/browser.js) static assets and handles [epoxy-tls](https://github.com/MercuryWorkshop/epoxy-tls) Wisp WebSocket proxying over a single HTTP port (8080).

---

## 🚀 Quick Start

### Run container:
```bash
docker run -d -p 8080:8080 ghcr.io/winguse/browser:latest
```

Open `http://localhost:8080` in your browser.

---

## 🏷 Submodules & Automated Releases

This repository tracks two Git submodules:
- `browser.js`: `https://github.com/HeyPuter/browser.js`
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
   - Serves static assets for the Browser.js frontend with SPA fallback.
   - Detects WebSocket upgrade headers and routes Wisp multiplexed proxy traffic.
2. **Multi-Stage Dockerfile**:
   - Stage 1: Builds `browser.js` static assets using Node 22 + PNPM.
   - Stage 2: Compiles `browser-server` using Rust.
   - Stage 3: Assembles runtime `debian:bookworm-slim` image exposing port 8080.

For technical details and maintenance instructions, see [AGENTS.md](AGENTS.md).
