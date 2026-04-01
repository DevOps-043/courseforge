"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateArtifactStatusAction } from "@/domains/artifacts/actions/artifact.actions";
import {
  deleteInstructionalPlanAction,
  generateInstructionalPlanAction,
  getInstructionalPlanSnapshotAction,
  updateInstructionalPlanStatusAction,
  validateInstructionalPlanAction,
} from "../actions/plan.actions";
import {
  dismissUpstreamDirtyAction,
} from "@/lib/server/pipeline-dirty-actions";
import {
  PLAN_STATES,
  PLAN_TERMINAL_STATES,
  REVIEWER_ROLE_SET,
} from "@/lib/pipeline-constants";
import { usePolling } from "@/shared/hooks/usePolling";
import { useInstructionalPlanEditor } from "../hooks/useInstructionalPlanEditor";
import { InstructionalPlanResultsView } from "./InstructionalPlanResultsView";
import { InstructionalPlanSetupView } from "./InstructionalPlanSetupView";
import type { InstructionalPlanRecord } from "./plan-view.types";

interface InstructionalPlanGenerationContainerProps {
  artifactId: string;
  onNext?: () => void;
  profile?: {
    platform_role?: string | null;
  } | null;
}

const PLAN_POLL_INTERVAL_MS = 3000;
const PLAN_REFRESH_DELAY_MS = 2000;

