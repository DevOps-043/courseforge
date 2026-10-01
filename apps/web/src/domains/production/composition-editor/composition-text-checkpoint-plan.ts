import { createHash } from "node:crypto";
import { compositionEditorDocumentSchema, type CompositionEditorDocument } from "./composition-document.types";
import { captionCueElementId } from "./composition-native-overlay-renderer.service";
import { COMPOSITION_TEXT_PARITY_POLICY as policy } from "./composition-text-parity-policy";
import { createMotionOpacityProjection } from "./composition-motion-opacity-projection";
import { NATIVE_TRANSITION_VISIBILITY_POLICY, NATIVE_TEXT_APPEARANCE_POLICY, NATIVE_TEXT_GEOMETRY_POLICY, type NativeTextVisibilityPolicy, type TextPresentation } from "./composition-text-parity-contract";

export const hashTextParityContent = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const includesTransitions = (visibility: boolean | NativeTextVisibilityPolicy) => visibility === NATIVE_TRANSITION_VISIBILITY_POLICY
  || visibility === NATIVE_TEXT_APPEARANCE_POLICY || visibility === NATIVE_TEXT_GEOMETRY_POLICY;

function projectTextCheckpoint(document: CompositionEditorDocument, seconds: number, windows?: ReturnType<typeof createMotionOpacityProjection>["windows"]) {
  if (document.canvas.width * document.canvas.height > policy.maximumFramePixels) throw new Error("CONFORMANCE_TEXT_FRAME_LIMIT");
  if (!Number.isFinite(seconds) || seconds < 0 || seconds >= document.canvas.durationSeconds) throw new Error("CONFORMANCE_TEXT_CHECKPOINT_INVALID");
  const tracks = new Map(document.tracks.map((track) => [track.id, track]));
  const expectedTexts: Array<{elementId: string; textSha256: string; visibility?: "VISIBLE" | "HIDDEN";
    presentation?: TextPresentation}> = [];
  for (const clip of document.clips) {
    const window = windows?.get(clip.id);
    if (clip.hidden || tracks.get(clip.trackId)?.hidden || clip.layout.opacity === 0
      || seconds < (window?.startSeconds ?? clip.startSeconds) || seconds >= (window?.endSeconds ?? clip.startSeconds + clip.durationSeconds)) continue;
    if (clip.source.type === "NATIVE_TEXT") expectedTexts.push({elementId: `${clip.id}-motion`, textSha256: hashTextParityContent(clip.source.text)});
    if (clip.source.type === "NATIVE_CAPTIONS") for (const cue of clip.source.cues) {
      if (seconds < clip.startSeconds + cue.startSeconds || seconds >= clip.startSeconds + cue.endSeconds) continue;
      const text = cue.words?.length ? cue.words.map((word) => word.text).join(" ") : cue.text;
      expectedTexts.push({elementId: captionCueElementId(clip.id, cue.id), textSha256: hashTextParityContent(text)});
    }
    if (expectedTexts.length > policy.maximumRegions) throw new Error("CONFORMANCE_TEXT_REGION_LIMIT");
  }
  if (new Set(expectedTexts.map((text) => text.elementId)).size !== expectedTexts.length) throw new Error("CONFORMANCE_TEXT_EXPECTED_DUPLICATE");
  return {expectedTexts, width: document.canvas.width, height: document.canvas.height};
}

export function buildTextParityCheckpointPlan(input: unknown, seconds: number, motionVisibility: boolean | NativeTextVisibilityPolicy = false) {
  const document = compositionEditorDocumentSchema.parse(input);
  if (!motionVisibility) return projectTextCheckpoint(document, seconds);
  const projection = createMotionOpacityProjection(document, includesTransitions(motionVisibility));
  try {
    const plan = projectTextCheckpoint(document, seconds, projection.windows);
    return {...plan, expectedTexts: addVisibility(plan.expectedTexts, document, seconds, projection, motionVisibility)};
  }
  finally { projection.dispose(); }
}

function addVisibility(expectedTexts: Array<{elementId: string; textSha256: string}>, document: CompositionEditorDocument,
  seconds: number, projection: ReturnType<typeof createMotionOpacityProjection>, visibilityPolicy: boolean | NativeTextVisibilityPolicy) {
  const owners = new Map<string, string>();
  for (const clip of document.clips) {
    if (clip.source.type === "NATIVE_TEXT") owners.set(`${clip.id}-motion`, clip.id);
    if (clip.source.type === "NATIVE_CAPTIONS") for (const cue of clip.source.cues) owners.set(captionCueElementId(clip.id, cue.id), clip.id);
  }
  let overlayReferences = 0;
  return expectedTexts.map((expected) => {
    const ownerId = owners.get(expected.elementId)!;
    const appearance = visibilityPolicy === NATIVE_TEXT_APPEARANCE_POLICY || visibilityPolicy === NATIVE_TEXT_GEOMETRY_POLICY;
    const presentation = appearance ? {...projection.presentationAt(seconds, ownerId),
      ...(visibilityPolicy === NATIVE_TEXT_GEOMETRY_POLICY ? {paintPose: projection.paintPoseAt(seconds, ownerId)} : {})} : undefined;
    overlayReferences += presentation?.opaqueOverlayIds.length ?? 0;
    if (overlayReferences > policy.maximumOverlayReferencesPerCheckpoint) throw new Error("CONFORMANCE_TEXT_PRESENTATION_LIMIT");
    return {...expected, visibility: projection.at(seconds, ownerId),
      ...(presentation ? {presentation} : {})};
  });
}

/** Normalize once for a frozen contract, not once per checkpoint. */
export function buildTextParityCheckpointPlans(input: unknown, checkpoints: Array<{frameIndex: number; timeSeconds: number}>, motionVisibility: boolean | NativeTextVisibilityPolicy = false) {
  const document = compositionEditorDocumentSchema.parse(input);
  const projection = motionVisibility ? createMotionOpacityProjection(document, includesTransitions(motionVisibility)) : null;
  try {
    return checkpoints.map(({frameIndex, timeSeconds}) => {
      const expectedTexts = projectTextCheckpoint(document, timeSeconds, projection?.windows).expectedTexts;
      return {frameIndex, timeSeconds, expectedTexts: projection ? addVisibility(expectedTexts, document, timeSeconds, projection, motionVisibility) : expectedTexts};
    });
  } finally { projection?.dispose(); }
}
