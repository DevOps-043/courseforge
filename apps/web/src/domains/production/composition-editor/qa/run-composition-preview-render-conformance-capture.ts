import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { compositionConformanceContractSchema } from "../composition-preview-render-conformance";
import { COMPOSITION_PREVIEW_PROTOCOL_VERSION } from "../composition-preview-protocol";
import {
  captureCompositionQaScreenshot,
  compositionQaDelay,
  launchCompositionQaBrowser,
  type CompositionQaCdpClient,
} from "./composition-qa-browser";
import {
  compareCompositionConformanceDirectories,
  compositionConformanceCaptureMetadataSchema,
  type CompositionConformanceCaptureMetadata,
} from "./composition-conformance-files";
import { COMPOSITION_MEDIA_REPLACEMENT_CONFORMANCE_FIXTURE as replacementFixture } from "./composition-media-replacement-conformance.fixture";

const conformanceDirectory = resolve(process.cwd(), ".tmp/composition-conformance");
const contractPath = resolve(conformanceDirectory, "conformance-contract.json");
const previewDocumentPath = resolve(conformanceDirectory, "preview/index.html");
const renderDocumentPath = resolve(conformanceDirectory, "render/index.html");
const previewFramesDirectory = resolve(conformanceDirectory, "captures/preview");
const renderFramesDirectory = resolve(conformanceDirectory, "captures/render");
const previewMetadataPath = resolve(conformanceDirectory, "captures/preview-metadata.json");
const renderMetadataPath = resolve(conformanceDirectory, "captures/render-metadata.json");
const reportPath = resolve(conformanceDirectory, "conformance-report.json");
const READINESS_TIMEOUT_MS = 20_000;

