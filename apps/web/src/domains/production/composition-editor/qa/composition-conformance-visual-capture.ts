import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdtemp, readFile, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { verifyConformanceReferenceSource } from "../composition-conformance-reference.service";
import { COMPOSITION_PREVIEW_PROTOCOL_VERSION } from "../composition-preview-protocol";
import { compositionConformanceCaptureMetadataSchema } from "./composition-conformance-files";
import { isAllowedConformanceCaptureUrl, startConformanceCaptureServer } from "./composition-conformance-capture-server";
import { captureCompositionQaScreenshot, launchCompositionQaBrowser, type CompositionQaCdpClient } from "./composition-qa-browser";
import type { materializeConformanceReference } from "./composition-conformance-materialization";
import { captureBrowserPlaybackAudio } from "./composition-browser-playback-audio";
import { PLAYBACK_CAPTURE_POLICY } from "./composition-playback-capture-runtime";
import { buildMediaBoundaryPlan } from "./composition-playback-boundaries";
import { isDeepStrictEqual } from "node:util";
import { captureTextParityCheckpoint } from "./composition-text-checkpoint-capture";
import { captureTextPaintMasks } from "./composition-text-paint-mask-capture";
import { suppressedTextFrameName } from "./composition-text-paint-mask-derivation";
import { textCheckpointEvidenceSchema, textParityEvidenceHash, validateTextParityEvidence,
  TEXT_PARITY_REPEATABILITY, type TextParityEvidence } from "./composition-text-parity-evidence";
import { COMPOSITION_TEXT_PARITY_POLICY } from "../composition-text-parity-policy";
import { conformanceFontPath, conformanceFontManifestHash, CONFORMANCE_FONT_BINDING_LIMITS } from "../composition-conformance-font-bindings";
import { verifyConformanceFontLoading } from "./composition-font-loading-capture";
import { startConformancePlatformFontCapture } from "./composition-platform-font-capture";
import { FONT_USAGE_EVIDENCE_POLICY, fontUsageEvidenceHash, validateFontUsageEvidence } from "./composition-font-usage-evidence";
import { readCaptureBrowserIdentity, assertCaptureBrowserIdentityUnchanged, browserIdentityHash } from "./composition-browser-identity";
import { browserExecutableIdentitySchema, browserExecutableIdentityHash } from "./composition-browser-executable-identity";
import { prepareCompositionEventBatchContracts } from "../composition-conformance-event-batch-contract";
import { eventBatchCaptureLineageSchema } from "../composition-conformance-event-batch-lineage";
import { captureDeckTextCheckpoint } from "./composition-deck-text-capture";
import { deckTextCheckpointEvidenceSchema, validateDeckTextEvidence, hashDeckTextEvidence, type DeckTextEvidence } from "./composition-deck-text-evidence";
import { hashDeckTextPlan } from "../composition-deck-text-plan";
import { captureDeckTextPaintMasks } from "./composition-deck-text-paint-producer";
import { suppressedDeckTextFrameName } from "./composition-deck-text-paint-derivation";
import {assertConformanceJobActive} from "./composition-conformance-job-lease";
import {bindCaptureCdpCancellation} from "./composition-cdp-cancellation";
import {assertHtmlLayoutBeforeCapture} from "./composition-html-layout-capture";

const CAPTURE_LIMITS = { durationMilliseconds: 180_000, pngBytes: 20 * 1024 * 1024, totalPngBytes: 128 * 1024 * 1024, requests: 2_000,
  metadataBytes: 1024 * 1024 } as const;
async function evaluate<T>(client: CompositionQaCdpClient, expression: string): Promise<T> {
  const response = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  const result = response.result as { value?: T } | undefined;
  if (response.exceptionDetails || !result || !("value" in result)) throw new Error("CONFORMANCE_CAPTURE_RUNTIME_FAILED");
  return result.value as T;
}

