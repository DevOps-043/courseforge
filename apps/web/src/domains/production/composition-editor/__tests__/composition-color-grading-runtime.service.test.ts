import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  COMPOSITION_COLOR_GRADING_RUNTIME_ARTIFACT,
  COMPOSITION_COLOR_GRADING_RUNTIME_CONTRACT,
  COMPOSITION_COLOR_GRADING_RUNTIME_MAX_BYTES,
  validateCompositionColorGradingRuntimeArtifact,
} from "../composition-color-grading-runtime.service";

function buildManifest(source: string) {
  return JSON.stringify({
    colorGrading: {
      artifacts: { iife: COMPOSITION_COLOR_GRADING_RUNTIME_ARTIFACT },
      bytes: { iife: Buffer.byteLength(source, "utf8") },
      contract: COMPOSITION_COLOR_GRADING_RUNTIME_CONTRACT,
      sha256: {
        iife: createHash("sha256").update(source, "utf8").digest("hex"),
      },
    },
  });
}

test("accepts a bounded runtime with the exact contract, size and hash", () => {
  const source = "window.__hfColorGradingRuntimeContractVersion=1;";
  const result = validateCompositionColorGradingRuntimeArtifact({
    manifestRaw: buildManifest(source),
    source,
  });

  assert.equal(result.bytes, Buffer.byteLength(source, "utf8"));
  assert.equal(result.source, source);
  assert.equal(result.sha256.length, 64);
});

test("fails closed for incompatible, tampered or oversized runtime artifacts", () => {
  const source = "runtime-source";
  const incompatible = JSON.parse(buildManifest(source));
  incompatible.colorGrading.contract.version = 2;
  assert.throws(
    () => validateCompositionColorGradingRuntimeArtifact({ manifestRaw: JSON.stringify(incompatible), source }),
    /no es compatible/,
  );

  assert.throws(
    () => validateCompositionColorGradingRuntimeArtifact({ manifestRaw: buildManifest(source), source: `${source}-tampered` }),
    /hash|tamaño/,
  );

  const oversized = "x".repeat(COMPOSITION_COLOR_GRADING_RUNTIME_MAX_BYTES + 1);
  assert.throws(
    () => validateCompositionColorGradingRuntimeArtifact({ manifestRaw: buildManifest(oversized), source: oversized }),
    /excede el presupuesto/,
  );
});
