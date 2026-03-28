import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { UpstreamChangeAlert } from "@/shared/components/UpstreamChangeAlert";
import {
  dismissUpstreamDirtyAction,
  markDownstreamDirtyAction,
} from "@/lib/server/pipeline-dirty-actions";
import { REVIEWER_ROLE_SET } from "@/lib/pipeline-constants";
import { syllabusService } from "@/domains/syllabus/services/syllabus.service";
import {
  Esp02Route,
  Esp02StepState,
  SyllabusInputMode,
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
  const [activeTab, setActiveTab] = useState<SyllabusInputMode>("GENERATE");
  const [route, setRoute] = useState<Esp02Route | null>("B_NO_SOURCE");
  const [status, setStatus] = useState<Esp02StepState>("STEP_DRAFT");
  const [temario, setTemario] = useState<TemarioEsp02 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [isObjectivesOpen, setIsObjectivesOpen] = useState(false);

  const applyTemario = (generatedTemario: TemarioEsp02 | SyllabusRow) => {
    const nextTemario = buildTemarioForReview(
      generatedTemario,
      route,
      initialObjetivos,
    );

    setTemario(nextTemario);
    setRoute(nextTemario.route);
    setStatus(generatedTemario.state || "STEP_READY_FOR_QA");
  };

  const handleGenerate = async () => {
    if (!route) {
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
      });

      if ("modules" in result && Array.isArray(result.modules)) {
        applyTemario(result);
      }
    } catch (generationError) {
      console.error(generationError);
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
      console.error("Error dismissing alert:", dismissError);
    }
  };

  const handleImport = (modules: SyllabusModule[]) => {
    const importedTemario: TemarioEsp02 = {
      route: "B_NO_SOURCE",
      modules,
      validation: {
        automatic_pass: true,
        checks: [],
      },
      qa: { status: "PENDING" },
    };

    const validation = syllabusService.validateTemario(importedTemario);
    importedTemario.validation = {
      automatic_pass: validation.passed,
      checks: validation.checks,
    };

    setTemario(importedTemario);
    setStatus("STEP_READY_FOR_QA");
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
      console.error("Error guardando módulos:", saveError);
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
      console.error(approveError);
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
      console.error(rejectError);
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
      setStatus("STEP_DRAFT");
      setReviewNotes("");
      setRoute(null);
      setError(null);
    } catch (resetError) {
      console.error(resetError);
    }
  };

  useEffect(() => {
    const checkExisting = async () => {
      setLoading(true);

      try {
        const data = await syllabusService.getSyllabus(artifactId);
        if (data?.modules?.length) {
          applyTemario(data);
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
    if (status !== "STEP_GENERATING") {
      return undefined;
    }

    const interval = setInterval(async () => {
      try {
        const data = await syllabusService.getSyllabus(artifactId);
        if (data?.modules?.length) {
          applyTemario(data);
        }
      } catch (pollingError) {
        console.error("Polling error (ignorable):", pollingError);
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

      <SyllabusGenerationHeader ideaCentral={initialIdeaCentral} />

      <SyllabusObjectivesAccordion
        objectives={initialObjetivos}
        isOpen={isObjectivesOpen}
        onToggle={() => setIsObjectivesOpen((current) => !current)}
      />

      {!temario && status === "STEP_DRAFT" && (
        <SyllabusSetupPanel
          activeTab={activeTab}
          route={route}
          onTabChange={setActiveTab}
          onRouteChange={setRoute}
          onGenerate={handleGenerate}
          onImport={handleImport}
        />
      )}

      {status === "STEP_GENERATING" && (
        <SyllabusStatusPanel status="STEP_GENERATING" />
      )}

      {status === "STEP_ESCALATED" && error && (
        <SyllabusStatusPanel status="STEP_ESCALATED" error={error} />
      )}

      {temario && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex justify-between items-center mb-6">
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
