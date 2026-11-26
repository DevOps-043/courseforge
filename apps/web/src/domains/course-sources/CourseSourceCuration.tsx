"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { sourceJsonRequest } from "./course-source.client";
import {
  CourseSourceReviewPanel,
  type SourceReviewSnapshot,
} from "./CourseSourceReviewPanel";
import { CourseSourceSearchStatus } from "./CourseSourceSearchStatus";
import { materialSourceSetAvailability } from "./course-source-material-set";
import styles from "./course-source-ui.module.css";
export function CourseSourceCuration({
  artifactId,
  children,
  onNext,
}: {
  artifactId: string;
  children: ReactNode;
  onNext?: () => void;
}) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<SourceReviewSnapshot | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [expandedLesson, setExpandedLesson] = useState<string | null>(null);
  useEffect(() => {
    const reload = () =>
      void sourceJsonRequest(`/api/artifacts/${artifactId}/sources/review`)
        .then(setSnapshot)
        .catch(() =>
          setMessage(
            "No se pudo verificar la política de fuentes. Actualiza antes de continuar.",
          ),
        );
    const timer = setTimeout(reload, 0);
    window.addEventListener(`source-review-${artifactId}`, reload);
    window.addEventListener(`source-set-${artifactId}`, reload);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(`source-review-${artifactId}`, reload);
      window.removeEventListener(`source-set-${artifactId}`, reload);
    };
  }, [artifactId, refreshVersion]);
  if (!snapshot)
    return <p role="status">{message || "Verificando política de fuentes…"}</p>;
  if (!snapshot.configured || snapshot.policy === "WEB_ONLY") return children;
  const availability = materialSourceSetAvailability(snapshot.policy, snapshot.planReady, snapshot.lessons, snapshot.evidence);
  async function continueWithAll() {
    if (!snapshot || busy) return;
    setBusy(true); setMessage("");
    try {
      await sourceJsonRequest(`/api/artifacts/${artifactId}/sources/review`, {
        action: "use-all", expectedRevision: snapshot.revision, curriculumHash: snapshot.curriculumHash,
      });
      setMessage("Conjunto completo habilitado para Materiales."); router.refresh(); onNext?.();
    } catch (failure) { setMessage(failure instanceof Error ? failure.message : "No se pudo preparar el conjunto de fuentes."); }
    finally { setBusy(false); }
  }
  return (
    <div className="space-y-5">
      {snapshot.policy === "DOCUMENTS_AND_WEB" && <CourseSourceSearchStatus key={artifactId} artifactId={artifactId} planReady={snapshot.planReady}
        approved={snapshot.lessons.length > 0 && snapshot.lessons.every(lesson => snapshot.evidence.filter(item => item.type === "WEB" && item.lessonId === lesson.id).length >= Math.max(1, lesson.webRequired))} />}
      <section className={styles.policy} aria-label="Conjunto completo de fuentes">
        <h2 className="text-xl font-semibold">Fuentes del curso · Uso automático</h2>
        <p>Materiales utilizará todos los documentos procesados y todas las fuentes web válidas de cada lección, según la política del curso. No necesitas elegir una evidencia por objetivo.</p>
        <p>{availability.documentFragments} fragmentos documentales · {availability.webSources} fuentes web válidas.</p>
        <button type="button" disabled={busy} onClick={() => setRefreshVersion(value => value + 1)}>Actualizar fuentes disponibles</button>
        {availability.issues.length > 0 && <ul aria-label="Requisitos para Materiales" className="list-disc space-y-2 pl-5">{availability.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
        {snapshot.lessons.map(lesson => <details key={lesson.id} className={styles.step} open={expandedLesson === lesson.id}
          onToggle={event => {
            if (event.currentTarget.open) setExpandedLesson(lesson.id);
            else setExpandedLesson(current => current === lesson.id ? null : current);
          }}>
          <summary className="cursor-pointer font-semibold">{lesson.title} · {snapshot.evidence.filter(item => item.type === "DOCUMENT" || snapshot.policy === "DOCUMENTS_AND_WEB" && item.lessonId === lesson.id).length} evidencias</summary>
          {expandedLesson === lesson.id && <ul className="mt-3 list-disc space-y-2 pl-5">{snapshot.evidence.filter(item => item.type === "DOCUMENT" || snapshot.policy === "DOCUMENTS_AND_WEB" && item.lessonId === lesson.id).map(item => <li key={item.id} className="break-words text-sm">{item.type === "DOCUMENT" ? "Documento" : "Web"} · {item.title}</li>)}</ul>}
        </details>)}
        <p className={styles.intro}>El conjunto se conserva con su versión al generar. Cada material sigue comprobando respaldo y citas; fuentes inválidas o de otras lecciones no se añaden. Si se supera el límite de contexto, se informa sin recortar fuentes.</p>
        <button type="button" className={styles.save} disabled={busy || !availability.ready} onClick={() => void continueWithAll()}>{busy ? "Preparando fuentes…" : "Usar todas las fuentes y continuar a Materiales"}</button>
      </section>
      <details className={styles.step}><summary className="cursor-pointer font-semibold">Política de fuentes del curso</summary><CourseSourceReviewPanel artifactId={artifactId} policyOnly /></details>
      <p role="status">{message}</p>
    </div>
  );
}
