import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rmdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import sharp from "sharp";
import test from "node:test";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { hashCompositionDocument } from "../composition-document.service";
import { buildConformanceReferenceSource } from "../composition-conformance-reference.service";
import { buildSnapshotConformanceContract } from "../composition-snapshot-conformance-contract";
import { materializeConformanceReference } from "../qa/composition-conformance-materialization";
import { captureMaterializedConformancePreview } from "../qa/composition-conformance-visual-capture";
import { isAllowedConformanceCaptureUrl, readCaptureByteRange, startConformanceCaptureServer } from "../qa/composition-conformance-capture-server";
import type { CompositionQaCdpClient, launchCompositionQaBrowser } from "../qa/composition-qa-browser";
import { mediaBoundaryPlanHash, MEDIA_BOUNDARY_POLICY } from "../qa/composition-playback-boundaries";
import { createCompositionNativeOverlay } from "../composition-native-overlay.factory";
import { NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT } from "../composition-document.types";
import { textParityEvidenceHash } from "../qa/composition-text-parity-evidence";
import { NATIVE_TEXT_GEOMETRY_POLICY, type NativeTextVisibilityPolicy } from "../composition-text-parity-contract";
import { conformanceFontPath } from "../composition-conformance-font-bindings";
import { fontUsageEvidenceHash, validateFontUsageEvidence } from "../qa/composition-font-usage-evidence";
import { buildVisualConformanceEvidencePackage } from "../qa/composition-conformance-evidence-package";
import { browserIdentityHash } from "../qa/composition-browser-identity";
import { browserExecutableIdentityHash } from "../qa/composition-browser-executable-identity";

const identifier = "70000000-0000-4000-8000-000000000001";
async function withSource(run: (parent: string, materialized: Awaited<ReturnType<typeof materializeConformanceReference>>) => Promise<void>, nativeText = false, contractVersion: 2 | 4 = 2, motionVisibility = false, visibilityPolicy?: NativeTextVisibilityPolicy, nativeOutsideCanvas = false, declaredFont = false, fontObligation = false, eventCheckpoints = false) {
  const parent = await mkdtemp(join(tmpdir(), "visual-capture-test-"));
  const media = Buffer.from("controlled media fixture");
  const fontBytes = Buffer.from("controlled font fixture, not decoder evidence");
  const font = {fontAssetId: identifier, family: "Editorial", mimeType: "font/woff2" as const,
    checksumSha256: createHash("sha256").update(fontBytes).digest("hex"), fileSizeBytes: fontBytes.length};
  const asset = { productionAssetId: identifier, checksum: createHash("sha256").update(media).digest("hex"), fileSizeBytes: media.length,
    mimeType: "video/mp4", storageBucket: "production-assets", storagePath: "media/fixture.mp4" };
  const document = createInitialCompositionDocument({ animatedDeck: null,
    assets: [{ ...asset, durationSeconds: 10, hasAudio: false, publicUrl: null, timelineRole: "BROLL" }],
    plan: { accentColor: "#38BDF8", durationSeconds: 10, subtitle: "Capture", title: "Reference" } });
  if (nativeText) {
    const {clip, track} = createCompositionNativeOverlay({document, id: "native", kind: "TEXT", playheadSeconds: 0});
    if (clip.source.type !== "NATIVE_TEXT") throw new Error("Expected native text"); clip.source.text = "Captura nativa";
    if (declaredFont) {clip.source.style.fontAssetId = identifier; clip.source.style.fontFamily = font.family;}
    if (track) document.tracks.push(track); document.clips.push(clip); document.format = NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT;
    if (nativeOutsideCanvas) clip.layout.x = -clip.layout.width - 100;
    if (motionVisibility) document.motion.animations.push({id: "hide", origin: "USER", propertyGroup: "OPACITY",
      target: {clipId: clip.id, part: "CONTENT"}, timing: {anchor: "CLIP_START", offsetSeconds: 0, durationSeconds: 1},
      keyframes: [{offset: 0, values: {opacity: 0}}, {offset: 1, values: {opacity: 0}, ease: "none"}]});
  }
  const contract = buildSnapshotConformanceContract({ document, contractVersion, motionVisibility, visibilityPolicy, eventCheckpoints,
    fontUsage: fontObligation, fontManifest: declaredFont ? [font] : [], documentHash: hashCompositionDocument(document), assets: [{ id: identifier, checksum: asset.checksum }],
    renderProfile: { format: "mp4", fps: 25, quality: "high", resolution: "1080p" } });
  const source = await buildConformanceReferenceSource({ document, contract, assets: [asset],
    ...(declaredFont ? {fontManifest: [font], fontAssets: new Map([[identifier,
      {assetId: identifier, family: font.family, format: "woff2" as const, sourceUrl: conformanceFontPath(font)}]])} : fontObligation ? {fontManifest: []} : {}) });
  const zip = new JSZip();
  for (const [path, content] of [["conformance-preview.html", source.previewHtml], ["conformance-reference.json", JSON.stringify(source.metadata)],
    ["composition-document.json", source.documentJson], ["conformance-contract.json", source.contractJson],
    ["font-manifest.json", JSON.stringify(declaredFont ? [font] : [])]]) zip.file(path!, content!);
  if (declaredFont) zip.file(conformanceFontPath(font), fontBytes);
  const archiveBytes = await zip.generateAsync({ type: "nodebuffer" });
  const materialized = await materializeConformanceReference({ archiveBytes, expectedProjectHash: createHash("sha256").update(archiveBytes).digest("hex"),
    organizationId: identifier, revisionId: identifier, outputParentDirectory: parent, readAsset: async () => new Response(media) });
  try { await run(parent, materialized); }
  finally { await materialized.cleanup(); await rmdir(parent); }
}

