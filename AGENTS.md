# AGENTS.md - AI & Developer Maintenance Guide

This document is an AI-native reference guide for AI agents and maintainers working on this repository. It provides system context, architecture blueprints, build workflows, and maintenance rules for the **Node.js-powered wisp-js & Browser.js Web Server** Docker container.

---

## 1. System Intent & Overview

This repository automates the build and publishing of multi-architecture Docker images (`linux/amd64` and `linux/arm64`) for **Browser.js** coupled with a high-performance **Node.js HTTP + wisp-js WebSocket Proxy Server** to GitHub Container Registry (`ghcr.io`).

### Key Operational Rules:
- **Submodules**: Tracks `browser.js` (`https://github.com/HeyPuter/browser.js`) and `wisp-js` (`https://github.com/MercuryWorkshop/wisp-js`) as Git submodules. Upstream `gecko.js` and `chrome-demo` release artifacts are fetched dynamically via `Makefile`.
- **Workflow Trigger**: Triggers automatically on any Git tag matching **`v*`** (e.g., `v1.0.0`, `v-a1b2c3d`).
- **Parallel Multi-Arch Build**: GitHub Actions uses a matrix strategy to compile `linux/amd64` and `linux/arm64` images in **parallel**, pushing platform digests to `ghcr.io` and merging them into a unified multi-arch manifest.
- **No TLS on Server**: The Node.js server handles plain HTTP traffic and WebSocket upgrades on port **`8080`**.
- **Static Asset Serving**: `browser.js` static assets (`packages/chrome/dist` and `packages/sandbox`) and Firefox WASM static assets (`dist/firefox`) are served directly by the Node.js server under `/`, `/sandbox/`, and `/ff/` with SPA fallback routing.

---

## 2. Codebase Architecture & File Structure

```
.
├── .github/
│   └── workflows/
│       └── docker-publish.yml # Parallel multi-arch GitHub Actions workflow (v*)
├── browser.js/                 # Git Submodule: HeyPuter/browser.js
├── wisp-js/                    # Git Submodule: MercuryWorkshop/wisp-js
├── firefox-landing-page/       # Standalone Firefox WASM landing page UI (Vite + TS)
├── src/
│   └── server.js              # Node.js HTTP & wisp-js WebSocket server
├── Makefile                   # Build automation & dev runner (make dev)
├── package.json               # Node.js package & dependencies
├── Dockerfile                  # Docker build configuration
├── README.md                   # Public human-readable documentation
├── AGENTS.md                   # AI-native technical reference & maintenance guide
└── .gitignore                  # Git exclusion rules
```

---

## 3. Firefox WASM Landing Page Features & Options

The custom frontend in `firefox-landing-page/` provides:
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
# Downloads upstream release tarballs, builds frontend landing page into dist/firefox, and runs Node.js server
make dev
```

### Build Landing Page Frontend Only:
```bash
make build-firefox-landing-page
```

### Build Node.js Server Dependencies:
```bash
make build-server
```

---

## 5. Maintenance Guidelines

1. **Submodule Sync**: Keep submodules updated:
   `git submodule update --remote --recursive`
2. **Upstream Release Version**: To update upstream Firefox WASM artifacts, change `FIREFOX_WASM_VERSION ?= vX.Y.Z` in `Makefile`.
3. **Container Size**: The final runtime stage strictly uses `node:22-slim` with `wisp-js` server and static HTML/JS assets to maintain minimal image size and fast startup.