/** Captures checkpoints only, never certifies parity or captures playback audio. */
export async function captureMaterializedConformancePreview(params: {
  materialized: Awaited<ReturnType<typeof materializeConformanceReference>>; outputParentDirectory: string;
  capturePlaybackAudio?: boolean;
  captureTextRegions?: boolean;
  captureTextPaintMasks?: boolean;
  eventBatchIndex?: number;
  signal?: AbortSignal;
}, launch: typeof launchCompositionQaBrowser = launchCompositionQaBrowser) {
  assertConformanceJobActive(params.signal);
  const root = params.materialized.directory;
  const fontManifestPath = join(root, "font-manifest.json");
  const fontManifestFile = await lstat(fontManifestPath);
  if (!fontManifestFile.isFile() || fontManifestFile.size > CAPTURE_LIMITS.metadataBytes) throw new Error("CONFORMANCE_CAPTURE_FONT_MANIFEST_LIMIT");
  const fontManifestJson = await readFile(fontManifestPath, "utf8");
  if (Buffer.byteLength(fontManifestJson) > CAPTURE_LIMITS.metadataBytes) throw new Error("CONFORMANCE_CAPTURE_FONT_MANIFEST_LIMIT");
  const source = verifyConformanceReferenceSource({
    previewHtml: await readFile(join(root, "conformance-preview.html"), "utf8"),
    documentJson: await readFile(join(root, "composition-document.json"), "utf8"),
    contractJson: await readFile(join(root, "conformance-contract.json"), "utf8"),
    metadata: JSON.parse(await readFile(join(root, "conformance-reference.json"), "utf8")),
    fontManifest: JSON.parse(fontManifestJson),
  });
  if (source.metadata.documentHash !== params.materialized.receipt.documentHash) throw new Error("CONFORMANCE_CAPTURE_REVISION_MISMATCH");
  // The source remains the authorized root. Only capture selection is derived in memory.
  const hasEventBatch = source.contract.schemaVersion === 4 && source.contract.checkpointBatch !== undefined;
  const prepared = hasEventBatch || params.eventBatchIndex !== undefined
    ? prepareCompositionEventBatchContracts({document: source.document, parentContract: source.contract}) : undefined;
  const selection = prepared?.select(params.eventBatchIndex ?? 0);
  const contract = selection?.contract ?? source.contract;
  const eventBatchLineage = prepared && selection && contract.schemaVersion === 4
    ? eventBatchCaptureLineageSchema.parse({policy: "VERIFIED_ROOT_EVENT_PARTITION_V1",
      scope: "ONE_PREVIEW_PARTITION_NOT_GLOBAL_RENDER_ATTESTATION",
      parentContractSha256: prepared.parentContractSha256, batchContractSha256: selection.batchContractSha256,
      batch: contract.checkpointBatch}) : undefined;
  const fonts = source.fontManifest;
  if (!fonts) throw new Error("CONFORMANCE_CAPTURE_FONT_BINDINGS_MISSING");
  const paintMasksRequired = params.captureTextPaintMasks === true
    || contract.schemaVersion === 4 && contract.textParity.paintMaskPolicy !== undefined;
  const captureTextRegions = params.captureTextRegions === true || paintMasksRequired || contract.schemaVersion === 4 || fonts.length > 0;
  const fontsByPath = new Map(fonts.map((font) => [conformanceFontPath(font), font]));
  const files = new Map([["conformance-preview.html", "text/html; charset=utf-8"],
    ...source.metadata.bindings.map((binding) => [binding.localPath, binding.mimeType] as [string, string])]);
  const digests = new Map<string, { checksum: string; size: number }>([
    ["font-manifest.json", {checksum: createHash("sha256").update(fontManifestJson).digest("hex"), size: Buffer.byteLength(fontManifestJson)}],
    ["conformance-preview.html", { checksum: source.metadata.previewSha256, size: Buffer.byteLength(await readFile(join(root, "conformance-preview.html"), "utf8")) }],
    ...source.metadata.bindings.map((binding) => [binding.localPath, { checksum: binding.checksum, size: binding.fileSizeBytes }] as const),
  ]);
  for (const name of await readdir(join(root, "assets/fonts"))) {
    if (!/^[a-f0-9]{64}\.(woff2?|ttf|otf)$/.test(name)) throw new Error("CONFORMANCE_CAPTURE_FONT_PATH_INVALID");
    const font = fontsByPath.get(`assets/fonts/${name}`);
    if (!font) throw new Error("CONFORMANCE_CAPTURE_FONT_BINDING_MISMATCH");
    files.set(`assets/fonts/${name}`, `font/${name.split(".").at(-1)}`);
    const size = (await lstat(join(root, "assets/fonts", name))).size;
    if (size > CONFORMANCE_FONT_BINDING_LIMITS.maximumFontBytes || size !== font.fileSizeBytes) throw new Error("CONFORMANCE_CAPTURE_FONT_SIZE_INVALID");
    digests.set(`assets/fonts/${name}`, { checksum: name.split(".")[0]!, size });
  }
  if ([...fontsByPath.keys()].some((path) => !files.has(path))) throw new Error("CONFORMANCE_CAPTURE_FONT_BINDING_MISMATCH");
  const verifyFiles = async () => {
    for (const [path, expected] of digests) {
      assertConformanceJobActive(params.signal);
      const filePath = join(root, path); const file = await lstat(filePath);
      if (!file.isFile() || file.size !== expected.size) throw new Error("CONFORMANCE_CAPTURE_SOURCE_CHANGED");
      const digest = createHash("sha256"); let bytes = 0;
      for await (const chunk of createReadStream(filePath, {signal: params.signal})) {
        assertConformanceJobActive(params.signal);
        bytes += (chunk as Buffer).length;
        if (bytes > expected.size) throw new Error("CONFORMANCE_CAPTURE_SOURCE_CHANGED");
        digest.update(chunk as Buffer);
      }
      if (bytes !== expected.size || digest.digest("hex") !== expected.checksum) throw new Error("CONFORMANCE_CAPTURE_SOURCE_CHANGED");
    }
  };
  await verifyFiles();
  assertConformanceJobActive(params.signal);
  const server = await startConformanceCaptureServer(root, files, {playbackAudio: params.capturePlaybackAudio === true});
  let browser: Awaited<ReturnType<typeof launch>> | null = null;
  let cancellation: ReturnType<typeof bindCaptureCdpCancellation> | undefined;
  let unsubscribe: (() => void) | undefined;
  let unsubscribeNetwork: (() => void) | undefined;
  let platformFonts: Awaited<ReturnType<typeof startConformancePlatformFontCapture>> | undefined;
  let directory: string | null = null; const ownedFiles: string[] = [];
  let playback: Awaited<ReturnType<typeof captureBrowserPlaybackAudio>> | null = null;
  const cleanup = async () => {
    const cleanups = await Promise.allSettled([
      Promise.resolve().then(() => playback?.cleanup()),
      Promise.resolve().then(async () => {
        for (const path of [...ownedFiles].reverse()) await rm(path, { force: true });
        if (directory) await rmdir(directory).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
      }),
    ]);
    if (cleanups.some((result) => result.status === "rejected")) throw new Error("CONFORMANCE_CAPTURE_CLEANUP_FAILED");
  };
  try {
    assertConformanceJobActive(params.signal);
    browser = await launch({ profilePrefix: "conformance-isolated-", isolatedCapture: true,
      ...(params.signal ? {signal: params.signal} : {}) });
    assertConformanceJobActive(params.signal);
    cancellation = bindCaptureCdpCancellation(browser.client, params.signal);
    const client = cancellation.client;
    const parsedExecutableIdentity = browserExecutableIdentitySchema.safeParse(browser.executableIdentity);
    if (!parsedExecutableIdentity.success) throw new Error("CONFORMANCE_BROWSER_EXECUTABLE_INVALID");
    const browserExecutableIdentity = parsedExecutableIdentity.data;
    if (!browser.verifyExecutableIdentity) throw new Error("CONFORMANCE_BROWSER_EXECUTABLE_VERIFIER_MISSING");
    const browserIdentity = await readCaptureBrowserIdentity(client);
    if (!client.onEvent) throw new Error("CONFORMANCE_CAPTURE_INTERCEPTION_UNAVAILABLE");
    platformFonts = await startConformancePlatformFontCapture(client, fonts, source.document, server.origin);
    let requests = 0; let blockedRequests = 0; let interceptionFailed = false;
    const pending = new Set<Promise<unknown>>();
    unsubscribeNetwork = client.onEvent("Network.loadingFailed", (event) => {
      if (event.blockedReason || event.canceled !== true) interceptionFailed = true;
    });
    await client.send("Network.enable");
    unsubscribe = client.onEvent("Fetch.requestPaused", (event) => {
      const request = event.request as { url?: string } | undefined;
      const allowed = ++requests <= CAPTURE_LIMITS.requests && typeof request?.url === "string"
        && isAllowedConformanceCaptureUrl(request.url, server.origin, server.paths);
      if (!allowed) blockedRequests++;
      const operation = client.send(allowed ? "Fetch.continueRequest" : "Fetch.failRequest", {
        requestId: event.requestId, ...(!allowed ? { errorReason: "BlockedByClient" } : {}),
      }).catch(() => { interceptionFailed = true; });
      pending.add(operation); void operation.finally(() => pending.delete(operation));
    });
    await client.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    await client.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
      let readyHash = null; let mediaErrors = 0;
      window.addEventListener("message", (event) => {
        if (event.source === window && event.data?.protocolVersion === ${COMPOSITION_PREVIEW_PROTOCOL_VERSION}
          && event.data?.type === "courseforge-composition-ready") readyHash = event.data.documentHash;
        if (event.source === window && event.data?.type === "courseforge-composition-media-error") mediaErrors++;
      });
      Object.defineProperty(window, "__courseforgeConformanceReadyHash", { get: () => readyHash });
      Object.defineProperty(window, "__courseforgeConformanceMediaErrors", { get: () => mediaErrors });
    })();` });
    await client.send("Emulation.setDeviceMetricsOverride", { deviceScaleFactor: 1, width: contract.canvas.width,
      height: contract.canvas.height, mobile: false });
    const deadline = Date.now() + CAPTURE_LIMITS.durationMilliseconds;
    const navigation = await client.send("Page.navigate", { url: `${server.origin}/conformance-preview.html` });
    if (navigation.errorText) throw new Error("CONFORMANCE_CAPTURE_NAVIGATION_FAILED");
    while (!await evaluate<boolean>(client, `document.getElementById("composition-root")?.dataset.previewReady === "true" && typeof window.__courseforgeConformanceReadyHash === "string"`)) {
      if (Date.now() > deadline || interceptionFailed || blockedRequests) throw new Error("CONFORMANCE_CAPTURE_NOT_READY");
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
    const runtimeHash = await evaluate<string | null>(client, `window.__courseforgeConformanceReadyHash`);
    if (runtimeHash !== source.metadata.documentHash) throw new Error("CONFORMANCE_CAPTURE_RUNTIME_HASH_MISMATCH");
    await verifyConformanceFontLoading(client, fonts, true);
    directory = await mkdtemp(join(resolve(params.outputParentDirectory), "conformance-captures-"));
    const frames: Array<{ frameIndex: number; timeSeconds: number; sha256: string; sizeBytes: number }> = [];
    const textCheckpoints: TextParityEvidence["checkpoints"] = [];
    const deckCheckpoints: DeckTextEvidence["checkpoints"] = [];
    const fontCheckpoints = new Map<number, Awaited<ReturnType<NonNullable<typeof platformFonts>["verify"]>>>();
    let textRegionCount = 0;
    let forwardPngBytes = 0; let reversePngBytes = 0;
    // Revisit every checkpoint backwards; coincident forward seeks alone cannot prove seek safety.
    for (const checkpoint of [...contract.checkpoints, ...[...contract.checkpoints].reverse()]) {
      assertConformanceJobActive(params.signal);
      if (Date.now() > deadline || blockedRequests || interceptionFailed) throw new Error("CONFORMANCE_CAPTURE_ISOLATION_FAILED");
      const seconds = await evaluate<number>(client, `new Promise((resolve, reject) => {
        const target = ${JSON.stringify(checkpoint.timeSeconds)};
        const timeout = setTimeout(() => { window.removeEventListener("message", listener); reject(new Error("seek timeout")); }, 5000);
        const listener = (event) => { if (event.source === window && event.data?.type === "courseforge-composition-time"
          && Math.abs(Number(event.data.seconds) - target) <= 0.01) {
          clearTimeout(timeout); window.removeEventListener("message", listener);
          setTimeout(async () => {
            const mediaDeadline = Date.now() + 5000;
            const pendingMedia = () => [...document.querySelectorAll("video[data-start], audio[data-start]")].some((media) => {
              const start = Number(media.dataset.start || 0); const duration = Number(media.dataset.duration || 0);
              return target >= start && target < start + duration && (media.seeking || media.readyState < 2);
            }) || [...document.querySelectorAll("img")].some((image) => !image.complete || image.naturalWidth <= 0);
            while (pendingMedia()) {
              if (Date.now() > mediaDeadline) { reject(new Error("media seek timeout")); return; }
              await new Promise((next) => setTimeout(next, 20));
            }
            await document.fonts.ready;
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(Number(event.data.seconds))));
          }, 50); } };
        window.addEventListener("message", listener); window.postMessage({ protocolVersion: ${COMPOSITION_PREVIEW_PROTOCOL_VERSION}, type: "courseforge-composition-seek", seconds: target }, "*");
      })`);
      if (!Number.isFinite(seconds) || Math.abs(seconds - checkpoint.timeSeconds) > 0.01) throw new Error("CONFORMANCE_CAPTURE_TIME_MISMATCH");
      await verifyConformanceFontLoading(client, fonts, false);
      await assertHtmlLayoutBeforeCapture(client, Boolean(source.document.htmlEditing?.items.length));
      const png = await captureCompositionQaScreenshot(client);
      const captured = frames.find((frame) => frame.frameIndex === checkpoint.frameIndex);
      if (contract.schemaVersion === 4 && contract.deckTextPlan) {
        const deckRead = deckTextCheckpointEvidenceSchema.parse({frameIndex: checkpoint.frameIndex, timeSeconds: checkpoint.timeSeconds,
          ...await captureDeckTextCheckpoint(client, contract.deckTextPlan, checkpoint.timeSeconds, contract.canvas.width, contract.canvas.height)});
        const deck = contract.deckTextPaintMaskPolicy ? await captureDeckTextPaintMasks(client, {
          checkpoint: deckRead, paintedPng: png, width: contract.canvas.width, height: contract.canvas.height}, async (suppressedPng) => {
            if (captured) reversePngBytes += suppressedPng.length; else forwardPngBytes += suppressedPng.length;
            if (forwardPngBytes > CAPTURE_LIMITS.totalPngBytes || reversePngBytes > CAPTURE_LIMITS.totalPngBytes)
              throw new Error("CONFORMANCE_CAPTURE_BYTE_LIMIT");
            if (!captured) {
              if (!directory) throw new Error("CONFORMANCE_CAPTURE_DIRECTORY_MISSING");
              const path = join(directory, suppressedDeckTextFrameName(checkpoint.frameIndex)); ownedFiles.push(path);
              await writeFile(path, suppressedPng, {flag: "wx", mode: 0o600});
            }
          }) : deckRead;
        if (captured) {
          if (!isDeepStrictEqual(deckCheckpoints.find((entry) => entry.frameIndex === checkpoint.frameIndex), deck))
            throw new Error("CONFORMANCE_DECK_TEXT_REVERSE_SEEK_MISMATCH");
        } else deckCheckpoints.push(deck);
      }
      if (captureTextRegions) {
        const textRead = textCheckpointEvidenceSchema.parse({frameIndex: checkpoint.frameIndex, timeSeconds: checkpoint.timeSeconds,
          ...await captureTextParityCheckpoint(client, source.document, checkpoint.timeSeconds,
            contract.schemaVersion === 4 ? contract.textParity.visibilityPolicy ?? false : false,
            contract.schemaVersion === 4 && contract.textParity.paintOffcanvasSeedPolicy !== undefined)});
        const text = paintMasksRequired ? await captureTextPaintMasks(client, {
          checkpoint: textRead, paintedPng: png, width: contract.canvas.width, height: contract.canvas.height},
          captureCompositionQaScreenshot, async (suppressedPng) => {
            if (captured) reversePngBytes += suppressedPng.length; else forwardPngBytes += suppressedPng.length;
            if (forwardPngBytes > CAPTURE_LIMITS.totalPngBytes || reversePngBytes > CAPTURE_LIMITS.totalPngBytes)
              throw new Error("CONFORMANCE_CAPTURE_BYTE_LIMIT");
            if (!captured) {
              if (!directory) throw new Error("CONFORMANCE_CAPTURE_DIRECTORY_MISSING");
              const suppressedPath = join(directory, suppressedTextFrameName(checkpoint.frameIndex)); ownedFiles.push(suppressedPath);
              await writeFile(suppressedPath, suppressedPng, {flag: "wx", mode: 0o600});
            }
          }) : textRead;
        const usedFonts = await platformFonts.verify(text);
        if (fontCheckpoints.has(checkpoint.frameIndex) && !isDeepStrictEqual(fontCheckpoints.get(checkpoint.frameIndex), usedFonts)) {
          throw new Error("CONFORMANCE_FONT_REVERSE_SEEK_MISMATCH");
        }
        fontCheckpoints.set(checkpoint.frameIndex, usedFonts);
        if (captured) {
          const previous = textCheckpoints.find((entry) => entry.frameIndex === checkpoint.frameIndex);
          if (!isDeepStrictEqual(previous, text)) throw new Error("CONFORMANCE_TEXT_REVERSE_SEEK_MISMATCH");
        } else {
          textRegionCount += text.expectedTexts.length;
          if (textRegionCount > COMPOSITION_TEXT_PARITY_POLICY.maximumRegionsPerCapture) throw new Error("CONFORMANCE_TEXT_EVIDENCE_LIMIT");
          textCheckpoints.push(text);
        }
      }
      if (captured) reversePngBytes += png.length; else forwardPngBytes += png.length;
      if (png.length > CAPTURE_LIMITS.pngBytes || forwardPngBytes > CAPTURE_LIMITS.totalPngBytes
        || reversePngBytes > CAPTURE_LIMITS.totalPngBytes) throw new Error("CONFORMANCE_CAPTURE_BYTE_LIMIT");
      const image = await sharp(png, { limitInputPixels: contract.canvas.width * contract.canvas.height }).metadata();
      if (image.format !== "png" || image.width !== contract.canvas.width || image.height !== contract.canvas.height) throw new Error("CONFORMANCE_CAPTURE_IMAGE_INVALID");
      const sha256 = createHash("sha256").update(png).digest("hex");
      if (captured) {
        if (captured.sha256 !== sha256) throw new Error("CONFORMANCE_CAPTURE_REVERSE_SEEK_MISMATCH");
        continue;
      }
      const path = join(directory, `frame-${checkpoint.frameIndex}.png`); ownedFiles.push(path);
      await writeFile(path, png, { flag: "wx", mode: 0o600 });
      frames.push({ frameIndex: checkpoint.frameIndex, timeSeconds: seconds, sha256, sizeBytes: png.length });
    }
    await Promise.all(pending);
    if (await evaluate<number>(client, "window.__courseforgeConformanceMediaErrors") !== 0) throw new Error("CONFORMANCE_CAPTURE_MEDIA_FAILED");
    if (blockedRequests || interceptionFailed || Date.now() > deadline) throw new Error("CONFORMANCE_CAPTURE_ISOLATION_FAILED");
    if (params.capturePlaybackAudio === true) {
      playback = await captureBrowserPlaybackAudio({client, workletUrl: `${server.origin}/${PLAYBACK_CAPTURE_POLICY.workletPath}`,
        durationSeconds: contract.canvas.durationSeconds, outputParentDirectory: params.outputParentDirectory,
        receipt: params.materialized.receipt, expectedMediaWindows: buildMediaBoundaryPlan(source.document)});
      await Promise.all(pending);
      if (blockedRequests || interceptionFailed) throw new Error("CONFORMANCE_CAPTURE_ISOLATION_FAILED");
    }
    await verifyFiles();
    assertCaptureBrowserIdentityUnchanged(browserIdentity, await readCaptureBrowserIdentity(client));
    await browser.verifyExecutableIdentity();
    const textParity = captureTextRegions ? validateTextParityEvidence({schemaVersion: 1,
      policy: COMPOSITION_TEXT_PARITY_POLICY.id, repeatability: TEXT_PARITY_REPEATABILITY, checkpoints: textCheckpoints}, contract) : undefined;
    const fontUsageRequired = contract.schemaVersion === 4 && contract.fontUsageContract !== undefined;
    const deckText = contract.schemaVersion === 4 && contract.deckTextPlan ? validateDeckTextEvidence({
      policy: "DECK_SOURCE_NODE_CAPTURE_V1", scope: "PREVIEW_TEXT_CONTENT_GEOMETRY_NOT_PAINT_OR_RENDER_FONT_EVIDENCE",
      documentHash: contract.documentHash, planSha256: hashDeckTextPlan(contract.deckTextPlan),
      repeatability: "EXACT_DECK_TEXT_GEOMETRY_FORWARD_REVERSE_V1", checkpoints: deckCheckpoints}, contract) : undefined;
    const fontUsage = (fonts.length || fontUsageRequired) && textParity ? validateFontUsageEvidence({schemaVersion: 1, policy: FONT_USAGE_EVIDENCE_POLICY,
      scope: "DECLARED_CUSTOM_NATIVE_PREVIEW_ONLY", status: "CAPTURED", manifest: fonts, manifestSha256: conformanceFontManifestHash(fonts),
      bindings: platformFonts.bindings, checkpoints: contract.checkpoints.map((checkpoint) => ({
        frameIndex: checkpoint.frameIndex, timeSeconds: checkpoint.timeSeconds, elements: fontCheckpoints.get(checkpoint.frameIndex) ?? [],
      }))}, textParity) : undefined;
    const metadata = compositionConformanceCaptureMetadataSchema.parse({ documentHash: source.metadata.documentHash,
      browserIdentity,
      browserExecutableIdentity,
      ...(textParity ? {textParity} : {}),
      ...(deckText ? {deckText} : {}),
      ...(fontUsage ? {fontUsage} : {}),
      frames: frames.map(({ frameIndex, timeSeconds }) => ({ frameIndex, timeSeconds })) });
    const receipt = { ...params.materialized.receipt, status: "VISUAL_CAPTURED_AUDIO_PENDING", frames, networkPolicy: "EXACT_LOCAL_ALLOWLIST_V1",
      ...(eventBatchLineage ? {eventBatchLineage} : {}),
      browserIdentitySha256: browserIdentityHash(browserIdentity),
      browserExecutableIdentitySha256: browserExecutableIdentityHash(browserExecutableIdentity),
      ...(textParity ? {textParitySha256: textParityEvidenceHash(textParity)} : {}),
      ...(deckText ? {deckTextSha256: hashDeckTextEvidence(deckText)} : {}),
      ...(fontUsage ? {fontUsageSha256: fontUsageEvidenceHash(fontUsage)} : {}),
      seekRepeatability: { policy: "EXACT_PNG_FORWARD_REVERSE_V1", status: "PASS", checkpointCount: frames.length } };
    for (const [name, value] of [["preview-metadata.json", metadata], ["capture-receipt.json", receipt]] as const) {
      assertConformanceJobActive(params.signal);
      const serialized = `${JSON.stringify(value, null, 2)}\n`;
      if (Buffer.byteLength(serialized) > CAPTURE_LIMITS.metadataBytes) throw new Error("CONFORMANCE_CAPTURE_METADATA_LIMIT");
      const path = join(directory, name); ownedFiles.push(path); await writeFile(path, serialized, { flag: "wx", mode: 0o600 });
    }
    assertConformanceJobActive(params.signal);
    return { directory, metadata, receipt, playback, cleanup, contract };
  } catch (error) { await cleanup(); assertConformanceJobActive(params.signal); throw error; }
  finally {
    cancellation?.dispose();
    platformFonts?.close();
    unsubscribe?.(); unsubscribeNetwork?.(); let closeFailed = cancellation?.closeFailed ?? false;
    try { await browser?.close(); } catch { closeFailed = true; }
    try { await server.close(); } catch { closeFailed = true; }
    if (closeFailed) { await cleanup(); throw new Error("CONFORMANCE_CAPTURE_RESOURCE_CLOSE_FAILED"); }
    if (params.signal?.aborted) {await cleanup(); assertConformanceJobActive(params.signal);}
  }
}
