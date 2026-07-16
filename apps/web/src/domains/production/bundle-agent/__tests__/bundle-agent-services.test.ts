import assert from "node:assert/strict";
import { describe, it } from "node:test";
import JSZip from "jszip";
import { buildControlledBundleZip, buildExternalAuthorBundleBaseZip } from "../generation.service";
import { redactSensitiveText, sanitizeErrorMessage } from "../redaction.service";
import { buildSpecFromConversation, computeSpecHash } from "../spec.service";
import { validateGeneratedRemotionBundle } from "../security-validator";
import { bundleAgentMessageMetadataSchema } from "../types";

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

  it("formats Supabase-like errors without leaking object placeholders", () => {
    const message = sanitizeErrorMessage({
      message: 'relation "public.soflia_bundle_conversations" does not exist',
      code: "42P01",
      hint: "Check the active database schema.",
    });

    assert.equal(message.includes("[object Object]"), false);
    assert.match(message, /soflia_bundle_conversations/);
    assert.match(message, /20260707120000_create_soflia_bundle_agent/);
  });

  it("accepts bounded visual references in message metadata", () => {
    const metadata = bundleAgentMessageMetadataSchema.parse({
      visualReferences: [
        {
          id: "reference-1",
          type: "image",
          fileName: "layout-reference.png",
          mimeType: "image/png",
          sizeBytes: 128_000,
          storagePath: "organizations/org-1/bundle-agent-references/reference-1/layout-reference.png",
          publicUrl: "https://example.com/layout-reference.png",
          note: "Usar como referencia de composicion y contraste.",
        },
      ],
    });

    assert.equal(metadata.visualReferences?.[0]?.type, "image");
    assert.equal(metadata.visualReferences?.[0]?.note, "Usar como referencia de composicion y contraste.");
  });

  it("rejects oversized visual reference metadata payloads", () => {
    assert.throws(() => bundleAgentMessageMetadataSchema.parse({
      visualReferences: Array.from({ length: 7 }, (_, index) => ({
        id: `reference-${index}`,
        type: "image",
        fileName: `reference-${index}.png`,
        mimeType: "image/png",
        sizeBytes: 1000,
        storagePath: `organizations/org-1/bundle-agent-references/reference-${index}/reference.png`,
      })),
    }));
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
    assert.deepEqual(spec.requiredAssets, ["audio", "slides"]);
    assert.equal(computeSpecHash(spec), computeSpecHash(spec));
  });

  it("infers a descriptive spec for avatar, slides and b-roll requests", () => {
    const spec = buildSpecFromConversation({
      title: "Nuevo bundle Remotion",
      messages: [
        {
          role: "USER",
          content_redacted: `Necesito que generes una plantilla acorde a las siguientes especificaciones:
- Debe tener animaciones de transicion suaves, preferentemente siempre de izquierda a derecha.
- Quiero que mi avatar siempre este en primera persona en toda la pantalla.
- Posteriormente cuando se muestre una diapositiva o un b-roll, que la gente tome la mitad de la pantalla izquierda y que la diapositiva o el b-roll tome la posicion derecha.
- Quiero que los colores principales de subrayados, contornos y demas sean de un color morado elegante o un morado oscuro.
- Mientras que las letras de los subtitulos sean blancas.`,
        },
      ],
    });

    assert.equal(spec.title, "Plantilla avatar inmersivo con slides y B-roll");
    assert.equal(spec.compositionId, "Plantilla-avatar-inmersivo-con-slides-y-B-roll");
    assert.deepEqual(spec.requiredAssets, ["audio", "slides", "avatar", "broll", "captions"]);
    assert.match(spec.description, /transicion suaves/i);
    assert.match(spec.visualStyle, /morado/i);
    assert.equal(spec.defaultProps.accentColor, "#5B21B6");
    assert.equal(spec.defaultProps.subtitle, "Video educativo con avatar, diapositivas, B-roll, subtitulos claros.");
    assert.doesNotMatch(String(spec.defaultProps.subtitle), /Debe tener|avatarVideoUrl|Remotion/i);
  });

  it("generates a controlled ZIP that passes generated bundle validation", async () => {
    const spec = buildSpecFromConversation({
      title: "Template seguro",
      messages: [{ role: "USER", content_redacted: "Usa motion graphics educativos." }],
    });
    const bundle = await buildControlledBundleZip(spec);
    const report = await validateGeneratedRemotionBundle(bundle.buffer, bundle.originalFileName);
    const zip = await JSZip.loadAsync(bundle.buffer);
    const source = await zip.file("src/index.tsx")!.async("text");
    const propsSchemaProperties = report.info.manifest?.propsSchema?.properties as Record<string, { type?: string }> | undefined;

    assert.equal(report.isValid, true);
    assert.equal(report.info.manifest?.compositionId, "Template-seguro");
    assert.equal(report.info.manifest?.exportMode, "component");
    assert.equal(report.info.manifest?.defaultDurationFrames, 150);
    assert.equal(propsSchemaProperties?.avatarVideoUrl?.type, "string");
    assert.equal(propsSchemaProperties?.slides?.type, "array");
    assert.equal(propsSchemaProperties?.brollClips?.type, "array");
    assert.equal(propsSchemaProperties?.totalDurationInFrames?.type, "integer");
    assert.match(source, /avatarVideoUrl/);
    assert.match(source, /slides/);
    assert.match(source, /brollClips/);
    assert.match(source, /export const calculateMetadata/);
    assert.match(source, /props\.totalDurationInFrames/);
    assert.match(source, /@remotion\/media-utils/);
    assert.match(source, /getVideoMetadata/);
    assert.match(source, /buildSupportVisualSequence/);
    assert.match(source, /activeVisual\?\.type === "broll"/);
    assert.doesNotMatch(source, /slides\.length > 0 \? null :/);
    assert.doesNotMatch(source, /<Composition/);
    assert.match(source, /<Video/);
    assert.match(source, /<Img/);
    assert.match(source, /<Audio/);
    assert.doesNotMatch(source, /Avatar en primera persona/);
    assert.doesNotMatch(source, /Locucion principal activa/);
    assert.doesNotMatch(source, /Direccion visual:/);
    assert.match(bundle.hash, /^[a-f0-9]{64}$/);
  });

  it("generates a downloadable base ZIP that passes bundle validation", async () => {
    const bundle = await buildExternalAuthorBundleBaseZip();
    const report = await validateGeneratedRemotionBundle(bundle.buffer, bundle.originalFileName);

    assert.equal(report.isValid, true);
    assert.equal(report.info.manifest?.compositionId, "courseforge-template-base");
    assert.equal(report.info.manifest?.exportMode, "component");
    assert.equal(bundle.originalFileName, "courseforge-remotion-template-base.zip");
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
