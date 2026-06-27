import React from "react";
import {
  AbsoluteFill,
  type CalculateMetadataFunction,
  Img,
  OffthreadVideo,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { getVideoMetadata } from "@remotion/media-utils";

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

const W = 1920;
const H = 1080;
const PHASE_FRAMES = 150; // 5 seconds @ 30 fps

const AVATAR_FULL = {
  left: 0,
  top: 0,
  width: W,
  height: H,
  borderRadius: 0,
};

const AVATAR_PIP = {
  left: W - 480 - 64,
  top: H - 270 - 180, // Leaves room for subtitles at the bottom
  width: 480,
  height: 270,
  borderRadius: 24,
};

// ─── TYPES ───────────────────────────────────────────────────────────────────

type Slide = { index: number; url: string };
type BrollClip = { url: string; durationInFrames: number; order: number };

export type TemplateProps = {
  slides?: Slide[];
  brollClips?: BrollClip[];
  avatarVideoUrl?: string;
  totalDurationInFrames?: number;
};

// ─── CALCULATE METADATA ──────────────────────────────────────────────────────

export const calculateMetadata: CalculateMetadataFunction<TemplateProps> = async ({
  props,
}) => {
  if (props.avatarVideoUrl) {
    try {
      const { durationInSeconds } = await getVideoMetadata(props.avatarVideoUrl);
      if (durationInSeconds > 0) {
        return { durationInFrames: Math.ceil(durationInSeconds * 30), fps: 30 };
      }
    } catch (err) {
      console.warn("getVideoMetadata failed, fallback to static duration", err);
    }
  }
  return {};
};

// ─── COMPONENTS ──────────────────────────────────────────────────────────────

function Subtitle({ text, startFrame, endFrame }: { text: string; startFrame: number; endFrame: number }) {
  const frame = useCurrentFrame();
  if (frame < startFrame || frame > endFrame) return null;

  const FADE = 10;
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
        bottom: 54,
        minHeight: 90,
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
      }}
    >
      {text}
    </div>
  );
}

// ─── ROOT COMPOSITION ────────────────────────────────────────────────────────

export const AlternatingFocus = ({
  slides = [],
  avatarVideoUrl,
}: TemplateProps) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Determine current phase (each phase is 150 frames = 5 seconds)
  const phase = Math.floor(frame / PHASE_FRAMES);
  const phaseStart = phase * PHASE_FRAMES;
  const localFrame = frame - phaseStart;

  // Transition spring triggers at the start of every phase
  const transition = spring({
    frame: localFrame,
    fps,
    config: { damping: 20, stiffness: 90, mass: 1 },
  });

  // phase % 2 === 0 -> Avatar is Full
  // phase % 2 === 1 -> Slide is Full (Avatar PiP)
  const isAvatarPhase = phase % 2 === 0;
  const prevIsAvatar = phase === 0 ? true : phase % 2 !== 0; // phase 0 starts fully formed

  const prevRect = prevIsAvatar ? AVATAR_FULL : AVATAR_PIP;
  const currRect = isAvatarPhase ? AVATAR_FULL : AVATAR_PIP;

  const prevSlideOpacity = prevIsAvatar ? 0 : 1;
  const currSlideOpacity = isAvatarPhase ? 0 : 1;

  const avatarRect = {
    left: interpolate(transition, [0, 1], [prevRect.left, currRect.left]),
    top: interpolate(transition, [0, 1], [prevRect.top, currRect.top]),
    width: interpolate(transition, [0, 1], [prevRect.width, currRect.width]),
    height: interpolate(transition, [0, 1], [prevRect.height, currRect.height]),
    borderRadius: interpolate(transition, [0, 1], [prevRect.borderRadius, currRect.borderRadius]),
  };

  const slideOpacity = interpolate(transition, [0, 1], [prevSlideOpacity, currSlideOpacity]);

  // Determine which slide to show
  // We want the slide to remain stable while fading in/out.
  const logicalSlideIdx = isAvatarPhase ? Math.max(0, Math.floor((phase - 1) / 2)) : Math.floor(phase / 2);
  const currentSlide = slides.length > 0 ? slides[logicalSlideIdx % slides.length] : null;

  // Generate generic subtitles for the phases to demonstrate the subtitle functionality
  const totalPhases = Math.ceil(durationInFrames / PHASE_FRAMES);
  const subtitles = Array.from({ length: totalPhases }).map((_, i) => ({
    text: i % 2 === 0 
      ? "El avatar es el elemento principal a observar durante estos 5 segundos." 
      : "Ahora la diapositiva toma el protagonismo con una transición limpia.",
    startFrame: i * PHASE_FRAMES + 15,
    endFrame: (i + 1) * PHASE_FRAMES - 15,
  }));

  return (
    <AbsoluteFill style={{ backgroundColor: "#000", overflow: "hidden" }}>
      
      {/* 1. SLIDE LAYER */}
      <AbsoluteFill style={{ opacity: slideOpacity }}>
        {currentSlide ? (
          <Img 
            src={currentSlide.url} 
            style={{ width: "100%", height: "100%", objectFit: "contain", backgroundColor: "#0f172a" }} 
          />
        ) : (
          <div style={{ width: "100%", height: "100%", backgroundColor: "#0f172a", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <h1 style={{ color: "rgba(255,255,255,0.3)", fontSize: 48, fontFamily: "sans-serif" }}>Diapositiva {logicalSlideIdx + 1}</h1>
          </div>
        )}
      </AbsoluteFill>

      {/* 2. AVATAR LAYER */}
      <div
        style={{
          position: "absolute",
          left: avatarRect.left,
          top: avatarRect.top,
          width: avatarRect.width,
          height: avatarRect.height,
          borderRadius: avatarRect.borderRadius,
          overflow: "hidden",
          border: isAvatarPhase ? "none" : "3px solid #00D4B3",
          boxShadow: isAvatarPhase ? "none" : "0 16px 48px rgba(0,0,0,0.6)",
          zIndex: 20,
        }}
      >
        {avatarVideoUrl ? (
          <OffthreadVideo
            src={avatarVideoUrl}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg, #1e293b, #0f172a)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: "40%", paddingBottom: "40%", borderRadius: "50%", background: "#cbd5e1" }} />
          </div>
        )}
      </div>

      {/* 3. SUBTITLES LAYER */}
      {subtitles.map((sub, i) => (
        <Subtitle key={i} text={sub.text} startFrame={sub.startFrame} endFrame={sub.endFrame} />
      ))}

    </AbsoluteFill>
  );
};

export const MyComposition = AlternatingFocus;