async function browserAdapter(documentHash: string, mode: "normal" | "external" | "hash" | "time" | "image" | "interception" | "unstable" | "playback" | "text" | "text-unstable" | "text-motion" | "text-geometry" | "text-geometry-bad" | "text-absence" = "normal", fontFailureAt = Infinity, glyphFailureAt = Infinity) {
  const png = await sharp({ create: { width: mode === "image" ? 1 : 1920, height: 1080, channels: 4, background: "#020617" } }).png().toBuffer();
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const handlers = new Map<string, (params: Record<string, unknown>) => void>();
  let closed = false;
  let captureCount = 0;
  let fontChecks = 0;
  let glyphChecks = 0;
  let textTarget = 0; const textVisits = new Map<number, number>();
  const poseVisits = new Map<number, number>();
  let audioBatches = 0; let audioStopped = false;
  const changedPng = mode === "unstable" ? await sharp({ create: { width: 1920, height: 1080, channels: 4, background: "#fefefe" } }).png().toBuffer() : png;
  const launch: typeof launchCompositionQaBrowser = async (options) => {
    assert.equal(options.isolatedCapture, true);
    const client: CompositionQaCdpClient = { close: () => undefined,
      ...(mode !== "interception" ? { onEvent: (method: string, handler: (params: Record<string, unknown>) => void) => {
        handlers.set(method, handler); return () => { handlers.delete(method); };
      } } : {}),
      send: async (method, params) => {
        calls.push({ method, params });
        if (method === "Browser.getVersion") return {protocolVersion: "1.3", product: "HeadlessChrome/130.0.0.0",
          revision: "controlled-revision", userAgent: "controlled-agent", jsVersion: "13.0"};
        if (method === "Page.navigate") handlers.get("Fetch.requestPaused")?.({ requestId: "request-1", request: {
          url: mode === "external" ? "https://external.invalid/image.png" : params?.url,
        } });
        if (method === "Page.navigate") handlers.get("CSS.fontsUpdated")?.({font: {fontFamily: "Editorial", platformFontFamily: "Internal Editorial",
          src: `${new URL(String(params?.url)).origin}/assets/fonts/${createHash("sha256").update("controlled font fixture, not decoder evidence").digest("hex")}.woff2`}});
        if (method === "DOM.requestNode") return {nodeId: 1};
        if (method === "CSS.getPlatformFontsForNode") return {fonts: [{familyName: "Internal Editorial", postScriptName: "InternalEditorial-Regular", isCustomFont: ++glyphChecks < glyphFailureAt, glyphCount: 14}]};
        if (method === "Runtime.evaluate") {
          const expression = String(params?.expression);
          if (params?.returnByValue === false && expression.startsWith("document.getElementById(")) return {result: {objectId: "controlled-native-node"}};
          if (expression.includes("verifyDeclaredFontFaces")) return ++fontChecks >= fontFailureAt
            ? {exceptionDetails: {text: "controlled private font decoding failure"}}
            : {result: {value: true}};
          if (expression.includes("readNativeTextPaintPoses")) {
            const visits = (poseVisits.get(textTarget) ?? 0) + 1; poseVisits.set(textTarget, visits);
            return {result: {value: [{elementId: "native-motion", verified: mode !== "text-geometry-bad" || visits === 1}]}};
          }
          if (expression.includes("readTextParityDom")) {
            const visits = (textVisits.get(textTarget) ?? 0) + 1; textVisits.set(textTarget, visits);
            return {result: {value: textTarget >= 5 || mode === "normal" ? [] : [{elementId: "native-motion", text: "Captura nativa",
              left: mode === "text-unstable" && visits > 1 ? 11 : 10, top: 20, width: 30, height: 40,
              ...(mode === "text-motion" ? {visibility: "HIDDEN"} : {}),
              ...(mode === "text-geometry" || mode === "text-geometry-bad" || mode === "text-absence" ? {visibility: "VISIBLE",
                presentation: {effectiveOpacity: 1, opaqueOverlayIds: []}} : {}),
              ...(mode === "text-absence" ? {left: 0, top: 0, width: 1920, height: 1080, regionKind: "CANVAS_ABSENCE_PROBE"} : {})}]}};
          }
          const seekTarget = /const target = ([\d.]+)/.exec(expression)?.[1];
          if (seekTarget) textTarget = Number(seekTarget);
          if (mode === "playback") {
            if (expression.startsWith("(async")) return {result: {value: {sampleRate: 48000, mediaCount: 0}}};
            if (expression.includes("__courseforgePlaybackCapture.start()")) return {result: {value: true}};
            if (expression.includes("__courseforgePlaybackCapture.stop()")) {audioStopped = true; return {result: {value: true}};}
            if (expression.includes("__courseforgePlaybackCapture.pull()")) {
              const offset = audioBatches++ * 16_000;
              return {result: {value: {originFrame: 0, chunks: Array.from({length: 125}, (_, index) => ({startFrame: offset + index * 128,
                frames: 128, pcm: Buffer.alloc(1024).toString("base64")})), error: null, done: audioBatches >= 30,
                packetCount: audioBatches * 125, eventCount: 0, maxClockDriftMilliseconds: 0, maxMediaDriftMilliseconds: 0, largestBlockFrames: 128,
                ...(audioBatches >= 30 ? {boundaries: {policy: MEDIA_BOUNDARY_POLICY, planHash: mediaBoundaryPlanHash([]), media: []}} : {})}}};
            }
          }
          const value = expression.includes("dataset.previewReady") ? true : expression === "window.__courseforgeConformanceReadyHash"
            ? mode === "hash" ? "b".repeat(64) : documentHash
            : expression === "window.__courseforgeConformanceMediaErrors" ? 0
            : Number(/const target = ([\d.]+)/.exec(expression)?.[1]) + (mode === "time" ? 1 : 0);
          return { result: { value } };
        }
        if (method === "Page.captureScreenshot") {
          captureCount++; return { data: (mode === "unstable" && captureCount > 1 ? changedPng : png).toString("base64") };
        }
        return {};
      },
    };
    return { client, browserPath: "controlled-adapter", executableIdentity: {policy: "LAUNCH_FILE_SHA256_BEFORE_AFTER_V1",
      scope: "LAUNCH_FILE_NOT_LOADED_MODULES_OR_REMOTE_RENDERER", sha256: "e".repeat(64), sizeBytes: 100},
      verifyExecutableIdentity: async () => undefined, close: async () => { closed = true; } };
  };
  return { launch, calls, handlers, wasClosed: () => closed, wasAudioStopped: () => audioStopped };
}

