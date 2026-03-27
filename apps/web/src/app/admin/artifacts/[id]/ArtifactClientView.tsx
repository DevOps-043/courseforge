"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  regenerateArtifactAction,
  updateArtifactContentAction,
  updateArtifactStatusAction,
} from "@/domains/artifacts/actions/artifact.actions";
import {
  getArtifactWorkflowStep,
  hasCurationStarted,
  hasMaterialsStarted,
  isCurationApproved,
  isInstructionalPlanApproved,
  isMaterialsApproved,
  isSyllabusApproved,
} from "@/lib/artifact-workflow";
import type {
  PublicationProfile,
  PublicationRequestRecord,
  PublicationVideoLesson,
} from "@/domains/publication/types/publication.types";
import { ArtifactStageContent } from "./ArtifactStageContent";
import { ArtifactToast } from "./ArtifactToast";
import { ArtifactWorkflowHeader } from "./ArtifactWorkflowHeader";
import { ArtifactWorkflowStepper } from "./ArtifactWorkflowStepper";
import {
  ARTIFACT_REFRESH_POLL_INTERVAL_MS,
  ARTIFACT_TOAST_HIDE_DELAY_MS,
} from "@/shared/constants/timing";
import type {
  ArtifactContentUpdates,
  ArtifactEditedContent,
  ArtifactValidationReport,
  ArtifactViewRecord,
} from "./artifact-view.types";

const STATUS_STYLES: Record<string, string> = {
  READY_FOR_QA: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
  ESCALATED: "text-orange-400 bg-orange-500/10 border-orange-500/20",
  GENERATING: "text-blue-400 bg-blue-500/10 border-blue-500/20 animate-pulse",
  APPROVED: "text-green-400 bg-green-500/10 border-green-500/20",
};

function buildEditedContent(artifact: ArtifactViewRecord): ArtifactEditedContent {
  return {
    nombres: artifact.nombres || [],
    objetivos: artifact.objetivos || [],
    descripcion: {
      texto: artifact.descripcion?.texto || artifact.descripcion?.resumen || "",
      publico_objetivo: artifact.descripcion?.publico_objetivo || "",
      beneficios: artifact.descripcion?.beneficios || "",
    },
  };
}

