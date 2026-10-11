"use client";

import { useEffect, useRef, useState } from "react";
import type { CompositionHtmlEditorialHost } from "@/domains/production/composition-editor/composition-html-editing-native-host.client";
import type { HtmlSnapshotLocatorScope } from "@/domains/production/composition-editor/composition-html-snapshot-locator.client";

/** Explicit prerequisite only. Availability is not registration or an operation
 * receipt. After an uncertain POST, only an explicit consultation is offered. */
export function CompositionHtmlInitialAnchorStep({ scope, host, disabled, onAvailabilityChange }: {
  scope: HtmlSnapshotLocatorScope; host: CompositionHtmlEditorialHost; disabled: boolean; onAvailabilityChange: (available: boolean) => void;
}) {
  const [status, setStatus] = useState<"UNCHECKED" | "MISSING" | "AVAILABLE" | "UNKNOWN">("UNCHECKED");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function run(action: "CONSULT" | "PREPARE") {
    if (!host.initialAnchor || disabled || pending.current || (action === "PREPARE" && status !== "MISSING")) return;
    const controller = new AbortController(); pending.current = controller; setBusy(true); setError(null);
    onAvailabilityChange(false);
    try {
      const view = await host.initialAnchor({ scope, action, signal: controller.signal });
      if (!controller.signal.aborted) {
        setStatus(view.activeRevisionId ? "AVAILABLE" : "MISSING");
        onAvailabilityChange(Boolean(view.activeRevisionId));
      }
    } catch {
      if (!controller.signal.aborted) {
        setStatus("UNKNOWN");
        setError("No se pudo comprobar la revisión guardada. Consulta su disponibilidad; no se repetirá la preparación automáticamente. Si falta calcular la duración, recalcúlala u organiza el timeline antes de continuar.");
      }
    } finally {
      if (pending.current === controller) { pending.current = null; if (!controller.signal.aborted) setBusy(false); }
    }
  }
  if (!host.initialAnchor) return null;
  return <div aria-label="Revisión necesaria para editar" aria-busy={busy}>
    <p><strong>1. Comprueba la revisión guardada</strong></p>
    <p>Para habilitar los campos necesitas una versión de esta composición guardada. Prepararla crea la primera versión de salida; no cambia el timeline, no aprueba el video ni ejecuta un render.</p>
    <button type="button" disabled={disabled || busy} onClick={() => void run("CONSULT")}>
      {busy ? "Comprobando…" : status === "AVAILABLE" ? "Volver a comprobar revisión" : "Comprobar revisión guardada"}
    </button>
    {status === "MISSING" && <>
      <p role="status">Todavía no hay una revisión activa. Guarda la primera para continuar.</p>
      <button type="button" data-primary="true" disabled={disabled || busy} onClick={() => void run("PREPARE")}>Preparar primera revisión para editar</button>
    </>}
    {status === "AVAILABLE" && <p role="status">Revisión disponible. Ahora busca la plantilla compatible y habilita sus campos.</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
