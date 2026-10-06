import { execFile, spawn, type ChildProcess } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readBrowserExecutableIdentity, assertBrowserExecutableUnchanged, type BrowserExecutableIdentity } from "./composition-browser-executable-identity";
import {assertConformanceJobActive} from "./composition-conformance-job-lease";

const CDP_COMMAND_TIMEOUT_MS = 20_000;
const DEVTOOLS_STARTUP_TIMEOUT_MS = 15_000;
const MAX_BROWSER_DIAGNOSTIC_CHARACTERS = 8_000;

export type CompositionQaCdpClient = {
  onEvent?: (method: string, handler: (params: Record<string, unknown>) => void) => () => void;
  close: () => void;
  send: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

export type CompositionQaBrowser = {
  browserPath: string;
  client: CompositionQaCdpClient;
  executableIdentity?: BrowserExecutableIdentity;
  verifyExecutableIdentity?: () => Promise<void>;
  close: () => Promise<void>;
};

export async function launchCompositionQaBrowser(params: {
  isolatedCapture?: boolean;
  gpuEnabled?: boolean;
  profilePrefix: string;
  signal?: AbortSignal;
}): Promise<CompositionQaBrowser> {
  assertConformanceJobActive(params.signal);
  if (params.isolatedCapture && process.platform === "linux" && typeof process.getuid === "function" && process.getuid() === 0) {
    throw new Error("CONFORMANCE_CAPTURE_BROWSER_SANDBOX_REQUIRED");
  }
  const browserPath = await resolveCompositionQaChromePath();
  const executableIdentity = params.isolatedCapture ? await readBrowserExecutableIdentity(browserPath) : undefined;
  assertConformanceJobActive(params.signal);
  const profilePath = await mkdtemp(join(tmpdir(), params.profilePrefix));
  if (params.signal?.aborted) {
    await rm(profilePath, {force: true, recursive: true});
    assertConformanceJobActive(params.signal);
  }
  let diagnostics = "";
  const browserProcess = spawn(browserPath, [
    "--headless=new",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    ...(params.isolatedCapture ? ["--proxy-server=http://127.0.0.1:9", "--proxy-bypass-list=127.0.0.1", "--disable-quic"] : []),
    ...(params.gpuEnabled
      ? ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"]
      : ["--disable-gpu"]),
    ...(process.platform === "linux" && typeof process.getuid === "function" && process.getuid() === 0
      ? ["--no-sandbox"]
      : []),
    "--disable-sync",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    ...(params.isolatedCapture ? [] : ["--allow-file-access-from-files"]),
    "--remote-debugging-port=0",
    `--user-data-dir=${profilePath}`,
  ], {
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
    ...(params.isolatedCapture ? { env: { NODE_ENV: process.env.NODE_ENV ?? "production", ...Object.fromEntries(
      ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "HOME", "DISPLAY", "XDG_RUNTIME_DIR", "LANG"]
        .flatMap((name) => process.env[name] ? [[name, process.env[name]!] as const] : []),
    ) } } : {}),
  });
  browserProcess.stderr?.setEncoding("utf8");
  browserProcess.stderr?.on("data", (chunk: string) => {
    diagnostics = `${diagnostics}${chunk}`.slice(-MAX_BROWSER_DIAGNOSTIC_CHARACTERS);
  });

  let client: CompositionQaCdpClient | null = null;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    if (client) {
      await client.send("Browser.close").catch(() => undefined);
      client.close();
    }
    await terminateBrowserProcess(browserProcess);
    await rm(profilePath, {
      force: true,
      maxRetries: process.platform === "win32" ? 10 : 0,
      recursive: true,
      retryDelay: 200,
    });
  };

  try {
    const port = await readDevToolsPort(profilePath, browserProcess, () => diagnostics, params.signal);
    assertConformanceJobActive(params.signal);
    const websocketUrl = await resolvePageWebsocketUrl(port, params.signal);
    assertConformanceJobActive(params.signal);
    client = await openCdpClient(websocketUrl);
    assertConformanceJobActive(params.signal);
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    assertConformanceJobActive(params.signal);
    return { browserPath, client, close, ...(executableIdentity ? {executableIdentity,
      verifyExecutableIdentity: () => assertBrowserExecutableUnchanged(browserPath, executableIdentity)} : {}) };
  } catch (error) {
    await close();
    assertConformanceJobActive(params.signal);
    throw error;
  }
}

export async function captureCompositionQaScreenshot(client: CompositionQaCdpClient) {
  const result = await client.send("Page.captureScreenshot", {
    captureBeyondViewport: false,
    fromSurface: true,
    format: "png",
  });
  const data = result.data;
  if (typeof data !== "string" || data.length === 0) {
    throw new Error("Chromium no devolvió un snapshot PNG.");
  }
  return Buffer.from(data, "base64");
}

export function compositionQaDelay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function readDevToolsPort(
  profilePath: string,
  browserProcess: ChildProcess,
  getDiagnostics: () => string,
  signal?: AbortSignal,
): Promise<number> {
  const activePortPath = join(profilePath, "DevToolsActivePort");
  const deadline = Date.now() + DEVTOOLS_STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    assertConformanceJobActive(signal);
    if (browserProcess.exitCode !== null || browserProcess.signalCode !== null) {
      throw new Error(formatBrowserStartupError(browserProcess, getDiagnostics()));
    }
    try {
      const [portText] = (await readFile(activePortPath, "utf8")).trim().split(/\r?\n/);
      const port = Number(portText);
      if (Number.isInteger(port) && port > 0) return port;
    } catch {
      // Chromium creates DevToolsActivePort asynchronously after startup.
    }
    await compositionQaDelay(100);
  }
  throw new Error(`Chromium no expuso DevToolsActivePort dentro del tiempo esperado.${diagnosticSuffix(getDiagnostics())}`);
}

