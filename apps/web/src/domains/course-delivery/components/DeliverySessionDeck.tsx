"use client";

import { useEffect, useState } from "react";
import type { SessionDeckResult } from "../services/delivery-deck";
import styles from "./delivery-ui.module.css";

export function DeliverySessionDeck({ artifactId, sessionId, revision, approved }: {
  artifactId: string; sessionId: string; revision: number; approved: boolean;
}) {
  const [deck, setDeck] = useState<SessionDeckResult | null>(null);
  const [busy, setBusy] = useState(approved);
  const [error, setError] = useState("");
  const endpoint = `/api/artifacts/${artifactId}/delivery/sessions/${sessionId}/deck`;
  useEffect(() => {
    const controller = new AbortController();
    if (!approved) return () => controller.abort();
    void fetch(endpoint, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "No se pudo consultar la presentación.");
      if (!controller.signal.aborted) setDeck(result.deck);
    }).catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error && failure.name !== "TimeoutError" ? failure.message : "La consulta tardó demasiado. Reintenta para recuperar la presentación."); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [endpoint, revision, approved]);
  async function generate() {
    setBusy(true); setError("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision }), signal: AbortSignal.timeout(30_000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "No se pudo producir la presentación.");
      setDeck(result.deck);
    } catch (failure) { setError(failure instanceof Error && failure.name !== "TimeoutError" ? failure.message : "La confirmación tardó demasiado. Reintenta para consultar la misma presentación."); }
    finally { setBusy(false); }
  }
  return <DeliverySessionDeckView approved={approved} busy={busy} error={error} deck={deck} endpoint={endpoint} onGenerate={() => void generate()} />;
}

export function DeliverySessionDeckView({ approved, busy, error, deck, endpoint, onGenerate }: {
  approved: boolean; busy: boolean; error: string; deck: SessionDeckResult | null; endpoint: string; onGenerate: () => void;
}) {
  return <section aria-label="Deck de la sesión" className={styles.previewSection}>
    <h4>Presentación de la sesión</h4>
    {!approved && <p>Aprueba los materiales vigentes en Materiales para producir la presentación.</p>}
    {approved && !deck && <p>El contenido ya está preparado. Falta producir su deck visual.</p>}
    {approved && <button type="button" disabled={busy || Boolean(deck)} onClick={onGenerate}>
      {busy ? "Consultando presentación…" : deck ? "Deck guardado" : "Producir presentación"}
    </button>}
    {error && <p role="alert">{error}</p>}
    {approved && deck && <>
      <p role="status">{deck.qa.summary.slideCount} {deck.qa.summary.slideCount === 1 ? "diapositiva" : "diapositivas"} · QA: {deck.qa.status}{deck.status === "QA_FAILED" ? " · Corrige el contenido en Materiales antes de continuar." : " · Presentación producida"}</p>
      {deck.qa.findings.length > 0 && <details><summary>Diagnóstico de QA ({deck.qa.findings.length})</summary>
        <ul>{deck.qa.findings.map((finding, index) => <li key={index}>{finding.severity === "error" ? "Error" : "Advertencia"}{finding.slideId ? ` · ${finding.slideId}` : ""}: {finding.message}</li>)}</ul>
      </details>}
      {deck.status === "READY" && <>
        <iframe key={deck.id} title="Presentación visual de la sesión" src={`${endpoint}?preview=1&v=${deck.id}`}
          sandbox="allow-scripts" className={styles.deckFrame} />
        <a className={styles.exportDownload} href={`${endpoint}?download=1`}>Descargar presentación HTML</a>
      </>}
    </>}
  </section>;
}
