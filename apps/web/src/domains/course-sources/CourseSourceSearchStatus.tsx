"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getCurationSnapshotAction, startCurationAction } from "../curation/actions/curation.actions";
import type { Curation } from "../curation/types/curation.types";
import { CURATION_RUNNING_STATES } from "@/lib/pipeline-constants";
import { usePolling } from "@/shared/hooks/usePolling";
import styles from "./course-source-ui.module.css";

const LABELS: Record<string, string> = {
  PHASE2_GENERATING: "Buscando fuentes web…", PHASE2_VALIDATING: "Validando fuentes…",
  PHASE2_BLOCKED: "La búsqueda requiere atención", PAUSED: "Búsqueda en pausa",
  PAUSED_REQUESTED: "Pausa solicitada", STOPPED: "Búsqueda detenida", STOPPED_REQUESTED: "Detención solicitada",
  PHASE2_DRAFT: "Búsqueda sin iniciar", PHASE2_GENERATED: "Búsqueda finalizada",
  PHASE2_HITL_REVIEW: "Fuentes listas para revisar", PHASE2_READY_FOR_QA: "Fuentes listas para revisar",
  PHASE2_APPROVED: "Búsqueda finalizada", PHASE2_CORRECTABLE: "Las fuentes necesitan correcciones",
};

export function CourseSourceSearchStatus({ artifactId, planReady, approved }: { artifactId: string; planReady: boolean; approved: boolean }) {
  const [curation, setCuration] = useState<Curation | null>(null);
  const [count, setCount] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const lastSnapshot = useRef("");
  const refresh = useCallback(async () => {
    try {
      const result = await getCurationSnapshotAction(artifactId);
      if (!result.success) throw new Error(result.error || "No se pudo consultar la búsqueda.");
      setCuration(result.curation || null);
      setCount(result.rows?.length || 0);
      const version = `${result.curation?.state || "none"}:${result.rows?.length || 0}`;
      if (lastSnapshot.current !== version) {
        lastSnapshot.current = version;
        window.dispatchEvent(new Event(`source-set-${artifactId}`));
      }
      setLoaded(true);
      setError("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo consultar el estado. Reintenta la consulta."); }
  }, [artifactId]);
  useEffect(() => { const timer = setTimeout(() => void refresh(), 0); return () => clearTimeout(timer); }, [refresh]);
  const running = Boolean(curation && (CURATION_RUNNING_STATES.has(curation.state) || curation.state === "PHASE2_VALIDATING"));
  usePolling(refresh, running || starting, { intervalMs: 3000 });
  async function start() {
    if (inFlight.current || running) return;
    inFlight.current = true; setStarting(true); setError("");
    try {
      const result = await startCurationAction(artifactId, 1, [], true);
      if (!result.success) throw new Error(result.error || "No se pudo iniciar la búsqueda.");
      await refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo iniciar la búsqueda."); }
    finally { inFlight.current = false; setStarting(false); }
  }
  const attention = curation && ["PHASE2_BLOCKED", "PAUSED", "STOPPED", "PHASE2_CORRECTABLE"].includes(curation.state);
  return <section className={styles.search} aria-label="Búsqueda de fuentes web" aria-busy={starting || running && !error}>
    <div role="status" className={styles.searchState}>
      {(starting || running && !error) && <span className={styles.spinner} aria-hidden="true" />}
      <strong>{starting ? "Iniciando búsqueda de fuentes…" : error ? "No se pudo consultar el estado actual" : !loaded ? "Consultando la búsqueda…" : curation ? LABELS[curation.state] || "Consulta el estado de las fuentes" : "Todavía no se ha iniciado una búsqueda"}</strong>
    </div>
    {loaded && <p className={styles.intro}>{error ? "Último dato recibido: " : ""}{count} registros de fuentes encontrados. El estado se actualiza durante la ejecución y se recupera al volver a abrir esta etapa.</p>}
    {attention && curation.qa_decision?.notes && <p role="status">{curation.qa_decision.notes}</p>}
    {error && <p role="alert">{error}</p>}
    {error && <p className={styles.intro}>Una consulta fallida no confirma que la ejecución se haya detenido. Pulsa «Consultar estado» para recuperar su situación antes de iniciar otra búsqueda.</p>}
    <div className="flex flex-wrap gap-3">
      {!approved && <button type="button" disabled={!loaded || !planReady || starting || running || Boolean(error)} onClick={() => void start()}>{error && !starting ? "Consulta el estado antes de continuar" : starting || running ? "Búsqueda en curso…" : curation ? "Completar búsqueda de fuentes pendientes" : "Buscar fuentes web para vacíos documentales"}</button>}
      <button type="button" disabled={starting} onClick={() => void refresh()}>Consultar estado</button>
    </div>
    {!planReady && <p className={styles.intro}>Aprueba el plan vigente antes de iniciar la búsqueda.</p>}
    <p className={styles.intro}>Las fuentes disponibles se actualizan al recibir resultados. Materiales utilizará el conjunto de fuentes válidas de cada lección; no necesitas seleccionarlas una por una.</p>
  </section>;
}