test("URL and byte-range policies reject traversal, foreign origins, extra query and invalid/multiple ranges", () => {
  const origin = "http://127.0.0.1:12345"; const paths = new Set(["conformance-preview.html"]);
  assert.equal(isAllowedConformanceCaptureUrl(`${origin}/conformance-preview.html`, origin, paths), true);
  for (const url of ["https://external.invalid/conformance-preview.html", `${origin}/secret`, `${origin}/conformance-preview.html?token=secret`,
    `${origin}/%2e%2e/secret`, "file:///etc/passwd", `${origin}/conformance-preview.html#fragment`]) {
    assert.equal(isAllowedConformanceCaptureUrl(url, origin, paths), false);
  }
  assert.deepEqual(readCaptureByteRange("bytes=2-100", 10), { start: 2, end: 9, partial: true });
  for (const header of ["bytes=-5", "bytes=10-", "bytes=4-2", "bytes=0-1,4-5", "bytes=90071992547409999-"]) assert.throws(() => readCaptureByteRange(header, 10));
});

test("local server exposes only explicit files, supports seeking ranges and applies restrictive CSP", async () => {
  const parent = await mkdtemp(join(tmpdir(), "capture-server-test-"));
  const path = join(parent, "conformance-preview.html"); await writeFile(path, "0123456789");
  const server = await startConformanceCaptureServer(parent, new Map([["conformance-preview.html", "text/html"]]));
  try {
    const response = await fetch(`${server.origin}/conformance-preview.html`, { headers: { Range: "bytes=2-4" } });
    assert.equal(response.status, 206); assert.equal(await response.text(), "234");
    assert.ok(response.headers.get("content-security-policy")?.includes("connect-src 'none'"));
    assert.equal((await fetch(`${server.origin}/secret`)).status, 403);
    assert.equal((await fetch(`${server.origin}/conformance-preview.html`, { headers: { Range: "bytes=20-" } })).status, 416);
  } finally { await server.close(); await rm(path); await rmdir(parent); }
});

