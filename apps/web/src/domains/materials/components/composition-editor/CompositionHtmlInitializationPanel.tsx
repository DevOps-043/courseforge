"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { CompositionHtmlEditorialHost } from "@/domains/production/composition-editor/composition-html-editing-native-host.client";
import type { HtmlSnapshotLocatorScope } from "@/domains/production/composition-editor/composition-html-snapshot-locator.client";
import { htmlEditingInitializationRequestSchema } from "@/domains/production/composition-editor/composition-html-editing-initialization-http.contract";
import { HtmlEditingInitializationCoordinatorError, type HtmlEditingInitializationAction } from "@/domains/production/composition-editor/composition-html-editing-initialization-coordinator.client";
import { useCompositionHtmlTemplateChoices } from "./useCompositionHtmlTemplateChoices";
import { ListChecks } from "lucide-react";
import { CompositionHtmlPanel } from "./CompositionHtmlPanel";
import { CompositionHtmlInitialAnchorStep } from "./CompositionHtmlInitialAnchorStep";

const initializationEnabled = process.env.NEXT_PUBLIC_COMPOSITION_HTML_EDITING_INITIALIZATION_ENABLED === "true";
/** Installed template locator only; source/declarations/grants remain server-side.
 * Unknown tracking stays visible even when new initialization is disabled. */
