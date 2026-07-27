FIREFOX_WASM_VERSION ?= v0.0.1
CHROME_DEMO_URL := https://github.com/HeyPuter/firefox-wasm/releases/download/$(FIREFOX_WASM_VERSION)/chrome-demo-$(FIREFOX_WASM_VERSION).tar.gz
GECKO_JS_URL := https://github.com/HeyPuter/firefox-wasm/releases/download/$(FIREFOX_WASM_VERSION)/gecko.js-$(FIREFOX_WASM_VERSION).tar.gz
TWEMOJI_URL := https://raw.githubusercontent.com/mozilla/gecko-dev/master/browser/fonts/TwemojiMozilla.ttf
NOTO_CJK_URL := https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf

DEPS_DIR := deps
DIST_DIR := dist
FIREFOX_DIST := $(DIST_DIR)/firefox

.PHONY: all dev download-deps build-firefox-landing-page build-demo build-server clean

all: dev

# Download and extract upstream pre-built artifacts
download-deps:
	@mkdir -p $(DEPS_DIR) /tmp/fw-deps firefox-landing-page/public/fonts
	@if [ ! -d "$(DEPS_DIR)/gecko.js" ]; then \
		echo ">> Downloading gecko.js $(FIREFOX_WASM_VERSION)..."; \
		curl -sL "$(GECKO_JS_URL)" -o /tmp/fw-deps/gecko.js.tar.gz && \
		mkdir -p $(DEPS_DIR) && \
		tar -xzf /tmp/fw-deps/gecko.js.tar.gz -C $(DEPS_DIR); \
	fi
	@if [ ! -f "firefox-landing-page/public/chrome-assets.tar.zst" ]; then \
		echo ">> Downloading chrome-demo $(FIREFOX_WASM_VERSION) assets..."; \
		mkdir -p firefox-landing-page/public; \
		curl -sL "$(CHROME_DEMO_URL)" -o /tmp/fw-deps/chrome-demo.tar.gz && \
		mkdir -p /tmp/fw-deps/cdemo && \
		tar -xzf /tmp/fw-deps/chrome-demo.tar.gz -C /tmp/fw-deps/cdemo && \
		cp /tmp/fw-deps/cdemo/dist/chrome-assets.tar.zst firefox-landing-page/public/ && \
		cp /tmp/fw-deps/cdemo/dist/chrome-assets.json firefox-landing-page/public/; \
	fi
	@if [ ! -f "firefox-landing-page/public/fonts/TwemojiMozilla.ttf" ]; then \
		echo ">> Downloading Mozilla official Twemoji font..."; \
		curl -sL "$(TWEMOJI_URL)" -o firefox-landing-page/public/fonts/TwemojiMozilla.ttf; \
	fi
	@if [ ! -f "firefox-landing-page/public/fonts/NotoSansSC.ttf" ]; then \
		echo ">> Downloading Noto Sans CJK Chinese font..."; \
		curl -sL "$(NOTO_CJK_URL)" -o firefox-landing-page/public/fonts/NotoSansSC.ttf; \
	fi
	@rm -rf /tmp/fw-deps

# Build frontend landing page into dist/firefox
build-firefox-landing-page: download-deps
	@echo ">> Building frontend landing page..."
	@cd firefox-landing-page && pnpm install --ignore-scripts && npx vite build
	@mkdir -p $(FIREFOX_DIST)
	@cp -r firefox-landing-page/dist/* $(FIREFOX_DIST)/

build-demo: build-firefox-landing-page

# Build Node.js server dependencies
build-server:
	@echo ">> Installing server dependencies..."
	@npm install --omit=dev

# Development target: builds landing page assets and runs Node.js server
dev: build-firefox-landing-page
	@npm install
	@echo ">> Starting Browser & Wisp server on http://localhost:8080 ..."
	FIREFOX_DIR=$(FIREFOX_DIST) node src/server.js

clean:
	@rm -rf $(DEPS_DIR) $(DIST_DIR) firefox-landing-page/dist firefox-landing-page/node_modules node_modules /tmp/fw-deps

