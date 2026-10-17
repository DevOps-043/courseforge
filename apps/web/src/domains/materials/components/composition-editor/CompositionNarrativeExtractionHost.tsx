"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuthStore } from "@/core/stores/authStore";
import { useOrganizationStore } from "@/core/stores/organizationStore";
import { NarrativeEditorController, type NarrativeEditorSessionState, type NarrativeEditorReload } from "@/domains/production/composition-editor/composition-narrative-editor-controller";
import { narrativeExtractionPendingScopeSchema } from "@/domains/production/composition-editor/composition-narrative-extraction-pending";
import type { NarrativeExtractionQuery, NarrativeExtractionSummary } from "@/domains/production/composition-editor/composition-narrative-extraction-contract";
import type { NarrativeFragmentQuery, NarrativeFragmentSummary } from "@/domains/production/composition-editor/composition-narrative-fragment-contract";

type EditorialOwner = { canApply: () => boolean; beforeApply: () => void;
  reloadDocument: (receipt: NarrativeEditorReload) => Promise<boolean> };
type ExtractionHost = { enabled: boolean; fragmentEnabled: boolean; busy: boolean;
  isBlocked: () => boolean;
  registerOwner: (owner: EditorialOwner) => () => void;
  confirm: (selection: NarrativeExtractionQuery, summary: NarrativeExtractionSummary) => Promise<boolean>;
  confirmFragment: (query: NarrativeFragmentQuery, summary: NarrativeFragmentSummary) => Promise<boolean> };
const ExtractionContext = createContext<ExtractionHost | null>(null);
export const useNarrativeExtractionHost = () => useContext(ExtractionContext);

/** Scope changes remount both the editor and its command host; pending pointers stay scoped in storage. */
export function CompositionNarrativeExtractionHost({ draftId, enabled = false, fragmentEnabled = false, children }: {
  draftId: string; enabled?: boolean; fragmentEnabled?: boolean; children: ReactNode;
}) {
  const userId = useAuthStore(state => state.user?.id);
  const organizationId = useOrganizationStore(state => state.activeOrganizationId);
  return <ExtractionHostSession key={`${organizationId}:${userId}:${draftId}`} draftId={draftId}
    userId={userId} organizationId={organizationId} enabled={enabled} fragmentEnabled={fragmentEnabled}>{children}</ExtractionHostSession>;
}

function ExtractionHostSession({ draftId, organizationId, userId, enabled, fragmentEnabled, children }: {
  draftId: string; organizationId: string | null; userId: string | undefined; enabled: boolean; fragmentEnabled: boolean; children: ReactNode;
}) {
  const ownerRef = useRef<EditorialOwner | null>(null);
  const controllerRef = useRef<NarrativeEditorController | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [state, setState] = useState<NarrativeEditorSessionState>({ phase: "IDLE" });
  const [available, setAvailable] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState(false);
  const liveRef = useRef(true);
  useEffect(() => {
    liveRef.current = true;
    const parsed = narrativeExtractionPendingScopeSchema.safeParse({ organizationId, userId, draftId });
    if (!parsed.success) return;
    try {
      if (!navigator.locks) return;
      const controller = new NarrativeEditorController({ scope: parsed.data, storage: window.localStorage,
        exclusiveLock: async (name, task) => await navigator.locks.request(name, { mode: "exclusive" }, task),
        onState: next => { if (liveRef.current) setState(next); },
        reloadDocument: receipt => ownerRef.current?.reloadDocument(receipt) ?? Promise.resolve(false) });
      controllerRef.current = controller;
      controller.initialize();
      setAvailable(!controller.unavailable); setUnavailable(controller.unavailable);
    } catch { setUnavailable(true); }
    return () => { liveRef.current = false; abortRef.current?.abort(); controllerRef.current = null; };
  }, [draftId, organizationId, userId]);

  const registerOwner = useCallback((owner: EditorialOwner) => {
    ownerRef.current = owner;
    return () => { if (ownerRef.current === owner) ownerRef.current = null; };
  }, []);
  const isBlocked = useCallback(() => {
    const controller = controllerRef.current;
    return Boolean(controller && (controller.isBusy || controller.unavailable));
  }, []);
  const execute = async (action: "RECOVER" | "RELOAD") => {
    const controller = controllerRef.current;
    if (!controller || working) return;
    setWorking(true); setFailure(false);
    const abort = new AbortController(); abortRef.current = abort;
    try {
      const success = action === "RECOVER" ? await controller.recover(abort.signal) : await controller.reload();
      if (liveRef.current) { setFailure(!success); setUnavailable(controller.unavailable); }
    } finally { if (liveRef.current) setWorking(false); }
  };
  const confirmCommand = async (gate: boolean, review: (controller: NarrativeEditorController) => boolean,
    apply: (controller: NarrativeEditorController, signal: AbortSignal) => Promise<boolean>): Promise<boolean> => {
    const controller = controllerRef.current;
    const owner = ownerRef.current;
    if (!gate || !available || working || !controller || !owner?.canApply() || !review(controller)) return false;
    owner.beforeApply();
    setWorking(true); setFailure(false);
    const abort = new AbortController(); abortRef.current = abort;
    try {
      const result = await apply(controller, abort.signal);
      if (liveRef.current) setUnavailable(controller.unavailable);
      return result;
    } finally { if (liveRef.current) setWorking(false); }
  };
  const confirm = (selection: NarrativeExtractionQuery, summary: NarrativeExtractionSummary) =>
    confirmCommand(enabled, controller => controller.review(selection, summary), (controller, signal) => controller.apply(selection, signal));
  const confirmFragment = (query: NarrativeFragmentQuery, summary: NarrativeFragmentSummary) =>
    confirmCommand(fragmentEnabled, controller => controller.reviewFragment(query, summary), (controller, signal) => controller.applyFragment(query, signal));
  const pending = !["IDLE", "REVIEWED"].includes(state.phase);
  return <ExtractionContext.Provider value={{ enabled: enabled && available && !unavailable && !pending && !working,
    fragmentEnabled: fragmentEnabled && available && !unavailable && !pending && !working,
    busy: working || pending || unavailable, isBlocked, confirm, confirmFragment, registerOwner }}>
    {children}
    {(pending || unavailable) && <aside role="status" aria-label="Recuperación de extracción" className="fixed bottom-4 right-4 z-50 max-w-sm space-y-2 rounded border border-amber-500 bg-white p-3 text-xs shadow-lg dark:bg-slate-900">
      <p className="font-semibold">Recuperación de extracción</p>
      {unavailable ? <p>No hay recuperación local segura disponible. No se enviarán nuevas extracciones; conserva el registro para revisión.</p>
        : state.phase === "RELOAD_REQUIRED" ? <><p>Guardado confirmado. Recarga la composición vigente antes de continuar.</p>
          <button type="button" disabled={working} onClick={() => void execute("RELOAD")} className="rounded border px-2 py-1">Recargar composición</button></>
        : <><p>Resultado pendiente de confirmación. No repitas la extracción.</p>
          <button type="button" disabled={working || state.phase !== "UNCONFIRMED"} onClick={() => void execute("RECOVER")} className="rounded border px-2 py-1">Consultar resultado</button></>}
      {working && <p>Procesando…</p>}
      {failure && <p>La consulta o recarga no se confirmó. Se conserva el comando pendiente.</p>}
    </aside>}
  </ExtractionContext.Provider>;
}
