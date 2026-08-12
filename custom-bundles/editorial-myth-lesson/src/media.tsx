import React from "react";
import { Freeze, Img, Loop, OffthreadVideo, Sequence } from "remotion";
import type { Box, BrollClip, CaptionCue, SlideAsset } from "./types";

const REMOTE_END_PADDING = 15;

export function RenderVideo(props: { src: string; durationInFrames: number; sourceStartFrame?: number; sourceEndFrame?: number; loopMode?: "loop" | "freeze" | "none"; style: React.CSSProperties }) {
  const start = Math.max(0, props.sourceStartFrame ?? 0);
  const requestedEnd = Math.max(start + 1, props.sourceEndFrame ?? start + props.durationInFrames);
  const end = requestedEnd - start > 16 ? requestedEnd - REMOTE_END_PADDING : requestedEnd;
  const sourceDuration = Math.max(1, end - start);
  const video = <OffthreadVideo src={props.src} muted startFrom={start} endAt={end} delayRenderTimeoutInMilliseconds={45000} delayRenderRetries={1} style={props.style} />;
  if (props.loopMode === "loop") return <Loop durationInFrames={sourceDuration}>{video}</Loop>;
  if (props.loopMode === "freeze" && props.durationInFrames > sourceDuration) return <><Sequence durationInFrames={sourceDuration}>{video}</Sequence><Sequence from={sourceDuration} durationInFrames={props.durationInFrames - sourceDuration}><Freeze frame={sourceDuration - 1}>{video}</Freeze></Sequence></>;
  return video;
}

export function SlideRenderer({ slide, box, localFrame }: { slide: SlideAsset; box: Box; localFrame: number }) {
  if (slide.kind !== "html") return <Img src={slide.url ?? ""} style={{ width: "100%", height: "100%", objectFit: "contain" }} />;
  const scale = Math.min(box.width / 1920, box.height / 1080);
  return <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}><div style={{ position: "absolute", width: 1920, height: 1080, left: (box.width - 1920 * scale) / 2, top: (box.height - 1080 * scale) / 2, zoom: scale }}><section className={`${slide.classes ?? "slide"} active`} style={{ "--deck-t": String(localFrame / 25) } as React.CSSProperties} dangerouslySetInnerHTML={{ __html: slide.html ?? "" }} /></div></div>;
}

export function CaptionRenderer({ cue }: { cue: CaptionCue | null }) {
  if (!cue?.text) return null;
  return <div style={{ width: "100%", minHeight: 56, padding: "16px 28px", borderRadius: 12, background: "rgba(0,0,0,0.72)", color: "#fff", fontSize: 28, fontWeight: 600, lineHeight: 1.25, textAlign: "center" }}>{cue.text}</div>;
}

export function findCue(frame: number, cues: CaptionCue[] | undefined) { return (cues ?? []).find((cue) => frame >= cue.startFrame && frame < cue.endFrame) ?? null; }
export function findSlide(index: number | undefined, slides: SlideAsset[] | undefined) { return (slides ?? []).find((slide) => slide.index === index) ?? null; }
export function findBroll(order: number | undefined, clips: BrollClip[] | undefined) { return (clips ?? []).find((clip) => clip.order === order) ?? null; }
