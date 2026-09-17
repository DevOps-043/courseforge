import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);
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

async function main() {
  const browserPath = await resolveChromePath();
  const results: Record<string, string> = { browserPath };
  for (const fixture of smokeFixtures) {
    const fixturePath = resolve(process.cwd(), fixture.path);
    await access(fixturePath);
    await runSmokeFixture({ browserPath, fixturePath, marker: fixture.marker });
    results[fixture.result] = "passed";
  }
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

async function runSmokeFixture(params: {
  browserPath: string;
  fixturePath: string;
  marker: string;
}) {
  const profilePath = await mkdtemp(join(tmpdir(), "courseforge-preview-smoke-"));
  try {
    const { stdout } = await execFileAsync(params.browserPath, [
      "--headless=new",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-sync",
      "--no-first-run",
      "--no-default-browser-check",
      "--allow-file-access-from-files",
      "--virtual-time-budget=5000",
      `--user-data-dir=${profilePath}`,
      "--dump-dom",
      pathToFileURL(params.fixturePath).href,
    ], {
      maxBuffer: 24 * 1024 * 1024,
      timeout: 20_000,
      windowsHide: true,
    });
    if (!stdout.includes(params.marker)) {
      throw new Error(`El fixture ${params.fixturePath} no alcanzó el marcador QA esperado.`);
    }
  } finally {
    await rm(profilePath, { force: true, recursive: true });
  }
}

async function resolveChromePath() {
  const configuredPath = process.env.CHROME_PATH?.trim();
  const candidates = [
    configuredPath,
    ...(process.platform === "win32" ? [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
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
