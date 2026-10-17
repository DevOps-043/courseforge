"use client";
import { useState } from "react";
import { SyllabusDocumentUploader } from "./SyllabusDocumentUploader";
import { SyllabusImportOutlineEditor } from "./SyllabusImportOutlineEditor";
import { useSyllabusImport } from "../import/use-syllabus-import";
import type { SyllabusSourceDocument } from "../syllabus-source-documents";
import { SYLLABUS_IMPORT_POLICY } from "../import/syllabus-import.schema";

interface Props {
  artifactId: string;
  onCompleted: () => Promise<void>;
}
const buttonClass =
  "rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40";

export function SyllabusImportPanel({ artifactId, onCompleted }: Props) {
  const state = useSyllabusImport(artifactId, onCompleted);
  const [uploads, setUploads] = useState<SyllabusSourceDocument[]>([]);
  const [primaryId, setPrimaryId] = useState("");
  const [supportIds, setSupportIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [acceptedIds, setAcceptedIds] = useState<string[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const entry = state.entry;
  const dirty = Boolean(
    entry &&
    JSON.stringify(state.outline) !== JSON.stringify(entry.candidate_outline),
  );
  const blocked = state.busy || uploading;
  const command = (action: "confirm" | "enrich" | "propose" | "retry") => {
    if (!entry) return;
    if (action === "confirm")
      void state.command({
        action,
        artifactId,
        importId: entry.id,
        expectedRevision: entry.revision,
        acknowledgeIssues: true,
      });
    else
      void state.command({
        action,
        artifactId,
        importId: entry.id,
        expectedRevision: entry.revision,
      });
  };
  return (
    <section className="space-y-5 rounded-2xl border border-emerald-300 bg-white p-5 text-gray-900 dark:bg-gray-900 dark:text-white">
      <div>
        <h3 className="text-lg font-bold">Usar mi temario existente</h3>
        <p className="mt-1 text-sm text-gray-500">
          Importa tu estructura, revisa la interpretación y completa los
          objetivos faltantes. Las ampliaciones se muestran como propuestas.
        </p>
      </div>
      {state.error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
        >
          {state.error}
        </p>
      )}
      {!state.enabled ? (
        <p className="text-sm">
          La importación está pendiente de habilitación para este entorno.
        </p>
      ) : (
        <>
          <SyllabusDocumentUploader
            artifactId={artifactId}
            documents={uploads}
            persistDocuments
            onUploadingChange={setUploading}
            onChange={(documents) => {
              setUploads(documents);
              state.setDocuments((current) => [
                ...current.filter(
                  (option) =>
                    !documents.some(
                      (document) => document.fileId === option.id,
                    ),
                ),
                ...documents.map((document) => ({
                  id: document.fileId,
                  filename: document.filename,
                })),
              ]);
            }}
          />
          <label className="block text-sm">
            Documento que contiene el temario
            <select
              className="mt-1 w-full rounded-lg border bg-white p-2 text-gray-900"
              value={primaryId}
              disabled={blocked}
              onChange={(event) => {
                setPrimaryId(event.target.value);
                setSupportIds((ids) =>
                  ids.filter((id) => id !== event.target.value),
                );
              }}
            >
              <option value="">Selecciona el documento principal</option>
              {state.documents.map((document) => (
                <option key={document.id} value={document.id}>
                  {document.filename}
                </option>
              ))}
            </select>
          </label>
          {state.documents.filter((document) => document.id !== primaryId)
            .length > 0 && (
            <fieldset disabled={blocked} className="space-y-1 text-sm">
              <legend>Documentos de apoyo (opcional)</legend>
              {state.documents
                .filter((document) => document.id !== primaryId)
                .map((document) => (
                  <label key={document.id} className="flex gap-2">
                    <input
                      type="checkbox"
                      checked={supportIds.includes(document.id)}
                      onChange={(event) =>
                        setSupportIds((ids) =>
                          event.target.checked
                            ? [...ids, document.id]
                            : ids.filter((id) => id !== document.id),
                        )
                      }
                    />
                    {document.filename}
                  </label>
                ))}
            </fieldset>
          )}
          <button
            type="button"
            className={buttonClass}
            disabled={blocked || !primaryId || supportIds.length > 7}
            onClick={() => {
              setAcknowledged(false);
              void state.command({
                action: "start",
                artifactId,
                primaryDocumentId: primaryId,
                supportDocumentIds: supportIds,
                idempotencyKey: crypto.randomUUID(),
              });
            }}
          >
            Interpretar este temario
          </button>
          {entry && (
            <>
              {state.busy && (
                <p role="status" className="text-sm">
                  Procesando el temario. Puedes volver a esta página para
                  consultar el resultado.
                </p>
              )}
              {entry.status === "FAILED" && (
                <div className="space-y-2">
                  <p role="alert">{entry.error_message}</p>
                  <button
                    className={buttonClass}
                    disabled={
                      blocked ||
                      entry.attempt_count >= SYLLABUS_IMPORT_POLICY.maxAttempts
                    }
                    onClick={() => command("retry")}
                  >
                    Reintentar operación
                  </button>
                </div>
              )}
              {(entry.status === "REVIEW_REQUIRED" ||
                entry.status === "CONFIRMED" ||
                (entry.status === "FAILED" &&
                  entry.candidate_outline.length > 0)) && (
                <>
                  <h4 className="font-semibold">Estructura interpretada</h4>
                  <p className="text-sm text-gray-500">
                    Revisa títulos, orden y temas contra tu documento. Las
                    correcciones que guardes quedarán registradas como
                    decisiones tuyas.
                  </p>
                  {state.original && (
                    <details className="rounded-lg border p-3 text-sm">
                      <summary>
                        Consultar texto original: {state.original.filename}
                      </summary>
                      <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap font-sans">
                        {state.original.text}
                      </pre>
                    </details>
                  )}
                  {entry.extracted_outline?.length ? (
                    <details className="rounded-lg border p-3 text-sm">
                      <summary>
                        Comparar con la primera interpretación del documento
                      </summary>
                      {entry.extracted_outline.map((module) => (
                        <div key={module.id} className="mt-3">
                          <strong>{module.title}</strong>
                          <ol className="list-decimal pl-5">
                            {module.lessons.map((lesson) => (
                              <li key={lesson.id}>
                                {lesson.title}
                                {lesson.topics.length
                                  ? ` — ${lesson.topics.join("; ")}`
                                  : ""}
                              </li>
                            ))}
                          </ol>
                        </div>
                      ))}
                    </details>
                  ) : null}
                  {(entry.issues.length > 0 ||
                    entry.unassigned_topics.length > 0) && (
                    <div className="space-y-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
                      {entry.issues.map((issue, index) => (
                        <p key={index}>{issue}</p>
                      ))}
                      {entry.unassigned_topics.length > 0 && (
                        <p>
                          Temas pendientes de ubicar:{" "}
                          {entry.unassigned_topics.join("; ")}
                        </p>
                      )}
                    </div>
                  )}
                  <SyllabusImportOutlineEditor
                    outline={state.outline}
                    onChange={(outline) => {
                      state.setOutline(outline);
                      setAcknowledged(false);
                    }}
                    disabled={blocked}
                  />
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={blocked || !dirty}
                      onClick={() =>
                        void state.command({
                          action: "revise",
                          artifactId,
                          importId: entry.id,
                          expectedRevision: entry.revision,
                          outline: state.outline,
                        })
                      }
                    >
                      Guardar correcciones
                    </button>
                    <button
                      type="button"
                      disabled={blocked}
                      className="text-sm underline"
                      onClick={() => {
                        setAcknowledged(false);
                        void state.refresh();
                      }}
                    >
                      Recargar revisión guardada
                    </button>
                  </div>
                  {entry.status === "REVIEW_REQUIRED" && (
                    <>
                      <label className="flex gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={acknowledged}
                          onChange={(event) =>
                            setAcknowledged(event.target.checked)
                          }
                        />
                        Revisé el documento, resolví los temas pendientes y
                        confirmo esta estructura.
                      </label>
                      <button
                        type="button"
                        className={buttonClass}
                        disabled={
                          blocked ||
                          dirty ||
                          !acknowledged ||
                          !state.outline.length
                        }
                        onClick={() => command("confirm")}
                      >
                        Confirmar estructura
                      </button>
                    </>
                  )}
                  {entry.status === "CONFIRMED" && (
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        className={buttonClass}
                        disabled={blocked || dirty}
                        onClick={() => command("enrich")}
                      >
                        Completar objetivos y preparar temario
                      </button>
                      <button
                        type="button"
                        className={buttonClass}
                        disabled={blocked || dirty}
                        onClick={() => {
                          setAcceptedIds([]);
                          command("propose");
                        }}
                      >
                        Revisar posibles ampliaciones
                      </button>
                    </div>
                  )}
                  {entry.proposals.length > 0 && (
                    <div className="space-y-3 rounded-xl border p-4">
                      <h4 className="font-semibold">Ampliaciones propuestas</h4>
                      {entry.proposals.map((proposal) => (
                        <label key={proposal.id} className="block text-sm">
                          <input
                            type="checkbox"
                            checked={acceptedIds.includes(proposal.id)}
                            onChange={(event) =>
                              setAcceptedIds((ids) =>
                                event.target.checked
                                  ? [...ids, proposal.id]
                                  : ids.filter((id) => id !== proposal.id),
                              )
                            }
                          />{" "}
                          <strong>{proposal.title}</strong>
                          <span className="block">{proposal.reason}</span>
                        </label>
                      ))}
                      <p className="text-sm">
                        Solo las seleccionadas se agregarán al borrador. Deberás
                        revisar y confirmar nuevamente la estructura.
                      </p>
                      <button
                        type="button"
                        className={buttonClass}
                        disabled={blocked || dirty}
                        onClick={() => {
                          setAcknowledged(false);
                          void state.command({
                            action: "decide",
                            artifactId,
                            importId: entry.id,
                            expectedRevision: entry.revision,
                            acceptedIds,
                          });
                        }}
                      >
                        Aplicar decisión
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
