"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  regenerateArtifactAction,
  updateArtifactContentAction,
  updateArtifactStatusAction,
} from "@/domains/artifacts/actions/artifact.actions";
import {
  buildWorkflowSnapshot,
  getWorkflowStep,
  isCurationApprovedFromSnapshot,
  isInstructionalPlanApproved,
  isMaterialsApprovedFromSnapshot,
  isSyllabusApproved,
} from "@/lib/artifact-workflow";
import { getArtifactDisplayState } from "../artifacts-list.utils";
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
    getWorkflowStep(buildWorkflowSnapshot(artifact, publicationRequest)),
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
    setCurrentStep(getWorkflowStep(buildWorkflowSnapshot(artifact, publicationRequest)));
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
      showToast("Error de conexiҳn", "error");
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
      showToast("Regeneraciҳn iniciada.", "info");
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
      showToast("Error de conexiҳn.", "error");
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
      showToast("Error de conexiҳn.", "error");
    }
  };

  const validation = artifact.validation_report || {
    results: [],
    all_passed: false,
  } satisfies ArtifactValidationReport;
  const displayState =
    basePath === "/admin"
      ? getArtifactDisplayState({
          id: artifact.id,
          idea_central: artifact.idea_central || "",
          descripcion: artifact.descripcion,
          state: artifact.state,
          created_at: artifact.created_at,
          created_by: "",
          syllabus_state:
            typeof artifact.syllabus_state === "string"
              ? artifact.syllabus_state
              : undefined,
          plan_state:
            typeof artifact.plan_state === "string" ? artifact.plan_state : undefined,
          production_complete: Boolean(artifact.production_complete),
        }, true)
      : artifact.state;
  const currentStatusStyle =
    STATUS_STYLES[displayState] || STATUS_STYLES.GENERATING;

  // Construir snapshot — extrae solo campos primitivos del artifact.
  // Elimina contaminación cruzada entre fases.
  const snapshot = buildWorkflowSnapshot(artifact, publicationRequest);
  const productionComplete =
    localProductionComplete || snapshot.productionComplete;
  const syllabusApproved = isSyllabusApproved(snapshot);
  const planApproved = isInstructionalPlanApproved(snapshot);
  const curationApproved = isCurationApprovedFromSnapshot(snapshot);
  const materialsApproved = isMaterialsApprovedFromSnapshot(snapshot);

  // Cada paso se marca como "done" solo por su propia fase
  const baseDone = reviewState === "approved" || syllabusApproved;
  const syllabusDone = syllabusApproved;
  const planDone = planApproved;
  const curationDone = curationApproved;
  const materialsDone = materialsApproved;
  const productionDone = productionComplete;

  // Progresión lineal estricta: cada paso requiere que su predecesor esté done
  const canAccessSourcesStep = planDone;
  const canAccessMaterialsStep = curationDone;
  const canAccessProductionStep = materialsDone;
  const canAccessPublicationStep = productionDone;

  return (
    <div className="space-y-8 relative">
      <ArtifactToast
        toast={toast}
        onClose={() => setToast((previous) => ({ ...previous, show: false }))}
      />

      <ArtifactWorkflowHeader
        artifact={artifact}
        currentStatusStyle={currentStatusStyle}
        displayState={displayState}
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
