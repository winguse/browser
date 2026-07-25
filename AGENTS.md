# AGENTS.md - AI & Developer Maintenance Guide

This document is an AI-native reference guide for AI agents and maintainers working on this repository. It provides system context, architecture blueprints, build workflows, and maintenance rules for the **Rust-powered Wisp & Browser.js Web Server** Docker container.

---

## 1. System Intent & Overview

This repository automates the build and publishing of multi-architecture Docker images (`linux/amd64` and `linux/arm64`) for **Browser.js** coupled with a high-performance **Rust HTTP + Wisp WebSocket Proxy Server** to GitHub Container Registry (`ghcr.io`).

### Key Operational Rules:
- **Submodules**: Tracks `browser.js` (`https://github.com/HeyPuter/browser.js`) and `epoxy-tls` (`https://github.com/MercuryWorkshop/epoxy-tls`, branch `multiplexed`) as Git submodules.
- **Workflow Trigger**: Triggers automatically on any Git tag matching **`v*`** (e.g., `v1.0.0`, `v-a1b2c3d`).
- **Parallel Multi-Arch Build**: GitHub Actions uses a matrix strategy to compile `linux/amd64` and `linux/arm64` images in **parallel**, pushing platform digests to `ghcr.io` and merging them into a unified multi-arch manifest.
- **No TLS on Server**: The Rust server handles plain HTTP traffic and WebSocket upgrades on port **`8080`**.
- **Static Asset Serving**: `browser.js` static assets (`packages/chrome/dist` and `packages/sandbox`) are served directly by the Rust server with SPA fallback routing.

---

## 2. Codebase Architecture & File Structure

```
.
├── .github/
│   └── workflows/
│       └── docker-publish.yml # Parallel multi-arch GitHub Actions workflow (v*)
├── browser.js/                 # Git Submodule: HeyPuter/browser.js
├── epoxy-tls/                 # Git Submodule: MercuryWorkshop/epoxy-tls (branch: multiplexed)
├── src/
│   └── main.rs                # Rust HTTP & Wisp WebSocket server
├── Cargo.toml                 # Cargo workspace definition
├── Dockerfile                  # Multi-stage Docker build (Node frontend + Rust server + debian runtime)
├── README.md                   # Public human-readable documentation
├── AGENTS.md                   # AI-native technical reference & maintenance guide
└── .gitignore                  # Git exclusion rules
```

---

## 3. GitHub Actions Release Workflow

The workflow file [.github/workflows/docker-publish.yml](file:///.github/workflows/docker-publish.yml) automates the pipeline:

### Workflow Lifecycle:
1. **Trigger**: `push` on tags matching `v*` or manual `workflow_dispatch`.
2. **Frontend Asset Build Job (`build-assets`)**:
   - Runs once on `ubuntu-latest`.
   - Installs Node 22 + PNPM and compiles `browser.js` static assets (`packages/chrome/dist` & `packages/sandbox`).
   - Uploads static asset artifacts shared by all target architectures.
3. **Parallel Native Multi-Arch Container Build Job (`build`)**:
   - Runs two parallel matrix tasks using native runners (`ubuntu-latest` for `amd64`, `ubuntu-24.04-arm` for `arm64`), eliminating QEMU emulation overhead.
   - Downloads pre-built `static-assets` artifacts.
   - Compiles native Rust `browser-server` binary for target platform.
   - Assembles minimal `debian:bookworm-slim` container image and pushes platform digest to `ghcr.io`.
4. **Manifest Merge Job (`merge`)**:
   - Downloads platform digests from the parallel matrix tasks.
   - Combines platform digests into a unified multi-architecture image manifest via `docker buildx imagetools create`.
   - Pushes manifest tags:
     - `ghcr.io/<owner>/<repo>:<tag>`
     - `ghcr.io/<owner>/<repo>:latest`

---

## 4. Rust Server Architecture (`src/main.rs`)

### Ports & Environment Variables
| Port | Purpose | Environment Variable | Default |
|---|---|---|---|
| **8080** | Primary HTTP & Wisp WebSocket Endpoint | `PORT`, `HOST` | `8080`, `0.0.0.0` |
| - | Path to Chrome UI static assets | `STATIC_DIR` | `./dist/chrome` |
| - | Path to Sandbox isolation static assets | `SANDBOX_DIR` | `./dist/sandbox` |

### Server Mechanics:
1. **WebSocket Upgrade Check**: Uses `epoxy_server::upgrade::is_upgrade_request` to detect Wisp WebSocket proxy requests.
2. **Wisp Proxy Handler**: Passes upgraded WebSocket streams directly to `epoxy_server::handle::handle_wisp` for multiplexed Wisp proxying over HTTP port 8080.
3. **Static File Server**: Serves `/sandbox/*` from `SANDBOX_DIR` and all other paths from `STATIC_DIR`. Fallbacks non-extension paths to `index.html` for SPA routing.

---

## 5. Local Development Commands

### Build Frontend Static Assets:
```bash
cd browser.js
pnpm install
pnpm build:dreamland
pnpm build
pnpm build:chrome
```

### Build & Run Rust Server Locally:
```bash
cargo build --release
STATIC_DIR=./browser.js/packages/chrome/dist SANDBOX_DIR=./browser.js/packages/sandbox ./target/release/browser-server
```

### Build Multi-Arch Docker Image Locally:
```bash
docker buildx build --platform linux/amd64,linux/arm64 -t browser-server-test .
```

---

## 6. Maintenance Guidelines

1. **Submodule Sync**: Ensure submodules are kept up to date:
   `git submodule update --remote --recursive`
2. **Parallel Build Matrix**: Maintain the `matrix.include` array in `.github/workflows/docker-publish.yml` if additional architectures (e.g. `riscv64`) are added.
3. **Container Size**: The final runtime stage strictly uses `debian:bookworm-slim` with compiled Rust binary and static HTML/JS assets to maintain minimal image size and fast startup across both `amd64` and `arm64`.
