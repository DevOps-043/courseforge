import React from "react";
import { Img } from "remotion";
import { boxStyle, getBox, getLayerStyle } from "./layout";
import { CaptionRenderer, findBroll, findCue, findSlide, RenderVideo, SlideRenderer } from "./media";
import type { AvatarClip, SceneSpec, TemplateProps } from "./types";

function findAvatar(scene: SceneSpec, props: TemplateProps): AvatarClip | null {
  const ordered = [...(props.avatarClips ?? [])].sort((a, b) => a.order - b.order);
  if (scene.avatar?.clipOrder !== undefined) return ordered.find((clip) => clip.order === scene.avatar?.clipOrder) ?? null;
  if (props.avatarVideoUrl) return { order: 1, url: props.avatarVideoUrl, durationInFrames: props.totalDurationInFrames };
  return ordered[0] ?? null;
}

function Card({ scene, props }: { scene: SceneSpec; props: TemplateProps }) {
  const isDark = scene.copy?.tone === "dark" || scene.layout === "CTA_CARD";
  const headline = scene.copy?.headline ?? "";
  const eyebrow = scene.copy?.eyebrow;
  const style = { color: isDark ? "#F7F8F6" : "#10253B", background: isDark ? "#071016" : "#F7F8F6" };
  const headlineBox = getBox(scene.layout, "headline", props.layoutOverrides);
  return <div style={{ position: "absolute", inset: 0, background: style.background }}>
    {headlineBox ? <div style={boxStyle(headlineBox, { zIndex: 40, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", ...getLayerStyle("headline", props.layoutOverrides) })}>
      <div>{scene.copy?.icon === "warning" ? <div style={{ color: "#3DE1CF", fontSize: 80, lineHeight: 1 }}>▲</div> : null}{eyebrow ? <div style={{ color: "#3DE1CF", fontSize: 24, fontWeight: 800, letterSpacing: 4, marginBottom: 24 }}>{eyebrow}</div> : null}<div style={{ color: style.color, fontSize: headline.length > 70 ? 58 : 76, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2 }}>{headline}</div></div>
    </div> : null}
  </div>;
}

export function SceneRenderer({ frame, scene, props }: { frame: number; scene: SceneSpec; props: TemplateProps }) {
  const localFrame = frame - scene.startFrame;
  const avatar = findAvatar(scene, props);
  const slide = findSlide(scene.slide?.index, props.slides);
  const broll = findBroll(scene.broll?.order, props.brollClips);
  const avatarBox = getBox(scene.layout, "avatar", props.layoutOverrides);
  const slideBox = getBox(scene.layout, "slide", props.layoutOverrides);
  const brollBox = getBox(scene.layout, "broll", props.layoutOverrides);
  const captionsBox = getBox(scene.layout, "captions", props.layoutOverrides);
  const avatarStyle = { width: "100%", height: "100%", objectFit: "cover" as const, objectPosition: `${(scene.avatar?.focalPoint?.x ?? 0.5) * 100}% ${(scene.avatar?.focalPoint?.y ?? 0.5) * 100}%` };
  const cardLayouts = ["TITLE_CARD", "STATEMENT_CARD", "WARNING_CARD", "CTA_CARD"];
  if (cardLayouts.includes(scene.layout)) return <Card scene={scene} props={props} />;
  if (scene.layout === "OUTRO") return scene.outroUrl ? <Img src={scene.outroUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Card scene={{ ...scene, layout: "CTA_CARD", copy: { ...scene.copy, tone: "dark" } }} props={props} />;
  const showAvatar = Boolean(avatar && avatarBox);
  const showSlide = Boolean(slide && slideBox);
  const showBroll = Boolean(broll && brollBox);
  const needsEvidenceFallback = scene.layout === "EVIDENCE_SPLIT" && !showBroll && scene.fallback === "slide_full";
  const cue = scene.captionsEnabled ? findCue(frame, props.captionCues) : null;

  return <>
    {showAvatar && avatarBox ? <div style={boxStyle(avatarBox, { zIndex: 20, ...getLayerStyle("avatar", props.layoutOverrides), ...getLayerStyle(`avatar:${avatar!.order}`, props.layoutOverrides) })}><RenderVideo src={avatar!.url} durationInFrames={scene.endFrame - scene.startFrame} sourceStartFrame={scene.avatar?.sourceStartFrame} sourceEndFrame={scene.avatar?.sourceEndFrame ?? avatar!.durationInFrames} loopMode="freeze" style={avatarStyle} /></div> : null}
    {showBroll && brollBox ? <div style={boxStyle(brollBox, { zIndex: 25, ...getLayerStyle("broll", props.layoutOverrides), ...getLayerStyle(`broll:${broll!.order}`, props.layoutOverrides) })}><RenderVideo src={broll!.url} durationInFrames={scene.endFrame - scene.startFrame} sourceStartFrame={scene.broll?.sourceStartFrame} sourceEndFrame={scene.broll?.sourceEndFrame ?? broll!.durationInFrames} loopMode={scene.broll?.loopMode ?? "freeze"} style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div> : null}
    {showSlide && slideBox ? <div style={needsEvidenceFallback ? { position: "absolute", inset: 0, zIndex: 30 } : boxStyle(slideBox, { zIndex: 30, ...getLayerStyle("slides", props.layoutOverrides), ...getLayerStyle(`slide:${slide!.index}`, props.layoutOverrides) })}><SlideRenderer slide={slide!} box={needsEvidenceFallback ? { x: 0, y: 0, width: 1920, height: 1080 } : slideBox} localFrame={localFrame} /></div> : null}
    {cue && captionsBox ? <div style={boxStyle(captionsBox, { zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", ...getLayerStyle("captions", props.layoutOverrides) })}><CaptionRenderer cue={cue} /></div> : null}
  </>;
}
