export type Box = { x: number; y: number; width: number; height: number };

export type SceneLayout =
  | "AVATAR_FULL"
  | "TITLE_CARD"
  | "STATEMENT_CARD"
  | "WARNING_CARD"
  | "AVATAR_SLIDE_SPLIT"
  | "EVIDENCE_SPLIT"
  | "CTA_CARD"
  | "OUTRO";

export type FadeTransition = { type: "cut" | "fade"; durationFrames?: number };

export type SceneSpec = {
  id: string;
  layout: SceneLayout;
  startFrame: number;
  endFrame: number;
  transitionIn?: FadeTransition;
  transitionOut?: FadeTransition;
  avatar?: { clipOrder?: number; sourceStartFrame?: number; sourceEndFrame?: number; focalPoint?: { x: number; y: number } };
  slide?: { index: number; variant?: "image" | "html" };
  broll?: { order: number; sourceStartFrame?: number; sourceEndFrame?: number; loopMode?: "loop" | "freeze" | "none" };
  copy?: { eyebrow?: string; headline?: string; highlightedPhrases?: string[]; tone?: "light" | "dark"; icon?: "warning" };
  captionsEnabled?: boolean;
  outroUrl?: string;
  fallback?: "slide_full" | "avatar_full" | "card";
};

export type AvatarClip = { order: number; url: string; durationInFrames?: number };
export type BrollClip = { order: number; url: string; durationInFrames?: number };
export type SlideAsset = { index: number; kind?: "image" | "html"; url?: string; html?: string; classes?: string };
export type CaptionCue = { startFrame: number; endFrame: number; text: string };

export type LayoutOverrideEdit =
  | { layerId: string; kind: "position"; x: number; y: number }
  | { layerId: string; kind: "size"; width: number; height: number }
  | { layerId: string; kind: "crop"; top: number; right: number; bottom: number; left: number }
  | { layerId: string; kind: "rotation"; angle: number }
  | { layerId: string; kind: "visibility"; hidden: boolean }
  | { layerId: string; kind: "stack"; order: number };

export type LayoutOverrideManifest = { edits?: LayoutOverrideEdit[] };

export type TemplateProps = {
  schemaVersion?: number;
  totalDurationFrames?: number;
  totalDurationInFrames?: number;
  voiceAudioUrl?: string;
  bgMusicUrl?: string;
  bgMusicVolume?: number;
  avatarVideoUrl?: string;
  avatarClips?: AvatarClip[];
  slides?: SlideAsset[];
  brollClips?: BrollClip[];
  captionCues?: CaptionCue[];
  scenes?: SceneSpec[];
  layoutOverrides?: LayoutOverrideManifest[];
  timelineOverrides?: unknown[];
};
