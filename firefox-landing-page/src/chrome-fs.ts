import { ZSTDDecoder } from 'zstddec';
import type { FsProvider, FsStat, ProfileProvider } from 'gecko.js';

export type ChromeAssetsProgressPhase =
  | 'downloading'
  | 'decompressing'
  | 'ready';
export interface ChromeAssetsProgress {
  phase: ChromeAssetsProgressPhase;
  loaded?: number;
  total?: number;
  percent?: number;
  message: string;
}
type ProgressCallback = (progress: ChromeAssetsProgress) => void;

const ARCHIVE_URL = new URL('chrome-assets.tar.zst', location.href).href;
const MANIFEST_URL = new URL('chrome-assets.json', location.href).href;

/**
 * Creates an in-memory ProfileProvider for Firefox (/profile).
 * Using pure in-memory storage eliminates browser OPFS (FileSystemSyncAccessHandle)
 * file locking, stale handles, and InvalidStateError issues on page reloads.
 */
export function createInMemoryProfileProvider(): ProfileProvider {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>(['']);

  return {
    async stat(path: string): Promise<FsStat | null> {
      const p = path.replace(/^\/+/, '');
      if (files.has(p)) return { size: files.get(p)!.byteLength, isDir: false };
      if (dirs.has(p)) return { size: 0, isDir: true };
      return null;
    },
    async readdir(path: string): Promise<string[]> {
      const p = path.replace(/^\/+/, '');
      const results: string[] = [];
      const prefix = p ? `${p}/` : '';
      for (const d of dirs) {
        if (d && d !== p && d.startsWith(prefix)) {
          const rest = d.slice(prefix.length);
          if (!rest.includes('/')) results.push(rest);
        }
      }
      for (const f of files.keys()) {
        if (f.startsWith(prefix)) {
          const rest = f.slice(prefix.length);
          if (!rest.includes('/')) results.push(rest);
        }
      }
      return Array.from(new Set(results));
    },
    async readFile(path: string): Promise<Uint8Array> {
      const p = path.replace(/^\/+/, '');
      const file = files.get(p);
      if (!file) throw new Error(`profile: no such file ${path}`);
      return file.slice();
    },
    async writeFile(path: string, data: Uint8Array): Promise<void> {
      const p = path.replace(/^\/+/, '');
      files.set(p, data.slice());
    },
    async unlink(path: string): Promise<void> {
      const p = path.replace(/^\/+/, '');
      files.delete(p);
    },
    async mkdir(path: string): Promise<void> {
      const p = path.replace(/^\/+/, '');
      dirs.add(p);
    },
    async rename(from: string, to: string): Promise<void> {
      const f = from.replace(/^\/+/, '');
      const t = to.replace(/^\/+/, '');
      const data = files.get(f);
      if (data) {
        files.set(t, data);
        files.delete(f);
      }
    },
  };
}

const REQUIRED_FILES = [
  'fonts/LiberationSans-Regular.ttf',
  'browser/fonts/LiberationSans-Regular.ttf',
  'browser/chrome.manifest',
  'chrome/pdfjs/content/PdfjsContextMenu.sys.mjs',
];

const textDecoder = new TextDecoder();
let ready: Promise<FsProvider> | undefined;
let cachedTarIndex: TarIndex | undefined;

function report(progress: ProgressCallback | undefined, update: ChromeAssetsProgress): void {
  progress?.(update);
}

async function yieldToBrowser(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`chrome-fs: ${url} -> HTTP ${r.status}`);
  return await r.json() as T;
}

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function fetchBytes(url: string, progress?: ProgressCallback): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`chrome-fs: ${url} -> HTTP ${r.status}`);
  const totalStr = r.headers.get('Content-Length');
  const total = totalStr ? Number(totalStr) : undefined;

  if (!r.body) {
    const data = new Uint8Array(await r.arrayBuffer());
    report(progress, {
      phase: 'downloading',
      loaded: data.byteLength,
      total: data.byteLength,
      percent: 1,
      message: 'Downloaded assets',
    });
    return data;
  }

  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    report(progress, {
      phase: 'downloading',
      loaded,
      total,
      percent: total ? loaded / total : undefined,
      message: total ? `Downloading (${Math.round((loaded / total) * 100)}%)` : 'Downloading',
    });
  }
  return concatChunks(chunks, loaded);
}

