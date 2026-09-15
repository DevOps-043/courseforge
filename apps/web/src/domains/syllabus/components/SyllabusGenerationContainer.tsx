import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { UpstreamChangeAlert } from "@/shared/components/UpstreamChangeAlert";
import {
  dismissUpstreamDirtyAction,
  markDownstreamDirtyAction,
} from "@/lib/server/pipeline-dirty-actions";
import { REVIEWER_ROLE_SET, SYLLABUS_STATES } from "@/lib/pipeline-constants";
import { syllabusService } from "@/domains/syllabus/services/syllabus.service";
import {
  Esp02Route,
  Esp02StepState,
  SyllabusModule,
  SyllabusRow,
  TemarioEsp02,
} from "../types/syllabus.types";
import { SyllabusGenerationHeader } from "./SyllabusGenerationHeader";
import { SyllabusObjectivesAccordion } from "./SyllabusObjectivesAccordion";
import { SyllabusReviewPanel } from "./SyllabusReviewPanel";
import { SyllabusSetupPanel } from "./SyllabusSetupPanel";
import { SyllabusStatusPanel } from "./SyllabusStatusPanel";
import { SyllabusViewer } from "./SyllabusViewer";
import {
  canIterateSyllabus,
  normalizeSyllabusIterationCount,
  SYLLABUS_MAX_ITERATIONS,
} from "../lib/syllabus-iteration";
import type { SyllabusSourceDocument } from "../syllabus-source-documents";

interface SyllabusProfile {
  platform_role?: string | null;
}

interface SyllabusGenerationContainerProps {
  artifactId: string;
  initialObjetivos: string[];
  initialIdeaCentral: string;
  onNext?: () => void;
  profile?: SyllabusProfile | null;
  className?: string;
}

function buildTemarioForReview(
  temario: TemarioEsp02 | SyllabusRow,
  route: Esp02Route | null,
  objetivos: string[],
): TemarioEsp02 {
  const validation = syllabusService.validateTemario(temario, objetivos);

  return {
    ...temario,
    route: temario.route || route || "B_NO_SOURCE",
    validation: {
      automatic_pass: Boolean(validation.passed),
      checks: validation.checks,
    },
    qa: temario.qa || { status: "PENDING" },
  };
}

