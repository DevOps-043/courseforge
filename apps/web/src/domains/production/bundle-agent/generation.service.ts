import crypto from "crypto";
import JSZip from "jszip";
import type { BundleAgentSpec } from "./types";

function escapeString(value: string): string {
  return JSON.stringify(value);
}

function buildTemplateSource(spec: BundleAgentSpec): string {
  return `import React from "react";
import { AbsoluteFill, Audio, Img, Video, interpolate, useCurrentFrame, useVideoConfig, type CalculateMetadataFunction } from "remotion";

type SlideAsset = {
  index?: number;
  url: string;
};

type BrollClip = {
  durationInFrames?: number;
  order?: number;
  url: string;
};

type TemplateProps = {
  accentColor?: string;
  avatarVideoUrl?: string;
  bgMusicUrl?: string;
  bgMusicVolume?: number;
  brollClips?: BrollClip[];
  slides?: SlideAsset[];
  subtitle?: string;
  title?: string;
  totalDurationInFrames?: number;
  voiceAudioUrl?: string;
};

const defaultAccentColor = ${escapeString(String(spec.defaultProps.accentColor || "#5B21B6"))};
const defaultSubtitle = ${escapeString(String(spec.defaultProps.subtitle || "Video educativo con ritmo visual claro."))};
const fallbackDurationInFrames = ${Number.isFinite(spec.durationFrames) ? spec.durationFrames : 150};
const fallbackFps = ${Number.isFinite(spec.fps) ? spec.fps : 30};
const compositionWidth = ${Number.isFinite(spec.width) ? spec.width : 1920};
const compositionHeight = ${Number.isFinite(spec.height) ? spec.height : 1080};

function cleanDisplayText(value: unknown, fallback: string, maxLength = 160) {
  if (typeof value !== "string") return fallback;
  const compact = value.replace(/\\s+/g, " ").trim();
  if (!compact) return fallback;

  const normalized = compact.toLowerCase();
  const blockedFragments = [
    "avatarvideourl",
    "brollclips",
    "defaultprops",
    "direccion visual",
    "locucion principal",
    "objetivo:",
    "propsschema",
    "remotion",
    "voiceaudiourl",
  ];

  if (blockedFragments.some((fragment) => normalized.includes(fragment))) {
    return fallback;
  }

  return compact.slice(0, maxLength);
}

function orderedSlides(slides: SlideAsset[] = []) {
  return slides
    .filter((slide) => typeof slide.url === "string" && slide.url.length > 0)
    .sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
}

function orderedBrollClips(clips: BrollClip[] = []) {
  return clips
    .filter((clip) => typeof clip.url === "string" && clip.url.length > 0)
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
}

function getActiveSlide(frame: number, slides: SlideAsset[], durationInFrames: number) {
  if (slides.length === 0) return null;
  const framesPerSlide = Math.max(1, Math.floor(durationInFrames / slides.length));
  const index = Math.min(slides.length - 1, Math.floor(frame / framesPerSlide));
  return slides[index];
}

function getActiveBrollClip(frame: number, clips: BrollClip[]) {
  if (clips.length === 0) return null;
  let cursor = 0;
  for (const clip of clips) {
    const duration = Math.max(1, Math.round(clip.durationInFrames || 90));
    if (frame >= cursor && frame < cursor + duration) {
      return clip;
    }
    cursor += duration;
  }
  return clips[clips.length - 1];
}

export const calculateMetadata: CalculateMetadataFunction<TemplateProps> = ({ props }) => {
  const resolvedDuration = typeof props.totalDurationInFrames === "number" && Number.isFinite(props.totalDurationInFrames)
    ? Math.max(1, Math.round(props.totalDurationInFrames))
    : fallbackDurationInFrames;

  return {
    durationInFrames: resolvedDuration,
    fps: fallbackFps,
    props,
  };
};

export default function SofliaGeneratedTemplate(props: TemplateProps) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const progress = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const title = cleanDisplayText(props.title, ${escapeString(spec.title)}, 96);
  const subtitle = cleanDisplayText(props.subtitle, defaultSubtitle, 160);
  const accentColor = props.accentColor || defaultAccentColor;
  const slides = orderedSlides(props.slides);
  const brollClips = orderedBrollClips(props.brollClips);
  const activeSlide = getActiveSlide(frame, slides, durationInFrames);
  const activeBroll = slides.length > 0 ? null : getActiveBrollClip(frame, brollClips);
  const hasAvatar = typeof props.avatarVideoUrl === "string" && props.avatarVideoUrl.length > 0;
  const hasVoice = typeof props.voiceAudioUrl === "string" && props.voiceAudioUrl.length > 0;
  const hasSupportVisual = Boolean(activeSlide || activeBroll);
  const panelIn = interpolate(frame, [0, 36], [-80, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const contentIn = interpolate(frame, [18, 54], [140, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(135deg, #09090f 0%, #151022 48%, #2e1065 100%)",
        color: "white",
        fontFamily: "Inter, Arial, sans-serif",
        padding: 72,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 44,
          height: "100%",
          alignItems: "stretch",
        }}
      >
        <section
          style={{
            border: \`2px solid \${accentColor}\`,
            borderRadius: 28,
            background: "linear-gradient(180deg, rgba(91,33,182,0.26), rgba(12,10,18,0.9))",
            boxShadow: \`0 28px 80px rgba(0,0,0,0.34), inset 0 0 48px \${accentColor}44\`,
            padding: 48,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            transform: \`translateX(\${panelIn}px)\`,
            opacity: interpolate(frame, [0, 24], [0, 1], { extrapolateRight: "clamp" }),
          }}
        >
          {hasAvatar ? (
            <div style={{ flex: 1, minHeight: 0, borderRadius: 28, overflow: "hidden", background: "rgba(0,0,0,0.24)" }}>
              <Video
                src={props.avatarVideoUrl!}
                muted={hasVoice}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            </div>
          ) : (
            <div
              style={{
                height: 520,
                borderRadius: 260,
                background: \`radial-gradient(circle at 50% 32%, rgba(255,255,255,0.28), \${accentColor} 38%, rgba(12,10,18,0.2) 68%)\`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            />
          )}
        </section>

        <section
          style={{
            borderRadius: 28,
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.18)",
            padding: 56,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            transform: \`translateX(\${contentIn}px)\`,
            opacity: interpolate(frame, [18, 54], [0, 1], { extrapolateRight: "clamp" }),
          }}
        >
          <div style={{ width: 120, height: 8, borderRadius: 999, background: accentColor, marginBottom: 36 }} />
          {activeSlide ? (
            <Img src={activeSlide.url} style={{ width: "100%", height: "58%", objectFit: "contain", borderRadius: 20, background: "rgba(0,0,0,0.24)" }} />
          ) : activeBroll ? (
            <Video src={activeBroll.url} muted style={{ width: "100%", height: "58%", objectFit: "cover", borderRadius: 20, background: "rgba(0,0,0,0.24)" }} />
          ) : (
            <>
              <h1 style={{ fontSize: 78, lineHeight: 1.02, margin: 0, letterSpacing: 0 }}>{title}</h1>
              <p style={{ fontSize: 34, lineHeight: 1.28, marginTop: 30, color: "rgba(255,255,255,0.9)" }}>{subtitle}</p>
            </>
          )}
          {hasSupportVisual ? (
            <div style={{ marginTop: 26, borderRadius: 18, background: "rgba(0,0,0,0.38)", padding: "18px 22px", fontSize: 26, lineHeight: 1.28, color: "white" }}>
              {subtitle}
            </div>
          ) : null}
          <div
            style={{
              height: 8,
              width: "100%",
              background: "rgba(255,255,255,0.18)",
              borderRadius: 999,
              overflow: "hidden",
              marginTop: 44,
            }}
          >
            <div
              style={{
                height: "100%",
                width: \`\${Math.round(progress * 100)}%\`,
                background: accentColor,
              }}
            />
          </div>
        </section>
      </div>
      {hasVoice ? <Audio src={props.voiceAudioUrl!} /> : null}
      {props.bgMusicUrl ? <Audio src={props.bgMusicUrl} volume={props.bgMusicVolume ?? 0.15} /> : null}
    </AbsoluteFill>
  );
}
`;
}

