"use client";

import { useMemo } from "react";
import { useAuthStore } from "@/core/stores/authStore";
import { useOrganizationStore } from "@/core/stores/organizationStore";
import type { CompositionHtmlEditorialHost } from "@/domains/production/composition-editor/composition-html-editing-native-host.client";
import { resolveHtmlEditingRecoveryContext } from "@/domains/production/composition-editor/composition-html-editing-recovery-context.client";
import { CompositionHtmlEditorialRecoveryPanel } from "./CompositionHtmlEditorialRecoveryPanel";
import { CompositionHtmlInitializationPanel } from "./CompositionHtmlInitializationPanel";
import { CompositionHtmlLegacyAdoptionRecoveryPanel } from "./CompositionHtmlLegacyAdoptionRecoveryPanel";
import { CompositionHtmlSnapshotHistoryPanel } from "./CompositionHtmlSnapshotHistoryPanel";
import { CompositionHtmlHistoricalPublicationPanel } from "./CompositionHtmlHistoricalPublicationPanel";
import { CompositionHtmlLegacyInventoryPanel } from "./CompositionHtmlLegacyInventoryPanel";

/** Draft-level recovery, not a selected-clip inspector. Child panels own commands and no
 * read/write flag hides persisted tracking. Individual panels own request aborts. */
export function CompositionHtmlRecoveryCenter({ draftId, host, compositionId }: {
  draftId: string; host: CompositionHtmlEditorialHost; compositionId?: string;
}) {
  const actorId = useAuthStore(state => state.user?.id ?? null);
  const organizationId = useOrganizationStore(state => state.activeOrganizationId);
  const context = useMemo(() => resolveHtmlEditingRecoveryContext({ actorId, organizationId, draftId }), [actorId, organizationId, draftId]);
  if (!context) return null;
  return <div className="max-h-64 shrink-0 overflow-y-auto empty:hidden" aria-label="Recuperación HTML del borrador">
    {compositionId && <CompositionHtmlHistoricalPublicationPanel key={`historical-publication:${context.key}:${compositionId}`} scope={context.scope} compositionId={compositionId} />}
    {compositionId && <CompositionHtmlSnapshotHistoryPanel key={`history:${context.key}:${compositionId}`} scope={context.scope} compositionId={compositionId} />}
    {compositionId && <CompositionHtmlLegacyInventoryPanel key={`legacy-inventory:${context.key}:${compositionId}`} scope={context.scope} compositionId={compositionId} />}
    <CompositionHtmlLegacyAdoptionRecoveryPanel key={`adoption:${context.key}`} scope={context.scope} host={host} />
    <CompositionHtmlInitializationPanel key={`initialization:${context.key}`} scope={context.scope} host={host} />
    <CompositionHtmlEditorialRecoveryPanel key={`editorial:${context.key}`} scope={context.scope} host={host} />
  </div>;
}