export function SyllabusGenerationContainer({
  artifactId,
  initialObjetivos,
  initialIdeaCentral,
  onNext,
  profile,
  className = "",
}: SyllabusGenerationContainerProps) {
  const router = useRouter();
  const [route, setRoute] = useState<Esp02Route | null>("B_NO_SOURCE");
  const [status, setStatus] = useState<Esp02StepState>("STEP_DRAFT");
  const [temario, setTemario] = useState<TemarioEsp02 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [isObjectivesOpen, setIsObjectivesOpen] = useState(false);
  const [iterationCount, setIterationCount] = useState(0);
  const [hasExistingSyllabus, setHasExistingSyllabus] = useState(false);
  const [sourceDocuments, setSourceDocuments] = useState<SyllabusSourceDocument[]>([]);
  const [documentsUploading, setDocumentsUploading] = useState(false);
  const [configuredPrompt, setConfiguredPrompt] = useState("");
  const [prompt, setPrompt] = useState("");
  const [promptError, setPromptError] = useState<string | null>(null);
  const [promptLoading, setPromptLoading] = useState(true);
  const [promptReloadKey, setPromptReloadKey] = useState(0);
  const [promptSource, setPromptSource] = useState<
    "organization" | "global" | "default" | null
  >(null);
  const [promptVersion, setPromptVersion] = useState<string | null>(null);

  const getPromptOverride = () => {
    const trimmedPrompt = prompt.trim();
    return trimmedPrompt && trimmedPrompt !== configuredPrompt.trim()
      ? trimmedPrompt
      : undefined;
  };

  const applyTemario = (generatedTemario: TemarioEsp02 | SyllabusRow) => {
    const nextTemario = buildTemarioForReview(
      generatedTemario,
      route,
      initialObjetivos,
    );

    setTemario(nextTemario);
    setHasExistingSyllabus(true);
    setRoute(nextTemario.route);
    setStatus(generatedTemario.state || "STEP_READY_FOR_QA");
    if (generatedTemario.iteration_count !== undefined) {
      setIterationCount(
        normalizeSyllabusIterationCount(generatedTemario.iteration_count),
      );
    }
    setError(null);
  };

  const handleIterate = async () => {
    if (!route || status === "STEP_GENERATING") {
      return;
    }

    if (!canIterateSyllabus(iterationCount)) {
      setError(
        `El temario alcanzo el limite de ${SYLLABUS_MAX_ITERATIONS} iteraciones.`,
      );
      return;
    }

    const previousStatus = status;
    setStatus("STEP_GENERATING");
    setError(null);

    try {
      await syllabusService.startGeneration({
        artifactId,
        route,
        objetivos: initialObjetivos,
        ideaCentral: initialIdeaCentral,
        iterationInstructions: reviewNotes.trim() || undefined,
        promptOverride: getPromptOverride(),
        sourceDocuments: route === "A_WITH_SOURCE" ? sourceDocuments : undefined,
      });
      await markDownstreamDirtyAction(artifactId, 2, "Temario");
    } catch (iterationError) {
      setError(
        iterationError instanceof Error
          ? iterationError.message
          : "No se pudo iterar el temario.",
      );
      setStatus(previousStatus);
    }
  };

  const handleGenerate = async () => {
    if (!route) {
      return;
    }
    if (route === "A_WITH_SOURCE" && sourceDocuments.length === 0) {
      setError("Agrega al menos un documento para generar el temario basado en fuentes.");
      return;
    }

    setStatus("STEP_GENERATING");
    setError(null);

    try {
      const result = await syllabusService.startGeneration({
        artifactId,
        route,
        objetivos: initialObjetivos,
        ideaCentral: initialIdeaCentral,
        promptOverride: getPromptOverride(),
        sourceDocuments: route === "A_WITH_SOURCE" ? sourceDocuments : undefined,
      });

      if ("modules" in result && Array.isArray(result.modules)) {
        applyTemario(result);
      }
    } catch (generationError) {
      setError(
        generationError instanceof Error
          ? generationError.message
          : "No se pudo generar el temario.",
      );
      setStatus("STEP_ESCALATED");
    }
  };

  const handleDismissAlert = async () => {
    try {
      await dismissUpstreamDirtyAction("syllabus", artifactId);
      setTemario((currentTemario) =>
        currentTemario
          ? { ...currentTemario, upstream_dirty: false }
          : currentTemario,
      );
    } catch (dismissError) {
      setError(
        dismissError instanceof Error
          ? dismissError.message
          : "No se pudo descartar el aviso.",
      );
    }
  };

  const handleSaveModules = async (modules: SyllabusModule[]) => {
    if (!temario) {
      return;
    }

    try {
      setTemario({ ...temario, modules });
      await syllabusService.updateModules(artifactId, modules);
      await markDownstreamDirtyAction(artifactId, 2, "Temario");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "No se pudieron guardar los módulos.",
      );
    }
  };

  const handleApprove = async () => {
    try {
      await syllabusService.updateStatus(
        artifactId,
        "STEP_APPROVED",
        reviewNotes,
      );
      setStatus("STEP_APPROVED");
      router.refresh();
    } catch (approveError) {
      setError(
        approveError instanceof Error
          ? approveError.message
          : "No se pudo aprobar el temario.",
      );
    }
  };

  const handleReject = async () => {
    try {
      await syllabusService.updateStatus(
        artifactId,
        "STEP_REJECTED",
        reviewNotes,
      );
      setStatus("STEP_REJECTED");
      router.refresh();
    } catch (rejectError) {
      setError(
        rejectError instanceof Error
          ? rejectError.message
          : "No se pudo rechazar el temario.",
      );
    }
  };

  const handleReset = async () => {
    if (
      !confirm(
        "¿Estás seguro de que quieres eliminar este temario y volver a generarlo?",
      )
    ) {
      return;
    }

    try {
      await syllabusService.deleteSyllabusContent(artifactId);
      setTemario(null);
      setHasExistingSyllabus(false);
      setStatus("STEP_DRAFT");
      setReviewNotes("");
      setRoute(null);
      setSourceDocuments([]);
      setError(null);
      setIterationCount(0);
    } catch (resetError) {
      setError(
        resetError instanceof Error
          ? resetError.message
          : "No se pudo reiniciar el temario.",
      );
    }
  };

  useEffect(() => {
    const checkExisting = async () => {
      setLoading(true);

      try {
        const data = await syllabusService.getSyllabus(artifactId);
        if (data) {
          setHasExistingSyllabus(true);
          setIterationCount(
            normalizeSyllabusIterationCount(data.iteration_count),
          );
          setRoute(data.route || "B_NO_SOURCE");
          setSourceDocuments(data.source_summary?.source_documents || []);
          if (data.state === SYLLABUS_STATES.ESCALATED) {
            setError(
              data.source_summary?.error ||
                "La iteración del temario terminó con un error.",
            );
          }
        }
        if (data?.modules?.length) {
          applyTemario(data);
        } else if (data?.state === SYLLABUS_STATES.GENERATING) {
          setStatus(SYLLABUS_STATES.GENERATING);
        } else if (data?.state) {
          setStatus(data.state);
        }
      } catch {
        // Ignorar error si el syllabus aún no existe.
      } finally {
        setLoading(false);
      }
    };

    void checkExisting();
  }, [artifactId]);

  useEffect(() => {
    let cancelled = false;

    const loadPrompt = async () => {
      setPromptLoading(true);
      setPromptError(null);
      try {
        const resolvedPrompt = await syllabusService.getGenerationPrompt(artifactId);
        if (cancelled) return;
        setConfiguredPrompt(resolvedPrompt.content);
        setPrompt(resolvedPrompt.content);
        setPromptSource(resolvedPrompt.source);
        setPromptVersion(resolvedPrompt.version);
      } catch (promptLoadError) {
        if (cancelled) return;
        setPromptError(
          promptLoadError instanceof Error
            ? promptLoadError.message
            : "No se pudo cargar el prompt configurado.",
        );
      } finally {
        if (!cancelled) setPromptLoading(false);
      }
    };

    void loadPrompt();
    return () => {
      cancelled = true;
    };
  }, [artifactId, promptReloadKey]);

  useEffect(() => {
    if (status !== "STEP_GENERATING") {
      return undefined;
    }

    const interval = setInterval(async () => {
      try {
        const data = await syllabusService.getSyllabus(artifactId);
        if (data) {
          setHasExistingSyllabus(true);
          setIterationCount(
            normalizeSyllabusIterationCount(data.iteration_count),
          );
          if (data.state === SYLLABUS_STATES.ESCALATED) {
            setError(
              data.source_summary?.error ||
                "La iteración del temario terminó con un error.",
            );
          }
        }
        if (data?.modules?.length) {
          applyTemario(data);
        } else if (data?.state && data.state !== SYLLABUS_STATES.GENERATING) {
          setStatus(data.state);
        }
      } catch (pollingError) {
        if (pollingError instanceof Error) {
          setError(pollingError.message);
        }
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [artifactId, status]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className={`space-y-6 max-w-5xl mx-auto pb-20 ${className}`}>
      {temario?.upstream_dirty && (
        <UpstreamChangeAlert
          source={temario.upstream_dirty_source || "la idea central"}
          onIterate={handleGenerate}
          onDismiss={handleDismissAlert}
          isIterating={status === "STEP_GENERATING"}
        />
      )}

      <SyllabusGenerationHeader
        ideaCentral={initialIdeaCentral}
        iterationCount={iterationCount}
        iterationLimit={SYLLABUS_MAX_ITERATIONS}
        canIterate={canIterateSyllabus(iterationCount)}
        isIterating={status === "STEP_GENERATING"}
        onIterate={
          hasExistingSyllabus ? () => void handleIterate() : undefined
        }
      />

      <SyllabusObjectivesAccordion
        objectives={initialObjetivos}
        isOpen={isObjectivesOpen}
        onToggle={() => setIsObjectivesOpen((current) => !current)}
      />

      {!temario && status === "STEP_DRAFT" && (
        <SyllabusSetupPanel
          artifactId={artifactId}
          documents={sourceDocuments}
          documentsUploading={documentsUploading}
          route={route}
          configuredPrompt={configuredPrompt}
          prompt={prompt}
          promptError={promptError}
          promptLoading={promptLoading}
          promptSource={promptSource}
          promptVersion={promptVersion}
          onDocumentsChange={setSourceDocuments}
          onDocumentsUploadingChange={setDocumentsUploading}
          onRouteChange={setRoute}
          onPromptChange={setPrompt}
          onPromptRetry={() => setPromptReloadKey((current) => current + 1)}
          onGenerate={handleGenerate}
        />
      )}

      {status === "STEP_GENERATING" && (
        <SyllabusStatusPanel status="STEP_GENERATING" />
      )}

      {status === "STEP_ESCALATED" && error && (
        <SyllabusStatusPanel status="STEP_ESCALATED" error={error} />
      )}

      {temario && error && status !== "STEP_ESCALATED" && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </div>
      )}

      {!temario &&
        hasExistingSyllabus &&
        status !== "STEP_DRAFT" &&
        status !== "STEP_GENERATING" &&
        status !== "STEP_ESCALATED" && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 dark:border-amber-500/20 dark:bg-amber-500/10">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-bold text-amber-900 dark:text-amber-200">
                  El temario no contiene módulos
                </h3>
                <p className="mt-1 text-sm text-amber-700 dark:text-amber-300/80">
                  La generación anterior quedó vacía o incompleta. Puedes iniciar
                  una nueva iteración para reconstruirlo.
                </p>
                <p className="mt-2 text-xs font-semibold text-amber-800 dark:text-amber-200">
                  Iteración {iterationCount}/{SYLLABUS_MAX_ITERATIONS}
                </p>
              </div>

            </div>
          </div>
        )}

      {temario && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="mb-6">
            <div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <svg
                  className="w-6 h-6 text-green-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                Temario Generado
              </h3>
            </div>
          </div>

          <SyllabusViewer
            modules={temario.modules}
            validation={temario.validation}
            metadata={temario.source_summary}
            onSave={handleSaveModules}
            isEditable
          />

          <SyllabusReviewPanel
            status={status}
            reviewNotes={reviewNotes}
            canReview={REVIEWER_ROLE_SET.has(profile?.platform_role || "")}
            onReviewNotesChange={setReviewNotes}
            onApprove={handleApprove}
            onReject={handleReject}
            onReset={handleReset}
            onNext={onNext}
          />
        </div>
      )}
    </div>
  );
}