test("capture writes exact checkpoints, hashes PNGs, isolates before navigation and closes all resources", async () => {
  await withSource(async (parent, materialized) => {
    const adapter = await browserAdapter(materialized.receipt.documentHash);
    const result = await captureMaterializedConformancePreview({ materialized, outputParentDirectory: parent }, adapter.launch);
    try {
      assert.equal(result.receipt.status, "VISUAL_CAPTURED_AUDIO_PENDING"); assert.ok(result.metadata.frames.length > 0);
      assert.ok(result.metadata.browserIdentity);
      assert.equal(result.receipt.browserIdentitySha256, browserIdentityHash(result.metadata.browserIdentity));
      assert.ok(result.metadata.browserExecutableIdentity);
      assert.equal(result.receipt.browserExecutableIdentitySha256, browserExecutableIdentityHash(result.metadata.browserExecutableIdentity));
      assert.equal(adapter.calls.filter((call) => call.method === "Browser.getVersion").length, 2);
      assert.equal(result.receipt.seekRepeatability.status, "PASS");
      assert.equal(result.receipt.seekRepeatability.checkpointCount, result.metadata.frames.length);
      assert.equal(adapter.calls.filter((call) => call.method === "Page.captureScreenshot").length, result.metadata.frames.length * 2);
      for (const frame of result.receipt.frames) {
        const bytes = await readFile(join(result.directory, `frame-${frame.frameIndex}.png`));
        assert.equal(createHash("sha256").update(bytes).digest("hex"), frame.sha256);
      }
      assert.ok(adapter.calls.findIndex((call) => call.method === "Fetch.enable") < adapter.calls.findIndex((call) => call.method === "Page.navigate"));
      assert.ok(adapter.calls.some((call) => call.method === "Page.addScriptToEvaluateOnNewDocument"));
      assert.equal(adapter.wasClosed(), true); assert.equal(adapter.handlers.size, 0);
    } finally { await result.cleanup(); }
  });
});

