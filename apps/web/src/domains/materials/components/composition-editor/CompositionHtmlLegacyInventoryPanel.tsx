"use client";

import { useEffect, useRef, useState } from "react";
import type { HtmlSnapshotLocatorScope } from "@/domains/production/composition-editor/composition-html-snapshot-locator.client";
import { consultHtmlLegacyInventory } from "@/domains/production/composition-editor/composition-html-editing-legacy-inventory.client";
import type { HtmlLegacyInventoryPage } from "@/domains/production/composition-editor/composition-html-editing-legacy-inventory.contract";

const enabled = process.env.NEXT_PUBLIC_COMPOSITION_HTML_EDITING_INSPECTOR_ENABLED === "true"
  && process.env.NEXT_PUBLIC_COMPOSITION_HTML_LEGACY_INVENTORY_ENABLED === "true";
/** Current draft inventory: not the template catalogue or historical snapshot
 * browser. One page in memory; no parsing/rendering HTML or automatic adoption. */
export function CompositionHtmlLegacyInventoryPanel({scope, compositionId}: {scope: HtmlSnapshotLocatorScope; compositionId: string}) {
  const [page, setPage] = useState<HtmlLegacyInventoryPage | null>(null), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null), requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => requestRef.current?.abort(), []);
  async function consult(next: boolean) {
    if (requestRef.current || next && !page?.nextOrdinal) return;
    const controller = new AbortController(); requestRef.current = controller; setBusy(true); setError(null);
    const query = {compositionId, ...(next && page ? {afterOrdinal: page.nextOrdinal!, expectedDocumentHash: page.documentHash,
      expectedVersion: page.nativeVersion} : {})};
    // Clear the previous page before reading: a denied/stale read cannot retain
    // apparently current metadata or a cursor that invites skipping a failure.
    setPage(null);
    try {
      const current = await consultHtmlLegacyInventory({request: {...scope, query}, signal: controller.signal});
      if (!controller.signal.aborted) setPage(current);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Inventario no disponible.");
    } finally {
      if (requestRef.current === controller) {requestRef.current = null; if (!controller.signal.aborted) setBusy(false);}
    }
  }
  if (!enabled) return null;
  return <details className="space-y-2 rounded border p-3 text-xs" aria-label="Inventario del legado HTML" aria-busy={busy}>
    <summary>Inventario del legado HTML del borrador</summary>
    <p>Solo metadatos de slides guardadas. Un hash, una plantilla o un pointer no prueban compatibilidad,
      revisión visual ni autorización de sus recursos. No se migra ni ejecuta HTML.</p>
    <button type="button" disabled={busy} onClick={() => void consult(false)}>Consultar desde el inicio</button>
    {error && <p role="alert">{error}</p>}
    {page && <>
      <p role="status">Versión nativa {page.nativeVersion} · {page.entries.length} slides en esta página.</p>
      <p className="break-all">Base: {page.documentHash}</p>
      {!page.issuanceRevisionId && <p>No hay revisión de emisión. El piloto de adopción no puede iniciarse todavía.</p>}
      <ul>{page.entries.map(entry => <li key={entry.clipId} className="my-2">
        <p>Clip {entry.clipId} · {entry.sourceBytes} bytes</p>
        <p className="break-all">Fuente SHA-256: {entry.sourceSha256}</p>
        <p>{entry.nativePointerPresent ? "Pointer editorial presente; requiere verificación exacta." : "Sin pointer editorial guardado."}</p>
        {entry.template ? <p>Registro {entry.template.templateId} v{entry.template.templateVersion} · {entry.template.revoked ? "revocado" : "no revocado"}
          {entry.sourceSha256 !== entry.template.sourceSha256 ? " · fuente distinta al registro" : " · hash de fuente coincide"}</p>
          : <p>Sin registro de plantilla para este clip.</p>}
      </li>)}</ul>
      {page.nextOrdinal !== null ? <button type="button" disabled={busy} onClick={() => void consult(true)}>Consultar siguiente página</button>
        : <p>Fin del inventario de esta base. No acredita adopción ni cierre de trazabilidad.</p>}
    </>}
  </details>;
}
