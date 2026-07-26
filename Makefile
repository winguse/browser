FIREFOX_WASM_VERSION ?= v0.0.1
CHROME_DEMO_URL := https://github.com/HeyPuter/firefox-wasm/releases/download/$(FIREFOX_WASM_VERSION)/chrome-demo-$(FIREFOX_WASM_VERSION).tar.gz
GECKO_JS_URL := https://github.com/HeyPuter/firefox-wasm/releases/download/$(FIREFOX_WASM_VERSION)/gecko.js-$(FIREFOX_WASM_VERSION).tar.gz
TWEMOJI_URL := https://raw.githubusercontent.com/mozilla/gecko-dev/master/browser/fonts/TwemojiMozilla.ttf
NOTO_CJK_URL := https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf

DEPS_DIR := deps
DIST_DIR := dist
FIREFOX_DIST := $(DIST_DIR)/firefox

.PHONY: all dev download-deps build-demo build-server clean

all: dev

# Download and extract upstream pre-built artifacts
download-deps:
	@mkdir -p $(DEPS_DIR) /tmp/fw-deps demo/public/fonts
	@if [ ! -d "$(DEPS_DIR)/gecko.js" ]; then \
		echo ">> Downloading gecko.js $(FIREFOX_WASM_VERSION)..."; \
		curl -sL "$(GECKO_JS_URL)" -o /tmp/fw-deps/gecko.js.tar.gz && \
		mkdir -p $(DEPS_DIR) && \
		tar -xzf /tmp/fw-deps/gecko.js.tar.gz -C $(DEPS_DIR); \
	fi
	@if [ ! -f "demo/public/chrome-assets.tar.zst" ]; then \
		echo ">> Downloading chrome-demo $(FIREFOX_WASM_VERSION) assets..."; \
		mkdir -p demo/public; \
		curl -sL "$(CHROME_DEMO_URL)" -o /tmp/fw-deps/chrome-demo.tar.gz && \
		mkdir -p /tmp/fw-deps/cdemo && \
		tar -xzf /tmp/fw-deps/chrome-demo.tar.gz -C /tmp/fw-deps/cdemo && \
		cp /tmp/fw-deps/cdemo/dist/chrome-assets.tar.zst demo/public/ && \
		cp /tmp/fw-deps/cdemo/dist/chrome-assets.json demo/public/; \
	fi
	@if [ ! -f "demo/public/fonts/TwemojiMozilla.ttf" ]; then \
		echo ">> Downloading Mozilla official Twemoji font..."; \
		curl -sL "$(TWEMOJI_URL)" -o demo/public/fonts/TwemojiMozilla.ttf; \
	fi
	@if [ ! -f "demo/public/fonts/NotoSansSC.ttf" ]; then \
		echo ">> Downloading Noto Sans CJK Chinese font..."; \
		curl -sL "$(NOTO_CJK_URL)" -o demo/public/fonts/NotoSansSC.ttf; \
	fi
	@rm -rf /tmp/fw-deps

# Build frontend demo into dist/firefox
build-demo: download-deps
	@echo ">> Building frontend demo..."
	@cd demo && (pnpm install --ignore-scripts || true) && npx vite build
	@mkdir -p $(FIREFOX_DIST)
	@cp -r demo/dist/* $(FIREFOX_DIST)/

# Build Rust server binary
build-server:
	@echo ">> Building Rust server..."
	@cargo build --release

# Development target: builds demo assets and runs Rust server
dev: build-demo
	@echo ">> Starting Rust Browser & Wisp server on http://localhost:8080 ..."
	FIREFOX_DIR=$(FIREFOX_DIST) cargo run --release

clean:
	@rm -rf $(DEPS_DIR) $(DIST_DIR) demo/dist demo/node_modules target /tmp/fw-deps
