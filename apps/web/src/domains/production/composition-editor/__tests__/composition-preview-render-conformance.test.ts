import assert from "node:assert/strict";
import test from "node:test";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { applyCompositionEditorPatches } from "../editor-patch.service";
import {
  buildCompositionConformanceContract,
  compositionConformanceContractSchema,
  evaluateCompositionConformance,
  measureCompositionConformanceTemporalDriftMs,
  resolveSnapshotConformanceContractVersion,
} from "../composition-preview-render-conformance";
import { createTransitionDocument } from "./composition-transition-test-fixtures";

test("builds deterministic bounded checkpoints tied to document, assets and render profile", () => {
  const document = createTransitionDocument();
  const input = {
    assets: [
      { checksum: "b".repeat(64), id: "asset-b" },
      { checksum: "a".repeat(64), id: "asset-a" },
    ],
    document,
    documentHash: "c".repeat(64),
    renderProfile: { format: "mp4" as const, fps: 25 as const, quality: "high" as const, resolution: "1080p" as const },
  };
  const first = buildCompositionConformanceContract(input);
  const second = buildCompositionConformanceContract(input);

  assert.deepEqual(first, second);
  assert.deepEqual(first.assets.map((asset) => asset.id), ["asset-a", "asset-b"]);
  assert.equal(first.schemaVersion, 2);
  if (first.schemaVersion !== 2) throw new Error("Expected v2 contract.");
  assert.deepEqual(first.audio, { required: true });
  const legacyContract = { ...first, schemaVersion: 1 } as Record<string, unknown>;
  delete legacyContract.audio;
  assert.equal(compositionConformanceContractSchema.parse(legacyContract).schemaVersion, 1);
  assert.equal(compositionConformanceContractSchema.safeParse({ ...first, audio: undefined }).success, false);
  assert.deepEqual(buildCompositionConformanceContract({ ...input, contractVersion: 1 }), legacyContract);
  assert.equal(resolveSnapshotConformanceContractVersion(undefined), 1);
  assert.equal(resolveSnapshotConformanceContractVersion("TRUE"), 1);
  assert.equal(resolveSnapshotConformanceContractVersion("true"), 2);
  assert.ok(first.checkpoints.length > 2 && first.checkpoints.length <= 48);
  assert.equal(first.checkpoints[0]?.frameIndex, 0);
  assert.equal(first.checkpoints.at(-1)?.frameIndex, Math.ceil(document.canvas.durationSeconds * document.canvas.fps) - 1);
});

test("freezes audio presence only for clips with an audible source and nonzero gain", () => {
  const document = createTransitionDocument();
  const renderProfile = { format: "mp4" as const, fps: 25 as const, quality: "high" as const, resolution: "1080p" as const };
  const build = () => buildCompositionConformanceContract({ assets: [], contractVersion: 2, document, documentHash: "a".repeat(64), renderProfile });
  const audioRequired = () => {
    const contract = build();
    if (contract.schemaVersion !== 2) throw new Error("Expected v2 contract.");
    return contract.audio.required;
  };
  assert.equal(audioRequired(), true);
  document.clips.forEach((clip) => { clip.volume = 0; });
  assert.equal(audioRequired(), false);
  document.clips[0]!.volume = 1;
  document.tracks.find((track) => track.id === document.clips[0]!.trackId)!.muted = true;
  assert.equal(audioRequired(), false);
});

test("detects when both targets seek to the same incorrect frame", () => {
  const driftMs = measureCompositionConformanceTemporalDriftMs({
    expectedSeconds: 2,
    previewSeconds: 2.04,
    renderSeconds: 2.04,
  });
  assert.ok(Math.abs(driftMs - 40) < 0.001);
  const contract = buildCompositionConformanceContract({
    assets: [],
    document: createTransitionDocument(),
    documentHash: "c".repeat(64),
    renderProfile: { format: "mp4", fps: 25, quality: "high", resolution: "1080p" },
  });
  const samples = contract.checkpoints.map(({ frameIndex }) => ({
    frameIndex,
    meanAbsoluteError: 0,
    mismatchedPixelRatio: 0,
    psnrDb: 99,
    temporalDriftMs: driftMs,
  }));
  const report = evaluateCompositionConformance({
    contract,
    previewDocumentHash: contract.documentHash,
    renderDocumentHash: contract.documentHash,
    samples,
  });
  assert.equal(report.status, "FAIL");
  assert.ok(report.failures.every((failure) => failure.metric === "temporal_drift_frames"));
});

