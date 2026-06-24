/**
 * Remotion Template — Advanced Multi-Scene v2
 * compositionId: advanced-multi-scene-v2
 *
 * Demuestra: 4 escenas con avatar animado (posición + escala), subtítulos
 * sincronizados, transición fade/slide entre slides, B-roll PiP en escena 3,
 * y progress bar dinámico. Diseñado sin colisiones entre elementos.
 *
 * Canvas esperado: 1920×1080 @ 30 fps
 */

import React from "react";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  Sequence,
  Series,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

// ─── LAYOUT CONSTANTS ────────────────────────────────────────────────────────

const W = 1920;
const H = 1080;
const MARGIN = 116;

// Subtitle zone: y 936–1026 (bottom 54, height 90)
const SUB_BOTTOM = 54;
const SUB_HEIGHT = 90;

// Avatar always bottoms out at least this far from the canvas bottom,
// guaranteeing ≥ 16 px gap above the subtitle zone (160 > 144).
const AVATAR_SAFE_BOTTOM = SUB_BOTTOM + SUB_HEIGHT + 16; // 160 px

// Slide stage: from top 340 to bottom 190 (above subtitle + 30 px margin).
const STAGE_TOP = 340;
const STAGE_BOTTOM_OFFSET = AVATAR_SAFE_BOTTOM + 30; // 190 px

const FADE_FRAMES = 12;

// ─── TYPES ───────────────────────────────────────────────────────────────────

type Slide = { index: number; url: string };
type BrollClip = { url: string; durationInFrames: number; order: number };

export type TemplateProps = {
  slides?: Slide[];
  brollClips?: BrollClip[];
  avatarVideoUrl?: string;
  /** Overrides useVideoConfig().durationInFrames when provided as an inputProp. */
  totalDurationInFrames?: number;
};

/** Avatar geometry expressed as absolute px on the 1920×1080 canvas. */
type AvatarRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

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

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/**
 * Computes the absolute pixel rect of the avatar PiP given a corner anchor
 * and a width expressed as a fraction of the canvas width.
 * All bottom-anchored avatars respect AVATAR_SAFE_BOTTOM so they never
 * collide with the subtitle zone.
 */
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

/**
 * Returns the index of the active scene for the current frame.
 * Each scene spans an equal portion of totalFrames.
 */
function activeSceneIdx(frame: number, boundaries: number[]): number {
  for (let i = boundaries.length - 1; i >= 0; i--) {
    if (frame >= boundaries[i]) return i;
  }
  return 0;
}

/** Divides totalFrames into N equal boundaries (start frame of each scene). */
function buildBoundaries(totalFrames: number, n: number): number[] {
  const size = Math.floor(totalFrames / n);
  return Array.from({ length: n }, (_, i) => i * size);
}

// ─── SCENE DEFINITIONS ───────────────────────────────────────────────────────
//
// Four scenes, each with a different accent colour, hero copy, subtitle pair,
// and avatar position+scale. The layout is collision-free for a 1920×1080 canvas:
//
//   Scene 1 — bottom-right 24 %  (x 1411–1872, y 661–920)  text at left ✅
//   Scene 2 — top-right    28 %  (x 1334–1872, y  80–382)  text at left ✅
//   Scene 3 — bottom-left  20 %  (x  48– 432, y 704–920)  broll PiP at right ✅
//   Scene 4 — bottom-right 34 %  (x 1219–1872, y 553–920)  text at left ✅
//
// Subtitle zone y 936–1026 — always ≥ 16 px below every avatar bottom (y 920).