function parseTarString(bytes: Uint8Array, start: number, length: number): string {
  let end = start;
  const max = start + length;
  while (end < max && bytes[end] !== 0) end++;
  return textDecoder.decode(bytes.subarray(start, end));
}

function parseTarSize(bytes: Uint8Array, start: number): number {
  const first = bytes[start];
  if (first & 0x80) {
    let size = first & 0x7f;
    for (let i = start + 1; i < start + 12; i++) size = (size * 256) + bytes[i];
    return size;
  }
  const raw = parseTarString(bytes, start, 12).trim();
  return raw ? Number.parseInt(raw, 8) : 0;
}

function parsePax(data: Uint8Array): Record<string, string> {
  const text = textDecoder.decode(data);
  const out: Record<string, string> = {};
  let i = 0;
  while (i < text.length) {
    const space = text.indexOf(' ', i);
    if (space < 0) break;
    const length = Number.parseInt(text.slice(i, space), 10);
    if (!Number.isFinite(length) || length <= 0) break;
    const record = text.slice(space + 1, i + length - 1);
    const eq = record.indexOf('=');
    if (eq >= 0) out[record.slice(0, eq)] = record.slice(eq + 1);
    i += length;
  }
  return out;
}

function tarName(bytes: Uint8Array, offset: number): string {
  const name = parseTarString(bytes, offset, 100);
  const prefix = parseTarString(bytes, offset + 345, 155);
  return prefix ? `${prefix}/${name}` : name;
}

function isEmptyBlock(bytes: Uint8Array, offset: number): boolean {
  for (let i = offset; i < offset + 512; i++) {
    if (bytes[i] !== 0) return false;
  }
  return true;
}

export interface TarIndex {
  files: Map<string, Uint8Array>;
  dirs: Map<string, Set<string>>;
}

function addToTree(dirs: Map<string, Set<string>>, parts: string[], isDir: boolean): void {
  let dir = '';
  for (let i = 0; i < parts.length; i++) {
    const isLast = i === parts.length - 1;
    let children = dirs.get(dir);
    if (!children) {
      children = new Set();
      dirs.set(dir, children);
    }
    children.add(parts[i]);
    if (isLast && !isDir) break;
    dir = dir ? `${dir}/${parts[i]}` : parts[i];
    if (isLast && !dirs.has(dir)) dirs.set(dir, new Set());
  }
}

