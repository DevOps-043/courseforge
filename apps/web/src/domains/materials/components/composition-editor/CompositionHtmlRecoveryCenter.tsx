"use client";

import { useMemo } from "react";
import { useAuthStore } from "@/core/stores/authStore";
import { useOrganizationStore } from "@/core/stores/organizationStore";
import type { CompositionHtmlEditorialHost } from "@/domains/production/composition-editor/composition-html-editing-native-host.client";
import { resolveHtmlEditingRecoveryContext } from "@/domains/production/composition-editor/composition-html-editing-recovery-context.client";
import { CompositionHtmlEditorialRecoveryPanel } from "./CompositionHtmlEditorialRecoveryPanel";
import { CompositionHtmlInitializationPanel } from "./CompositionHtmlInitializationPanel";

/** Draft-level recovery, not a selected-clip inspector. No POST form here and no
 * read/write flag hides persisted tracking. Individual panels own request aborts. */
export function CompositionHtmlRecoveryCenter({ draftId, host }: {
  draftId: string; host: CompositionHtmlEditorialHost;
}) {
  const actorId = useAuthStore(state => state.user?.id ?? null);
  const organizationId = useOrganizationStore(state => state.activeOrganizationId);
  const context = useMemo(() => resolveHtmlEditingRecoveryContext({ actorId, organizationId, draftId }), [actorId, organizationId, draftId]);
  if (!context) return null;
  return <div className="max-h-64 shrink-0 overflow-y-auto empty:hidden" aria-label="Recuperación HTML del borrador">
    <CompositionHtmlInitializationPanel key={`initialization:${context.key}`} scope={context.scope} host={host} />
    <CompositionHtmlEditorialRecoveryPanel key={`editorial:${context.key}`} scope={context.scope} host={host} />
  </div>;
}