const SCENES: SceneDef[] = [
  {
    index: 0,
    accent: "#00D4B3",
    eyebrow: "Escena 01 · Introducción",
    title: "Marco del Tema",
    body: "El avatar acompaña desde la esquina inferior derecha mientras el contenido visual establece el marco inicial del aprendizaje.",
    subtitleA: "Primero identificamos el problema central que el estudiante debe resolver.",
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
    body: "El avatar se reduce y se mueve a la esquina inferior izquierda, dejando la derecha libre para el B-roll contextual.",
    subtitleA: "En la práctica el estudiante ejecuta pasos breves y verificables en su propio entorno.",
    subtitleB: "El B-roll aparece como PiP en la esquina opuesta al avatar: sin solapamiento.",
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

/** Scene header: eyebrow, title, body — slides in from below on scene change. */
function SceneHeader({
  scene,
  sceneStart,
}: {
  scene: SceneDef;
  sceneStart: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const localFrame = Math.max(0, frame - sceneStart);

  const enter = spring({ frame: localFrame, fps, config: { damping: 18, stiffness: 90, mass: 1 } });
  const translateY = interpolate(enter, [0, 1], [40, 0]);

  return (
    <div
      style={{
        position: "absolute",
        left: MARGIN,
        top: 80,
        // Width capped so text never overlaps top-right avatar (starts at x ≈ 1334)
        width: 1100,
        opacity: enter,
        transform: `translateY(${translateY}px)`,
        fontFamily: "system-ui, -apple-system, sans-serif",
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
      <h1
        style={{
          margin: "0 0 16px",
          fontSize: 76,
          lineHeight: 0.95,
          color: "#ffffff",
          fontWeight: 950,
        }}
      >
        {scene.title}
      </h1>
      <p
        style={{
          margin: 0,
          color: "#cbd5e1",
          fontSize: 30,
          lineHeight: 1.4,
          maxWidth: 820,
        }}
      >
        {scene.body}
      </p>
    </div>
  );
}

/** Accent divider between header text and the slide stage. */
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
      }}
    />
  );
}

/**
 * Individual slide with fade-in on entry and fade-out on exit (within a Series.Sequence).
 * Also applies a subtle zoom-from-1.03→1 on entry to reinforce the transition.
 */
function SlideFrame({ url, durationInFrames }: { url: string; durationInFrames: number }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(
    frame,
    [0, FADE_FRAMES, durationInFrames - FADE_FRAMES, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const scale = interpolate(frame, [0, FADE_FRAMES], [1.03, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        opacity,
        transform: `scale(${scale})`,
        backgroundColor: "#000",
      }}
    >
      <Img
        src={url}
        style={{ width: "100%", height: "100%", objectFit: "contain" }}
      />
    </AbsoluteFill>
  );
}

/** Distributes slides evenly across totalFrames using Series + fade transitions. */
function SlideStage({ slides, totalFrames }: { slides: Slide[]; totalFrames: number }) {
  if (slides.length === 0) return null;
  const ordered = [...slides].sort((a, b) => a.index - b.index);
  const perSlide = Math.max(FADE_FRAMES * 2 + 1, Math.floor(totalFrames / ordered.length));

  return (
    <Series>
      {ordered.map((slide) => (
        <Series.Sequence key={slide.index} durationInFrames={perSlide}>
          <SlideFrame url={slide.url} durationInFrames={perSlide} />
        </Series.Sequence>
      ))}
    </Series>
  );
}

/**
 * B-Roll PiP shown ONLY during scene 3 (index 2).
 * Anchored bottom-right at the same safe-bottom as the avatar, but the avatar
 * is at bottom-LEFT in scene 3, so there is no horizontal overlap.
 *
 * Geometry (1920×1080):
 *   PiP  x 1258–1872,  y 559–904
 *   Avatar x 48–432,   y 704–920  → zero X overlap ✅
 *   Subtitle y 936–    → 32 px gap below PiP ✅
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
  const PIP_RIGHT = 48;
  const PIP_BOTTOM = AVATAR_SAFE_BOTTOM + 16; // 176 px

  return (
    <Sequence from={sceneStart} durationInFrames={sceneFrames}>
      <div
        style={{
          position: "absolute",
          right: PIP_RIGHT,
          bottom: PIP_BOTTOM,
          width: PIP_W,
          height: PIP_H,
          borderRadius: 14,
          overflow: "hidden",
          border: `2px solid ${accent}`,
          boxShadow: "0 16px 48px rgba(0,0,0,0.55)",
        }}
      >
        <Series>
          {ordered.map((clip, i) => (
            <Series.Sequence
              key={`${clip.order}-${i}`}
              durationInFrames={Math.min(clip.durationInFrames, sceneFrames)}
            >
              <AbsoluteFill style={{ backgroundColor: "#000" }}>
                <OffthreadVideo
                  src={clip.url}
                  muted
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              </AbsoluteFill>
            </Series.Sequence>
          ))}
        </Series>
      </div>
    </Sequence>
  );
}

/**
 * Avatar PiP with smooth spring-driven position AND size transitions between scenes.
 *
 * On each scene change, a new spring (localFrame resets to 0) interpolates from
 * the previous scene's rect to the current scene's rect. This creates visible
 * movement and scale change that validates Remotion Lambda rendering end-to-end.
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

  // Spring resets at each scene boundary for a fresh elastic transition.
  const t = spring({ frame: localFrame, fps, config: { damping: 22, stiffness: 110, mass: 1 } });

  const rect = {
    left: interpolate(t, [0, 1], [prev.left, curr.left]),
    top: interpolate(t, [0, 1], [prev.top, curr.top]),
    width: interpolate(t, [0, 1], [prev.width, curr.width]),
    height: interpolate(t, [0, 1], [prev.height, curr.height]),
  };

  const accent = sceneDefs[idx].accent;
  const sharedStyle: React.CSSProperties = {
    position: "absolute",
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    borderRadius: 16,
    overflow: "hidden",
    border: `3px solid ${accent}`,
    boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
  };

  if (url) {
    return (
      <div style={sharedStyle}>
        <OffthreadVideo
          src={url}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>
    );
  }

  // CSS placeholder when no avatar URL is provided (demo/QA mode).
  const pulse = interpolate(Math.sin(frame / 12), [-1, 1], [0.92, 1.08]);

  return (
    <div
      style={{
        ...sharedStyle,
        background: `radial-gradient(circle at 45% 28%, #fff 0 7%, ${accent} 8% 12%, #1e293b 13% 100%)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Simulated face silhouette */}
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
 * Single subtitle cue.
 * Fades in over FADE_FRAMES and fades out over FADE_FRAMES.
 * Positioned in the safe subtitle zone (bottom 54 px, clear of avatar).
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

  const fadeIn = interpolate(frame, [startFrame, startFrame + FADE_FRAMES], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(frame, [endFrame - FADE_FRAMES, endFrame], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        // Inset 280 px each side → x 280–1640, well within avatar X ranges ✅
        left: 280,
        right: 280,
        bottom: SUB_BOTTOM,
        minHeight: SUB_HEIGHT,
        padding: "18px 32px",
        borderRadius: 16,
        background: "rgba(8, 12, 20, 0.88)",
        color: "#ffffff",
        fontSize: 32,
        lineHeight: 1.3,
        textAlign: "center",
        boxShadow: "0 16px 48px rgba(0,0,0,0.4)",
        opacity: Math.min(fadeIn, fadeOut),
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {text}
    </div>
  );
}

/**
 * Progress bar. Uses useVideoConfig().durationInFrames — never a hardcoded constant.
 */
function ProgressBar({ color }: { color: string }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const pct = Math.min(100, (frame / durationInFrames) * 100);

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
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          background: color,
          borderRadius: 999,
        }}
      />
    </div>
  );
}