function mergeCanonicalPropsSchema(spec: BundleAgentSpec) {
  return {
    ...spec.propsSchema,
    type: "object" as const,
    properties: {
      ...(spec.propsSchema.properties || {}),
      accentColor: { type: "string", description: "Color de acento para subrayados, bordes y progreso." },
      avatarVideoUrl: { type: "string", description: "URL publica del video de avatar/talking head." },
      bgMusicUrl: { type: "string", description: "URL publica de musica de fondo." },
      bgMusicVolume: { type: "number", description: "Volumen relativo de musica de fondo entre 0 y 1." },
      brollClips: { type: "array", description: "Clips B-roll normalizados por Courseforge." },
      slides: { type: "array", description: "Slides renderizables normalizadas por Courseforge." },
      subtitle: { type: "string", description: "Subtitulo o texto narrativo corto en pantalla." },
      title: { type: "string", description: "Titulo principal de la leccion o composicion." },
      totalDurationInFrames: { type: "integer", description: "Duracion total resuelta para el render." },
      voiceAudioUrl: { type: "string", description: "URL publica de la locucion principal." },
    },
  };
}

function mergeCanonicalDefaultProps(spec: BundleAgentSpec) {
  return {
    ...spec.defaultProps,
    bgMusicVolume: typeof spec.defaultProps.bgMusicVolume === "number" ? spec.defaultProps.bgMusicVolume : 0.15,
    brollClips: Array.isArray(spec.defaultProps.brollClips) ? spec.defaultProps.brollClips : [],
    slides: Array.isArray(spec.defaultProps.slides) ? spec.defaultProps.slides : [],
  };
}

