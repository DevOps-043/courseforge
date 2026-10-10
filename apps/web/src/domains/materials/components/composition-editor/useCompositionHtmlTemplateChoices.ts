"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { consultHtmlTemplateChoices } from "@/domains/production/composition-editor/composition-html-editing-template-choices.client";
import type { HtmlTemplateChoicesView } from "@/domains/production/composition-editor/composition-html-editing-template-choices.contract";
import type { HtmlSnapshotLocatorScope } from "@/domains/production/composition-editor/composition-html-snapshot-locator.client";

/** Local owner key masks previous results immediately, before effect cleanup.
 * One explicit consultation, never initialization or automatic background fetch. */
export function useCompositionHtmlTemplateChoices(scope: HtmlSnapshotLocatorScope, target?: { clipId: string; documentHash: string }) {
  const ownerKey = JSON.stringify([scope.actorId, scope.organizationId, scope.draftId, target?.clipId, target?.documentHash]);
  const owner = useMemo(() => ({ key: ownerKey }), [ownerKey]);
  const activeOwner = useRef(owner); activeOwner.current = owner;
  const pending = useRef<AbortController | null>(null);
  const [result, setResult] = useState<{ owner: typeof owner; view?: HtmlTemplateChoicesView; error?: string; busy: boolean }>();
  useEffect(() => () => { pending.current?.abort(); pending.current = null; }, [owner]);
  const current = result?.owner === owner ? result : undefined;
  async function consult() {
    if (!target || pending.current || activeOwner.current !== owner) return;
    const controller = new AbortController(); pending.current = controller;
    setResult({ owner, busy: true });
    try {
      const view = await consultHtmlTemplateChoices({ request: { documentId: scope.draftId, clipId: target.clipId,
        expectedDocumentHash: target.documentHash }, signal: controller.signal });
      if (!controller.signal.aborted && activeOwner.current === owner) setResult({ owner, view, busy: false });
    } catch (error) {
      if (!controller.signal.aborted && activeOwner.current === owner) setResult({ owner, busy: false,
        error: error instanceof Error ? error.message : "No se pudo consultar el catálogo instalado." });
    } finally { if (pending.current === controller) pending.current = null; }
  }
  return { view: current?.view, error: current?.error, busy: current?.busy ?? false, consult };
}
