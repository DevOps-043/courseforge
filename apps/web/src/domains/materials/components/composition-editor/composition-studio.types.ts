import type { CompositionClip, CompositionEditorDocument, CompositionTrack } from "@/domains/production/composition-editor/composition-document.types";
import type { CompositionAgentProposalEnvelope } from "@/domains/production/composition-editor/composition-agent-proposal.types";
import type { CompositionAgentRecoveryMetadata } from "@/domains/production/composition-editor/composition-agent-recovery.service";

export type CompositionAgentProposal = CompositionAgentProposalEnvelope & {
  documentHash: string;
  expiresAt: string;
  model: string;
  recovery: CompositionAgentRecoveryMetadata;
};

export interface CompositionDocumentPayload {
  document: CompositionEditorDocument;
  documentHash: string;
  version: number;
}

export type CompositionTrackSettings = {
  label?: string;
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

export interface CompositionStudioLesson {
  completed: boolean;
  id: string;
  subtitle: string;
  title: string;
}

export interface CompositionStudioAsset {
  deckClip?: CompositionClip;
  detachedFromAssetId?: string;
  detachedFromClipId?: string;
  durationSeconds?: number;
  hasAudio?: boolean;
  id: string;
  isEditable: boolean;
  label: string;
  mimeType: string;
  previewUrl: string | null;
  sourceHeight?: number;
  sourceWidth?: number;
  sizeLabel: string;
  sourceLabel: string;
  timelineRole?: "AUDIO" | "AVATAR" | "BROLL" | "MEDIA" | "VISUAL" | "VOICE";
  timelineVariant?: "CLIP" | "FULL";
  valid: boolean;
}