async function main() {
  await Promise.all([
    access(previewDocumentPath),
    access(renderDocumentPath),
    mkdir(previewFramesDirectory, { recursive: true }),
    mkdir(renderFramesDirectory, { recursive: true }),
  ]);
  const contract = compositionConformanceContractSchema.parse(
    JSON.parse(await readFile(contractPath, "utf8")) as unknown,
  );
  const browser = await launchCompositionQaBrowser({
    profilePrefix: "courseforge-conformance-",
  });
  try {
    await browser.client.send("Emulation.setDeviceMetricsOverride", {
      deviceScaleFactor: 1,
      height: contract.canvas.height,
      mobile: false,
      screenHeight: contract.canvas.height,
      screenWidth: contract.canvas.width,
      width: contract.canvas.width,
    });
    const previewMetadata = await captureTarget({
      client: browser.client,
      documentHash: contract.documentHash,
      documentPath: previewDocumentPath,
      framesDirectory: previewFramesDirectory,
      checkpoints: contract.checkpoints,
      target: "preview",
    });
    const renderMetadata = await captureTarget({
      client: browser.client,
      documentHash: contract.documentHash,
      documentPath: renderDocumentPath,
      framesDirectory: renderFramesDirectory,
      checkpoints: contract.checkpoints,
      target: "render",
    });
    await Promise.all([
      writeMetadata(previewMetadataPath, previewMetadata),
      writeMetadata(renderMetadataPath, renderMetadata),
    ]);
    const report = await compareCompositionConformanceDirectories({
      contractPath,
      previewDirectory: previewFramesDirectory,
      previewMetadataPath,
      renderDirectory: renderFramesDirectory,
      renderMetadataPath,
    });
    for (const targetDirectory of [previewFramesDirectory, renderFramesDirectory]) {
      const visible = await assertReplacementVisible(targetDirectory);
      if (!visible) {
        report.failures.push({
          frameIndex: replacementFixture.insideFrameIndex,
          message: "El medio reemplazado no produjo un cambio visible dentro del clip.",
          metric: "replacement_visibility",
        });
        report.status = "FAIL";
      }
    }
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify({
      browserPath: browser.browserPath,
      checkedCheckpointCount: report.checkedCheckpointCount,
      failureCount: report.failures.length,
      reportPath,
      requiredCheckpointCount: report.requiredCheckpointCount,
      replacementVisibility: report.failures.some((failure) => failure.metric === "replacement_visibility") ? "FAIL" : "PASS",
      status: report.status,
    }, null, 2)}\n`);
    if (report.status !== "PASS") process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

async function assertReplacementVisible(framesDirectory: string) {
  const beforePath = resolve(framesDirectory, `frame-${replacementFixture.beforeFrameIndex}.png`);
  const insidePath = resolve(framesDirectory, `frame-${replacementFixture.insideFrameIndex}.png`);
  const [before, inside] = await Promise.all([readSampleRgb(beforePath), readSampleRgb(insidePath)]);
  const difference = before.reduce((sum, channel, index) => sum + Math.abs(channel - inside[index]!), 0);
  return difference >= replacementFixture.minimumRgbDifference;
}

async function readSampleRgb(framePath: string): Promise<[number, number, number]> {
  const { data, info } = await sharp(framePath)
    .extract({ left: replacementFixture.sampleX, top: replacementFixture.sampleY, width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) throw new Error(`El frame ${framePath} no contiene una muestra RGB válida.`);
  return [data[0]!, data[1]!, data[2]!];
}

async function captureTarget(params: {
  checkpoints: Array<{ frameIndex: number; timeSeconds: number }>;
  client: CompositionQaCdpClient;
  documentHash: string;
  documentPath: string;
  framesDirectory: string;
  target: "preview" | "render";
}): Promise<CompositionConformanceCaptureMetadata> {
  await params.client.send("Page.navigate", { url: pathToFileURL(params.documentPath).href });
  await waitForTargetReadiness(params.client, params.target, params.documentPath);
  const frames: CompositionConformanceCaptureMetadata["frames"] = [];
  for (const checkpoint of params.checkpoints) {
    const actualTimeSeconds = params.target === "preview"
      ? await seekPreview(params.client, checkpoint.timeSeconds)
      : await seekRender(params.client, checkpoint.timeSeconds);
    await settleCompositor(params.client);
    const screenshot = await captureCompositionQaScreenshot(params.client);
    await writeFile(resolve(params.framesDirectory, `frame-${checkpoint.frameIndex}.png`), screenshot);
    frames.push({ frameIndex: checkpoint.frameIndex, timeSeconds: actualTimeSeconds });
  }
  return compositionConformanceCaptureMetadataSchema.parse({
    documentHash: params.documentHash,
    frames,
  });
}

async function waitForTargetReadiness(
  client: CompositionQaCdpClient,
  target: "preview" | "render",
  documentPath: string,
) {
  const readinessExpression = target === "preview"
    ? `document.getElementById("composition-root")?.dataset.previewReady === "true"`
    : `window.__playerReady === true && typeof window.__player?.renderSeek === "function"`;
  const deadline = Date.now() + READINESS_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const state = await evaluateValue<boolean>(client, readinessExpression);
    if (state) return;
    await compositionQaDelay(100);
  }
  throw new Error(`El target ${target} no quedó listo para captura: ${documentPath}`);
}

async function seekPreview(client: CompositionQaCdpClient, timeSeconds: number) {
  return evaluateValue<number>(client, `new Promise((resolve, reject) => {
    const targetSeconds = ${JSON.stringify(timeSeconds)};
    const timeout = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("preview_seek_timeout:" + targetSeconds));
    }, 5000);
    const onMessage = (event) => {
      if (event.source !== window || event.data?.type !== "courseforge-composition-time") return;
      if (Math.abs(Number(event.data.seconds) - targetSeconds) > 0.01) return;
      clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(Number(event.data.seconds))));
    };
    window.addEventListener("message", onMessage);
    window.postMessage({
      protocolVersion: ${COMPOSITION_PREVIEW_PROTOCOL_VERSION},
      seconds: targetSeconds,
      type: "courseforge-composition-seek"
    }, "*");
  })`, true);
}

async function seekRender(client: CompositionQaCdpClient, timeSeconds: number) {
  return evaluateValue<number>(client, `(async () => {
    window.__player.renderSeek(${JSON.stringify(timeSeconds)});
    if (typeof window.__hfWaitForSeekCompletion === "function") {
      await window.__hfWaitForSeekCompletion();
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return Number(window.__player.getTime());
  })()`, true);
}

async function settleCompositor(client: CompositionQaCdpClient) {
  await evaluateValue<number>(client, `new Promise((resolve) => {
    // Page.captureScreenshot can observe the previous GPU surface directly
    // after an exact clip boundary even when layout is already current.
    // A bounded macrotask plus RAF forces that surface to be committed.
    setTimeout(() => requestAnimationFrame(() => {
      document.documentElement.getBoundingClientRect();
      requestAnimationFrame(() => resolve(document.body.offsetHeight));
    }), 50);
  })`, true);
}

async function evaluateValue<T>(
  client: CompositionQaCdpClient,
  expression: string,
  awaitPromise = false,
): Promise<T> {
  const evaluation = await client.send("Runtime.evaluate", {
    awaitPromise,
    expression,
    returnByValue: true,
  });
  const exceptionDetails = evaluation.exceptionDetails as {
    exception?: { description?: string };
    text?: string;
  } | undefined;
  if (exceptionDetails) {
    throw new Error(exceptionDetails.exception?.description || exceptionDetails.text || "Error al evaluar el target QA.");
  }
  const remoteResult = evaluation.result as { description?: string; value?: T } | undefined;
  if (!remoteResult || !("value" in remoteResult)) {
    throw new Error(remoteResult?.description || "Chromium no devolvió el valor esperado para QA.");
  }
  return remoteResult.value as T;
}

async function writeMetadata(path: string, metadata: CompositionConformanceCaptureMetadata) {
  await writeFile(path, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