test("event partition capture preserves root files and rejects invalid selection before launching", async () => {
  await withSource(async (parent, materialized) => {
    const rootPath = join(materialized.directory, "conformance-contract.json");
    const original = await readFile(rootPath, "utf8");
    const adapter = await browserAdapter(materialized.receipt.documentHash);
    await assert.rejects(captureMaterializedConformancePreview({materialized, outputParentDirectory: parent,
      eventBatchIndex: 999}, adapter.launch), /BATCH_INDEX_INVALID/);
    assert.equal(adapter.calls.length, 0);
    const captured = await captureMaterializedConformancePreview({materialized, outputParentDirectory: parent,
      eventBatchIndex: 0}, adapter.launch);
    try {
      assert.deepEqual(captured.contract, JSON.parse(original));
      assert.deepEqual(captured.metadata.frames.map((frame) => frame.frameIndex),
        captured.contract.checkpoints.map((checkpoint) => checkpoint.frameIndex));
      assert.equal(await readFile(rootPath, "utf8"), original);
      const bundle = await buildVisualConformanceEvidencePackage({captureDirectory: captured.directory,
        organizationId: materialized.receipt.organizationId, revisionId: materialized.receipt.revisionId,
        projectHash: materialized.receipt.projectHash, contract: captured.contract});
      const zip = await JSZip.loadAsync(bundle.bytes);
      const receiptPath = join(captured.directory, "capture-receipt.json");
      const receipt = JSON.parse(await zip.file("capture-receipt.json")!.async("string"));
      assert.deepEqual(receipt.eventBatchLineage, captured.receipt.eventBatchLineage);
      delete receipt.eventBatchLineage;
      await writeFile(receiptPath, JSON.stringify(receipt));
      await assert.rejects(buildVisualConformanceEvidencePackage({captureDirectory: captured.directory,
        organizationId: materialized.receipt.organizationId, revisionId: materialized.receipt.revisionId,
        projectHash: materialized.receipt.projectHash, contract: captured.contract}), /LINEAGE_MISSING/);
    } finally {await captured.cleanup();}
  }, false, 4, false, undefined, false, false, false, true);
});

test("v4 requires native text capture even when the caller explicitly opts out", async () => {
  await withSource(async (parent, materialized) => {
    const adapter = await browserAdapter(materialized.receipt.documentHash, "text");
    const capture = await captureMaterializedConformancePreview({materialized, outputParentDirectory: parent, captureTextRegions: false}, adapter.launch);
    try {
      assert.ok(capture.metadata.textParity);
      assert.equal(capture.metadata.textParity.checkpoints.length, capture.receipt.frames.length);
      assert.ok(capture.metadata.textParity.checkpoints.some((entry) => entry.regions.length === 1));
      assert.equal(capture.receipt.textParitySha256, textParityEvidenceHash(capture.metadata.textParity));
    } finally { await capture.cleanup(); }
  }, true, 4);
});

test("invalid or changing actual browser versions cannot leave a capture package", async () => {
  for (const failure of ["missing", "changed"] as const) await withSource(async (parent, materialized) => {
    const before = await readdir(parent), adapter = await browserAdapter(materialized.receipt.documentHash);
    const launch: typeof launchCompositionQaBrowser = async (params) => {
      const browser = await adapter.launch(params), send = browser.client.send;
      let versions = 0;
      browser.client.send = async (method, input) => {
        const response = await send(method, input);
        if (method !== "Browser.getVersion") return response;
        versions++;
        return failure === "missing" ? {} : versions > 1 ? {...response, revision: "changed-revision"} : response;
      };
      return browser;
    };
    await assert.rejects(captureMaterializedConformancePreview({materialized, outputParentDirectory: parent}, launch), /BROWSER_IDENTITY_(INVALID|CHANGED)/);
    assert.deepEqual(await readdir(parent), before); assert.equal(adapter.wasClosed(), true); assert.equal(adapter.handlers.size, 0);
  });
});

test("missing launch identity, missing verifier and changed executable reject capture with cleanup", async () => {
  for (const failure of ["identity", "verifier", "changed"] as const) await withSource(async (parent, materialized) => {
    const before = await readdir(parent), adapter = await browserAdapter(materialized.receipt.documentHash);
    const launch: typeof launchCompositionQaBrowser = async (params) => {
      const browser = await adapter.launch(params);
      if (failure === "identity") return {...browser, executableIdentity: undefined};
      if (failure === "verifier") return {...browser, verifyExecutableIdentity: undefined};
      return {...browser, verifyExecutableIdentity: async () => {throw new Error("CONFORMANCE_BROWSER_EXECUTABLE_CHANGED");}};
    };
    await assert.rejects(captureMaterializedConformancePreview({materialized, outputParentDirectory: parent}, launch), /BROWSER_EXECUTABLE_(INVALID|VERIFIER_MISSING|CHANGED)/);
    assert.deepEqual(await readdir(parent), before);
    assert.equal(adapter.wasClosed(), true); assert.equal(adapter.handlers.size, 0);
  });
});

