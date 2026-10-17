import { gsap } from "gsap";
import type { CompositionEditorDocument } from "./composition-document.types";
import { buildCompositionMotionRuntime } from "./composition-motion-runtime";
import { scheduleCompositionMotion } from "./composition-motion-timeline";
import { buildCompositionTransitionRuntime } from "./composition-transition-runtime";
import { scheduleCompositionTransitions } from "./composition-transition-timeline";
import { COMPOSITION_TRANSITION_OVERLAY_Z_INDEX } from "./composition-transition-render-policy";
import { projectTextPaintGeometry } from "./composition-text-paint-geometry";
import { buildNativeTextPaintPose } from "./composition-text-paint-pose";

/** Evaluate the renderer's actual scheduler/easing, not an independent interpolation formula. */
export function createMotionOpacityProjection(document: CompositionEditorDocument, includeTransitions = false) {
  // Validate transition eligibility before allocating any GSAP timeline.
  const transitionRuntime = includeTransitions ? buildCompositionTransitionRuntime(document) : null;
  const targets = new Map(document.clips.map((clip) => [`${clip.id}-motion`, {opacity: 1, x: 0, y: 0, scale: 1, rotation: 0}]));
  const timeline = gsap.timeline({paused: true});
  scheduleCompositionMotion(timeline, buildCompositionMotionRuntime(document),
    (id) => targets.get(id));
  const parentTimeline = gsap.timeline({paused: true});
  const parents = new Map(document.clips.map((clip) => [clip.id,
    {autoAlpha: clip.layout.opacity, xPercent: 0, yPercent: 0, filter: "blur(0px)", clipPath: "inset(0% 0% 0% 0%)"}]));
  if (transitionRuntime) {
    for (const clip of document.clips) {
      if (clip.kind === "AUDIO") continue;
      const window = transitionRuntime.clipWindowsById.get(clip.id)!;
      const parent = parents.get(clip.id)!;
      parentTimeline.set(parent, {autoAlpha: clip.hidden ? 0 : clip.layout.opacity}, window.startSeconds);
      parentTimeline.set(parent, {autoAlpha: 0}, window.endSeconds);
    }
    for (const transition of transitionRuntime.items) if (transition.overlayId) parents.set(transition.overlayId,
      {autoAlpha: 0, xPercent: 0, yPercent: 0, filter: "blur(0px)", clipPath: "inset(0% 0% 0% 0%)"});
    scheduleCompositionTransitions(parentTimeline, transitionRuntime.items, (id) => parents.get(id));
  }
  const clipDepths = new Map(document.clips.map((clip) => [clip.id, clip.layout.zIndex]));
  const clipsById = new Map(document.clips.map((clip) => [clip.id, clip]));
  let renderedTime: number | null = null;
  function renderPose(seconds: number, clipId: string) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error("CONFORMANCE_MOTION_TIME_INVALID");
    if (renderedTime !== seconds) {
      timeline.render(seconds, true, true);
      if (transitionRuntime) parentTimeline.render(seconds, true, true);
      renderedTime = seconds;
    }
    const opacity = targets.get(`${clipId}-motion`)?.opacity;
    if (opacity === undefined || !Number.isFinite(opacity)) throw new Error("CONFORMANCE_MOTION_POSE_INVALID");
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    const parentOpacity = parents.get(clipId)!.autoAlpha;
    return {effectiveOpacity: clamp(opacity) * clamp(parentOpacity),
      opaqueOverlayIds: (transitionRuntime?.items ?? []).flatMap((transition) => transition.overlayId
        && seconds >= transition.startSeconds && seconds <= transition.endSeconds
        && clipDepths.get(clipId)! <= COMPOSITION_TRANSITION_OVERLAY_Z_INDEX
        && parents.get(transition.overlayId)!.autoAlpha >= 1 ? [transition.overlayId] : []),
      visibility: opacity <= 0 || (transitionRuntime && parentOpacity <= 0) ? "HIDDEN" as const : "VISIBLE" as const};
  }
  return {
    at(seconds: number, clipId: string): "VISIBLE" | "HIDDEN" {
      return renderPose(seconds, clipId).visibility;
    },
    presentationAt(seconds: number, clipId: string) {
      const {effectiveOpacity, opaqueOverlayIds} = renderPose(seconds, clipId);
      return {effectiveOpacity, opaqueOverlayIds};
    },
    geometryAt(seconds: number, clipId: string) {
      renderPose(seconds, clipId);
      const clip = clipsById.get(clipId)!;
      const parent = parents.get(clipId)!;
      if (parent.filter !== "blur(0px)" && parent.filter !== "none") throw new Error("CONFORMANCE_TEXT_PAINT_FILTER_UNSUPPORTED");
      return projectTextPaintGeometry({canvas: document.canvas, layout: clip.layout,
        motion: targets.get(`${clipId}-motion`)!, transition: parent});
    },
    paintPoseAt(seconds: number, clipId: string) {
      renderPose(seconds, clipId);
      const clip = clipsById.get(clipId)!, parent = parents.get(clipId)!;
      return buildNativeTextPaintPose(clipId, {canvas: document.canvas, layout: clip.layout,
        motion: targets.get(`${clipId}-motion`)!, transition: parent}, parent.filter);
    },
    windows: transitionRuntime?.clipWindowsById,
    dispose() {timeline.kill(); parentTimeline.kill();},
  };
}
