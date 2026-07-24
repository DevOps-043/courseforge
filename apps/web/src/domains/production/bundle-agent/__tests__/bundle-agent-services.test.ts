import assert from "node:assert/strict";
import { describe, it } from "node:test";
import JSZip from "jszip";
import { buildControlledBundleZip, buildExternalAuthorBundleBaseZip } from "../generation.service";
import { buildBundleBlueprint } from "../blueprint.service";
import { redactSensitiveText, sanitizeErrorMessage } from "../redaction.service";
import { buildSpecFromConversation, computeSpecHash } from "../spec.service";
import { validateGeneratedRemotionBundle } from "../security-validator";
import { DEFAULT_BUNDLE_AGENT_CREATIVE_BRIEF, bundleAgentMessageMetadataSchema, type BundleAgentSpec } from "../types";

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
    assert.equal(spec.creativeBrief.visualVariants.length, 3);
    assert.equal(spec.creativeBrief.similarityCheck.differentiators.length >= 4, true);
    assert.equal(spec.defaultProps.visualVariantId, spec.creativeBrief.visualVariants[0].id);
    assert.equal(computeSpecHash(spec), computeSpecHash(spec));
  });

  it("infers requested accent colors in deterministic specs", () => {
    const spec = buildSpecFromConversation({
      title: "Nuevo bundle Remotion",
      messages: [
        {
          role: "USER",
          content_redacted: "Crea una plantilla con estilo editorial y acentos azules para destacar puntos clave.",
        },
      ],
    });

    assert.equal(spec.defaultProps.accentColor, "#2563EB");
    assert.equal((spec.defaultProps.designTokens as Record<string, unknown>).accentColor, "#2563EB");
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

  it("builds the proven avatar-left blueprint from explicit bundle requirements", () => {
    const spec = buildSpecFromConversation({
      title: "Nuevo bundle Remotion",
      messages: [
        {
          role: "USER",
          content_redacted: "Avatar totalmente a la izquierda todo el tiempo. Del lado derecho diapositiva arriba y B-roll abajo. No quiero letras.",
        },
      ],
    });
    const blueprint = buildBundleBlueprint(spec);

    assert.equal(blueprint.layout, "avatar-left-slides-broll-right");
    assert.equal(blueprint.timeline, "equal-slides-with-indexed-broll");
    assert.equal(blueprint.renderText, false);
    assert.deepEqual(blueprint.boxes.avatar, { x: 0, y: 0, width: 806, height: 1080 });
    assert.equal(blueprint.editableLayers.some((layer) => layer.layerId === "slides" && layer.defaultBox?.x === 842), true);
    assert.equal(blueprint.editableLayers.some((layer) => layer.layerId === "broll" && layer.defaultBox?.x === 1364), true);
    assert.equal(blueprint.editableLayers.find((layer) => layer.layerId === "avatar")?.capabilities.canReorder, true);
    assert.equal(blueprint.editableLayers.find((layer) => layer.layerId === "slides")?.itemLayerIdPattern, "slide:{index}");
    assert.equal(blueprint.editableLayers.find((layer) => layer.layerId === "broll")?.itemLayerIdPattern, "broll:{order}");
  });

  it("weights the latest user feedback when creating a revised deterministic spec", () => {
    const spec = buildSpecFromConversation({
      title: "Nuevo bundle Remotion",
      messages: [
        {
          role: "USER",
          content_redacted: "Quiero avatar a la izquierda, slides a la derecha y acentos morados.",
        },
        {
          role: "TOOL",
          content_redacted: "Spec estructurada generada por SofLIA.",
        },
        {
          role: "USER",
          content_redacted: "Cambia la nueva version: avatar a la derecha, contenido a la izquierda y acentos azules.",
        },
      ],
    });
    const blueprint = buildBundleBlueprint(spec);

    assert.equal(spec.defaultProps.accentColor, "#2563EB");
    assert.match(spec.visualStyle, /avatar ubicado a la derecha/i);
    assert.match(spec.changeSummary, /avatar a la derecha/i);
    assert.equal(blueprint.layout, "support-left-avatar-right");
    assert.deepEqual(blueprint.boxes.avatar, { x: 1190, y: 0, width: 730, height: 1080 });
    assert.equal(blueprint.boxes.slides.x, 48);
  });

  it("supports a stacked support layout for vertical revision feedback", () => {
    const spec = buildSpecFromConversation({
      title: "Nuevo bundle Remotion",
      messages: [
        {
          role: "USER",
          content_redacted: "Necesito avatar, slides y B-roll con composicion vertical apilada: diapositiva arriba y B-roll abajo.",
        },
      ],
    });
    const blueprint = buildBundleBlueprint(spec);

    assert.equal(blueprint.layout, "stacked-support");
    assert.equal(blueprint.boxes.avatar.width, 691);
    assert.equal(blueprint.boxes.slides.y, 42);
    assert.equal(blueprint.boxes.broll.y, 561);
  });

  it("locks layout and frame color from analyzed wireframe visual references", () => {
    const spec = buildSpecFromConversation({
      title: "Nuevo bundle Remotion",
      messages: [
        {
          role: "USER",
          content_redacted: [
            "Usa la imagen de referencia para tomar estructura y color del marco.",
            "En cada cambio de escena al cambiar la diapositiva, los elementos de izquierda y derecha intercambian lados con transiciones suaves.",
            "Si no hay B-roll o diapositiva, el elemento disponible toma el espacio del otro.",
            "Automatic visual reference analysis: canvas 800x600; dominant frame/border color #DE8D00; strong vertical divider near 50% width; strong horizontal divider near 50% height; wireframe structure: large left region plus right column split into top and bottom regions; map left region to avatar, top-right to slides, bottom-right to B-roll when those assets are requested.",
          ].join("\n"),
        },
      ],
    });
    const blueprint = buildBundleBlueprint(spec);

    assert.equal(spec.creativeBrief.directionName, "Reference Wireframe Lock");
    assert.equal(spec.defaultProps.accentColor, "#DE8D00");
    assert.equal(spec.defaultProps.animationVariant, "scene-swap");
    assert.equal(spec.defaultProps.expandMissingSupportMedia, true);
    assert.equal(spec.defaultProps.sceneSwapOnSlideChange, true);
    assert.equal((spec.defaultProps.designTokens as Record<string, unknown>).backgroundColor, "#DE8D00");
    assert.equal(blueprint.layout, "reference-frame-avatar-left-stack-right");
    assert.deepEqual(blueprint.boxes.avatar, { x: 35, y: 35, width: 923, height: 1010 });
    assert.deepEqual(blueprint.boxes.slides, { x: 962, y: 35, width: 923, height: 503 });
    assert.deepEqual(blueprint.boxes.broll, { x: 962, y: 542, width: 923, height: 503 });
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
    const readme = await zip.file("README.md")!.async("text");
    const propsSchemaProperties = report.info.manifest?.propsSchema?.properties as Record<string, { type?: string }> | undefined;

    assert.equal(report.isValid, true);
    assert.equal(report.info.manifest?.compositionId, "Template-seguro");
    assert.equal(report.info.manifest?.exportMode, "root");
    assert.equal(report.info.manifest?.defaultDurationFrames, 150);
    assert.equal(report.info.manifest?.layoutContractVersion, 2);
    assert.equal(report.info.manifest?.layoutCoordinateSpace, "canvas");
    assert.equal(report.info.manifest?.editableLayers?.find((layer) => layer.layerId === "slides")?.itemLayerIdPattern, "slide:{index}");
    assert.equal(report.info.manifest?.editableLayers?.some((layer) => layer.layerId === "avatar" && layer.defaultBox?.width), true);
    assert.equal(propsSchemaProperties?.avatarVideoUrl?.type, "string");
    assert.equal(propsSchemaProperties?.slides?.type, "array");
    assert.equal(propsSchemaProperties?.brollClips?.type, "array");
    assert.equal(propsSchemaProperties?.animationVariant?.type, "string");
    assert.equal(propsSchemaProperties?.designTokens?.type, "object");
    assert.equal(propsSchemaProperties?.expandMissingSupportMedia?.type, "boolean");
    assert.equal(propsSchemaProperties?.layoutOverrides?.type, "array");
    assert.equal(propsSchemaProperties?.sceneSwapOnSlideChange?.type, "boolean");
    assert.equal(propsSchemaProperties?.totalDurationInFrames?.type, "integer");
    assert.equal(propsSchemaProperties?.visualVariantId?.type, "string");
    assert.match(source, /avatarVideoUrl/);
    assert.match(source, /slides/);
    assert.match(source, /brollClips/);
    assert.match(source, /type DesignTokens/);
    assert.match(source, /animationVariant\?: string/);
    assert.match(source, /visualVariantId\?: string/);
    assert.match(source, /tokenAccent/);
    assert.match(source, /isReferenceFrameLayout/);
    assert.match(source, /sceneSwapOnSlideChange\?: boolean/);
    assert.match(source, /expandMissingSupportMedia\?: boolean/);
    assert.match(source, /mirrorBoxHorizontally/);
    assert.match(source, /buildSceneBox/);
    assert.match(source, /supportUnionBox/);
    assert.match(source, /layoutOverrides\?: LayoutOverrideManifest\[\]/);
    assert.match(source, /REMOTION_EDITABLE_LAYERS/);
    assert.match(source, /buildLayoutOverrideStyle/);
    assert.match(source, /edit\.kind === "stack"/);
    assert.match(source, /style\.zIndex = edit\.order/);
    assert.match(source, /activeSlideItemOverride/);
    assert.match(source, /activeBrollItemOverride/);
    assert.match(source, /defaultStackOrders/);
    assert.match(source, /primaryVisual/);
    assert.match(source, /export const calculateMetadata/);
    assert.match(source, /props\.totalDurationInFrames/);
    assert.match(source, /registerRoot\(RemotionRoot\)/);
    assert.match(source, /<Composition/);
    assert.match(source, /timelineMode === "equal-slides-with-indexed-broll"/);
    assert.doesNotMatch(source, /slides\.length > 0 \? null :/);
    assert.doesNotMatch(source, /transform\s*:/);
    assert.doesNotMatch(source, /style\.transform/);
    assert.doesNotMatch(source, /translate[XYZ]?\(/);
    assert.doesNotMatch(source, /scale\(/);
    assert.doesNotMatch(source, /gridTemplateColumns/);
    assert.match(source, /<Video/);
    assert.match(source, /<Img/);
    assert.match(source, /<Audio/);
    assert.doesNotMatch(source, /Avatar en primera persona/);
    assert.doesNotMatch(source, /Locucion principal activa/);
    assert.doesNotMatch(source, /Direccion visual:/);
    assert.match(bundle.hash, /^[a-f0-9]{64}$/);
    assert.match(readme, /Layout contract: v2/);
    assert.match(readme, /Coordinate space: canvas pixels/);
    assert.match(readme, /slide:\{index\}/);
  });

  it("generates structurally different template sources for different visual intents", async () => {
    const cinematicSpec: BundleAgentSpec = {
      title: "Plantilla cinematica de B-roll",
      description: "Pantalla completa cinematic inmersivo con B-roll de fondo y texto superpuesto.",
      visualStyle: "cinematic inmersivo pantalla completa con zoom y profundidad",
      creativeBrief: {
        ...DEFAULT_BUNDLE_AGENT_CREATIVE_BRIEF,
        directionName: "Cinematic Learning Field",
        layoutSystem: "Media field with full-frame B-roll and compact overlays.",
        motionLanguage: "Kinetic cuts with brief overlay reveals.",
      },
      compositionId: "plantilla-cinematica-broll",
      durationFrames: 180,
      fps: 30,
      width: 1920,
      height: 1080,
      requiredAssets: ["audio", "broll", "captions"],
      propsSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
        },
      },
      defaultProps: {
        title: "Plantilla cinematica de B-roll",
        subtitle: "Texto superpuesto sobre visual inmersivo.",
        accentColor: "#F59E0B",
      },
      changeSummary: "Plantilla cinematica full-screen.",
    };
    const editorialSpec: BundleAgentSpec = {
      title: "Plantilla editorial clara",
      description: "Layout claro editorial para lectura explicativa con slides sin avatar.",
      visualStyle: "claro editorial lectura explicativo con transiciones suaves",
      creativeBrief: {
        ...DEFAULT_BUNDLE_AGENT_CREATIVE_BRIEF,
        directionName: "Editorial Learning Page",
        layoutSystem: "Editorial media layout with a strong reading rail.",
        motionLanguage: "Soft measured transitions and calm support visual holds.",
      },
      compositionId: "plantilla-editorial-clara",
      durationFrames: 180,
      fps: 30,
      width: 1920,
      height: 1080,
      requiredAssets: ["audio", "slides", "captions"],
      propsSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
        },
      },
      defaultProps: {
        title: "Plantilla editorial clara",
        subtitle: "Explicacion guiada con soporte visual.",
        accentColor: "#0F766E",
      },
      changeSummary: "Plantilla editorial clara.",
    };

    const cinematicBundle = await buildControlledBundleZip(cinematicSpec);
    const editorialBundle = await buildControlledBundleZip(editorialSpec);
    const cinematicReport = await validateGeneratedRemotionBundle(cinematicBundle.buffer, cinematicBundle.originalFileName);
    const editorialReport = await validateGeneratedRemotionBundle(editorialBundle.buffer, editorialBundle.originalFileName);
    const cinematicZip = await JSZip.loadAsync(cinematicBundle.buffer);
    const editorialZip = await JSZip.loadAsync(editorialBundle.buffer);
    const cinematicSource = await cinematicZip.file("src/index.tsx")!.async("text");
    const editorialSource = await editorialZip.file("src/index.tsx")!.async("text");

    assert.equal(cinematicReport.isValid, true);
    assert.equal(editorialReport.isValid, true);
    assert.notEqual(cinematicSource, editorialSource);
    assert.match(cinematicSource, /const layoutMode = "media-only"/);
    assert.match(cinematicSource, /const timelineMode = "equal-support-visuals"/);
    assert.match(editorialSource, /const layoutMode = "media-only"/);
    assert.match(editorialSource, /const timelineMode = "equal-support-visuals"/);
  });

  it("generates a downloadable base ZIP that passes bundle validation", async () => {
    const bundle = await buildExternalAuthorBundleBaseZip();
    const report = await validateGeneratedRemotionBundle(bundle.buffer, bundle.originalFileName);
    const zip = await JSZip.loadAsync(bundle.buffer);
    const source = await zip.file("src/index.tsx")!.async("text");
    const readme = await zip.file("README.md")!.async("text");

    assert.equal(report.isValid, true);
    assert.equal(report.info.manifest?.compositionId, "soflia-engine-template-base");
    assert.equal(report.info.manifest?.exportMode, "root");
    assert.equal(report.info.manifest?.layoutCoordinateSpace, "canvas");
    assert.equal(bundle.originalFileName, "soflia-engine-video-template-base.zip");
    assert.match(readme, /Layout contract: v2/);
    assert.doesNotMatch(source, /transform\s*:/);
    assert.doesNotMatch(source, /translate[XYZ]?\(/);
    assert.doesNotMatch(source, /scale\(/);
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