test("declared font loading is mandatory before frames and throughout forward/reverse capture, with failure cleanup", async () => {
  await withSource(async (parent, materialized) => {
    const adapter = await browserAdapter(materialized.receipt.documentHash, "text");
    const capture = await captureMaterializedConformancePreview({materialized, outputParentDirectory: parent}, adapter.launch);
    const frameCount = capture.metadata.frames.length;
    try {
      assert.ok(capture.metadata.fontUsage);
      assert.equal(capture.receipt.fontUsageSha256, fontUsageEvidenceHash(capture.metadata.fontUsage));
      assert.deepEqual(validateFontUsageEvidence(capture.metadata.fontUsage, capture.metadata.textParity!), capture.metadata.fontUsage);
      assert.deepEqual(JSON.parse(await readFile(join(capture.directory, "preview-metadata.json"), "utf8")).fontUsage, capture.metadata.fontUsage);
      const fontCalls = adapter.calls.filter((call) => String(call.params?.expression).includes("verifyDeclaredFontFaces"));
      assert.equal(fontCalls.length, 1 + frameCount * 2);
      assert.ok(adapter.calls.findIndex((call) => String(call.params?.expression).includes("verifyDeclaredFontFaces"))
        < adapter.calls.findIndex((call) => call.method === "Page.captureScreenshot"));
    } finally {await capture.cleanup();}
    for (const failureAt of [1, 2, frameCount + 2]) {
      const before = await readdir(parent);
      const failing = await browserAdapter(materialized.receipt.documentHash, "text", failureAt);
      await assert.rejects(captureMaterializedConformancePreview({materialized, outputParentDirectory: parent}, failing.launch),
        /^Error: CONFORMANCE_CAPTURE_FONT_LOADING_FAILED$/);
      assert.deepEqual(await readdir(parent), before); assert.equal(failing.wasClosed(), true);
      assert.equal(failing.handlers.size, 0);
      if (failureAt <= 2) assert.equal(failing.calls.filter((call) => call.method === "Page.captureScreenshot").length, 0);
    }
  }, true, 4, false, undefined, false, true);
});

test("actual glyph fallback rejects forward or reverse packages despite unchanged PNGs and loaded FontFaces", async () => {
  await withSource(async (parent, materialized) => {
    const good = await browserAdapter(materialized.receipt.documentHash, "text");
    const captured = await captureMaterializedConformancePreview({materialized, outputParentDirectory: parent}, good.launch);
    const forwardGlyphChecks = good.calls.filter((call) => call.method === "CSS.getPlatformFontsForNode").length / 2;
    await captured.cleanup(); assert.ok(forwardGlyphChecks > 0);
    for (const failureAt of [1, forwardGlyphChecks + 1]) {
      const before = await readdir(parent);
      const failing = await browserAdapter(materialized.receipt.documentHash, "text", Infinity, failureAt);
      await assert.rejects(captureMaterializedConformancePreview({materialized, outputParentDirectory: parent}, failing.launch), /GLYPH_FALLBACK/);
      assert.deepEqual(await readdir(parent), before); assert.equal(failing.wasClosed(), true);
      assert.equal(failing.handlers.size, 0);
      assert.ok(failing.calls.some((call) => call.method === "Runtime.releaseObject"));
    }
  }, true, 4, false, undefined, false, true);
});

test("frozen font obligation cannot lose both witness copies, including an explicitly empty manifest", async () => {
  for (const declaredFont of [false, true]) await withSource(async (parent, materialized) => {
    const adapter = await browserAdapter(materialized.receipt.documentHash, declaredFont ? "text" : "normal");
    const captured = await captureMaterializedConformancePreview({materialized, outputParentDirectory: parent}, adapter.launch);
    try {
      assert.ok(captured.metadata.fontUsage);
      assert.equal(captured.metadata.fontUsage.manifest.length, declaredFont ? 1 : 0);
      const contract = JSON.parse(await readFile(join(materialized.directory, "conformance-contract.json"), "utf8"));
      const params = {captureDirectory: captured.directory, organizationId: identifier, revisionId: identifier,
        projectHash: materialized.receipt.projectHash, contract};
      await buildVisualConformanceEvidencePackage(params);
      const {fontUsage: _fontUsage, ...metadata} = captured.metadata;
      const {fontUsageSha256: _fontUsageSha256, ...receipt} = captured.receipt;
      await writeFile(join(captured.directory, "preview-metadata.json"), JSON.stringify(metadata));
      await writeFile(join(captured.directory, "capture-receipt.json"), JSON.stringify(receipt));
      await assert.rejects(buildVisualConformanceEvidencePackage(params), /REQUIRED_EVIDENCE_MISSING/);
    } finally {await captured.cleanup();}
  }, declaredFont, 4, false, undefined, false, declaredFont, true);
});

