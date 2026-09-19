import { execFile, spawn, type ChildProcess } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const smokeFixtures = [
  {
    marker: 'data-runtime-patch-smoke="passed"',
    path: ".tmp/composition-preview-qa-interactive/index.html",
    result: "runtimePatchSmoke",
  },
  {
    marker: 'data-transition-runtime-smoke="passed"',
    path: ".tmp/composition-transition-qa-interactive/index.html",
    result: "transitionRuntimeSmoke",
  },
] as const;
const CDP_COMMAND_TIMEOUT_MS = 20_000;

async function main() {
  const browserPath = await resolveChromePath();
  const gpuEnabled = process.argv.includes("--gpu");
  const results: Record<string, boolean | number | string> = { browserPath, gpuEnabled };
  for (const fixture of smokeFixtures) {
    const fixturePath = resolve(process.cwd(), fixture.path);
    await access(fixturePath);
    const metrics = await runSmokeFixture({ browserPath, fixturePath, gpuEnabled, marker: fixture.marker });
    results[fixture.result] = "passed";
    if (metrics.colorPatchDurationMs !== null) {
      results.colorPatchDispatchMs1080p = metrics.colorPatchDurationMs;
    }
    if (metrics.colorRuntimeState) results.colorRuntimeState = metrics.colorRuntimeState;
  }
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

async function runSmokeFixture(params: {
  browserPath: string;
  fixturePath: string;
  gpuEnabled: boolean;
  marker: string;
}) {
  const profilePath = await mkdtemp(join(tmpdir(), "courseforge-preview-smoke-"));
  let browserProcess: ChildProcess | null = null;
  let client: CdpClient | null = null;
  try {
    browserProcess = spawn(params.browserPath, [
      "--headless=new",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-extensions",
      // The default integration smoke owns the deterministic fail-open
      // contract. --gpu opts into the 1080p active-shader dispatch probe.
      ...(params.gpuEnabled
        ? ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"]
        : ["--disable-gpu", "--disable-software-rasterizer"]),
      "--disable-sync",
      "--no-first-run",
      "--no-default-browser-check",
      "--allow-file-access-from-files",
      "--remote-debugging-port=0",
      `--user-data-dir=${profilePath}`,
    ], {
      stdio: "ignore",
      windowsHide: true,
    });
    const port = await readDevToolsPort(profilePath);
    const websocketUrl = await resolvePageWebsocketUrl(port);
    client = await openCdpClient(websocketUrl);
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Page.navigate", { url: pathToFileURL(params.fixturePath).href });
    return await waitForMarker(client, params.marker, params.fixturePath);
  } finally {
    if (client) {
      await client.send("Browser.close").catch(() => undefined);
      client.close();
    }
    if (browserProcess) await terminateBrowserProcess(browserProcess);
    await rm(profilePath, {
      force: true,
      maxRetries: process.platform === "win32" ? 10 : 0,
      recursive: true,
      retryDelay: 200,
    });
  }
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

type CdpClient = {
  close: () => void;
  send: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

async function readDevToolsPort(profilePath: string): Promise<number> {
  const activePortPath = join(profilePath, "DevToolsActivePort");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const [portText] = (await readFile(activePortPath, "utf8")).trim().split(/\r?\n/);
      const port = Number(portText);
      if (Number.isInteger(port) && port > 0) return port;
    } catch {
      // Chromium creates DevToolsActivePort asynchronously after startup.
    }
    await delay(100);
  }
  throw new Error("Chromium no expuso DevToolsActivePort dentro del tiempo esperado.");
}

async function resolvePageWebsocketUrl(port: number): Promise<string> {
  const endpoint = `http://127.0.0.1:${port}`;
  const listResponse = await fetch(`${endpoint}/json/list`, { signal: AbortSignal.timeout(5_000) });
  const targets = await listResponse.json() as Array<{ type?: string; webSocketDebuggerUrl?: string }>;
  const existingPage = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
  if (existingPage?.webSocketDebuggerUrl) return existingPage.webSocketDebuggerUrl;

  const createResponse = await fetch(`${endpoint}/json/new?about:blank`, {
    method: "PUT",
    signal: AbortSignal.timeout(5_000),
  });
  const createdPage = await createResponse.json() as { webSocketDebuggerUrl?: string };
  if (!createdPage.webSocketDebuggerUrl) {
    throw new Error("Chromium no expuso un target de página para el smoke test.");
  }
  return createdPage.webSocketDebuggerUrl;
}

async function openCdpClient(websocketUrl: string): Promise<CdpClient> {
  const socket = new WebSocket(websocketUrl);
  const pending = new Map<number, {
    reject: (error: Error) => void;
    resolve: (value: Record<string, unknown>) => void;
  }>();
  let sequence = 0;

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
    const message = JSON.parse(String(event.data)) as {
      error?: { message?: string };
      id?: number;
      result?: Record<string, unknown>;
    };
    if (message.id === undefined) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message ?? "Error desconocido de Chromium DevTools."));
    else request.resolve(message.result ?? {});
  });

  return {
    close: () => socket.close(),
    send: (method, params = {}) => new Promise((resolveRequest, rejectRequest) => {
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
      socket.send(JSON.stringify({ id: requestId, method, params }));
    }),
  };
}

async function waitForMarker(
  client: CdpClient,
  marker: string,
  fixturePath: string,
): Promise<{ colorPatchDurationMs: number | null; colorRuntimeState: string | null }> {
  const match = /^(data-[\w-]+)="([^"]+)"$/.exec(marker);
  if (!match) throw new Error(`Marcador QA inválido: ${marker}`);
  const [, attribute, expected] = match;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const evaluation = await client.send("Runtime.evaluate", {
      expression: `({ value: document.documentElement?.getAttribute(${JSON.stringify(attribute)}), error: document.documentElement?.getAttribute(${JSON.stringify(`${attribute.replace(/-smoke$/, "")}-error`)}), colorPatchDurationMs: document.documentElement?.dataset?.colorPatchDurationMs || null, colorRuntimeState: document.documentElement?.dataset?.colorRuntimeState || null })`,
      returnByValue: true,
    });
    const runtimeResult = evaluation.result as {
      value?: {
        colorPatchDurationMs?: string | null;
        colorRuntimeState?: string | null;
        error?: string | null;
        value?: string | null;
      };
    } | undefined;
    const state = runtimeResult?.value;
    if (state?.value === expected) {
      const duration = Number(state.colorPatchDurationMs);
      return {
        colorPatchDurationMs: Number.isFinite(duration) ? duration : null,
        colorRuntimeState: state.colorRuntimeState ?? null,
      };
    }
    if (state?.value === "failed") {
      throw new Error(`El fixture ${fixturePath} falló: ${state.error ?? "sin detalle"}`);
    }
    await delay(100);
  }
  throw new Error(`El fixture ${fixturePath} no alcanzó ${marker} dentro del tiempo esperado.`);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function resolveChromePath() {
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
  throw new Error("No se encontró Chrome/Chromium. Define CHROME_PATH para ejecutar el smoke test del preview.");
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
