import type { ArtifactViewRecord } from "./artifact-view.types";

const ACTIVE_PHASE_LABELS = {
  reading: "Leyendo las fuentes",
  writing: "Generando el contenido de Base",
  verifying: "Verificando el contenido y sus fuentes",
};

export function ArtifactBaseProgress({ artifact, syncFailed, showResult }: {
  artifact: ArtifactViewRecord;
  syncFailed: boolean;
  showResult: boolean;
}) {
  const progress = artifact.generation_metadata?.base_progress;
  const active = artifact.state === "GENERATING";
  const generationFailed = artifact.state === "ESCALATED" &&
    artifact.validation_report?.results?.some(result => result.code === "GENERATION_FAILED");
  const documentary = Boolean(progress) || artifact.course_id === `DOC-${artifact.id}`;
  if (!active && (!showResult || !documentary || (!progress && !generationFailed))) return null;
  if (!active && !["APPROVED", "ESCALATED"].includes(artifact.state)) return null;

  const title = active
    ? (progress && ACTIVE_PHASE_LABELS[progress.phase]) || "Preparando la generación de Base"
    : generationFailed
      ? "La generación de Base se detuvo"
      : artifact.state === "ESCALATED" ? "Base generada con observaciones" : "Base disponible";
  const { confirmed, total } = progress ?? {};
  const hasCounts = total != null && confirmed != null;

  return (
    <div role="status" className="mb-4 space-y-1 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-100">
      <p className="font-semibold">{title}</p>
      {hasCounts && <p>{confirmed} de {total} lotes guardados.</p>}
      {active && hasCounts && progress?.phase === "reading" && (
        <progress aria-label="Lotes de fuentes guardados" className="w-full max-w-sm" value={confirmed} max={total} />
      )}
      <p>{active
        ? syncFailed
          ? "No se pudo consultar el avance. Mostramos el último estado disponible y volveremos a consultar."
          : "El trabajo se realiza en segundo plano. El contenido aparecerá aquí cuando termine."
        : generationFailed
          ? "Ya puedes recargar o reintentar desde Base."
          : "Ya puedes revisar el contenido o recargar la página."}</p>
    </div>
  );
}
