"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { CompositionHtmlEditorialHost } from "@/domains/production/composition-editor/composition-html-editing-native-host.client";
import type { HtmlSnapshotLocatorScope } from "@/domains/production/composition-editor/composition-html-snapshot-locator.client";
import { htmlEditingInitializationRequestSchema } from "@/domains/production/composition-editor/composition-html-editing-initialization-http.contract";
import { HtmlEditingInitializationCoordinatorError, type HtmlEditingInitializationAction } from "@/domains/production/composition-editor/composition-html-editing-initialization-coordinator.client";

const initializationEnabled = process.env.NEXT_PUBLIC_COMPOSITION_HTML_EDITING_INITIALIZATION_ENABLED === "true";
/** Installed template locator only; source/declarations/grants remain server-side.
 * Unknown tracking stays visible even when new initialization is disabled. */
export function CompositionHtmlInitializationPanel({ scope, target, host }: {
  scope: HtmlSnapshotLocatorScope; target?: { clipId: string; documentHash: string }; host: CompositionHtmlEditorialHost;
}) {
  const templateInputId = useId(), versionInputId = useId();
  const [templateId, setTemplateId] = useState(""), [templateVersion, setTemplateVersion] = useState("1");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null), [, refresh] = useState(0);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => { requestRef.current?.abort(); }, []);
  const tracking = host.initializationTracking?.(scope);
  async function run(action: HtmlEditingInitializationAction) {
    if (requestRef.current || !host.initialize) return;
    const controller = new AbortController(); requestRef.current = controller; setBusy(true); setMessage(null);
    try {
      await host.initialize({ scope, action, signal: controller.signal });
      if (!controller.signal.aborted) setMessage("Inicialización confirmada y verificada. Consulta los campos HTML; no cambió el documento ni se creó historial de undo o render.");
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof HtmlEditingInitializationCoordinatorError && error.code === "ACK_REQUIRED"
        ? "Falta confirmación directa. Una consulta no prueba este intento: conserva el seguimiento y no repitas el envío."
        : "No se pudo completar la verificación. Conserva el seguimiento y recarga explícitamente la composición; no repitas la inicialización pendiente.");
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        if (!controller.signal.aborted) { setBusy(false); refresh(value => value + 1); }
      }
    }
  }
  function submit() {
    if (!target || !initializationEnabled || host.initializationTracking?.(scope).status !== "EMPTY") return;
    const body = htmlEditingInitializationRequestSchema.safeParse({ templateId, templateVersion: Number(templateVersion), expectedDocumentHash: target.documentHash });
    if (!body.success) { setMessage("Indica el identificador de una plantilla instalada y una versión entera válida."); return; }
    void run({ mode: "SEND", clipId: target.clipId, body: body.data });
  }
  if (!tracking || (target ? !initializationEnabled || tracking.status !== "EMPTY" : tracking.status === "EMPTY" && !message)) return null;
  return <section className="space-y-2 rounded border p-3 text-xs" aria-label="Inicialización HTML editable">
    <h3>{target ? "Inicializar campos HTML" : "Seguimiento de inicialización HTML"}</h3>
    {tracking.status === "UNAVAILABLE" && <p role="alert">Seguimiento inicial no disponible o dañado. No se borrará ni se reenviará.</p>}
    {tracking.status === "PENDING" && <>
      <p>Intento {tracking.entry.operationId} · clip {tracking.entry.clipId}.</p>
      <p>{tracking.entry.acknowledgment
        ? "Confirmación directa guardada. Recarga la composición y verifica el cierre sin reenviar."
        : "Resultado desconocido. Conserva este intento; no reenvíes ni borres el seguimiento. Una lectura actual no prueba esta inicialización."}</p>
      <button type="button" disabled={busy || !tracking.entry.acknowledgment || !host.initialize}
        onClick={() => void run({ mode: "RECOVER", operationId: tracking.entry.operationId })}>Verificar confirmación inicial sin reenviar</button>
    </>}
    {target && initializationEnabled && tracking.status === "EMPTY" && <form onSubmit={event => { event.preventDefault(); submit(); }} className="space-y-2">
      <p>Usa una plantilla instalada compatible con el HTML guardado. El servidor verifica permisos y compatibilidad; este formulario no instala ni activa plantillas.</p>
      <label htmlFor={templateInputId}>Identificador de plantilla instalada</label>
      <input id={templateInputId} value={templateId} onChange={event => setTemplateId(event.target.value)} disabled={busy} required className="w-full rounded border p-1" />
      <label htmlFor={versionInputId}>Versión de plantilla</label>
      <input id={versionInputId} type="number" min="1" step="1" value={templateVersion} onChange={event => setTemplateVersion(event.target.value)} disabled={busy} required className="w-full rounded border p-1" />
      <button type="submit" disabled={busy || !host.initialize}>Inicializar con guardado coordinado</button>
    </form>}
    <button type="button" disabled={busy} onClick={() => refresh(value => value + 1)}>Releer seguimiento inicial</button>
    {message && <p role="status">{message}</p>}
  </section>;
}
