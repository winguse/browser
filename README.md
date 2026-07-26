# Browser (in browser)

A high-performance Rust web server that serves [HeyPuter/browser.js](https://github.com/HeyPuter/browser.js) and Firefox WASM static assets while handling [epoxy-tls](https://github.com/MercuryWorkshop/epoxy-tls) Wisp WebSocket proxying over a single HTTP port (8080).

---

## 🚀 Quick Start

### Run locally:
```bash
make dev
```
This automatically downloads upstream `firefox-wasm` release assets (`v0.0.1`), builds the frontend landing page (`firefox-landing-page/`), compiles the Rust server, and launches the server at `http://localhost:8080`.

### Run container:
```bash
docker run -d -p 8080:8080 ghcr.io/winguse/browser:latest
```

Open `http://localhost:8080/ff/` in your browser to access the Firefox WASM UI.

---

## ⚙️ Environment Variables

| Variable | Description | Default |
|---|---|---|
| `PORT` | Web server listening port | `8080` |
| `HOST` | Web server listening host | `0.0.0.0` |
| `STATIC_DIR` | Path to Chrome UI static assets | `./browser.js/packages/chrome/dist` |
| `SANDBOX_DIR` | Path to Sandbox isolation static assets | `./browser.js/packages/sandbox` |
| `FIREFOX_DIR` | Path to Firefox WASM static assets | `./dist/firefox` |

For technical details and maintenance instructions, see [AGENTS.md](AGENTS.md).
