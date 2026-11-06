"use client";
import { useCallback, useEffect, useState } from "react";
import { sourceJsonRequest } from "./course-source.client";
import { sourceReviewSnapshotSchema } from "./course-source-review.schema";
import {
  sourceCoverage,
  type SourceAssociation,
  type SourceEvidence,
  type SourceLesson,
} from "./course-source-coverage";
import type { CourseSourcePolicy } from "./course-source-policy";
export interface SourceReviewSnapshot {
  policy: CourseSourcePolicy | null;
  configured: boolean;
  revision: number;
  approved: boolean;
  curriculumHash: string;
  planReady: boolean;
  canApprove?: boolean;
  lessons: SourceLesson[];
  evidence: SourceEvidence[];
  associations: SourceAssociation[];
}
export function CourseSourceReviewPanel({
  artifactId,
  policyOnly = false,
}: {
  artifactId: string;
  policyOnly?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<SourceReviewSnapshot | null>(null);
  const [associations, setAssociations] = useState<SourceAssociation[]>([]);
  const [policy, setPolicy] = useState<CourseSourcePolicy | null>(null);
  const [message, setMessage] = useState("");
  const [activeLesson, setActiveLesson] = useState("");
  const [busy, setBusy] = useState(false);
  const root = `/api/artifacts/${artifactId}/sources/review`;
  const refresh = useCallback(async () => {
    const payload = await sourceJsonRequest(
      `${root}${policyOnly ? "?policyOnly=1" : ""}`,
    );
    const parsed = sourceReviewSnapshotSchema.safeParse(payload);
    if (!parsed.success)
      throw new Error(
        "La configuración recibida no cumple el contrato. Actualiza antes de continuar.",
      );
    const result = parsed.data;
    setSnapshot(result);
    setPolicy(result.policy);
    setAssociations(result.associations);
    setActiveLesson((current) =>
      result.lessons.some((lesson: SourceLesson) => lesson.id === current)
        ? current
        : result.lessons[0]?.id || "",
    );
  }, [root, policyOnly]);
  useEffect(() => {
    const reload = () =>
      void refresh().catch(() =>
        setMessage(
          "La configuración de fuentes no está disponible. Reintenta antes de continuar.",
        ),
      );
    const initial = setTimeout(reload, 0);
    window.addEventListener(`source-review-${artifactId}`, reload);
    return () => {
      clearTimeout(initial);
      window.removeEventListener(`source-review-${artifactId}`, reload);
    };
  }, [refresh, artifactId]);
  async function command(action: "policy" | "save" | "approve" | "propose") {
    if (!snapshot) return;
    setBusy(true);
    setMessage("");
    try {
      if (
        action === "policy" &&
        (!policy ||
          (snapshot.policy &&
            !window.confirm(
              "Cambiar la política dejará obsoletos los resultados afectados. ¿Continuar?",
            )))
      )
        return;
      const result = await sourceJsonRequest(root, {
        action,
        ...(action === "propose"
          ? {}
          : {
              expectedRevision: snapshot.revision,
              curriculumHash: snapshot.curriculumHash,
            }),
        ...(action === "policy"
          ? { policy }
          : action === "save"
            ? { associations }
            : {}),
      });
      if (action === "propose") {
        setAssociations(result.associations);
        setMessage(
          "Propuesta sin aprobar. Revisa los fragmentos y confirma su suficiencia.",
        );
      } else {
        await refresh();
        window.dispatchEvent(new Event(`source-review-${artifactId}`));
        setMessage(
          action === "approve"
            ? "Cobertura aprobada y versionada."
            : "Configuración guardada.",
        );
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "No se pudo guardar la revisión.",
      );
    } finally {
      setBusy(false);
    }
  }
  const coverage = snapshot?.policy
    ? sourceCoverage(
        snapshot.policy,
        snapshot.lessons,
        associations,
        snapshot.evidence,
      )
    : [];
  function assign(lessonId: string, requirementId: string, value: string) {
    const next = associations.flatMap((item) =>
      item.lessonId === lessonId && item.requirementIds.includes(requirementId)
        ? item.requirementIds.length > 1
          ? [
              {
                ...item,
                requirementIds: item.requirementIds.filter(
                  (id) => id !== requirementId,
                ),
              },
            ]
          : []
        : [item],
    );
    const evidence = snapshot?.evidence.find((item) => item.id === value);
    if (evidence)
      next.push({
        lessonId,
        evidenceId: evidence.id,
        evidenceType: evidence.type,
        requirementIds: [requirementId],
        verified: false,
        conflict: false,
        resolution: "",
      });
    setAssociations(next);
  }
  function update(index: number, patch: Partial<SourceAssociation>) {
    setAssociations((current) =>
      current.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  }
  return (
    <section
      aria-label="Política y cobertura documental"
      className="my-4 space-y-3 rounded-xl border p-4 font-sans [&_button]:min-h-10 [&_button]:rounded-md [&_button]:border [&_button]:px-3 [&_button]:py-2 [&_button]:disabled:opacity-50"
    >
      <h3 className="font-semibold">Política de fuentes de este curso</h3>
      <p className="text-sm">
        Elige cómo usar tus documentos. Se conserva la elección al reabrir el
        curso.
      </p>
      <div className="flex flex-wrap gap-4">
        {(
          [
            ["DOCUMENTS_ONLY", "Solo mis archivos"],
            ["DOCUMENTS_AND_WEB", "Mis archivos + fuentes web"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex items-center gap-2">
            <input
              type="radio"
              name={`source-policy-${artifactId}-${policyOnly}`}
              value={value}
              checked={policy === value}
              disabled={busy}
              onChange={() => setPolicy(value)}
            />
            {label}
          </label>
        ))}
      </div>
      {snapshot?.policy === "WEB_ONLY" && (
        <p>Flujo web histórico conservado.</p>
      )}
      <button
        type="button"
        disabled={busy || !snapshot || !policy || policy === snapshot.policy}
        onClick={() => void command("policy")}
      >
        Guardar política
      </button>
      {!snapshot?.configured && snapshot && (
        <p className="text-sm">
          El curso histórico conserva su comportamiento mientras no configures
          un flujo documental.
        </p>
      )}
      {snapshot?.configured && !snapshot.policy && (
        <p role="alert">Debes elegir una política antes de generar.</p>
      )}
      {snapshot && !policyOnly && (
        <>
          <p className="text-sm">
            Revisión {snapshot.revision} ·{" "}
            {snapshot.approved ? "Aprobada" : "Pendiente de revisión"}. Un mismo
            manual puede respaldar varias lecciones. Las sugerencias no
            acreditan suficiencia.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              disabled={busy}
              onClick={() =>
                void refresh().catch(() =>
                  setMessage("No se pudo actualizar la revisión."),
                )
              }
            >
              Actualizar revisión
            </button>
            <button
              disabled={busy || !snapshot.policy}
              onClick={() => void command("propose")}
            >
              Proponer asociaciones
            </button>
            <button
              disabled={busy || !snapshot.policy}
              onClick={() => void command("save")}
            >
              Guardar revisión
            </button>
            <button
              disabled={
                busy ||
                !snapshot.planReady ||
                snapshot.canApprove === false ||
                !coverage.length ||
                coverage.some((item) => !item.complete)
              }
              onClick={() => void command("approve")}
            >
              Aprobar cobertura guardada
            </button>
          </div>
          {snapshot.lessons.map((lesson) => (
            <fieldset key={lesson.id} className="space-y-3 rounded border p-3">
              <legend className="font-medium">
                <button
                  type="button"
                  aria-expanded={activeLesson === lesson.id}
                  onClick={() =>
                    setActiveLesson((current) =>
                      current === lesson.id ? "" : lesson.id,
                    )
                  }
                >
                  {lesson.title}
                </button>
              </legend>
              <p className="text-sm">
                {coverage.find((item) => item.lessonId === lesson.id)?.missing
                  .length ?? lesson.requirements.length}{" "}
                requisitos pendientes
              </p>
              {activeLesson === lesson.id &&
                lesson.requirements.map((requirement) => {
                  const index = associations.findIndex(
                    (item) =>
                      item.lessonId === lesson.id &&
                      item.requirementIds.includes(requirement.id),
                  );
                  const association = associations[index];
                  const evidence = snapshot.evidence.find(
                    (item) => item.id === association?.evidenceId,
                  );
                  return (
                    <div
                      key={requirement.id}
                      className="space-y-2 border-t pt-2"
                    >
                      <label className="block">
                        {requirement.label}
                        <select
                          aria-label={`Evidencia: ${lesson.title} / ${requirement.label}`}
                          className="block w-full min-w-0 rounded border p-2"
                          value={association?.evidenceId || ""}
                          disabled={busy}
                          onChange={(event) =>
                            assign(
                              lesson.id,
                              requirement.id,
                              event.target.value,
                            )
                          }
                        >
                          <option value="">Sin evidencia</option>
                          {snapshot.evidence
                            .filter(
                              (item) =>
                                (snapshot.policy !== "DOCUMENTS_ONLY" ||
                                  item.type === "DOCUMENT") &&
                                (item.type === "DOCUMENT" ||
                                  item.lessonId === lesson.id),
                            )
                            .map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.type === "DOCUMENT" ? "Documento" : "Web"}{" "}
                                · {item.title} · {item.text.slice(0, 70)}
                              </option>
                            ))}
                        </select>
                      </label>
                      {association && (
                        <>
                          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-sm">
                            {evidence?.text}
                          </pre>
                          <label className="flex gap-2">
                            <input
                              type="checkbox"
                              checked={association.verified}
                              disabled={busy}
                              onChange={(event) =>
                                update(index, {
                                  verified: event.target.checked,
                                })
                              }
                            />
                            He revisado el contenido y respalda este
                            objetivo/tema
                          </label>
                          <label className="flex gap-2">
                            <input
                              type="checkbox"
                              checked={association.conflict}
                              disabled={busy}
                              onChange={(event) =>
                                update(index, {
                                  conflict: event.target.checked,
                                  verified: false,
                                })
                              }
                            />
                            Se detectó una contradicción entre fuentes
                          </label>
                          {association.conflict && (
                            <label className="block">
                              Resolución del conflicto
                              <input
                                className="block w-full rounded border p-2"
                                maxLength={2000}
                                value={association.resolution}
                                onChange={(event) =>
                                  update(index, {
                                    resolution: event.target.value,
                                    verified: false,
                                  })
                                }
                              />
                            </label>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
            </fieldset>
          ))}
        </>
      )}
      <p role="status" className="text-sm">
        {message}
      </p>
      {!snapshot && (
        <button
          disabled={busy}
          onClick={() =>
            void refresh().catch(() =>
              setMessage("La configuración sigue sin estar disponible."),
            )
          }
        >
          Reintentar configuración
        </button>
      )}
    </section>
  );
}
