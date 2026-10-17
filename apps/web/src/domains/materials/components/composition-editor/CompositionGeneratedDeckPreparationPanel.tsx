"use client";

import { useEffect, useRef, useState } from "react";
import { Layers } from "lucide-react";
import type { CompositionEditorDocument } from "@/domains/production/composition-editor/composition-document.types";
import type { CompositionHtmlEditorialHost } from "@/domains/production/composition-editor/composition-html-editing-native-host.client";
import type { HtmlSnapshotLocatorScope } from "@/domains/production/composition-editor/composition-html-snapshot-locator.client";
import { GeneratedDeckInitializationCoordinatorError, type GeneratedDeckInitializationAction } from "@/domains/production/composition-editor/composition-generated-deck-initialization-coordinator.client";
import { CompositionHtmlPanel } from "./CompositionHtmlPanel";
import { CompositionHtmlInitialAnchorStep } from "./CompositionHtmlInitialAnchorStep";

const writesEnabled = process.env.NEXT_PUBLIC_COMPOSITION_HTML_EDITING_INSPECTOR_ENABLED === "true"
  && process.env.NEXT_PUBLIC_COMPOSITION_HTML_EDITING_INITIALIZATION_ENABLED === "true";

/** Visibility hints are not catalog/permission authority. Host reconstructs the
 * exact owned material. No effect performs a request, registration or retry. */
export function CompositionGeneratedDeckPreparationPanel({ scope, host, document }: {
  scope: HtmlSnapshotLocatorScope; host: CompositionHtmlEditorialHost; document?: CompositionEditorDocument;
}) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null);
  const [anchorAvailable, setAnchorAvailable] = useState(false), [, refresh] = useState(0);
  const [checkAnchorFirst, setCheckAnchorFirst] = useState(false);
  const pendingRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    const changed = () => refresh(value => value + 1);
    window.addEventListener("storage", changed);
    return () => { window.removeEventListener("storage", changed); pendingRequest.current?.abort(); };
  }, []);
  const tracking = host.generatedDeckTracking?.(scope);
  const boundIds = new Set(document?.htmlEditing?.items.map(item => item.clipId) ?? []);
  const clips = document?.clips.filter(clip => clip.kind === "DECK_SLIDE" && !boundIds.has(clip.id)) ?? [];
  const compatibleHint = clips.length > 0 && clips.every(clip => clip.source.type === "DECK_SLIDE"
    && !clip.source.htmlAssetId && clip.source.html.includes("data-courseforge-editable-id"));
  async function run(action: GeneratedDeckInitializationAction) {
    if (pendingRequest.current || !host.prepareGeneratedDeck) return;
    const controller = new AbortController(); pendingRequest.current = controller; setBusy(true); setMessage(null);
    try {
      const current = await host.prepareGeneratedDeck({ scope, action, signal: controller.signal });
      if (!controller.signal.aborted) setMessage(current
        ? `${current.receipt.items.length} diapositivas y ${current.fieldCount} campos preparados. Selecciona una diapositiva y pulsa «Cargar campos editables» para cambiar su contenido. No se ejecutó un render.`
        : "Registro histórico confirmado. No se restauró el contenido ni se cambió el borrador actual.");
    } catch (error) {
      if (!controller.signal.aborted) {
        if (host.generatedDeckTracking?.(scope).status === "EMPTY") setCheckAnchorFirst(true);
        setMessage(error instanceof GeneratedDeckInitializationCoordinatorError && error.code === "ANCHOR_REQUIRED"
        ? "Primero comprueba y prepara la revisión guardada en el paso 1. No se envió el lote."
        : error instanceof GeneratedDeckInitializationCoordinatorError && error.code === "ACK_REQUIRED"
          ? "El recibo todavía no está confirmado. Conserva el seguimiento y vuelve a consultarlo; no repitas el envío."
          : "No se completó la verificación. Si hay un intento pendiente, consulta su seguimiento sin reenviar. Si todavía no se envió el lote, comprueba la revisión guardada antes de volver a preparar. Los HTML antiguos o externos requieren preparación individual.");
      }
    } finally {
      if (pendingRequest.current === controller) {
        pendingRequest.current = null;
        if (!controller.signal.aborted) { setBusy(false); refresh(value => value + 1); }
      }
    }
  }
  if (!tracking || !host.prepareGeneratedDeck || (tracking.status === "EMPTY" && !message && !busy && (!writesEnabled || !compatibleHint))) return null;
  return <CompositionHtmlPanel title={tracking.status === "EMPTY" ? clips.length ? `Preparar todas las diapositivas (${clips.length})` : "Diapositivas preparadas" : "Seguimiento de preparación del deck"}
    label="Preparación de todas las diapositivas" icon={Layers} collapsible initiallyOpen={tracking.status !== "EMPTY"} busy={busy}
    description="Habilita juntas las diapositivas de las nuevas generaciones de Engine. Si falta la primera revisión guardada, la prepara dentro de este flujo. Conserva las ya editadas; no convierte HTML antiguo ni cambia escenas, duración o diseño.">
    {tracking.status === "UNAVAILABLE" && <p role="alert">El seguimiento local no está disponible o está dañado. No se borrará ni se reenviará el lote.</p>}
    {tracking.status === "PENDING" && <>
      <p role="status">{tracking.entry.receipt ? "Recibo guardado; falta confirmar el estado actual." : "Resultado desconocido; consulta el recibo sin repetir el envío."}</p>
      <button type="button" disabled={busy} onClick={() => void run({ mode: "RECOVER", operationId: tracking.entry.request.operationId })}>Consultar y verificar preparación</button>
      <details><summary>Si el borrador ya cambió</summary>
        <p>Confirma únicamente el registro histórico. No restaura, activa ni sobrescribe ninguna diapositiva. Recarga antes el borrador actual.</p>
        <button type="button" disabled={busy} onClick={() => void run({ mode: "RECOVER", operationId: tracking.entry.request.operationId, historicalOnly: true })}>Confirmar solo registro histórico</button>
      </details>
    </>}
    {tracking.status === "EMPTY" && compatibleHint && writesEnabled && <>
      {checkAnchorFirst && <CompositionHtmlInitialAnchorStep scope={scope} host={host} disabled={busy}
        onAvailabilityChange={setAnchorAvailable} availableMessage="Revisión disponible. Ahora puedes preparar juntas las diapositivas pendientes." />}
      <p>Se guardará una versión nativa con los campos de {clips.length} diapositivas. No ejecuta un render ni aprueba el video.</p>
      <button type="button" data-primary="true" disabled={busy || (checkAnchorFirst && !anchorAvailable)} onClick={() => void run({ mode: "SEND" })}>Preparar todas las diapositivas</button>
    </>}
    {message && <p role="status">{message}</p>}
  </CompositionHtmlPanel>;
}