function indexTar(bytes: Uint8Array): TarIndex {
  const files = new Map<string, Uint8Array>();
  const dirs = new Map<string, Set<string>>([['', new Set()]]);
  let offset = 0;
  let pax: Record<string, string> | undefined;
  let longName: string | undefined;

  while (offset + 512 <= bytes.length && !isEmptyBlock(bytes, offset)) {
    const type = String.fromCharCode(bytes[offset + 156] || 0);
    const size = parseTarSize(bytes, offset + 124);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > bytes.length) throw new Error('chrome-fs: truncated tar archive');

    const data = bytes.subarray(dataStart, dataEnd);
    const name = (pax?.path ?? longName ?? tarName(bytes, offset)).replace(/^\.\//, '');
    pax = undefined;
    longName = undefined;

    const parts = name.split('/').filter(Boolean);
    if (name.startsWith('/') || parts.includes('..')) {
      throw new Error(`chrome-fs: unsafe tar path ${name}`);
    }

    if (type === 'x') {
      pax = parsePax(data);
    } else if (type === 'L') {
      longName = parseTarString(data, 0, data.length);
    } else if (parts.length && (type === '0' || type === '\0' || type === '')) {
      files.set(parts.join('/'), data);
      addToTree(dirs, parts, false);
    } else if (parts.length && type === '5') {
      addToTree(dirs, parts, true);
    }

    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return { files, dirs };
}

const normalizePath = (p: string) => p.split('/').filter(Boolean).join('/');

function makeProvider(index: TarIndex): FsProvider {
  return {
    async stat(path: string): Promise<FsStat | null> {
      const p = normalizePath(path);
      const file = index.files.get(p);
      if (file) return { size: file.byteLength, isDir: false };
      if (index.dirs.has(p)) return { size: 0, isDir: true };
      return null;
    },
    async readdir(path: string): Promise<string[]> {
      const children = index.dirs.get(normalizePath(path));
      if (!children) throw new Error(`chrome-fs: no such directory ${path}`);
      return [...children];
    },
    async readFile(path: string): Promise<Uint8Array> {
      const file = index.files.get(normalizePath(path));
      if (!file) throw new Error(`chrome-fs: no such file ${path}`);
      // Return a slice copy so Emscripten buffer transfers don't neuter shared ArrayBuffer instances
      return file.slice();
    },
  };
}

/**
 * Load optional fonts on demand if requested by user
 */
export async function loadOptionalFonts(loadEmoji: boolean, loadCjk: boolean, progress?: ProgressCallback): Promise<void> {
  if (!cachedTarIndex) return;

  if (loadEmoji && !cachedTarIndex.files.has('fonts/TwemojiMozilla.ttf')) {
    try {
      console.log('[chrome-fs] User enabled Emoji font: fetching TwemojiMozilla.ttf...');
      const emojiUrl = new URL('fonts/TwemojiMozilla.ttf', location.href).href;
      const emojiBytes = await fetchBytes(emojiUrl, progress);
      cachedTarIndex.files.set('fonts/TwemojiMozilla.ttf', emojiBytes);
      cachedTarIndex.files.set('browser/fonts/TwemojiMozilla.ttf', emojiBytes.slice());
      addToTree(cachedTarIndex.dirs, ['fonts', 'TwemojiMozilla.ttf'], false);
      addToTree(cachedTarIndex.dirs, ['browser', 'fonts', 'TwemojiMozilla.ttf'], false);
      console.log(`[chrome-fs] Loaded TwemojiMozilla.ttf (${Math.round(emojiBytes.byteLength / 1024)} KB)`);
    } catch (e) {
      console.warn('[chrome-fs] Could not load TwemojiMozilla.ttf:', e);
    }
  }

  if (loadCjk && !cachedTarIndex.files.has('fonts/NotoSansSC.ttf')) {
    try {
      console.log('[chrome-fs] User enabled CJK font: fetching NotoSansSC.ttf...');
      const notoUrl = new URL('fonts/NotoSansSC.ttf', location.href).href;
      const notoBytes = await fetchBytes(notoUrl, progress);
      cachedTarIndex.files.set('fonts/NotoSansSC.ttf', notoBytes);
      cachedTarIndex.files.set('browser/fonts/NotoSansSC.ttf', notoBytes.slice());
      addToTree(cachedTarIndex.dirs, ['fonts', 'NotoSansSC.ttf'], false);
      addToTree(cachedTarIndex.dirs, ['browser', 'fonts', 'NotoSansSC.ttf'], false);
      console.log(`[chrome-fs] Loaded NotoSansSC.ttf (${Math.round(notoBytes.byteLength / 1024)} KB)`);
    } catch (e) {
      console.warn('[chrome-fs] Could not load NotoSansSC.ttf:', e);
    }
  }
}

async function installAssets(progress?: ProgressCallback): Promise<FsProvider> {
  const decoder = new ZSTDDecoder();
  await decoder.init();
  const manifest = await fetchJson<{ uncompressedSize: number }>(MANIFEST_URL);
  const archive = await fetchBytes(ARCHIVE_URL, progress);
  report(progress, { phase: 'decompressing', percent: 1, message: 'Decompressing chrome assets' });
  await yieldToBrowser();
  const tar = decoder.decode(archive, manifest.uncompressedSize);
  cachedTarIndex = indexTar(tar);

  for (const path of REQUIRED_FILES) {
    if (!cachedTarIndex.files.has(path)) {
      throw new Error(`chrome-fs: chrome assets are missing required file ${path}`);
    }
  }
  report(progress, { phase: 'ready', percent: 1, message: 'Starting Gecko' });
  return makeProvider(cachedTarIndex);
}

export async function prepareChromeFs(progress?: ProgressCallback): Promise<FsProvider> {
  ready ??= installAssets(progress);
  return ready;
}
