/**
 * Remotion Template — Advanced Multi-Scene v2
 * compositionId: advanced-multi-scene-v2
 *
 * Canvas: 1920×1080 @ 30 fps
 *
 * Fixes over v1:
 *  - calculateMetadata: deriva la duración real del video de avatar
 *  - SlideStage: crossfade real vía opacidad superpuesta (no Series)
 *  - BrollPip: reposicionado a la zona superior-derecha (y 360-705)
 *  - Subtítulos: cobertura continua, z-index explícito, fondo sólido
 *  - AvatarPip: z-index explícito sobre B-roll
 */

import React from "react";
import {
  AbsoluteFill,
  type CalculateMetadataFunction,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { getVideoMetadata } from "@remotion/media-utils";

// ─── LAYOUT CONSTANTS ────────────────────────────────────────────────────────

const W = 1920;
const H = 1080;
const MARGIN = 116;

const SUB_BOTTOM = 54;
const SUB_HEIGHT = 90;
const AVATAR_SAFE_BOTTOM = SUB_BOTTOM + SUB_HEIGHT + 16; // 160 px from canvas bottom

// Slide stage: y 340 → 890 (clear of subtitle zone below)
const STAGE_TOP = 340;
const STAGE_BOTTOM_OFFSET = AVATAR_SAFE_BOTTOM + 30; // 190 px

// Cross-fade frames between slides
const CROSS = 18;
// Minimum frames per slide (10 seconds)
const MIN_SLIDE_FRAMES = 300;

// ─── TYPES ───────────────────────────────────────────────────────────────────

type Slide = { index: number; url: string };
type BrollClip = { url: string; durationInFrames: number; order: number };

export type TemplateProps = {
  slides?: Slide[];
  brollClips?: BrollClip[];
  avatarVideoUrl?: string;
  /** Fallback duration (frames) when calculateMetadata cannot fetch video duration. */
  totalDurationInFrames?: number;
};

type AvatarRect = { left: number; top: number; width: number; height: number };
type SceneDef = {
  index: number;
  accent: string;
  eyebrow: string;
  title: string;
  body: string;
  subtitleA: string;
  subtitleB: string;
  avatar: AvatarRect;
};

// ─── calculateMetadata ────────────────────────────────────────────────────────
// Runs server-side in the Remotion renderer to set the correct composition
// duration from the actual avatar video length, overriding the static default.

export const calculateMetadata: CalculateMetadataFunction<TemplateProps> = async ({
  props,
}) => {
  if (props.avatarVideoUrl) {
    try {
      const { durationInSeconds } = await getVideoMetadata(props.avatarVideoUrl);
      if (durationInSeconds > 0) {
        console.log(`[calculateMetadata] avatar duration: ${durationInSeconds}s → ${Math.ceil(durationInSeconds * 30)} frames`);
        return { durationInFrames: Math.ceil(durationInSeconds * 30), fps: 30 };
      }
    } catch (err) {
      console.warn("[calculateMetadata] getVideoMetadata failed, using static durationInFrames:", err);
    }
  }
  return {};
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function avatarRect(
  corner: "bottom-right" | "bottom-left" | "top-right" | "top-left",
  widthFraction: number,
): AvatarRect {
  const margin = 48;
  const width = Math.round(W * widthFraction);
  const height = Math.round((width * 9) / 16);
  const isLeft = corner.endsWith("left");
  const isTop = corner.startsWith("top");
  return {
    left: isLeft ? margin : W - margin - width,
    top: isTop ? 80 : H - AVATAR_SAFE_BOTTOM - height,
    width,
    height,
  };
}

function activeSceneIdx(frame: number, boundaries: number[]): number {
  for (let i = boundaries.length - 1; i >= 0; i--) {
    if (frame >= boundaries[i]) return i;
  }
  return 0;
}

function buildBoundaries(totalFrames: number, n: number): number[] {
  const size = Math.floor(totalFrames / n);
  return Array.from({ length: n }, (_, i) => i * size);
}

// ─── SCENE DEFINITIONS ───────────────────────────────────────────────────────
//
// Layout per scene (1920×1080, all avatar bottoms ≥ y 920 ≥ subtitle zone top y 936):
//
//   Scene 1 — avatar bottom-right 24 %  x 1411–1872, y 661–920   text left ✅
//   Scene 2 — avatar top-right    28 %  x 1334–1872, y  80–382   text left ✅
//   Scene 3 — avatar bottom-left  20 %  x   48–432,  y 704–920   broll upper-right ✅
//   Scene 4 — avatar bottom-right 34 %  x 1219–1872, y 553–920   text left ✅
//
// B-roll PiP (scene 3):  x 1258–1872, y 360–705  → above avatar ✅

const SCENES: SceneDef[] = [
  {
    index: 0,
    accent: "#00D4B3",
    eyebrow: "Escena 01 · Introducción",
    title: "Marco del Tema",
    body: "El avatar acompaña desde la esquina inferior derecha mientras el contenido visual establece el marco inicial del aprendizaje.",
    subtitleA: "Identificamos el problema central que el estudiante debe resolver.",
    subtitleB: "El material visual ocupa el espacio principal; el avatar complementa sin obstruir.",
    avatar: avatarRect("bottom-right", 0.24),
  },
  {
    index: 1,
    accent: "#F4B740",
    eyebrow: "Escena 02 · Ampliación",
    title: "Foco en el Proceso",
    body: "El avatar se desplaza a la esquina superior derecha y crece para guiar la explicación narrativa paso a paso.",
    subtitleA: "El avatar toma más espacio porque este segmento es narrativo y guiado por el presentador.",
    subtitleB: "El cambio de posición y escala señala un cambio de ritmo pedagógico al estudiante.",
    avatar: avatarRect("top-right", 0.28),
  },
  {
    index: 2,
    accent: "#7C6BFF",
    eyebrow: "Escena 03 · Práctica",
    title: "Aplicación Guiada",
    body: "El avatar se reduce a la esquina inferior izquierda. El B-roll contextual aparece arriba a la derecha, sin ningún solapamiento.",
    subtitleA: "En la práctica el estudiante ejecuta pasos breves y verificables en su propio entorno.",
    subtitleB: "El B-roll está arriba a la derecha del avatar — posiciones completamente separadas.",
    avatar: avatarRect("bottom-left", 0.20),
  },
  {
    index: 3,
    accent: "#FF6B6B",
    eyebrow: "Escena 04 · Cierre",
    title: "Criterio de Éxito",
    body: "El avatar regresa a la esquina inferior derecha y crece al máximo para enfatizar el cierre y la evidencia esperada.",
    subtitleA: "Cerramos con el criterio de éxito y la evidencia que el estudiante debe entregar.",
    subtitleB: "Esta plantilla demuestra posición, escala y assets cambiando de forma fluida.",
    avatar: avatarRect("bottom-right", 0.34),
  },
];

// ─── COMPONENTS ──────────────────────────────────────────────────────────────

function SceneHeader({ scene, sceneStart }: { scene: SceneDef; sceneStart: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const localFrame = Math.max(0, frame - sceneStart);
  const enter = spring({ frame: localFrame, fps, config: { damping: 18, stiffness: 90, mass: 1 } });
  const ty = interpolate(enter, [0, 1], [40, 0]);

  return (
    <div
      style={{
        position: "absolute",
        left: MARGIN,
        top: 80,
        width: 1100,
        opacity: enter,
        transform: `translateY(${ty}px)`,
        fontFamily: "system-ui, -apple-system, sans-serif",
        zIndex: 10,
      }}
    >
      <div
        style={{
          color: scene.accent,
          fontSize: 26,
          fontWeight: 900,
          letterSpacing: 3,
          textTransform: "uppercase",
          marginBottom: 14,
        }}
      >
        {scene.eyebrow}
      </div>
      <h1 style={{ margin: "0 0 16px", fontSize: 76, lineHeight: 0.95, color: "#fff", fontWeight: 950 }}>
        {scene.title}
      </h1>
      <p style={{ margin: 0, color: "#cbd5e1", fontSize: 30, lineHeight: 1.4, maxWidth: 820 }}>
        {scene.body}
      </p>
    </div>
  );
}

function AccentRule({ color }: { color: string }) {
  return (
    <div
      style={{
        position: "absolute",
        left: MARGIN,
        top: STAGE_TOP - 16,
        width: 80,
        height: 4,
        borderRadius: 999,
        background: color,
        zIndex: 10,
      }}
    />
  );
}

/**
 * SlideStage with real crossfade.
 * Each slide is rendered as an AbsoluteFill with overlapping opacity so adjacent
 * slides dissolve into each other — no black gap, no jump cut.
 *
 * Timing (n slides, totalFrames T, crossfade C):
 *   perSlide = ceil((T + (n-1)*C) / n)
 *   slide[i] starts at i*(perSlide-C), ends at i*(perSlide-C)+perSlide
 */
function SlideStage({ slides, totalFrames }: { slides: Slide[]; totalFrames: number }) {
  const frame = useCurrentFrame();
  if (slides.length === 0) return null;

  const ordered = [...slides].sort((a, b) => a.index - b.index);
  const n = ordered.length;

  if (n === 1) {
    return (
      <AbsoluteFill style={{ backgroundColor: "#000" }}>
        <Img src={ordered[0].url} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
      </AbsoluteFill>
    );
  }

  const perSlide = Math.max(MIN_SLIDE_FRAMES, Math.ceil((totalFrames + (n - 1) * CROSS) / n));

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {ordered.map((slide, i) => {
        const start = i * (perSlide - CROSS);
        const end = start + perSlide;

        // Skip rendering when far outside visible window
        if (frame < start - CROSS || frame > end + CROSS) return null;

        let opacity: number;
        if (i === 0) {
          // First slide: no fade-in, only fade out at the end
          opacity = interpolate(frame, [end - CROSS, end], [1, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
        } else if (i === n - 1) {
          // Last slide: fade in, then hold until composition ends
          opacity = interpolate(frame, [start, start + CROSS], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
        } else {
          // Middle slides: fade in AND fade out
          opacity = interpolate(
            frame,
            [start, start + CROSS, end - CROSS, end],
            [0, 1, 1, 0],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          );
        }

        return (
          <AbsoluteFill key={slide.index} style={{ opacity }}>
            <Img
              src={slide.url}
              style={{ width: "100%", height: "100%", objectFit: "contain" }}
            />
          </AbsoluteFill>
        );
      })}
    </AbsoluteFill>
  );
}

/**
 * B-Roll PiP — scene 3 only, upper-RIGHT zone of the canvas.
 *
 * Geometry (1920×1080):
 *   PiP    x 1258–1872,  y 360–705   (upper-right, inside slide stage vertically)
 *   Avatar x   48–432,   y 704–920   (bottom-left)
 *   → zero overlap, visually distinct positions ✅
 */
function BrollPip({
  clips,
  sceneStart,
  sceneEnd,
  accent,
}: {
  clips: BrollClip[];
  sceneStart: number;
  sceneEnd: number;
  accent: string;
}) {
  if (clips.length === 0) return null;

  const sceneFrames = sceneEnd - sceneStart;
  const ordered = [...clips].sort((a, b) => a.order - b.order);

  const PIP_W = Math.round(W * 0.32); // 614 px
  const PIP_H = Math.round((PIP_W * 9) / 16); // 345 px

  // Cumulative clip start times within the scene
  let offset = 0;
  const clipDefs = ordered
    .map((clip) => {
      const clipStart = offset;
      const duration = Math.max(0, Math.min(clip.durationInFrames, sceneFrames - offset));
      offset += duration;
      return { ...clip, clipStart, duration };
    })
    .filter((c) => c.duration > 0);

  return (
    <Sequence from={sceneStart} durationInFrames={sceneFrames}>
      <div
        style={{
          position: "absolute",
          right: 48,
          top: STAGE_TOP + 20, // 360 px from top — upper-right zone
          width: PIP_W,
          height: PIP_H,
          borderRadius: 14,
          overflow: "hidden",
          border: `2px solid ${accent}`,
          boxShadow: "0 16px 48px rgba(0,0,0,0.6)",
          zIndex: 20,
        }}
      >
        {clipDefs.map((clip, i) => (
          <Sequence
            key={i}
            from={clip.clipStart}
            durationInFrames={clip.duration}
            layout="none"
          >
            <div style={{ position: "absolute", inset: 0 }}>
              <OffthreadVideo
                src={clip.url}
                muted
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            </div>
          </Sequence>
        ))}
      </div>
    </Sequence>
  );
}

/**
 * Avatar PiP with spring-driven position AND size transitions between scenes.
 * Renders a CSS placeholder when no URL is provided (QA / demo mode).
 */
function AvatarPip({
  url,
  sceneDefs,
  boundaries,
}: {
  url: string | undefined;
  sceneDefs: SceneDef[];
  boundaries: number[];
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const idx = activeSceneIdx(frame, boundaries);
  const sceneStart = boundaries[idx];
  const localFrame = Math.max(0, frame - sceneStart);

  const curr = sceneDefs[idx].avatar;
  const prev = sceneDefs[Math.max(0, idx - 1)].avatar;

  const t = spring({ frame: localFrame, fps, config: { damping: 22, stiffness: 110, mass: 1 } });

  const rect = {
    left: interpolate(t, [0, 1], [prev.left, curr.left]),
    top: interpolate(t, [0, 1], [prev.top, curr.top]),
    width: interpolate(t, [0, 1], [prev.width, curr.width]),
    height: interpolate(t, [0, 1], [prev.height, curr.height]),
  };

  const accent = sceneDefs[idx].accent;
  const baseStyle: React.CSSProperties = {
    position: "absolute",
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    borderRadius: 16,
    overflow: "hidden",
    border: `3px solid ${accent}`,
    boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
    zIndex: 30,
  };

  if (url) {
    return (
      <div style={baseStyle}>
        <OffthreadVideo
          src={url}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>
    );
  }

  // Demo placeholder (no avatar URL)
  const pulse = interpolate(Math.sin(frame / 12), [-1, 1], [0.92, 1.08]);
  return (
    <div
      style={{
        ...baseStyle,
        background: `radial-gradient(circle at 45% 28%, #fff 0 7%, ${accent} 8% 12%, #1e293b 13% 100%)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: "38%",
          paddingBottom: "38%",
          borderRadius: "50%",
          background: "linear-gradient(160deg, #f1f5f9, #cbd5e1)",
          transform: `scale(${pulse})`,
        }}
      />
    </div>
  );
}

/**
 * Subtitle cue — continuous coverage with short fade in/out.
 * Positioned in the safe zone (y 936–1026), inset 280 px each side, z-index 40.
 */
function Subtitle({
  text,
  startFrame,
  endFrame,
}: {
  text: string;
  startFrame: number;
  endFrame: number;
}) {
  const frame = useCurrentFrame();
  if (frame < startFrame || frame > endFrame) return null;

  const FADE = 8;
  const fadeIn = interpolate(frame, [startFrame, startFrame + FADE], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(frame, [endFrame - FADE, endFrame], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        left: 280,
        right: 280,
        bottom: SUB_BOTTOM,
        minHeight: SUB_HEIGHT,
        padding: "16px 32px",
        borderRadius: 16,
        background: "rgba(6, 10, 18, 0.94)",
        color: "#f8fafc",
        fontSize: 34,
        fontWeight: 600,
        lineHeight: 1.3,
        textAlign: "center",
        boxShadow: "0 4px 32px rgba(0,0,0,0.65)",
        opacity: Math.min(fadeIn, fadeOut),
        fontFamily: "system-ui, -apple-system, sans-serif",
        zIndex: 40,
        pointerEvents: "none",
      }}
    >
      {text}
    </div>
  );
}

function ProgressBar({ color }: { color: string }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const pct = Math.min(100, (frame / Math.max(1, durationInFrames - 1)) * 100);

  return (
    <div
      style={{
        position: "absolute",
        left: MARGIN,
        right: MARGIN,
        bottom: 22,
        height: 6,
        borderRadius: 999,
        background: "rgba(255,255,255,0.12)",
        overflow: "hidden",
        zIndex: 40,
      }}
    >
      <div
        style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 999 }}
      />
    </div>
  );
}

// ─── ROOT COMPOSITION ─────────────────────────────────────────────────────────

export const AdvancedMultiScene = ({
  slides = [],
  brollClips = [],
  avatarVideoUrl,
}: TemplateProps) => {
  const frame = useCurrentFrame();
  // durationInFrames is set by calculateMetadata (from avatar duration) or by the
  // runner's composition registration. Never read totalDurationInFrames prop here —
  // useVideoConfig() already reflects the resolved value.
  const { durationInFrames } = useVideoConfig();

  const totalFrames = durationInFrames;
  const boundaries = buildBoundaries(totalFrames, SCENES.length);

  const idx = activeSceneIdx(frame, boundaries);
  const scene = SCENES[idx];
  const sceneStart = boundaries[idx];
  const sceneEnd = boundaries[idx + 1] ?? totalFrames;

  const s3Start = boundaries[2];
  const s3End = boundaries[3] ?? totalFrames;

  // Two subtitle cues per scene — tighter windows so subtitles are almost always visible.
  // Window A: 5%–48% of scene. Window B: 52%–95% of scene. Only 4% gap between cues.
  const subtitleCues = SCENES.flatMap((def, i) => {
    const start = boundaries[i];
    const end = boundaries[i + 1] ?? totalFrames;
    const d = end - start;
    return [
      { text: def.subtitleA, startFrame: start + Math.floor(d * 0.05), endFrame: start + Math.floor(d * 0.48) },
      { text: def.subtitleB, startFrame: start + Math.floor(d * 0.52), endFrame: start + Math.floor(d * 0.95) },
    ];
  });

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(135deg, #0d1520 0%, #1a2535 55%, #0a0e14 100%)",
        overflow: "hidden",
        color: "#ffffff",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Glass border panel — z 0 */}
      <div
        style={{
          position: "absolute",
          inset: 40,
          borderRadius: 28,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(255,255,255,0.025)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      {/* SLIDE STAGE — z 1 */}
      <div
        style={{
          position: "absolute",
          left: MARGIN,
          right: MARGIN,
          top: STAGE_TOP,
          bottom: STAGE_BOTTOM_OFFSET,
          borderRadius: 18,
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.10)",
          zIndex: 1,
        }}
      >
        {slides.length > 0 ? (
          <SlideStage slides={slides} totalFrames={totalFrames} />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              background: `linear-gradient(120deg, ${scene.accent}25, rgba(255,255,255,0.03))`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span style={{ fontSize: 28, color: "rgba(255,255,255,0.28)", fontWeight: 700 }}>
              Área de Slides / B-Roll
            </span>
          </div>
        )}
      </div>

      {/* SCENE HEADER — z 10 */}
      <SceneHeader scene={scene} sceneStart={sceneStart} />
      <AccentRule color={scene.accent} />

      {/* B-ROLL PIP (scene 3 only) — z 20, upper-right zone */}
      <BrollPip
        clips={brollClips}
        sceneStart={s3Start}
        sceneEnd={s3End}
        accent={scene.accent}
      />

      {/* AVATAR PIP — z 30 */}
      <AvatarPip url={avatarVideoUrl} sceneDefs={SCENES} boundaries={boundaries} />

      {/* SUBTITLES — z 40 */}
      {subtitleCues.map((cue, i) => (
        <Subtitle key={i} text={cue.text} startFrame={cue.startFrame} endFrame={cue.endFrame} />
      ))}

      {/* PROGRESS BAR — z 40 */}
      <ProgressBar color={scene.accent} />

      {/* Scene indicator */}
      <div
        style={{
          position: "absolute",
          right: MARGIN,
          top: 88,
          fontSize: 22,
          color: "rgba(255,255,255,0.35)",
          fontWeight: 700,
          letterSpacing: 1,
          zIndex: 10,
        }}
      >
        {idx + 1} / {SCENES.length}
      </div>
    </AbsoluteFill>
  );
};

// Required: sandbox runner resolves this export to find the component
export const MyComposition = AdvancedMultiScene;
