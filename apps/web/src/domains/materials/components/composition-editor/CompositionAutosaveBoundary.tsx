"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type SyntheticEvent } from "react";
import { COMPOSITION_AUTOSAVE_DELAY_MS, CompositionAutosaveCoordinator, CompositionInteractionAutosave, type CompositionAutosaveCommit } from "@/domains/production/composition-editor/composition-interaction-autosave";

export const CompositionAutosaveContext = createContext<CompositionAutosaveCoordinator | null>(null);
export function useCompositionAutosavePending() {
  const coordinator = useContext(CompositionAutosaveContext);
  return useSyncExternalStore((listener) => coordinator?.subscribe(listener) ?? (() => {}), () => coordinator?.pending ?? false, () => false);
}

/** Preview local durante la interacción; persistencia sólo del último snapshot editado. */
export function CompositionAutosaveBoundary({ children, value, onCommit, disabled = false, className, signal }: {
  children: ReactNode; value: unknown; onCommit: CompositionAutosaveCommit; disabled?: boolean; className?: string; signal?: unknown;
}) {
  const coordinator = useContext(CompositionAutosaveContext);
  const [, redraw] = useState(0);
  const mounted = useRef(true);
  const session = useRef<CompositionInteractionAutosave | null>(null);
  if (!session.current) session.current = new CompositionInteractionAutosave(JSON.stringify(value), () => { if (mounted.current) redraw((version) => version + 1); coordinator?.changed(); });
  const current = session.current;
  const snapshot = useRef({ value, onCommit, disabled });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointer = useRef(false), composing = useRef(false);
  const priorSignal = useRef(signal);
  useLayoutEffect(() => {
    snapshot.current = { value, onCommit, disabled };
    if (eventTimer.current && !composing.current) current.stage(JSON.stringify(value), onCommit);
    else if (signal === priorSignal.current) current.observe(JSON.stringify(value));
  });
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    return coordinator ? coordinator.commit(current) : current.flush();
  }, [coordinator, current]);
  useEffect(() => {
    mounted.current = true;
    const unregister = coordinator?.register(current);
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (eventTimer.current) current.stage(JSON.stringify(snapshot.current.value), snapshot.current.onCommit);
      if (eventTimer.current) clearTimeout(eventTimer.current);
      // El coordinador conserva un borrador fallido aunque se cierre su panel.
      void flush().finally(() => unregister?.());
    };
  }, [coordinator, current, flush]);

  const owns = (event: SyntheticEvent<HTMLElement>) => {
    const target = event.target;
    return target instanceof Element && (target.closest("[data-composition-autosave]") === event.currentTarget || !event.currentTarget.contains(target));
  };
  const schedule = (immediate = false) => {
    if (snapshot.current.disabled) return;
    if (eventTimer.current) clearTimeout(eventTimer.current);
    eventTimer.current = setTimeout(() => {
      eventTimer.current = null;
      const next = snapshot.current;
      if (composing.current) return;
      current.stage(JSON.stringify(next.value), next.onCommit);
      if (!current.dirty || pointer.current) return;
      if (timer.current) clearTimeout(timer.current);
      // Un fallo no se reintenta por rerender: sólo por otra interacción o acción explícita.
      timer.current = setTimeout(() => { void flush(); }, immediate ? 0 : COMPOSITION_AUTOSAVE_DELAY_MS);
    }, 0);
  };
  const state = current.state;
  useEffect(() => {
    if (signal === priorSignal.current) return;
    priorSignal.current = signal;
    if (signal) { current.stage(JSON.stringify(snapshot.current.value), snapshot.current.onCommit); void flush(); }
  }, [signal, current, flush]);
  return <div data-composition-autosave="true" className={className}
    onChangeCapture={(event) => { if (owns(event)) schedule(); }}
    onClickCapture={(event) => {
      if (!owns(event)) return;
      if (event.target instanceof Element && event.target.closest("[data-composition-autosave-reset]")) {
        if (timer.current) clearTimeout(timer.current);
        if (eventTimer.current) clearTimeout(eventTimer.current);
        eventTimer.current = null; current.discard(); return;
      }
      schedule();
    }}
    onBlurCapture={(event) => { if (owns(event) && current.dirty) schedule(true); }}
    onPointerDownCapture={(event) => { if (owns(event) && event.target instanceof HTMLInputElement && event.target.type === "range") pointer.current = true; }}
    onPointerUpCapture={(event) => { if (owns(event) && pointer.current) { pointer.current = false; schedule(true); } }}
    onPointerCancelCapture={() => { pointer.current = false; schedule(true); }}
    onCompositionStartCapture={() => { composing.current = true; }}
    onCompositionEndCapture={() => { composing.current = false; schedule(); }}
    onKeyUpCapture={(event) => { if (owns(event) && (event.key === "Enter" && !(event.target instanceof HTMLTextAreaElement) || event.target instanceof HTMLInputElement && event.target.type === "range")) schedule(true); }}>
    {children}
    {state !== "IDLE" && <p role={state === "ERROR" ? "alert" : "status"} className="mt-1 text-[10px] text-slate-500 dark:text-slate-300">
      {state === "SAVING" ? "Guardando…" : state === "ERROR" ? "No se confirmó el cambio. El borrador se conserva; revisa el error del editor." : state === "INVALID" ? "Completa o corrige los valores para guardar automáticamente." : "Cambios pendientes de guardado automático."}
    </p>}
    {state === "ERROR" && <button type="button" disabled={disabled} className="text-[10px] underline" onClick={(event) => { event.stopPropagation(); void (coordinator ? coordinator.commit(current, true) : current.flush(true)); }}>Reintentar cambio pendiente</button>}
  </div>;
}
