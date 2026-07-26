# AGENTS.md - AI & Developer Maintenance Guide

This document is an AI-native reference guide for AI agents and maintainers working on this repository. It provides system context, architecture blueprints, build workflows, and maintenance rules for the **Rust-powered Wisp & Browser.js Web Server** Docker container.

---

## 1. System Intent & Overview

This repository automates the build and publishing of multi-architecture Docker images (`linux/amd64` and `linux/arm64`) for **Browser.js** coupled with a high-performance **Rust HTTP + Wisp WebSocket Proxy Server** to GitHub Container Registry (`ghcr.io`).

### Key Operational Rules:
- **Submodules**: Tracks `browser.js` (`https://github.com/HeyPuter/browser.js`) and `epoxy-tls` (`https://github.com/MercuryWorkshop/epoxy-tls`, branch `multiplexed`) as Git submodules. The `firefox-wasm` submodule was removed; upstream `gecko.js` and `chrome-demo` release artifacts are fetched dynamically via `Makefile`.
- **Workflow Trigger**: Triggers automatically on any Git tag matching **`v*`** (e.g., `v1.0.0`, `v-a1b2c3d`).
- **Parallel Multi-Arch Build**: GitHub Actions uses a matrix strategy to compile `linux/amd64` and `linux/arm64` images in **parallel**, pushing platform digests to `ghcr.io` and merging them into a unified multi-arch manifest.
- **No TLS on Server**: The Rust server handles plain HTTP traffic and WebSocket upgrades on port **`8080`**.
- **Static Asset Serving**: `browser.js` static assets (`packages/chrome/dist` and `packages/sandbox`) and Firefox WASM static assets (`dist/firefox`) are served directly by the Rust server under `/`, `/sandbox/`, and `/ff/` with SPA fallback routing.

---

## 2. Codebase Architecture & File Structure

```
.
├── .github/
│   └── workflows/
│       └── docker-publish.yml # Parallel multi-arch GitHub Actions workflow (v*)
├── browser.js/                 # Git Submodule: HeyPuter/browser.js
├── epoxy-tls/                 # Git Submodule: MercuryWorkshop/epoxy-tls (branch: multiplexed)
├── demo/                      # Standalone Firefox WASM demo UI (Vite + TS)
├── src/
│   └── main.rs                # Rust HTTP & Wisp WebSocket server
├── Makefile                   # Build automation & dev runner (make dev)
├── Cargo.toml                 # Cargo workspace definition
├── Dockerfile                  # Multi-stage Docker build
├── README.md                   # Public human-readable documentation
├── AGENTS.md                   # AI-native technical reference & maintenance guide
└── .gitignore                  # Git exclusion rules
```

---

## 3. Firefox WASM Demo Features & Options

The custom frontend in `demo/` provides:
1. **Launch Button**: User-initiated click to boot Gecko WASM and open the Firefox chrome interface.
2. **GPU Acceleration**: WebGL-based hardware rendering toggle (enabled by default).
3. **JIT Option**: Experimental WebAssembly JIT toggle (unselected by default).
4. **Host Font Loading Option**: Option to access host browser system fonts via `queryLocalFonts()` to render non-English & CJK characters (unselected by default, with permission prompt warning).
5. **Wisp Proxy Endpoint**: Configurable Wisp WebSocket proxy URL (defaults to `wss://{host}/wisp/`).
6. **WASM Caching Fix**: Includes OPFS lock resolution (`waitForOpfsLocks`) to prevent browser file handle deadlock on reloads.

---

## 4. Local Development Commands

### Download Dependencies & Run Dev Server:
```bash
# Downloads upstream release tarballs, builds frontend demo into dist/firefox, and runs Rust server
make dev
```

### Build Demo Frontend Only:
```bash
make build-demo
```

### Build Rust Server Binary:
```bash
make build-server
```

---

## 5. Maintenance Guidelines

1. **Submodule Sync**: Keep submodules updated:
   `git submodule update --remote --recursive`
2. **Upstream Release Version**: To update upstream Firefox WASM artifacts, change `FIREFOX_WASM_VERSION ?= vX.Y.Z` in `Makefile`.
3. **Container Size**: The final runtime stage strictly uses `debian:bookworm-slim` with compiled Rust binary and static HTML/JS assets to maintain minimal image size and fast startup.
