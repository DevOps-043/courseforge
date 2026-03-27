"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Play } from "lucide-react";
import { dismissUpstreamDirtyAction } from "@/lib/server/pipeline-dirty-actions";
import { UpstreamChangeAlert } from "@/shared/components/UpstreamChangeAlert";
import {
  useMaterials,
  useMaterialStateStyles,
} from "../hooks/useMaterials";
import type { MaterialLesson, MaterialsPayload } from "../types/materials.types";
import { LessonMaterialsCard } from "./LessonMaterialsCard";
import {
  MaterialsApprovedBanner,
  MaterialsBulkRegenerateButton,
  MaterialsGeneratingBanner,
  MaterialsQaReviewPanel,
  MaterialsStatsGrid,
  MaterialsStepHeader,
  MaterialsValidationBanner,
} from "./MaterialsStatusPanels";

interface MaterialsProfile {
  platform_role?: string | null;
}

interface MaterialsFormProps {
  artifactId: string;
  className?: string;
  profile?: MaterialsProfile;
}

type MaterialsPayloadWithDirty = MaterialsPayload & {
  upstream_dirty?: boolean;
  upstream_dirty_source?: string | null;
};

function groupLessonsByModule(lessons: MaterialLesson[]) {
  return lessons.reduce<
    Record<
      string,
      {
        module_id: string;
        module_title: string;
        lessons: MaterialLesson[];
      }
    >
  >((accumulator, lesson) => {
    if (!accumulator[lesson.module_id]) {
      accumulator[lesson.module_id] = {
        module_id: lesson.module_id,
        module_title: lesson.module_title,
        lessons: [],
      };
    }

    accumulator[lesson.module_id].lessons.push(lesson);
    return accumulator;
  }, {});
}

export function MaterialsForm({
  artifactId,
  className = "",
  profile,
}: MaterialsFormProps) {
  const router = useRouter();
  const {
    materials,
    loading,
    error,
    startGeneration,
    runFixIteration,
    validateLesson,
    markLessonForFix,
    submitToQA,
    applyQADecision,
    validateMaterials,
    forceResetGeneration,
    refresh,
    isGenerating,
    isValidating,
    isReadyForQA,
    isApproved,
    generationStuckInfo,
  } = useMaterials(artifactId);

  const { label: stateLabel, color: stateColor } = useMaterialStateStyles(
    materials?.state,
  );
  const [qaNote, setQaNote] = useState("");
  const [isValidatingAll, setIsValidatingAll] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const materialsData = materials as MaterialsPayloadWithDirty | null;
  const lessonsByModule = groupLessonsByModule(materials?.lessons || []);
  const needsFixLessons = (materials?.lessons || []).filter(
    (lesson) => lesson.state === "NEEDS_FIX",
  );
  const allLessonsApprovable = (materials?.lessons || []).every(
    (lesson) => lesson.state === "APPROVABLE",
  );

  const handleForceReset = async () => {
    if (
      !confirm(
        "Estas seguro de que quieres cancelar la generacion actual? Esto permitira iniciar una nueva generacion.",
      )
    ) {
      return;
    }

    setIsResetting(true);
    await forceResetGeneration();
    setIsResetting(false);
  };

  const handleValidateAll = async () => {
    setIsValidatingAll(true);
    await validateMaterials();
    await refresh();
    setIsValidatingAll(false);
  };

  const handleRegenerateAll = async () => {
    for (const lesson of needsFixLessons) {
      await runFixIteration(
        lesson.id,
        "Regenerar esta leccion corrigiendo los errores identificados.",
      );
    }
  };

  const handleQADecision = async (decision: "APPROVED" | "REJECTED") => {
    await applyQADecision(decision, qaNote);
    setQaNote("");
    router.refresh();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
        <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
          <AlertTriangle className="h-5 w-5" />
          <span>{error}</span>
        </div>
        <button
          onClick={refresh}
          className="mt-2 text-sm text-red-600 dark:text-red-400 hover:underline"
        >
          Reintentar
        </button>
      </div>
    );
  }

  if (!materials || materials.state === "PHASE3_DRAFT") {
    return (
      <div className={`space-y-6 ${className}`}>
        <div className="text-center py-12 border-2 border-dashed border-gray-200 dark:border-white/10 rounded-lg">
          <Play className="h-12 w-12 mx-auto text-gray-400 dark:text-gray-500 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            Generar Materiales (Paso 5)
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 max-w-md mx-auto">
            Se generaran los materiales para cada leccion basandose en el plan
            instruccional (Paso 3) y las fuentes curadas (Paso 4).
          </p>
          <button
            onClick={startGeneration}
            className="inline-flex items-center gap-2 px-6 py-3 text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            <Play className="h-5 w-5" />
            Iniciar Generacion
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      <MaterialsStepHeader
        title="Materiales (Fase 3)"
        stateLabel={stateLabel}
        stateColor={stateColor}
        isGenerating={isGenerating}
        isValidating={isValidating}
      />

      {materialsData?.upstream_dirty && (
        <UpstreamChangeAlert
          source={materialsData.upstream_dirty_source || "un paso anterior"}
          onIterate={async () => {
            await startGeneration();
            await dismissUpstreamDirtyAction("materials", artifactId);
          }}
          onDismiss={async () => {
            await dismissUpstreamDirtyAction("materials", artifactId);
            await refresh();
          }}
          isIterating={isGenerating}
        />
      )}

      {isGenerating && (
        <MaterialsGeneratingBanner
          generationStuckInfo={generationStuckInfo}
          isResetting={isResetting}
          onForceReset={handleForceReset}
        />
      )}

      {isValidating && (
        <MaterialsValidationBanner
          isValidatingAll={isValidatingAll}
          onValidateAll={handleValidateAll}
        />
      )}

      {materials.lessons.length > 0 && (
        <MaterialsStatsGrid lessons={materials.lessons} />
      )}

      {needsFixLessons.length > 0 && !isGenerating && (
        <MaterialsBulkRegenerateButton
          pendingCount={needsFixLessons.length}
          onRegenerateAll={handleRegenerateAll}
        />
      )}

      <MaterialsQaReviewPanel
        isReadyForQA={isReadyForQA}
        isApproved={isApproved}
        allLessonsApprovable={allLessonsApprovable}
        qaNote={qaNote}
        profile={profile}
        onQaNoteChange={setQaNote}
        onSubmitToQA={submitToQA}
        onDecision={handleQADecision}
      />

      {isApproved && <MaterialsApprovedBanner qaDecision={materials.qa_decision} />}

      <div className="space-y-6">
        {Object.values(lessonsByModule).map((module) => (
          <div key={module.module_id} className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
              {module.module_title}
            </h4>
            <div className="space-y-2">
              {module.lessons.map((lesson) => (
                <LessonMaterialsCard
                  key={lesson.id}
                  lesson={lesson}
                  onIterationStart={runFixIteration}
                  onValidateLesson={validateLesson}
                  onRegenerateLesson={(lessonId) =>
                    runFixIteration(
                      lessonId,
                      "Regenerar completamente esta leccion siguiendo el plan original.",
                    )
                  }
                  onMarkForFix={markLessonForFix}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
