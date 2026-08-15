import type { CompositionTrack } from "@/domains/production/composition-editor/composition-document.types";

export type CompositionTrackSettings = {
  hidden?: boolean;
  locked?: boolean;
  muted?: boolean;
  volume?: number;
};

export type CompositionTrackUpdateHandler = (
  track: CompositionTrack,
  settings: CompositionTrackSettings,
  summary: string,
) => void;