function buildManifest(spec: BundleAgentSpec) {
  return {
    name: spec.title,
    entryPoint: "src/index.tsx",
    compositionId: spec.compositionId,
    exportMode: "component",
    defaultDurationFrames: spec.durationFrames,
    fps: spec.fps,
    width: spec.width,
    height: spec.height,
    propsSchema: mergeCanonicalPropsSchema(spec),
    defaultProps: mergeCanonicalDefaultProps(spec),
    remotionVersion: "4.0.484",
  };
}

export function buildBaseBundleSpec(): BundleAgentSpec {
  return {
    title: "Courseforge Remotion Template Base",
    description: "Base segura para crear un bundle Remotion externo compatible con Courseforge.",
    visualStyle: "estructura base con avatar, contenido lateral, subtitulos blancos y acentos configurables",
    compositionId: "courseforge-template-base",
    durationFrames: 150,
    fps: 30,
    width: 1920,
    height: 1080,
    requiredAssets: ["audio", "slides", "avatar", "broll", "captions"],
    propsSchema: {
      type: "object",
      required: ["title"],
      properties: {
        title: { type: "string", description: "Titulo principal de la leccion o composicion." },
        subtitle: { type: "string", description: "Subtitulo o texto narrativo corto en pantalla." },
        accentColor: { type: "string", description: "Color de acento para subrayados, bordes y progreso." },
      },
    },
    defaultProps: {
      title: "Courseforge Remotion Template Base",
      subtitle: "Reemplaza este texto con el contenido de tu leccion.",
      accentColor: "#5B21B6",
    },
    changeSummary: "Base externa descargable para autores de bundles Remotion.",
  };
}

export async function buildControlledBundleZip(spec: BundleAgentSpec): Promise<{
  buffer: ArrayBuffer;
  hash: string;
  originalFileName: string;
}> {
  const zip = new JSZip();
  zip.file("courseforge-remotion-template.json", JSON.stringify(buildManifest(spec), null, 2));
  zip.file("src/index.tsx", buildTemplateSource(spec));
  zip.file("package.json", JSON.stringify({
    private: true,
    dependencies: {
      react: "19.2.3",
      "react-dom": "19.2.3",
      remotion: "4.0.484",
    },
  }, null, 2));
  zip.file("README.md", `# ${spec.title}\n\nGenerated by SofLIA Bundle Agent as a non-approved draft bundle.\n`);

  const buffer = await zip.generateAsync({ type: "arraybuffer" });
  const hash = crypto.createHash("sha256").update(Buffer.from(buffer)).digest("hex");

  return {
    buffer,
    hash,
    originalFileName: `${spec.compositionId}.zip`,
  };
}

export async function buildExternalAuthorBundleBaseZip(): Promise<{
  buffer: ArrayBuffer;
  hash: string;
  originalFileName: string;
}> {
  const spec = buildBaseBundleSpec();
  const zip = new JSZip();
  zip.file("courseforge-remotion-template.json", JSON.stringify(buildManifest(spec), null, 2));
  zip.file("src/index.tsx", buildTemplateSource(spec));
  zip.file("package.json", JSON.stringify({
    private: true,
    dependencies: {
      react: "19.2.3",
      "react-dom": "19.2.3",
      remotion: "4.0.484",
    },
  }, null, 2));
  zip.file("README.md", `# Courseforge Remotion Template Base

Este ZIP contiene la estructura minima aceptada por Courseforge para un bundle Remotion externo.

Archivos obligatorios:
- courseforge-remotion-template.json
- src/index.tsx
- package.json

Reglas importantes:
- No agregues node_modules al ZIP.
- No agregues scripts lifecycle en package.json.
- Usa solo dependencias permitidas por Courseforge.
- No uses fs, path, child_process, process, eval, Function, fetch, XMLHttpRequest ni WebSocket.
- No incluyas secretos, tokens, credenciales ni URLs remotas hardcodeadas.
- Todo bundle subido debe pasar validacion, revision humana y build cloud antes de preview/render productivo.
`);

  const buffer = await zip.generateAsync({ type: "arraybuffer" });
  const hash = crypto.createHash("sha256").update(Buffer.from(buffer)).digest("hex");

  return {
    buffer,
    hash,
    originalFileName: "courseforge-remotion-template-base.zip",
  };
}
