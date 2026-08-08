import React from "react";
import { AbsoluteFill, Audio, interpolate, useCurrentFrame, useVideoConfig, type CalculateMetadataFunction } from "remotion";
import { CANVAS } from "./layout";
import { SceneRenderer } from "./scene-renderer";
import { getActiveScene, getSceneOpacity, normalizeScenes } from "./timeline";
import type { TemplateProps } from "./types";

const compositionId = "editorial-myth-lesson-v1";
const fallbackDurationInFrames = 4250;

const defaultProps: TemplateProps = { schemaVersion: 1, totalDurationInFrames: fallbackDurationInFrames, bgMusicVolume: 0.12, avatarClips: [], slides: [], brollClips: [], captionCues: [], scenes: [], layoutOverrides: [], timelineOverrides: [] };

export const calculateMetadata: CalculateMetadataFunction<TemplateProps> = async ({ props }) => ({ durationInFrames: Math.max(1, Math.round(props.totalDurationInFrames ?? fallbackDurationInFrames)), fps: CANVAS.fps, props });

function FallbackScene({ props }: { props: TemplateProps }) {
  const avatarUrl = props.avatarVideoUrl ?? props.avatarClips?.[0]?.url;
  if (!avatarUrl) return <AbsoluteFill style={{ background: "#071016" }} />;
  return <SceneRenderer frame={0} scene={{ id: "fallback-avatar", layout: "AVATAR_FULL", startFrame: 0, endFrame: props.totalDurationInFrames ?? fallbackDurationInFrames, avatar: { clipOrder: props.avatarClips?.[0]?.order }, captionsEnabled: true }} props={props} />;
}

export function EditorialMythLesson(props: TemplateProps) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const scenes = normalizeScenes(props.scenes, durationInFrames);
  const scene = getActiveScene(frame, scenes);
  const opacity = scene ? getSceneOpacity(frame, scene) : 1;
  const fadeFromBlack = interpolate(frame, [0, 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ background: "#071016", overflow: "hidden", opacity: fadeFromBlack }}>
    {scene ? <div style={{ position: "absolute", inset: 0, opacity }}><SceneRenderer frame={frame} scene={scene} props={props} /></div> : <FallbackScene props={{ ...props, totalDurationInFrames: durationInFrames }} />}
    {props.voiceAudioUrl ? <Audio src={props.voiceAudioUrl} /> : null}
    {props.bgMusicUrl ? <Audio src={props.bgMusicUrl} volume={props.bgMusicVolume ?? 0.12} /> : null}
  </AbsoluteFill>;
}

export const compositionConfig = { id: compositionId, component: EditorialMythLesson, durationInFrames: fallbackDurationInFrames, fps: CANVAS.fps, width: CANVAS.width, height: CANVAS.height, defaultProps, calculateMetadata };
