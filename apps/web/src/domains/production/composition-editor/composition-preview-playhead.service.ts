const DEFAULT_TIME_CONFIRMATION_TOLERANCE_SECONDS = 0.05;

export type PreviewTimeMessageDecision = {
  accept: boolean;
  completesRestore: boolean;
};

/** Keeps the parent playhead stable while a freshly compiled preview boots at zero. */
export function classifyPreviewTimeMessage(params: {
  pendingRestoreSeconds: number | null;
  pendingSeekSeconds: number | null;
  reportedSeconds: number;
  toleranceSeconds?: number;
}): PreviewTimeMessageDecision {
  const toleranceSeconds = params.toleranceSeconds ?? DEFAULT_TIME_CONFIRMATION_TOLERANCE_SECONDS;
  const hasPendingRestore = params.pendingRestoreSeconds !== null;
  const hasPendingSeek = params.pendingSeekSeconds !== null;

  if (hasPendingRestore && !hasPendingSeek) {
    return { accept: false, completesRestore: false };
  }
  if (
    hasPendingSeek
    && Math.abs(params.reportedSeconds - params.pendingSeekSeconds!) > toleranceSeconds
  ) {
    return { accept: false, completesRestore: false };
  }

  return {
    accept: true,
    completesRestore: hasPendingRestore && hasPendingSeek,
  };
}

export function clampPreviewPlayhead(seconds: number, durationSeconds: number) {
  return Math.max(0, Math.min(durationSeconds, seconds));
}

export function isPreviewRefreshRequired(params: {
  persistedDocumentHash: string | null;
  previewDirty: boolean;
  previewDocumentHash: string | null;
}) {
  return params.previewDirty || (
    params.persistedDocumentHash !== null
    && params.persistedDocumentHash !== params.previewDocumentHash
  );
}
