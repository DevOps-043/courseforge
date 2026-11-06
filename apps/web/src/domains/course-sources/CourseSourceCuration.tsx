"use client";
import { useEffect, useState, type ReactNode } from "react";
import { sourceJsonRequest } from "./course-source.client";
import {
  CourseSourceReviewPanel,
  type SourceReviewSnapshot,
} from "./CourseSourceReviewPanel";
import { startCurationAction } from "../curation/actions/curation.actions";
export function CourseSourceCuration({
  artifactId,
  children,
}: {
  artifactId: string;
  children: ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<SourceReviewSnapshot | null>(null);
  const [message, setMessage] = useState("");
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
    return () => {
      clearTimeout(timer);
      window.removeEventListener(`source-review-${artifactId}`, reload);
    };
  }, [artifactId]);
  if (!snapshot)
    return <p role="status">{message || "Verificando política de fuentes…"}</p>;
  if (!snapshot.configured || snapshot.policy === "WEB_ONLY") return children;
  return (
    <div>
      <CourseSourceReviewPanel artifactId={artifactId} />
      {snapshot.policy === "DOCUMENTS_AND_WEB" && !snapshot.approved && (
        <button
          onClick={() =>
            void startCurationAction(artifactId).then((result) =>
              setMessage(
                result.success
                  ? "Búsqueda de vacíos solicitada. Actualiza para revisar las nuevas fuentes."
                  : result.error || "No se pudo buscar.",
              ),
            )
          }
        >
          Buscar fuentes web para vacíos documentales
        </button>
      )}
      <p role="status">{message}</p>
      <p className="mt-3 text-sm">
        La cobertura requiere revisión humana. La configuración queda guardada;
        la generación desde estos documentos todavía no está habilitada.
      </p>
    </div>
  );
}