export default function ArtifactClientView({
  artifact,
  publicationRequest,
  publicationLessons,
  profile,
  basePath = "/admin",
}: {
  artifact: ArtifactViewRecord;
  publicationRequest?: PublicationRequestRecord | null;
  publicationLessons?: PublicationVideoLesson[];
  profile?: PublicationProfile;
  basePath?: string;
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"content" | "validation">(
    "content",
  );
  const [currentStep, setCurrentStep] = useState(() =>
    getArtifactWorkflowStep(artifact, publicationRequest),
  );
  const [feedback, setFeedback] = useState("");
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [reviewState, setReviewState] = useState<
    "pending" | "approved" | "rejected"
  >(
    artifact.state === "APPROVED" || artifact.qa_status === "APPROVED"
      ? "approved"
      : "pending",
  );
  const [localProductionComplete, setLocalProductionComplete] = useState(
    Boolean(artifact.production_complete),
  );
  const [editingSection, setEditingSection] = useState<
    "nombres" | "objetivos" | "descripcion" | null
  >(null);
  const [editedContent, setEditedContent] = useState(
    buildEditedContent(artifact),
  );
  const [toast, setToast] = useState<{
    show: boolean;
    message: string;
    type: "success" | "error" | "info";
  }>({ show: false, message: "", type: "info" });

  useEffect(() => {
    setLocalProductionComplete(Boolean(artifact.production_complete));
  }, [artifact.production_complete]);

  useEffect(() => {
    setCurrentStep((previousStep) =>
      Math.max(previousStep, getArtifactWorkflowStep(artifact, publicationRequest)),
    );
  }, [artifact, publicationRequest]);

  useEffect(() => {
    setEditedContent(buildEditedContent(artifact));
  }, [artifact]);

  useEffect(() => {
    if (artifact.state === "GENERATING" || isRegenerating) {
      const interval = setInterval(() => {
        router.refresh();
      }, ARTIFACT_REFRESH_POLL_INTERVAL_MS);

      return () => clearInterval(interval);
    }
  }, [artifact.state, isRegenerating, router]);

  const showToast = (
    message: string,
    type: "success" | "error" | "info" = "info",
  ) => {
    setToast({ show: true, message, type });
    setTimeout(() => {
      setToast((previous) => ({ ...previous, show: false }));
    }, ARTIFACT_TOAST_HIDE_DELAY_MS);
  };

  const handleSaveContent = async () => {
    if (!editingSection) return;

    try {
      const updates: ArtifactContentUpdates = {};

      if (editingSection === "nombres") {
        updates.nombres = editedContent.nombres;
      }

      if (editingSection === "objetivos") {
        updates.objetivos = editedContent.objetivos;
      }

      if (editingSection === "descripcion") {
        updates.descripcion = {
          ...artifact.descripcion,
          ...editedContent.descripcion,
        };
      }

      const result = await updateArtifactContentAction(artifact.id, updates);
      if (!result.success) {
        showToast("Error al guardar.", "error");
        return;
      }

      setEditingSection(null);
      showToast("Cambios guardados.", "success");
      router.refresh();
    } catch (error) {
      console.error(error);
      showToast("Error de conexiÃƒÂ³n", "error");
    }
  };

  const handleCancelEdit = () => {
    setEditingSection(null);
    setEditedContent(buildEditedContent(artifact));
  };

  const handleRegenerate = async () => {
    setIsRegenerating(true);

    try {
      await regenerateArtifactAction(artifact.id, feedback);
      showToast("RegeneraciÃƒÂ³n iniciada.", "info");
      setReviewState("pending");
      setFeedback("");
      router.refresh();
    } catch (error) {
      console.error(error);
      showToast("Error al regenerar.", "error");
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleApproveBase = async () => {
    try {
      const result = await updateArtifactStatusAction(artifact.id, "APPROVED");
      if (!result.success) {
        showToast("Error al actualizar.", "error");
        return;
      }

      setReviewState("approved");
      showToast("Fase 1 Aprobada.", "success");
      router.refresh();
    } catch (error) {
      console.error(error);
      showToast("Error de conexiÃƒÂ³n.", "error");
    }
  };

  const handleRejectBase = async () => {
    try {
      const result = await updateArtifactStatusAction(artifact.id, "REJECTED");
      if (!result.success) {
        showToast("Error al actualizar.", "error");
        return;
      }

      setReviewState("rejected");
      showToast("Fase 1 Rechazada.", "info");
      router.refresh();
    } catch (error) {
      console.error(error);
      showToast("Error de conexiÃƒÂ³n.", "error");
    }
  };

  const validation = artifact.validation_report || {
    results: [],
    all_passed: false,
  } satisfies ArtifactValidationReport;
  const currentStatusStyle =
    STATUS_STYLES[artifact.state] || STATUS_STYLES.GENERATING;
  const productionComplete =
    localProductionComplete || Boolean(artifact.production_complete);
  const syllabusApproved = isSyllabusApproved(artifact);
  const planApproved = isInstructionalPlanApproved(artifact);
  const curationStarted = hasCurationStarted(artifact);
  const curationApproved = isCurationApproved(artifact);
  const materialsStarted = hasMaterialsStarted(artifact);
  const materialsApproved = isMaterialsApproved(artifact);
  const publicationStarted = Boolean(publicationRequest);

  const canAccessSourcesStep =
    planApproved ||
    curationStarted ||
    materialsStarted ||
    productionComplete ||
    publicationStarted;
  const canAccessMaterialsStep =
    curationApproved ||
    materialsStarted ||
    productionComplete ||
    publicationStarted;
  const canAccessProductionStep =
    canAccessMaterialsStep || productionComplete || publicationStarted;
  const canAccessPublicationStep =
    canAccessProductionStep || publicationStarted;

  const baseDone =
    reviewState === "approved" ||
    syllabusApproved ||
    planApproved ||
    curationStarted ||
    curationApproved ||
    materialsStarted ||
    materialsApproved ||
    productionComplete ||
    publicationStarted;
  const syllabusDone =
    syllabusApproved ||
    planApproved ||
    curationStarted ||
    curationApproved ||
    materialsStarted ||
    materialsApproved ||
    productionComplete ||
    publicationStarted;
  const planDone =
    planApproved ||
    curationStarted ||
    curationApproved ||
    materialsStarted ||
    materialsApproved ||
    productionComplete ||
    publicationStarted;
  const curationDone =
    curationApproved ||
    materialsStarted ||
    materialsApproved ||
    productionComplete ||
    publicationStarted;
  const materialsDone =
    materialsApproved || productionComplete || publicationStarted;
  const productionDone = productionComplete || publicationStarted;

  return (
    <div className="space-y-8 relative">
      <ArtifactToast
        toast={toast}
        onClose={() => setToast((previous) => ({ ...previous, show: false }))}
      />

      <ArtifactWorkflowHeader
        artifact={artifact}
        currentStatusStyle={currentStatusStyle}
      />

      <ArtifactWorkflowStepper
        canAccessMaterialsStep={canAccessMaterialsStep}
        canAccessProductionStep={canAccessProductionStep}
        canAccessPublicationStep={canAccessPublicationStep}
        canAccessSourcesStep={canAccessSourcesStep}
        currentStep={currentStep}
        onStepChange={setCurrentStep}
        stepStatus={{
          baseDone,
          syllabusDone,
          planDone,
          curationDone,
          materialsDone,
          productionDone,
          publicationDone:
            publicationRequest?.status === "SENT" ||
            publicationRequest?.status === "APPROVED",
        }}
      />

      <ArtifactStageContent
        activeTab={activeTab}
        artifact={artifact}
        basePath={basePath}
        currentStep={currentStep}
        editedContent={editedContent}
        editingSection={editingSection}
        feedback={feedback}
        isRegenerating={isRegenerating}
        onApproveBase={handleApproveBase}
        onCancelEdit={handleCancelEdit}
        onLocalProductionStatusChange={setLocalProductionComplete}
        onRejectBase={handleRejectBase}
        onRegenerate={handleRegenerate}
        onSaveContent={handleSaveContent}
        profile={profile}
        productionComplete={productionComplete}
        publicationLessons={publicationLessons}
        publicationRequest={publicationRequest}
        reviewState={reviewState}
        setActiveTab={setActiveTab}
        setCurrentStep={setCurrentStep}
        setEditedContent={setEditedContent}
        setEditingSection={setEditingSection}
        setFeedback={setFeedback}
        validation={validation}
      />
    </div>
  );
}