export function InstructionalPlanGenerationContainer({
  artifactId,
  onNext,
  profile,
}: InstructionalPlanGenerationContainerProps) {
  const router = useRouter();
  const [customPrompt, setCustomPrompt] = useState("");
  const [existingPlan, setExistingPlan] =
    useState<InstructionalPlanRecord | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState(true);
  const [reviewNotes, setReviewNotes] = useState("");
  const [useCustomPrompt, setUseCustomPrompt] = useState(false);
  const canReview = REVIEWER_ROLE_SET.has(profile?.platform_role || "");
  const lastKnownPlanStateRef = useRef<string | null>(null);
  const lastKnownValidationRef = useRef(false);
  const {
    editedLesson,
    editingLessonId,
    expandedLessonId,
    handleCancelEdit,
    handleComponentFieldChange,
    handleComponentTypeChange,
    handleLessonFieldChange,
    handleSaveLesson,
    handleStartEdit,
    handleToggleExpandedLesson,
  } = useInstructionalPlanEditor({
    artifactId,
    existingPlan,
    setExistingPlan,
  });

  const fetchPlan = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoadingPlan(true);
      }

      try {
        const result = await getInstructionalPlanSnapshotAction(artifactId);

        if (!result.success) {
          console.error("[InstructionalPlan] Error fetching plan:", result.error);

          if (
            result.error === "Artifact not found or inaccessible" ||
            result.error === "Unauthorized"
          ) {
            setIsGenerating(false);
            setIsValidating(false);

            if (silent) {
              toast.error(
                result.error === "Unauthorized"
                  ? "Tu sesion expiro. Recarga la pagina e inicia sesion de nuevo."
                  : "No se pudo volver a leer el plan. Verifica la organizacion activa y vuelve a intentar.",
              );
            }
          }

          return;
        }

        const plan = (result.plan as InstructionalPlanRecord | null) || null;

        if (!plan) {
          setExistingPlan(null);
          lastKnownPlanStateRef.current = null;
          lastKnownValidationRef.current = false;
          return;
        }

        const hasLessons =
          Array.isArray(plan.lesson_plans) && plan.lesson_plans.length > 0;
        const hasValidation = Boolean(plan.validation);
        const planReachedTerminalState = PLAN_TERMINAL_STATES.has(plan.state);
        const shouldRefreshParent =
          silent &&
          ((lastKnownPlanStateRef.current !== plan.state &&
            planReachedTerminalState) ||
            (!lastKnownValidationRef.current && hasValidation));

        setExistingPlan(plan);
        setReviewNotes(plan.qa_decision?.notes || "");
        lastKnownPlanStateRef.current = plan.state;
        lastKnownValidationRef.current = hasValidation;

        if (plan.state === PLAN_STATES.PROCESSING && !isGenerating) {
          setIsGenerating(true);
        }

        if (planReachedTerminalState || (hasLessons && !isGenerating)) {
          setIsGenerating(false);
        }

        if (plan.state === PLAN_STATES.FAILED) {
          setIsGenerating(false);
          toast.error(
            "La generacion fallo. Por favor, intenta de nuevo o revisa los logs.",
          );
        }

        if (hasValidation) {
          setIsValidating(false);
        }

        if (shouldRefreshParent) {
          router.refresh();
        }
      } catch (error) {
        console.error(
          "[InstructionalPlan] Unexpected error fetching plan:",
          error,
        );
      } finally {
        if (!silent) {
          setLoadingPlan(false);
        }
      }
    },
    [artifactId, isGenerating, router],
  );

  useEffect(() => {
    void fetchPlan();
  }, [fetchPlan]);

  usePolling(() => fetchPlan(true), isGenerating || isValidating, {
    intervalMs: PLAN_POLL_INTERVAL_MS,
  });

  const handleGenerate = useCallback(async () => {
    setIsGenerating(true);
    lastKnownValidationRef.current = false;
    lastKnownPlanStateRef.current = PLAN_STATES.PROCESSING;
    setExistingPlan((currentPlan) =>
      currentPlan
        ? {
            ...currentPlan,
            state: PLAN_STATES.PROCESSING,
            validation: null,
          }
        : currentPlan,
    );

    try {
      const result = await generateInstructionalPlanAction(
        artifactId,
        customPrompt,
        useCustomPrompt,
      );

      if (!result.success) {
        toast.error(
          result.error === "Unauthorized"
            ? "Sesion expirada. Recarga la pagina e inicia sesion nuevamente."
            : `Error al generar: ${result.error}`,
        );
        setIsGenerating(false);
        return;
      }

      toast.info(
        "Generacion iniciada. Esto puede tomar entre 30 a 60 segundos.",
      );

      window.setTimeout(() => {
        void fetchPlan();
        router.refresh();
      }, PLAN_REFRESH_DELAY_MS);
    } catch (error) {
      console.error("Error calling plan generation action:", error);
      toast.error("Error de conexion. Intenta de nuevo.");
      setIsGenerating(false);
    }
  }, [artifactId, customPrompt, fetchPlan, router, useCustomPrompt]);

  const handleValidate = useCallback(async () => {
    setIsValidating(true);
    lastKnownValidationRef.current = false;
    setExistingPlan((currentPlan) =>
      currentPlan ? { ...currentPlan, validation: null } : currentPlan,
    );

    try {
      const result = await validateInstructionalPlanAction(artifactId);

      if (!result.success) {
        toast.error(
          result.error === "Unauthorized"
            ? "Sesion expirada. Recarga la pagina e inicia sesion nuevamente."
            : `Error al validar: ${result.error}`,
        );
        setIsValidating(false);
        return;
      }

      toast.info("Validacion iniciada...");
    } catch (error) {
      console.error("Error calling validate action:", error);
      toast.error("Error de conexion. Intenta de nuevo.");
      setIsValidating(false);
    }
  }, [artifactId]);

  const handleApprove = useCallback(async () => {
    await updateInstructionalPlanStatusAction(
      artifactId,
      PLAN_STATES.APPROVED,
      reviewNotes,
    );
    await updateArtifactStatusAction(artifactId, "READY_FOR_QA");
    setExistingPlan((currentPlan) =>
      currentPlan
        ? {
            ...currentPlan,
            state: PLAN_STATES.APPROVED,
          }
        : currentPlan,
    );
    router.refresh();
    onNext?.();
  }, [artifactId, onNext, reviewNotes, router]);

  const handleReject = useCallback(async () => {
    await updateInstructionalPlanStatusAction(
      artifactId,
      PLAN_STATES.REJECTED,
      reviewNotes,
    );
    setExistingPlan((currentPlan) =>
      currentPlan
        ? {
            ...currentPlan,
            state: PLAN_STATES.REJECTED,
          }
        : currentPlan,
    );
    router.refresh();
  }, [artifactId, reviewNotes, router]);

  const handleRegenerateRejected = useCallback(async () => {
    if (
      !confirm(
        "Estas seguro de que quieres regenerar? Esto eliminara el plan actual.",
      )
    ) {
      return;
    }

    try {
      await deleteInstructionalPlanAction(artifactId);
      setExistingPlan(null);
      setIsGenerating(false);
      setIsValidating(false);
      setReviewNotes("");
      handleCancelEdit();
    } catch (error) {
      console.error(error);
    }
  }, [artifactId, handleCancelEdit]);

  const handleDismissUpstreamDirty = useCallback(async () => {
    await dismissUpstreamDirtyAction("instructional_plans", artifactId);
    setExistingPlan((currentPlan) =>
      currentPlan ? { ...currentPlan, upstream_dirty: false } : currentPlan,
    );
    router.refresh();
  }, [artifactId, router]);

  const handleIterateUpstreamDirty = useCallback(async () => {
    await handleGenerate();
    await dismissUpstreamDirtyAction("instructional_plans", artifactId);
    setExistingPlan((currentPlan) =>
      currentPlan ? { ...currentPlan, upstream_dirty: false } : currentPlan,
    );
    router.refresh();
  }, [artifactId, handleGenerate, router]);

  if (loadingPlan) {
    return (
      <div className="py-10 text-center text-gray-500">
        Cargando plan instruccional...
      </div>
    );
  }

  if (existingPlan) {
    return (
      <InstructionalPlanResultsView
        canReview={canReview}
        editedLesson={editedLesson}
        editingLessonId={editingLessonId}
        expandedLessonId={expandedLessonId}
        isGenerating={isGenerating}
        isValidating={isValidating}
        onApprove={handleApprove}
        onCancelEdit={handleCancelEdit}
        onComponentFieldChange={handleComponentFieldChange}
        onComponentTypeChange={handleComponentTypeChange}
        onDismissUpstreamDirty={handleDismissUpstreamDirty}
        onIterateUpstreamDirty={handleIterateUpstreamDirty}
        onLessonFieldChange={handleLessonFieldChange}
        onNext={onNext}
        onRegenerate={handleGenerate}
        onRegenerateRejected={handleRegenerateRejected}
        onReject={handleReject}
        onReviewNotesChange={setReviewNotes}
        onSaveLesson={handleSaveLesson}
        onStartEdit={handleStartEdit}
        onToggleExpandedLesson={handleToggleExpandedLesson}
        onValidate={handleValidate}
        plan={existingPlan}
        reviewNotes={reviewNotes}
      />
    );
  }

  return (
    <InstructionalPlanSetupView
      customPrompt={customPrompt}
      isGenerating={isGenerating}
      lessonCount={0}
      onGenerate={handleGenerate}
      setCustomPrompt={setCustomPrompt}
      setUseCustomPrompt={setUseCustomPrompt}
      useCustomPrompt={useCustomPrompt}
    />
  );
}
