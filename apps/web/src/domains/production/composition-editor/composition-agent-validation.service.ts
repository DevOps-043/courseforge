import type { CompositionEditorDocument } from "./composition-document.types";
import type {
  CompositionAgentFieldChange,
  CompositionAgentValidationIssue,
} from "./composition-agent-proposal.types";

const OVERLAP_EPSILON_SECONDS = 0.001;

export class CompositionAgentValidationError extends Error {
  constructor(
    message: string,
    readonly issues: CompositionAgentValidationIssue[],
  ) {
    super(message);
  }
}

export function validateCompositionAgentSimulation(params: {
  after: CompositionEditorDocument;
  before: CompositionEditorDocument;
  diff: CompositionAgentFieldChange[];
}) {
  const issues: CompositionAgentValidationIssue[] = [];
  if (params.diff.length === 0) {
    issues.push({
      code: "AGENT_PROPOSAL_NO_EFFECT",
      message: "La propuesta no produce ningún cambio observable.",
      severity: "ERROR",
    });
  }

  const previousOverlaps = collectTrackOverlaps(params.before);
  for (const overlap of collectTrackOverlaps(params.after).values()) {
    const previousOverlap = previousOverlaps.get(overlap.key);
    if (
      previousOverlap
      && overlap.overlapSeconds <= previousOverlap.overlapSeconds + OVERLAP_EPSILON_SECONDS
    ) continue;
    issues.push({
      code: "AGENT_TIMELINE_OVERLAP_INTRODUCED",
      entityId: overlap.trackId,
      message: `La propuesta introduce o aumenta un solapamiento entre ${overlap.leftLabel} y ${overlap.rightLabel}.`,
      severity: "ERROR",
    });
  }

  const changedClipIds = new Set(
    params.diff
      .filter((change) => change.entityType === "CLIP")
      .map((change) => change.entityId),
  );
  const tracksById = new Map(params.after.tracks.map((track) => [track.id, track]));
  for (const clip of params.after.clips) {
    if (!changedClipIds.has(clip.id) || clip.kind === "AUDIO" || clip.hidden) continue;
    const track = tracksById.get(clip.trackId);
    if (track?.hidden) continue;
    const right = clip.layout.x + clip.layout.width;
    const bottom = clip.layout.y + clip.layout.height;
    const outside = right <= 0
      || bottom <= 0
      || clip.layout.x >= params.after.canvas.width
      || clip.layout.y >= params.after.canvas.height;
    if (outside) {
      issues.push({
        code: "AGENT_LAYOUT_OUTSIDE_CANVAS",
        entityId: clip.id,
        message: `${clip.label} quedaría completamente fuera del canvas.`,
        severity: "ERROR",
      });
      continue;
    }
    const partiallyOutside = clip.layout.x < 0
      || clip.layout.y < 0
      || right > params.after.canvas.width
      || bottom > params.after.canvas.height;
    if (partiallyOutside) {
      issues.push({
        code: "AGENT_LAYOUT_PARTIALLY_OUTSIDE_CANVAS",
        entityId: clip.id,
        message: `${clip.label} quedaría parcialmente fuera del canvas.`,
        severity: "WARNING",
      });
    }
  }

  const result = {
    issues,
    passed: !issues.some((issue) => issue.severity === "ERROR"),
  };
  if (!result.passed) {
    throw new CompositionAgentValidationError(
      issues.find((issue) => issue.severity === "ERROR")?.message
        || "La propuesta no superó la validación semántica.",
      issues,
    );
  }
  return result;
}

function collectTrackOverlaps(document: CompositionEditorDocument) {
  const overlaps = new Map<string, {
    key: string;
    leftLabel: string;
    overlapSeconds: number;
    rightLabel: string;
    trackId: string;
  }>();
  for (const track of document.tracks) {
    const clips = document.clips
      .filter((clip) => clip.trackId === track.id && !clip.hidden)
      .sort((left, right) => left.startSeconds - right.startSeconds || left.id.localeCompare(right.id));
    for (let leftIndex = 0; leftIndex < clips.length; leftIndex++) {
      const left = clips[leftIndex]!;
      const leftEnd = left.startSeconds + left.durationSeconds;
      for (let rightIndex = leftIndex + 1; rightIndex < clips.length; rightIndex++) {
        const right = clips[rightIndex]!;
        if (right.startSeconds >= leftEnd - OVERLAP_EPSILON_SECONDS) break;
        const ids = [left.id, right.id].sort();
        const key = `${track.id}:${ids[0]}:${ids[1]}`;
        overlaps.set(key, {
          key,
          leftLabel: left.label,
          overlapSeconds: leftEnd - right.startSeconds,
          rightLabel: right.label,
          trackId: track.id,
        });
      }
    }
  }
  return overlaps;
}
