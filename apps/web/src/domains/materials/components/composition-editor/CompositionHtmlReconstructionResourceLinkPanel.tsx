"use client";

import { useEffect, useRef, useState } from "react";
import { consultHtmlReconstructionResource } from "@/domains/production/composition-editor/composition-html-editing-reconstruction-resource-link.client";
import { coordinateHtmlReconstructionResourceLink } from "@/domains/production/composition-editor/composition-html-editing-reconstruction-resource-link-coordinator.client";
import { readHtmlReconstructionResourceLinkJournal, type HtmlReconstructionResourceLinkScope,
  type HtmlReconstructionResourceLinkTracking } from "@/domains/production/composition-editor/composition-html-editing-reconstruction-resource-link-journal.client";
import { resolveHtmlSnapshotLocatorStorage } from "@/domains/production/composition-editor/composition-html-snapshot-locator.client";
import { resolveHtmlSnapshotPublicationLock } from "@/domains/production/composition-editor/composition-html-snapshot-publication-lock.client";
import type { HtmlReconstructionResourceCandidate } from "@/domains/production/composition-editor/composition-html-editing-reconstruction-resource-link.contract";

/** Explicit attachment UI, not a template catalogue, original-source importer,
 * upload/decode tool, native edit or snapshot approval. Missing dependencies fail
 * closed; recovery stays available with resource-link writes disabled. */
export function CompositionHtmlReconstructionResourceLinkPanel({scope, linkEnabled, onLinked}: {
  scope: HtmlReconstructionResourceLinkScope; linkEnabled: boolean; onLinked: () => Promise<void>;
}) {
  const [assetId, setAssetId] = useState(""), [candidate, setCandidate] = useState<HtmlReconstructionResourceCandidate | null>(null);
  const [tracking, setTracking] = useState<HtmlReconstructionResourceLinkTracking | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null), owner = JSON.stringify(scope), currentOwner = useRef<string | null>(owner);
  useEffect(() => {
    currentOwner.current = owner;
    return () => {currentOwner.current = null; inFlight.current?.abort();};
  }, [owner]);
  async function run(mode: "LOOKUP" | "CHECK" | "LINK" | "RECOVER" | "CLOSE") {
    if (inFlight.current) return;
    const controller = new AbortController(), storage = resolveHtmlSnapshotLocatorStorage(); inFlight.current = controller;
    setBusy(true); setMessage(null);
    const isCurrent = () => !controller.signal.aborted && currentOwner.current === owner;
    try {
      if (mode === "LOOKUP") {
        setCandidate(null);
        const found = await consultHtmlReconstructionResource({request: {actorId: scope.actorId, organizationId: scope.organizationId,
          draftId: scope.draftId, query: {compositionId: scope.compositionId, assetId: assetId.trim()}}, signal: controller.signal});
        if (isCurrent()) setCandidate(found);
      } else if (mode === "CHECK") {
        const current = await readHtmlReconstructionResourceLinkJournal(storage, scope);
        if (isCurrent()) setMessage(current.status === "EMPTY" ? "No hay enlaces pendientes."
          : current.status === "UNAVAILABLE" ? "El seguimiento está indisponible o corrupto. No se sobrescribirá."
            : "Hay una operación preservada. Consulta su recibo antes de continuar.");
      } else {
        if (mode === "LINK" && (!linkEnabled || !candidate || tracking?.status !== "EMPTY"
          || !window.confirm(`¿Vincular «${candidate.asset.label}» únicamente a este borrador independiente? No se insertará en la timeline ni se publicará.`))) return;
        if (mode !== "LINK" && tracking?.status !== "PENDING") return;
        const receipt = await coordinateHtmlReconstructionResourceLink({scope, storage, lock: resolveHtmlSnapshotPublicationLock(),
          signal: controller.signal, isCurrent,
          action: mode === "LINK" ? {mode: "LINK", candidate: candidate!, confirmedResourceOnly: true}
            : {mode, operationId: tracking!.status === "PENDING" ? tracking!.entry.command.operationId : ""},
        });
        if (isCurrent()) {
          setMessage(receipt.resourceLinked ? "Enlace confirmado. La selección/inserción y publicación siguen siendo acciones separadas."
            : `Enlace rechazado sin cambiar recursos ni documento: ${receipt.rejectionReason}. Puedes cerrar el seguimiento confirmado y revisar otra selección.`);
          if (receipt.resourceLinked) {
            setCandidate(null);
            await onLinked();
          }
        }
      }
    } catch (failure) {
      if (isCurrent()) setMessage(failure instanceof Error ? failure.message : "No se pudo confirmar la operación. Conserva su seguimiento.");
    } finally {
      const current = await readHtmlReconstructionResourceLinkJournal(storage, scope);
      if (isCurrent()) {setTracking(current); setBusy(false);}
      if (inFlight.current === controller) inFlight.current = null;
    }
  }
  return <details className="mb-3 rounded-lg border border-slate-300 p-3 dark:border-white/20">
    <summary>Vincular un medio existente de esta empresa</summary>
    <p className="my-2 text-sm">Consulta el identificador del medio registrado en Producción y revisa su identidad antes de vincularlo.
      No se copian bibliotecas ni archivos del original. Esta acción no admite HTML ni URLs externas.</p>
    <form onSubmit={event => {event.preventDefault(); void run("LOOKUP");}} className="flex flex-wrap gap-2">
      <label>Identificador del medio <input aria-label="Identificador del medio registrado" disabled={busy} value={assetId}
        maxLength={36} onChange={event => {setAssetId(event.target.value); setCandidate(null);}} /></label>
      <button type="submit" disabled={busy || !assetId.trim()}>Consultar medio</button>
    </form>
    {candidate && <div className="my-2 text-sm">
      <p>{candidate.asset.label} · {candidate.asset.mimeType} · {candidate.asset.fileSizeBytes} bytes</p>
      <p>SHA-256: <code className="break-all">{candidate.asset.checksum}</code></p>
      <p>{candidate.alreadyLinked ? "El medio ya está vinculado." : "Candidato verificado; todavía no vinculado."}</p>
      <button type="button" disabled={busy || !linkEnabled || candidate.alreadyLinked || tracking?.status !== "EMPTY"}
        onClick={() => void run("LINK")}>Vincular al borrador nuevo</button>
    </div>}
    {!linkEnabled && <p className="text-sm">Escrituras de enlace deshabilitadas; las consultas y recuperación siguen separadas.</p>}
    <div className="my-2 flex flex-wrap gap-2" aria-busy={busy}>
      <button type="button" disabled={busy} onClick={() => void run("CHECK")}>Consultar seguimiento local</button>
      {tracking?.status === "PENDING" && <>
        <span>Operación: <code>{tracking.entry.command.operationId}</code></span>
        <button type="button" disabled={busy} onClick={() => void run("RECOVER")}>Consultar recibo sin reenviar</button>
        <button type="button" disabled={busy || !tracking.entry.receipt} onClick={() => void run("CLOSE")}>Verificar recibo y cerrar seguimiento</button>
      </>}
    </div>
    {message && <p role="status" className="text-sm">{message}</p>}
  </details>;
}
