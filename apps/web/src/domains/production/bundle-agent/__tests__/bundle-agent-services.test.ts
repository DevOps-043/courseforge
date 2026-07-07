import assert from "node:assert/strict";
import { describe, it } from "node:test";
import JSZip from "jszip";
import { buildControlledBundleZip } from "../generation.service";
import { redactSensitiveText } from "../redaction.service";
import { buildSpecFromConversation, computeSpecHash } from "../spec.service";
import { validateGeneratedRemotionBundle } from "../security-validator";

async function zipBuffer(files: Record<string, string>) {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content);
  }
  return zip.generateAsync({ type: "arraybuffer" });
}

describe("SofLIA Bundle Agent services", () => {
  it("redacts API keys and token-like values before persistence", () => {
    const redacted = redactSensitiveText(
      "OPENAI_API_KEY=sk-proj-secret-value password=hunter2 GOOGLE_GENERATIVE_AI_API_KEY=AIzaVerySecretTokenValue123456",
    );

    assert.equal(redacted.includes("sk-proj-secret-value"), false);
    assert.equal(redacted.includes("hunter2"), false);
    assert.equal(redacted.includes("AIzaVerySecretTokenValue123456"), false);
    assert.match(redacted, /OPENAI_API_KEY=\[redacted\]/);
  });

  it("builds a deterministic structured spec from conversation messages", () => {
    const spec = buildSpecFromConversation({
      title: "Curso de ventas consultivas",
      messages: [
        {
          role: "USER",
          content_redacted: "Quiero un template moderno para explicar ventas consultivas con slides y audio.",
        },
      ],
    });

    assert.equal(spec.title, "Curso de ventas consultivas");
    assert.equal(spec.compositionId, "Curso-de-ventas-consultivas");
    assert.deepEqual(spec.requiredAssets, ["slides", "audio"]);
    assert.equal(computeSpecHash(spec), computeSpecHash(spec));
  });

  it("generates a controlled ZIP that passes generated bundle validation", async () => {
    const spec = buildSpecFromConversation({
      title: "Template seguro",
      messages: [{ role: "USER", content_redacted: "Usa motion graphics educativos." }],
    });
    const bundle = await buildControlledBundleZip(spec);
    const report = await validateGeneratedRemotionBundle(bundle.buffer, bundle.originalFileName);

    assert.equal(report.isValid, true);
    assert.equal(report.info.manifest?.compositionId, "Template-seguro");
    assert.match(bundle.hash, /^[a-f0-9]{64}$/);
  });

  it("rejects generated bundles that attempt network or dynamic execution", async () => {
    const buffer = await zipBuffer({
      "courseforge-remotion-template.json": JSON.stringify({
        entryPoint: "src/index.tsx",
        compositionId: "unsafe-template",
        exportMode: "component",
      }),
      "src/index.tsx": "import fs from 'fs'; export default function T(){ fetch('https://example.com'); return null; }",
      "package.json": JSON.stringify({
        dependencies: {
          react: "19.2.3",
          remotion: "4.0.484",
        },
      }),
    });

    const report = await validateGeneratedRemotionBundle(buffer, "unsafe.zip");

    assert.equal(report.isValid, false);
    assert.ok(report.errors.some((error) => error.includes("Import no permitido")));
    assert.ok(report.errors.some((error) => error.includes("fetch")));
    assert.ok(report.errors.some((error) => error.includes("URL remota")));
  });
});