// ─── ROOT COMPOSITION ─────────────────────────────────────────────────────────

export const AdvancedMultiScene = ({
  slides = [],
  brollClips = [],
  avatarVideoUrl,
  totalDurationInFrames,
}: TemplateProps) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const totalFrames = totalDurationInFrames ?? durationInFrames;
  const boundaries = buildBoundaries(totalFrames, SCENES.length);

  const idx = activeSceneIdx(frame, boundaries);
  const scene = SCENES[idx];
  const sceneStart = boundaries[idx];
  const sceneEnd = boundaries[idx + 1] ?? totalFrames;

  // Scene 3 boundary for B-roll PiP
  const s3Start = boundaries[2];
  const s3End = boundaries[3] ?? totalFrames;

  // Two subtitle cues per scene, proportional to scene duration.
  const subtitleCues = SCENES.flatMap((def, i) => {
    const start = boundaries[i];
    const end = boundaries[i + 1] ?? totalFrames;
    const d = end - start;
    return [
      {
        text: def.subtitleA,
        startFrame: start + Math.floor(d * 0.08),
        endFrame: start + Math.floor(d * 0.44),
      },
      {
        text: def.subtitleB,
        startFrame: start + Math.floor(d * 0.56),
        endFrame: start + Math.floor(d * 0.92),
      },
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
      {/* Glass border panel */}
      <div
        style={{
          position: "absolute",
          inset: 40,
          borderRadius: 28,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(255,255,255,0.025)",
          pointerEvents: "none",
        }}
      />

      {/* ── SLIDE / B-ROLL STAGE ─────────────────────────────────────────── */}
      {/* y: STAGE_TOP (340) → H - STAGE_BOTTOM_OFFSET (890). Clear of subtitle ✅ */}
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
        }}
      >
        {slides.length > 0 ? (
          <SlideStage slides={slides} totalFrames={totalFrames} />
        ) : (
          /* Placeholder when no slides provided (QA / demo mode). */
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
            <span
              style={{ fontSize: 28, color: "rgba(255,255,255,0.28)", fontWeight: 700 }}
            >
              Área de Slides / B-Roll
            </span>
          </div>
        )}
      </div>

      {/* ── SCENE HEADER ─────────────────────────────────────────────────── */}
      <SceneHeader scene={scene} sceneStart={sceneStart} />
      <AccentRule color={scene.accent} />

      {/* ── B-ROLL PIP (scene 3 only) ──────────────────────────────────── */}
      <BrollPip
        clips={brollClips}
        sceneStart={s3Start}
        sceneEnd={s3End}
        accent={scene.accent}
      />

      {/* ── AVATAR PIP ───────────────────────────────────────────────────── */}
      <AvatarPip
        url={avatarVideoUrl}
        sceneDefs={SCENES}
        boundaries={boundaries}
      />

      {/* ── SUBTITLES ────────────────────────────────────────────────────── */}
      {subtitleCues.map((cue, i) => (
        <Subtitle key={i} text={cue.text} startFrame={cue.startFrame} endFrame={cue.endFrame} />
      ))}

      {/* ── PROGRESS BAR ─────────────────────────────────────────────────── */}
      <ProgressBar color={scene.accent} />

      {/* Scene index indicator (top-right corner, small) */}
      <div
        style={{
          position: "absolute",
          right: MARGIN,
          top: 88,
          fontSize: 22,
          color: "rgba(255,255,255,0.35)",
          fontWeight: 700,
          letterSpacing: 1,
        }}
      >
        {idx + 1} / {SCENES.length}
      </div>
    </AbsoluteFill>
  );
};

// Required alias so the host can resolve compositionId → component.
export const MyComposition = AdvancedMultiScene;