test("frozen motion visibility survives forward/reverse capture with hidden regions retained", async () => {
  await withSource(async (parent, materialized) => {
    const adapter = await browserAdapter(materialized.receipt.documentHash, "text-motion");
    const capture = await captureMaterializedConformancePreview({materialized, outputParentDirectory: parent}, adapter.launch);
    try {
      const checkpoint = capture.metadata.textParity!.checkpoints.find((entry) => entry.expectedTexts.length > 0)!;
      assert.equal(checkpoint.status, "CAPTURED");
      assert.equal(checkpoint.expectedTexts[0]!.visibility, "HIDDEN");
      assert.equal(checkpoint.regions[0]!.visibility, "HIDDEN");
      assert.equal(capture.receipt.textParitySha256, textParityEvidenceHash(capture.metadata.textParity));
    } finally { await capture.cleanup(); }
  }, true, 4, true);
});

test("geometry policy survives materialization and reverse capture; a reverse pose failure rejects the package", async () => {
  await withSource(async (parent, materialized) => {
    const adapter = await browserAdapter(materialized.receipt.documentHash, "text-geometry");
    const capture = await captureMaterializedConformancePreview({materialized, outputParentDirectory: parent}, adapter.launch);
    try {
      const witness = capture.metadata.textParity!;
      assert.equal(capture.receipt.textParitySha256, textParityEvidenceHash(witness));
      const checkpoint = witness.checkpoints.find((entry) => entry.expectedTexts.length > 0)!;
      assert.equal(checkpoint.status, "CAPTURED");
      assert.equal(checkpoint.expectedTexts[0]!.presentation!.paintPose!.clipId, "native");
      assert.deepEqual(checkpoint.regions[0]!.presentation!.paintPose, checkpoint.expectedTexts[0]!.presentation!.paintPose);
      const verificationCount = adapter.calls.filter((call) => String(call.params?.expression).includes("readNativeTextPaintPoses")).length;
      assert.equal(verificationCount, witness.checkpoints.filter((entry) => entry.expectedTexts.length > 0).length * 2);
    } finally {await capture.cleanup();}
    const altered = await browserAdapter(materialized.receipt.documentHash, "text-geometry-bad");
    await assert.rejects(captureMaterializedConformancePreview({materialized, outputParentDirectory: parent}, altered.launch), /PAINT_CAPTURE_FAILED/);
    assert.equal(altered.wasClosed(), true);
    assert.deepEqual(await readdir(parent), [materialized.directory.split(/[\\/]/).at(-1)]);
  }, true, 4, false, NATIVE_TEXT_GEOMETRY_POLICY);
});

test("explicit offcanvas absence probes remain scoped and pinned through forward/reverse visual capture", async () => {
  await withSource(async (parent, materialized) => {
    const adapter = await browserAdapter(materialized.receipt.documentHash, "text-absence");
    const capture = await captureMaterializedConformancePreview({materialized, outputParentDirectory: parent}, adapter.launch);
    try {
      const checkpoint = capture.metadata.textParity!.checkpoints.find((entry) => entry.expectedTexts.length > 0)!;
      assert.equal(checkpoint.status, "CAPTURED");
      assert.equal(checkpoint.regions[0]!.regionKind, "CANVAS_ABSENCE_PROBE");
      assert.equal(checkpoint.regions[0]!.presentation!.paintPose!.support.empty, true);
      assert.equal(checkpoint.regions[0]!.width, 1920); assert.equal(checkpoint.regions[0]!.height, 1080);
      assert.equal(capture.receipt.textParitySha256, textParityEvidenceHash(capture.metadata.textParity));
      assert.equal(capture.receipt.seekRepeatability.status, "PASS");
    } finally {await capture.cleanup();}
  }, true, 4, false, NATIVE_TEXT_GEOMETRY_POLICY, true);
});

