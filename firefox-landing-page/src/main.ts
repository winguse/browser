import { Gecko, FsProvider } from "gecko.js";
import {
  prepareChromeFs,
  createInMemoryProfileProvider,
  loadOptionalFonts,
  ChromeAssetsProgress,
} from "./chrome-fs";
import "./styles.css";

const canvas = document.getElementById("screen") as HTMLCanvasElement;
const splashShell = document.getElementById("splash-shell") as HTMLElement;
const splashCard = document.getElementById("stage-card") as HTMLElement;
const progressFill = document.getElementById("progress-fill") as HTMLElement;
const progressPhase = document.getElementById("progress-phase") as HTMLElement;
const progressPercent = document.getElementById("progress-percent") as HTMLElement;
const splashStatus = document.getElementById("splash-status") as HTMLElement;
const consoleOutput = document.getElementById("console-output") as HTMLElement;

type UiPhase = "loading" | "ready" | "console";

function setUiPhase(phase: UiPhase): void {
  splashShell.setAttribute("data-phase", phase);
  splashCard.setAttribute("data-phase", phase);
}

function appendConsoleLine(message: string, level: "log" | "warn" | "error" = "log"): void {
  const line = document.createElement("div");
  line.className = `console-line ${level}`;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  consoleOutput.appendChild(line);
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

let lastLogTime = 0;
let lastLogPhase = "";

function setProgress(progress: ChromeAssetsProgress, forceLog = false): void {
  const pct = Math.min(100, Math.max(0, Math.round((progress.percent ?? 0) * 100)));
  progressFill.style.width = `${pct}%`;
  progressPercent.textContent = `${pct}%`;

  const phaseLabels: Record<string, string> = {
    downloading: "Downloading assets",
    decompressing: "Unpacking Gecko environment",
    ready: "Initializing Gecko runtime",
  };
  progressPhase.textContent = phaseLabels[progress.phase] ?? "Preparing";
  splashStatus.textContent = progress.message;

  const now = performance.now();
  const isPhaseChange = progress.phase !== lastLogPhase;
  const isComplete =
    progress.percent === 1 ||
    (progress.loaded !== undefined &&
      progress.total !== undefined &&
      progress.total > 0 &&
      progress.loaded >= progress.total);
  const timeSinceLastLog = now - lastLogTime;

  if (forceLog || isPhaseChange || isComplete || timeSinceLastLog >= 1000) {
    appendConsoleLine(`${progressPhase.textContent}: ${progress.message}`);
    lastLogTime = now;
    lastLogPhase = progress.phase;
  }
}

window.addEventListener("error", (ev) => {
  appendConsoleLine(`Uncaught ${ev.message}`, "error");
});

window.addEventListener("unhandledrejection", (ev) => {
  const reason = ev.reason instanceof Error ? ev.reason.message : String(ev.reason);
  appendConsoleLine(`Unhandled Rejection: ${reason}`, "error");
});

function syncCanvasSize(): void {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
syncCanvasSize();
window.addEventListener("resize", syncCanvasSize);

const BROWSER_CHROME_URL = "chrome://browser/content/browser.xhtml";

const defaultWispProtocol = location.protocol === "https:" ? "wss:" : "ws:";
const defaultWisp = `${defaultWispProtocol}//${location.host}/wisp/`;

const LS_KEY = "firefox-landing-page-opts";
interface Opts {
  gpu: boolean;
  jit: boolean;
  emoji: boolean;
  cjk: boolean;
  wisp: string;
}
const saved: Partial<Opts> = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
const opts: Opts = {
  gpu: saved.gpu ?? true,
  jit: saved.jit ?? false,
  emoji: saved.emoji ?? false,
  cjk: saved.cjk ?? false,
  wisp: saved.wisp || defaultWisp,
};

const gpuToggle = document.getElementById("opt-gpu") as HTMLInputElement;
const jitToggle = document.getElementById("opt-jit") as HTMLInputElement;
const emojiToggle = document.getElementById("opt-emoji") as HTMLInputElement;
const cjkToggle = document.getElementById("opt-cjk") as HTMLInputElement;
const wispInput = document.getElementById("opt-wisp") as HTMLInputElement;

gpuToggle.checked = opts.gpu;
jitToggle.checked = opts.jit;
emojiToggle.checked = opts.emoji;
cjkToggle.checked = opts.cjk;
wispInput.value = opts.wisp;

const chromeFsReady: Promise<FsProvider> = prepareChromeFs(assetsProgress);
const wasmBlobReady: Promise<string> = fetchWasmBlob();

// Optional Fonts downloading functionality when selected
const checkOptionalFonts = async () => {
  if (emojiToggle.checked || cjkToggle.checked) {
    startBtn.disabled = true;
    startBtn.textContent = "Downloading Fonts…";
    setUiPhase("loading");
    setProgress({
      phase: "downloading",
      loaded: 0,
      total: 0,
      message: "Downloading optional font assets",
    });
    try {
      // Must ensure FS is ready before downloading fonts to cache
      await chromeFsReady;
      await loadOptionalFonts(emojiToggle.checked, cjkToggle.checked, assetsProgress);
      startBtn.disabled = false;
      startBtn.textContent = "Start Firefox";
      setUiPhase("ready");
    } catch (e) {
      console.warn("Failed to load optional fonts:", e);
      startBtn.disabled = false;
      startBtn.textContent = "Start Firefox";
      setUiPhase("ready");
    }
  }
};

emojiToggle.addEventListener("change", checkOptionalFonts);
cjkToggle.addEventListener("change", checkOptionalFonts);

function collectOpts(): Opts {
  const next: Opts = {
    gpu: gpuToggle.checked,
    jit: jitToggle.checked,
    emoji: emojiToggle.checked,
    cjk: cjkToggle.checked,
    wisp: wispInput.value.trim() || defaultWisp,
  };
  localStorage.setItem(LS_KEY, JSON.stringify(next));
  return next;
}

function buildEnv(o: Opts): Record<string, string> {
  const optEnv: Record<string, string> = { GECKO_CHROME: "1" };
  if (o.gpu) {
    optEnv.GECKO_GPU = "1";
    optEnv.GECKO_GL_PASSTHROUGH = "1";
    optEnv.GECKO_WR_DIRECT = "1";
    optEnv.GECKO_APZ = "1";
  }
  if (!o.jit) optEnv.GECKO_NOWASMJIT = "1";

  for (const [k, v] of new URLSearchParams(location.search)) {
    if (k.startsWith("env.")) optEnv[k.slice(4)] = v;
  }
  return optEnv;
}

const startBtn = document.getElementById("start-btn") as HTMLButtonElement;

const hasJspi =
  typeof (WebAssembly as { Suspending?: unknown }).Suspending === "function" &&
  typeof (WebAssembly as { promising?: unknown }).promising === "function";

if (!hasJspi) {
  const note = document.getElementById("jspi-note") as HTMLElement;
  note.textContent =
    "This browser doesn't support WebAssembly JSPI, which Firefox WASM needs to run.";
  if (navigator.userAgent.includes("Firefox")) {
    const hint = document.createElement("span");
    hint.append(
      " To enable it in Firefox: open ",
      Object.assign(document.createElement("code"), {
        textContent: "about:config",
      }),
      ", set ",
      Object.assign(document.createElement("code"), {
        textContent: "javascript.options.wasm_js_promise_integration",
      }),
      " to ",
      Object.assign(document.createElement("code"), { textContent: "true" }),
      ", then reload this page.",
    );
    note.append(hint);
  }
  note.hidden = false;
}

function fail(e: unknown): void {
  console.error("[firefox-landing-page] startup failed", e);
  setUiPhase("console");
  startBtn.disabled = false;
  startBtn.textContent = "Retry";
  startBtn.onclick = () => location.reload();
}

startBtn.onclick = () => void start();
startBtn.disabled = true;
setUiPhase("loading");

const dl = {
  assets: { loaded: 0, total: 0 },
  wasm: { loaded: 0, total: 0, done: false },
};

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${bytes} B`;
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1024 * 1024) {
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  }
  if (bytesPerSec >= 1024) {
    return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  }
  return `${Math.round(bytesPerSec)} B/s`;
}

let lastSpeedTime = 0;
let lastLoadedBytes = 0;
let currentSpeedBps = 0;

function renderDownloads(): void {
  const loaded = dl.assets.loaded + dl.wasm.loaded;
  const total =
    dl.assets.total && dl.wasm.total
      ? dl.assets.total + dl.wasm.total
      : undefined;

  const now = performance.now();
  if (!lastSpeedTime) {
    lastSpeedTime = now;
    lastLoadedBytes = loaded;
  } else {
    const elapsedSec = (now - lastSpeedTime) / 1000;
    if (elapsedSec >= 0.5) {
      const bytesDiff = loaded - lastLoadedBytes;
      currentSpeedBps = Math.max(0, bytesDiff / elapsedSec);
      lastSpeedTime = now;
      lastLoadedBytes = loaded;
    }
  }

  let msg = "Downloading Firefox";
  const details: string[] = [];

  if (loaded > 0) {
    if (total && total > 0) {
      details.push(`${formatBytes(loaded)} / ${formatBytes(total)}`);
    } else {
      details.push(formatBytes(loaded));
    }
  }

  if (currentSpeedBps > 0) {
    details.push(formatSpeed(currentSpeedBps));
  }

  if (details.length > 0) {
    msg += ` (${details.join(", ")})`;
  }

  setProgress({
    phase: "downloading",
    loaded,
    total,
    percent: total ? loaded / total : undefined,
    message: msg,
  });
}

function assetsProgress(p: ChromeAssetsProgress): void {
  if (p.phase === "downloading") {
    dl.assets.loaded = p.loaded ?? dl.assets.loaded;
    dl.assets.total = p.total ?? dl.assets.total;
  } else {
    if (dl.assets.total) dl.assets.loaded = dl.assets.total;
    if (dl.wasm.done) {
      setProgress(p);
      return;
    }
  }
  renderDownloads();
}

async function fetchWasmBlob(): Promise<string> {
  const url = new URL(__GECKO_WASM__.url, location.href).href;
  const r = await fetch(url);
  if (!r.ok || !r.body)
    throw new Error(`engine wasm fetch failed (${r.status}) for ${url}`);
  dl.wasm.total = Number(r.headers.get("Content-Length")) || 0;
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    dl.wasm.loaded += value.byteLength;
    renderDownloads();
  }
  dl.wasm.done = true;
  if (!dl.wasm.total) dl.wasm.total = dl.wasm.loaded;
  renderDownloads();
  return URL.createObjectURL(
    new Blob(chunks as BlobPart[], { type: "application/wasm" }),
  );
}

Promise.all([chromeFsReady, wasmBlobReady])
  .then(() => {
    console.log("[firefox-landing-page] assets and engine ready");
    setUiPhase("ready");
    startBtn.disabled = !hasJspi;
  })
  .catch(fail);

async function start(): Promise<void> {
  setUiPhase("console");
  startBtn.disabled = true;
  gpuToggle.disabled = true;
  jitToggle.disabled = true;
  emojiToggle.disabled = true;
  cjkToggle.disabled = true;
  wispInput.disabled = true;
  startBtn.textContent = "Starting…";

  const chosen = collectOpts();
  const optEnv = buildEnv(chosen);

  const fsProvider = await prepareChromeFs(assetsProgress);

  const gecko = new Gecko({
    canvas,
    width: window.innerWidth,
    height: window.innerHeight,
    wasm: {
      url: await wasmBlobReady,
      compressed: __GECKO_WASM__.compressed,
    },
    env: optEnv,
    fs: fsProvider,
    profile: createInMemoryProfileProvider(),
    wispUrl: chosen.wisp.trim() || undefined,
    print: (s) => console.log("[gecko]", s),
    printErr: (s) => console.warn("[gecko]", s),
  });

  try {
    await gecko.init();
    console.log("[firefox-landing-page] gecko.init done");
    setProgress({
      phase: "ready",
      percent: 1,
      message: "Loading browser chrome",
    });
    await gecko.load(BROWSER_CHROME_URL);
    console.log("[firefox-landing-page] Firefox front-end booted");

    try {
      await gecko.evalChrome(`(() => {
        const prefs = [
          ['font.name-list.sans-serif.zh-CN', 'Noto Sans SC, PingFang SC, Microsoft YaHei, SimHei, STHeiti, Noto Sans CJK SC, Twemoji Mozilla, sans-serif'],
          ['font.name-list.sans-serif.zh-TW', 'Noto Sans SC, PingFang TC, Microsoft JhengHei, STHeiti, Twemoji Mozilla, sans-serif'],
          ['font.name-list.sans-serif.zh-HK', 'Noto Sans SC, PingFang HK, Microsoft JhengHei, Twemoji Mozilla, sans-serif'],
          ['font.name-list.sans-serif.x-unicode', 'Noto Sans SC, PingFang SC, STHeiti, Hiragino Sans GB, Microsoft YaHei, Arial Unicode MS, Twemoji Mozilla, sans-serif'],
          ['font.name-list.sans-serif.x-western', 'Liberation Sans, Twemoji Mozilla, sans-serif'],
          ['font.name-list.serif.zh-CN', 'Noto Sans SC, Songti SC, SimSun, serif'],
          ['font.name-list.emoji', 'Twemoji Mozilla, Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji'],
          ['font.name.sans-serif.zh-CN', 'Noto Sans SC'],
          ['font.name.sans-serif.x-unicode', 'Noto Sans SC'],
        ];
        for (const [k, v] of prefs) {
          try { Services.prefs.setCharPref(k, v); } catch(e) {}
        }
        return 'cjk-prefs-set';
      })()`);
    } catch(e) {}

    canvas.classList.add("ready");
    document.getElementById("splash")?.classList.add("done");
  } catch (e) {
    fail(e);
  }
}
