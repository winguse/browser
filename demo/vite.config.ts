import { defineConfig, type Plugin } from 'vite';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { server as wisp } from '@mercuryworkshop/wisp-js/server';

const require = createRequire(import.meta.url);
const geckoPackagePath = path.resolve(__dirname, '../deps/gecko.js/package.json');
const libDist = fs.existsSync(geckoPackagePath)
  ? path.join(path.dirname(geckoPackagePath), 'dist')
  : path.join(path.dirname(require.resolve('gecko.js/package.json')), 'dist');

const ENGINE = ['gecko.wasm', 'gecko.wasm.zst'];
const mime = (n: string) =>
  n.endsWith('.wasm') ? 'application/wasm' :
    n.endsWith('.js') ? 'text/javascript' : 'application/octet-stream';

const PUBLIC_DIR = path.resolve(__dirname, 'public');
const ASSET_ARCHIVE = path.join(PUBLIC_DIR, 'chrome-assets.tar.zst');
const ASSET_MANIFEST = path.join(PUBLIC_DIR, 'chrome-assets.json');

function serveEngine(): Plugin {
  return {
    name: 'libxul-engine',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = (req.url || '').split('?')[0].replace(/^\//, '');
        if (ENGINE.includes(name) && fs.existsSync(path.join(libDist, name))) {
          res.setHeader('Content-Type', mime(name));
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Content-Length', fs.statSync(path.join(libDist, name)).size);
          fs.createReadStream(path.join(libDist, name)).pipe(res);
          return;
        }
        next();
      });
    },
    generateBundle() {
      for (const name of ENGINE) {
        const p = path.join(libDist, name);
        if (fs.existsSync(p)) {
          this.emitFile({ type: 'asset', fileName: name, source: fs.readFileSync(p) });
        }
      }
    },
  };
}

function ensureChromeAssetsArchive(): void {
  if (!fs.existsSync(ASSET_ARCHIVE) || !fs.existsSync(ASSET_MANIFEST)) {
    console.warn('[vite] Missing public/chrome-assets.tar.zst or chrome-assets.json; please ensure download-deps has run.');
  }
}

function packageGreExtra(): Plugin {
  return {
    name: 'libxul-gre-extra-package',
    buildStart: ensureChromeAssetsArchive,
    configureServer: ensureChromeAssetsArchive,
  };
}

function wispProxy(): Plugin {
  return {
    name: 'wisp-proxy',
    configureServer(server) {
      wisp.options.allow_loopback_ips = true;
      server.httpServer?.on('upgrade', (req, socket, head) => {
        if ((req.url || '').startsWith('/wisp')) {
          wisp.routeRequest(req, socket as any, head);
        }
      });
    },
    configurePreviewServer(server) {
      server.httpServer?.on('upgrade', (req, socket, head) => {
        if ((req.url || '').startsWith('/wisp')) {
          wisp.routeRequest(req, socket as any, head);
        }
      });
    },
  };
}

const coop = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

const wasmCompressed = fs.existsSync(path.join(libDist, 'gecko.wasm.zst'));
const GECKO_WASM = { url: wasmCompressed ? 'gecko.wasm.zst' : 'gecko.wasm', compressed: wasmCompressed };

export default defineConfig({
  base: './',
  plugins: [serveEngine(), packageGreExtra(), wispProxy()],
  define: { __GECKO_WASM__: JSON.stringify(GECKO_WASM) },
  optimizeDeps: { exclude: ['gecko.js'] },
  build: { target: 'esnext' },
  server: { headers: coop },
  preview: { headers: coop },
});