test("opt-in text capture pins every checkpoint and rejects changed reverse geometry even when PNGs match", async () => {
  for (const mode of ["text", "text-unstable"] as const) await withSource(async (parent, materialized) => {
    const adapter = await browserAdapter(materialized.receipt.documentHash, mode);
    if (mode === "text-unstable") {
      await assert.rejects(captureMaterializedConformancePreview({materialized, outputParentDirectory: parent, captureTextRegions: true}, adapter.launch), /TEXT_REVERSE_SEEK_MISMATCH/);
      assert.equal(adapter.wasClosed(), true); assert.deepEqual(await readdir(parent), [materialized.directory.split(/[\\/]/).at(-1)]);
      return;
    }
    const capture = await captureMaterializedConformancePreview({materialized, outputParentDirectory: parent, captureTextRegions: true}, adapter.launch);
    try {
      assert.ok(capture.metadata.textParity); assert.equal(capture.metadata.textParity.checkpoints.length, capture.receipt.frames.length);
      assert.ok(capture.metadata.textParity.checkpoints.some((checkpoint) => checkpoint.regions.length === 1));
      assert.equal(capture.receipt.textParitySha256, textParityEvidenceHash(capture.metadata.textParity));
      assert.deepEqual(JSON.parse(await readFile(join(capture.directory, "preview-metadata.json"), "utf8")).textParity, capture.metadata.textParity);
    } finally {await capture.cleanup();}
  }, true);
});

test("modo audio integra captura en el mismo navegador y dispone ambos workspaces independientes", async () => {
  await withSource(async (parent, materialized) => {
    const before = await readdir(parent); const adapter = await browserAdapter(materialized.receipt.documentHash, "playback");
    const result = await captureMaterializedConformancePreview({materialized, outputParentDirectory: parent, capturePlaybackAudio: true}, adapter.launch);
    try {
      assert.ok(result.playback); assert.equal(result.playback.receipt.status, "BROWSER_PLAYBACK_CAPTURED");
      assert.equal(result.playback.receipt.playback.sampleCount, 480_000);
      const wav = await readFile(result.playback.audioReferencePath);
      assert.equal(wav.length, 44 + 480_000 * 8);
      assert.equal(createHash("sha256").update(wav).digest("hex"), result.playback.receipt.audioSha256);
      assert.equal(adapter.wasClosed(), true); assert.equal(adapter.wasAudioStopped(), true);
    } finally {await result.cleanup(); await result.cleanup();}
    assert.deepEqual(await readdir(parent), before);
  });
});

test("remote request, wrong runtime hash/time/image, unstable seeks or missing interception cannot emit a capture package", async () => {
  for (const mode of ["external", "hash", "time", "image", "interception", "unstable"] as const) {
    await withSource(async (parent, materialized) => {
      const before = await readdir(parent); const adapter = await browserAdapter(materialized.receipt.documentHash, mode);
      await assert.rejects(captureMaterializedConformancePreview({ materialized, outputParentDirectory: parent }, adapter.launch));
      assert.deepEqual(await readdir(parent), before); assert.equal(adapter.wasClosed(), true);
      if (mode === "external") assert.ok(adapter.calls.some((call) => call.method === "Fetch.failRequest"));
    });
  }
});

test("modified materialized media are rejected before launching the browser", async () => {
  await withSource(async (parent, materialized) => {
    const before = await readdir(parent); const adapter = await browserAdapter(materialized.receipt.documentHash);
    await writeFile(join(materialized.directory, `conformance-media/${identifier}`), "tampered");
    await assert.rejects(captureMaterializedConformancePreview({ materialized, outputParentDirectory: parent }, adapter.launch), /SOURCE_CHANGED/);
    assert.equal(adapter.calls.length, 0); assert.deepEqual(await readdir(parent), before);
  });
});

test("resource close failure rejects the package and cleans already captured files", async () => {
  await withSource(async (parent, materialized) => {
    const before = await readdir(parent); const adapter = await browserAdapter(materialized.receipt.documentHash);
    const launch: typeof launchCompositionQaBrowser = async (options) => {
      const browser = await adapter.launch(options);
      return { ...browser, close: async () => { await browser.close(); throw new Error("controlled close failure"); } };
    };
    await assert.rejects(captureMaterializedConformancePreview({ materialized, outputParentDirectory: parent }, launch), /RESOURCE_CLOSE_FAILED/);
    assert.deepEqual(await readdir(parent), before); assert.equal(adapter.wasClosed(), true);
  });
});