export function CompositionHtmlInitializationPanel({ scope, target, host }: {
  scope: HtmlSnapshotLocatorScope; target?: { clipId: string; documentHash: string }; host: CompositionHtmlEditorialHost;
}) {
  const templateInputId = useId();
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [anchorAvailable, setAnchorAvailable] = useState(false);
  const catalog = useCompositionHtmlTemplateChoices(scope, target);
  const choice = catalog.view?.templates.find(template => JSON.stringify([template.templateId, template.templateVersion]) === selectedTemplate);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null), [, refresh] = useState(0);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => { requestRef.current?.abort(); }, []);
  const tracking = host.initializationTracking?.(scope);
  async function run(action: HtmlEditingInitializationAction) {
    if (requestRef.current || !host.initialize) return;
    const controller = new AbortController(); requestRef.current = controller; setBusy(true); setMessage(null);
    try {
      await host.initialize({ scope, action, signal: controller.signal });
      if (!controller.signal.aborted) setMessage(action.mode === "RECOVER" && action.historicalOnly
        ? "Registro histórico confirmado por recibo autorizado. No se restauró ni adoptó su revisión; consulta el estado actual antes de editar."
        : "Inicialización confirmada y verificada. Consulta los campos HTML; no cambió el documento ni se creó historial de undo o render.");
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof HtmlEditingInitializationCoordinatorError && error.code === "ACK_REQUIRED"
        ? "No hay un recibo durable confirmado para este intento. Conserva el seguimiento y no repitas el envío; una lectura del estado actual no demuestra su resultado."
        : "No se pudo completar la verificación. Conserva el seguimiento y recarga explícitamente la composición; no repitas la inicialización pendiente.");
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        if (!controller.signal.aborted) { setBusy(false); refresh(value => value + 1); }
      }
    }
  }
  function submit() {
    if (!target || !initializationEnabled || host.initializationTracking?.(scope).status !== "EMPTY"
      || (host.initialAnchor && !anchorAvailable)) return;
    if (!choice || catalog.busy) { setMessage("Consulta el catálogo y selecciona una plantilla instalada para este HTML guardado."); return; }
    const body = htmlEditingInitializationRequestSchema.safeParse({ templateId: choice.templateId,
      templateVersion: choice.templateVersion, expectedDocumentHash: target.documentHash });
    if (!body.success) { setMessage("La selección de plantilla no es válida."); return; }
    void run({ mode: "SEND", clipId: target.clipId, body: body.data });
  }
  if (!tracking || (target ? !initializationEnabled || tracking.status !== "EMPTY" : tracking.status === "EMPTY" && !message)) return null;
  return <CompositionHtmlPanel title={target ? "Preparar campos HTML" : "Seguimiento de inicialización HTML"}
    label="Inicialización HTML editable" icon={ListChecks} collapsible={Boolean(target)} busy={busy || catalog.busy}>
    {tracking.status === "UNAVAILABLE" && <p role="alert">Seguimiento inicial no disponible o dañado. No se borrará ni se reenviará.</p>}
    {tracking.status === "PENDING" && <>
      <p>Intento {tracking.entry.operationId} · clip {tracking.entry.clipId}.</p>
      <p>{tracking.entry.acknowledgment
        ? "Confirmación guardada. Recarga la composición y verifica el cierre sin reenviar."
        : tracking.entry.requestSha256
          ? "Resultado desconocido. Consulta el recibo durable de esta operación sin reenviar ni borrar el seguimiento."
          : "Intento legacy sin identidad durable. Conserva el seguimiento; una lectura actual no prueba esta inicialización."}</p>
      <button type="button" disabled={busy || (!tracking.entry.acknowledgment && !tracking.entry.requestSha256) || !host.initialize}
        onClick={() => void run({ mode: "RECOVER", operationId: tracking.entry.operationId })}>Verificar confirmación inicial sin reenviar</button>
      {tracking.entry.requestSha256 && <>
        <p>Si el documento ya cambió, puedes confirmar solo el registro histórico. Esto no restaura campos ni confirma el estado editable actual.</p>
        <button type="button" disabled={busy || !host.initialize}
          onClick={() => void run({ mode: "RECOVER", operationId: tracking.entry.operationId, historicalOnly: true })}>
          Confirmar solo el registro histórico sin restaurar
        </button>
      </>}
    </>}
    {target && initializationEnabled && tracking.status === "EMPTY" && <form onSubmit={event => { event.preventDefault(); submit(); }} className="space-y-2">
      <CompositionHtmlInitialAnchorStep scope={scope} host={host} disabled={busy || catalog.busy}
        onAvailabilityChange={setAnchorAvailable} />
      <p><strong>2. Habilita los campos de la diapositiva</strong></p>
      <p>Usa este paso si la diapositiva todavía no tiene campos editables. Busca una plantilla compatible, selecciónala y confirma la preparación.</p>
      <p>Solo se consultan plantillas ya instaladas. No se instala ni activa ninguna; se vuelven a comprobar permisos y compatibilidad.</p>
      <button type="button" disabled={busy || catalog.busy || Boolean(host.initialAnchor && !anchorAvailable)} onClick={() => { setSelectedTemplate(""); void catalog.consult(); }}>
        {catalog.busy ? "Buscando plantillas…" : "Buscar plantillas compatibles"}
      </button>
      {catalog.error && <p role="alert">{catalog.error}</p>}
      {catalog.view && catalog.view.templates.length === 0 && <p role="status">No hay una plantilla instalada compatible. Un administrador debe preparar una antes de continuar. No se modificó la diapositiva.</p>}
      {catalog.view && catalog.view.templates.length > 0 && <>
        <label htmlFor={templateInputId}>Plantilla instalada para este HTML</label>
        <select id={templateInputId} value={choice ? selectedTemplate : ""} onChange={event => setSelectedTemplate(event.target.value)}
          disabled={busy || catalog.busy} required className="w-full rounded border p-1">
          <option value="">Selecciona una plantilla</option>
          {catalog.view.templates.map(template => <option key={JSON.stringify([template.templateId, template.templateVersion])}
            value={JSON.stringify([template.templateId, template.templateVersion])}>
            {template.templateId} · v{template.templateVersion} · {template.fieldCount} campos
          </option>)}
        </select>
      </>}
      <button type="submit" data-primary="true" disabled={busy || catalog.busy || !choice || !host.initialize || Boolean(host.initialAnchor && !anchorAvailable)}>Habilitar campos con esta plantilla</button>
    </form>}
    {!target && <button type="button" disabled={busy} onClick={() => refresh(value => value + 1)}>Actualizar seguimiento</button>}
    {message && <p role="status">{message}</p>}
  </CompositionHtmlPanel>;
}