async function resolvePageWebsocketUrl(port: number, signal?: AbortSignal): Promise<string> {
  assertConformanceJobActive(signal);
  const endpoint = `http://127.0.0.1:${port}`;
  const requestSignal = () => signal ? AbortSignal.any([signal, AbortSignal.timeout(5_000)]) : AbortSignal.timeout(5_000);
  const listResponse = await fetch(`${endpoint}/json/list`, { signal: requestSignal() });
  const targets = await listResponse.json() as Array<{ type?: string; webSocketDebuggerUrl?: string }>;
  assertConformanceJobActive(signal);
  const existingPage = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
  if (existingPage?.webSocketDebuggerUrl) return existingPage.webSocketDebuggerUrl;

  const createResponse = await fetch(`${endpoint}/json/new?about:blank`, {
    method: "PUT",
    signal: requestSignal(),
  });
  const createdPage = await createResponse.json() as { webSocketDebuggerUrl?: string };
  assertConformanceJobActive(signal);
  if (!createdPage.webSocketDebuggerUrl) {
    throw new Error("Chromium no expuso un target de página para QA.");
  }
  return createdPage.webSocketDebuggerUrl;
}

async function openCdpClient(websocketUrl: string): Promise<CompositionQaCdpClient> {
  const socket = new WebSocket(websocketUrl);
  const pending = new Map<number, {
    reject: (error: Error) => void;
    resolve: (value: Record<string, unknown>) => void;
  }>();
  let sequence = 0;
  let closed = false;
  const eventHandlers = new Map<string, Set<(params: Record<string, unknown>) => void>>();
  const rejectPending = () => {
    closed = true;
    for (const request of pending.values()) request.reject(new Error("CONFORMANCE_CAPTURE_CDP_CLOSED"));
    pending.clear(); eventHandlers.clear();
  };

  await new Promise<void>((resolveConnection, rejectConnection) => {
    const timeout = setTimeout(
      () => rejectConnection(new Error("Chromium DevTools no abrió el WebSocket dentro del tiempo esperado.")),
      5_000,
    );
    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      resolveConnection();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      rejectConnection(new Error("No se pudo conectar a Chromium DevTools."));
    }, { once: true });
  });
  socket.addEventListener("message", (event) => {
    if (closed) return;
    const message = JSON.parse(String(event.data)) as {
      error?: { message?: string };
      id?: number;
      result?: Record<string, unknown>;
      method?: string;
      params?: Record<string, unknown>;
    };
    if (message.id === undefined) {
      if (message.method) for (const handler of eventHandlers.get(message.method) ?? []) handler(message.params ?? {});
      return;
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message ?? "Error desconocido de Chromium DevTools."));
    else request.resolve(message.result ?? {});
  });
  socket.addEventListener("close", rejectPending);
  socket.addEventListener("error", rejectPending);

  return {
    onEvent: (method, handler) => {
      const handlers = eventHandlers.get(method) ?? new Set();
      handlers.add(handler); eventHandlers.set(method, handlers);
      return () => { handlers.delete(handler); if (!handlers.size) eventHandlers.delete(method); };
    },
    close: () => {rejectPending(); socket.close();},
    send: (method, params = {}) => new Promise((resolveRequest, rejectRequest) => {
      if (closed) {rejectRequest(new Error("CONFORMANCE_CAPTURE_CDP_CLOSED")); return;}
      sequence += 1;
      const requestId = sequence;
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        rejectRequest(new Error(`Chromium DevTools no respondió a ${method} dentro del tiempo esperado.`));
      }, CDP_COMMAND_TIMEOUT_MS);
      pending.set(requestId, {
        reject: (error) => {
          clearTimeout(timeout);
          rejectRequest(error);
        },
        resolve: (value) => {
          clearTimeout(timeout);
          resolveRequest(value);
        },
      });
      try {socket.send(JSON.stringify({ id: requestId, method, params }));}
      catch {pending.get(requestId)?.reject(new Error("CONFORMANCE_CAPTURE_CDP_SEND_FAILED")); pending.delete(requestId);}
    }),
  };
}

async function resolveCompositionQaChromePath() {
  const configuredPath = process.env.CHROME_PATH?.trim();
  const candidates = [
    configuredPath,
    ...(process.platform === "win32" ? [
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    ] : process.platform === "darwin" ? [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ] : [
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
    ]),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue through the bounded platform-specific candidate list.
    }
  }
  throw new Error("No se encontró Chrome/Chromium. Define CHROME_PATH para ejecutar la QA visual.");
}

async function terminateBrowserProcess(browserProcess: ChildProcess): Promise<void> {
  if (browserProcess.exitCode !== null || browserProcess.signalCode !== null) return;
  if (process.platform !== "win32" || !browserProcess.pid) {
    browserProcess.kill("SIGKILL");
    return;
  }
  await new Promise<void>((resolveTermination) => {
    execFile(
      "taskkill",
      ["/PID", String(browserProcess.pid), "/T", "/F"],
      { windowsHide: true },
      () => resolveTermination(),
    );
  });
}

function formatBrowserStartupError(browserProcess: ChildProcess, diagnostics: string) {
  return `Chromium terminó antes de exponer DevTools (exit=${browserProcess.exitCode ?? "null"}, signal=${browserProcess.signalCode ?? "null"}).${diagnosticSuffix(diagnostics)}`;
}

function diagnosticSuffix(diagnostics: string) {
  const normalized = diagnostics.trim();
  return normalized ? ` Diagnóstico: ${normalized}` : "";
}