test("mide la frontera y el interior de la congelación del último frame", () => {
  const previousFlag = process.env.NEXT_PUBLIC_COMPOSITION_VIDEO_FREEZE;
  process.env.NEXT_PUBLIC_COMPOSITION_VIDEO_FREEZE = "true";
  try {
    const document = createInitialCompositionDocument({
      animatedDeck: null,
      assets: [{ checksum: "a".repeat(64), durationSeconds: 2, fileSizeBytes: 42, hasAudio: false, mimeType: "video/mp4", productionAssetId: "55555555-5555-4555-8555-555555555557", publicUrl: null, storageBucket: "production-assets", storagePath: "production-assets/freeze.mp4", timelineRole: "BROLL" }],
      plan: { accentColor: "#38BDF8", durationSeconds: 3, subtitle: "Prueba", title: "Freeze" },
    });
    const video = document.clips.find((clip) => clip.kind === "VIDEO")!;
    document.canvas.durationSeconds = 3;
    video.durationSeconds = 3;
    const frozen = applyCompositionEditorPatches(document, [{ clipId: video.id, enabled: true, type: "clip.freeze-tail" }]);
    const contract = buildCompositionConformanceContract({
      assets: [{ checksum: "a".repeat(64), id: "55555555-5555-4555-8555-555555555557" }],
      document: frozen,
      documentHash: "b".repeat(64),
      renderProfile: { format: "mp4", fps: document.canvas.fps, quality: "high", resolution: "1080p" },
    });
    const reasons = new Set(contract.checkpoints.flatMap((checkpoint) => checkpoint.reasons));
    for (const reason of ["freeze-before-source-end", "freeze-source-end", "freeze-tail-midpoint", "freeze-tail-last-frame"]) {
      assert.ok(reasons.has(`${reason}:${video.id}`), `${reason} debe incluirse en la captura visual.`);
    }
    assert.equal(contract.checkpoints.find((checkpoint) => checkpoint.reasons.includes(`freeze-source-end:${video.id}`))?.frameIndex, 2 * document.canvas.fps);
    assert.equal(contract.checkpoints.find((checkpoint) => checkpoint.reasons.includes(`freeze-tail-midpoint:${video.id}`))?.frameIndex, Math.round(2.5 * document.canvas.fps));

    const crowded = structuredClone(frozen);
    crowded.canvas.durationSeconds = 60;
    crowded.clips = Array.from({ length: 20 }, (_, index) => ({
      ...structuredClone(video),
      durationSeconds: 3,
      freezeTailSeconds: 1,
      hfId: `freeze-hf-${index}`,
      id: `freeze-${index}`,
      startSeconds: index * 3,
    }));
    const crowdedContract = buildCompositionConformanceContract({
      assets: [], document: crowded, documentHash: "c".repeat(64),
      renderProfile: { format: "mp4", fps: document.canvas.fps, quality: "high", resolution: "1080p" },
    });
    assert.equal(crowdedContract.checkpoints.length, 48);
    assert.equal(crowdedContract.checkpoints[0]?.frameIndex, 0);
    assert.equal(crowdedContract.checkpoints.at(-1)?.frameIndex, 60 * document.canvas.fps - 1);
    assert.ok(crowdedContract.checkpoints.some((checkpoint) => checkpoint.reasons.some((reason) => reason.startsWith("freeze-"))));
  } finally {
    if (previousFlag === undefined) delete process.env.NEXT_PUBLIC_COMPOSITION_VIDEO_FREEZE;
    else process.env.NEXT_PUBLIC_COMPOSITION_VIDEO_FREEZE = previousFlag;
  }
});

test("passes complete measurements within tolerance and fails identity or pixel drift", () => {
  const contract = buildCompositionConformanceContract({
    assets: [],
    document: createTransitionDocument(),
    documentHash: "c".repeat(64),
    renderProfile: { format: "mp4", fps: 25, quality: "high", resolution: "1080p" },
  });
  const passingSamples = contract.checkpoints.map(({ frameIndex }) => ({
    frameIndex,
    meanAbsoluteError: 0.1,
    mismatchedPixelRatio: 0.0001,
    psnrDb: 60,
    temporalDriftMs: 1,
  }));
  const passing = evaluateCompositionConformance({
    contract,
    previewDocumentHash: contract.documentHash,
    renderDocumentHash: contract.documentHash,
    samples: passingSamples,
  });
  assert.equal(passing.status, "PASS");
  assert.deepEqual(passing.observed, {
    maxMeanAbsoluteError: 0.1,
    maxMismatchedPixelRatio: 0.0001,
    maxTemporalDriftFrames: 0.025,
    minPsnrDb: 60,
  });

  const failed = evaluateCompositionConformance({
    contract,
    previewDocumentHash: "d".repeat(64),
    renderDocumentHash: contract.documentHash,
    samples: passingSamples.map((sample, index) => index === 0 ? { ...sample, mismatchedPixelRatio: 0.1 } : sample),
  });
  assert.equal(failed.status, "FAIL");
  assert.deepEqual(new Set(failed.failures.map((failure) => failure.metric)), new Set(["preview_document_hash", "mismatched_pixel_ratio"]));
  const incomplete = evaluateCompositionConformance({
    contract,
    previewDocumentHash: contract.documentHash,
    renderDocumentHash: contract.documentHash,
    samples: [],
  });
  assert.equal(incomplete.status, "INCOMPLETE");
  assert.equal(incomplete.observed.maxTemporalDriftFrames, null);

  const malformed = evaluateCompositionConformance({
    contract,
    previewDocumentHash: contract.documentHash,
    renderDocumentHash: contract.documentHash,
    samples: [
      { ...passingSamples[0]!, meanAbsoluteError: Number.NaN },
      ...passingSamples.slice(1),
    ],
  });
  assert.equal(malformed.status, "INCOMPLETE");
  assert.ok(malformed.failures.some((failure) => failure.metric === "invalid_sample"));
  const duplicate = evaluateCompositionConformance({
    contract,
    previewDocumentHash: contract.documentHash,
    renderDocumentHash: contract.documentHash,
    samples: [...passingSamples, passingSamples[0]!],
  });
  assert.equal(duplicate.status, "FAIL");
  assert.ok(duplicate.failures.some((failure) => failure.metric === "duplicate_sample"));
});
