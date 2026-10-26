"use client";

import type { Dispatch, SetStateAction } from "react";
import { DeliveryStagePanel } from "@/domains/course-delivery/components/DeliveryStagePanel";
import type { CourseDeliveryController } from "@/domains/course-delivery/hooks/useCourseDelivery";
import { SyllabusGenerationContainer } from "@/domains/syllabus/components/SyllabusGenerationContainer";
import { InstructionalPlanGenerationContainer } from "@/domains/plan/components/InstructionalPlanGenerationContainer";
import { SourcesCurationGenerationContainer } from "@/domains/curation/components/SourcesCurationGenerationContainer";
import { MaterialsForm } from "@/domains/materials/components/MaterialsForm";
import { VisualProductionContainer } from "@/domains/materials/components/VisualProductionContainer";
import { PostproductionAssemblyContainer } from "@/domains/materials/components/PostproductionAssemblyContainer";
import type {
  PublicationProfile,
  PublicationRequestRecord,
  PublicationVideoLesson,
} from "@/domains/publication/types/publication.types";
import PublicationClientView from "./publish/PublicationClientView";
import { ArtifactBaseStage } from "./ArtifactBaseStage";
import type {
  ArtifactEditedContent,
  ArtifactEditingSection,
  ArtifactValidationReport,
  ArtifactViewRecord,
} from "./artifact-view.types";

interface ArtifactStageContentProps {
  delivery: CourseDeliveryController;
  activeTab: "content" | "validation";
  artifact: ArtifactViewRecord;
  basePath: string;
  currentStep: number;
  editedContent: ArtifactEditedContent;
  editingSection: ArtifactEditingSection;
  feedback: string;
  isRegenerating: boolean;
  onApproveBase: () => Promise<void>;
  onCancelEdit: () => void;
  onLocalProductionStatusChange: (complete: boolean) => void;
  onRejectBase: () => Promise<void>;
  onRegenerate: () => Promise<void>;
  onSaveContent: () => Promise<void>;
  profile?: PublicationProfile;
  assetsComplete: boolean;
  publicationLessons?: PublicationVideoLesson[];
  publicationRequest?: PublicationRequestRecord | null;
  reviewState: "pending" | "approved" | "rejected";
  setActiveTab: (tab: "content" | "validation") => void;
  setCurrentStep: (step: number) => void;
  setEditedContent: Dispatch<SetStateAction<ArtifactEditedContent>>;
  setEditingSection: (section: ArtifactEditingSection) => void;
  setFeedback: (feedback: string) => void;
  validation: ArtifactValidationReport;
}

const STAGE_WRAPPER = "animate-in fade-in slide-in-from-right-4 duration-300";

export function ArtifactStageContent({
  delivery,
  activeTab,
  artifact,
  basePath,
  currentStep,
  editedContent,
  editingSection,
  feedback,
  isRegenerating,
  onApproveBase,
  onCancelEdit,
  onLocalProductionStatusChange,
  onRejectBase,
  onRegenerate,
  onSaveContent,
  profile,
  assetsComplete,
  publicationLessons,
  publicationRequest,
  reviewState,
  setActiveTab,
  setCurrentStep,
  setEditedContent,
  setEditingSection,
  setFeedback,
  validation,
}: ArtifactStageContentProps) {
  const mode = delivery.snapshot?.workspace.document.config.mode || "NEXUS";
  const sessions = mode !== "NEXUS";
  const nexus = mode !== "SYNCHRONOUS";
  const sessionPanel = <DeliveryStagePanel controller={delivery} stage={currentStep} />;
  if (sessions && [3, 5, 6, 8].includes(currentStep) && !nexus) return sessionPanel;
  if (sessions && currentStep === 7 && !nexus) return <div className={STAGE_WRAPPER}><p>Ensamble no requerido: este curso no necesita producción audiovisual.</p><button className="mt-4 rounded border px-4 py-2" onClick={() => setCurrentStep(8)}>Continuar a entrega</button></div>;
  if (currentStep === 1) {
    return (
      <div>{sessionPanel}<ArtifactBaseStage
        artifact={artifact}
        profile={profile}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        editingSection={editingSection}
        setEditingSection={setEditingSection}
        editedContent={editedContent}
        setEditedContent={setEditedContent}
        feedback={feedback}
        setFeedback={setFeedback}
        reviewState={reviewState}
        isRegenerating={isRegenerating}
        validation={validation}
        onSaveContent={onSaveContent}
        onCancelEdit={onCancelEdit}
        onApprove={onApproveBase}
        onReject={onRejectBase}
        onRegenerate={onRegenerate}
        onContinue={() => setCurrentStep(2)}
      /></div>
    );
  }

  if (currentStep === 2) {
    return (
      <div className={STAGE_WRAPPER}>
        <SyllabusGenerationContainer
          artifactId={artifact.id}
          initialObjetivos={artifact.objetivos || []}
          initialIdeaCentral={artifact.idea_central || ""}
          onNext={() => setCurrentStep(3)}
          profile={profile}
        />
        {sessions && sessionPanel}
      </div>
    );
  }

  if (currentStep === 3) {
    return (
      <div className={STAGE_WRAPPER}>
        {sessions && sessionPanel}
        <InstructionalPlanGenerationContainer
          coordinatedReview={sessions}
          artifactId={artifact.id}
          onNext={() => setCurrentStep(4)}
          profile={profile}
        />
      </div>
    );
  }

  if (currentStep === 4) {
    return (
      <div className={STAGE_WRAPPER}>
        <SourcesCurationGenerationContainer
          artifactId={artifact.id}
          courseId={artifact.courseId || artifact.course_id || undefined}
          temario={artifact.temario?.modules ?? undefined}
          ideaCentral={artifact.idea_central || undefined}
          profile={profile}
          onNext={() => setCurrentStep(5)}
        />
      </div>
    );
  }

  if (currentStep === 5) {
    return (
      <div className={STAGE_WRAPPER}>
        {sessions && sessionPanel}
        <MaterialsForm artifactId={artifact.id} profile={profile} coordinatedReview={sessions} />
      </div>
    );
  }

  if (currentStep === 6) {
    return (
      <div className={STAGE_WRAPPER}>
        {sessions && sessionPanel}
        <VisualProductionContainer
          artifactId={artifact.id}
          assetsComplete={assetsComplete}
          onStatusChange={onLocalProductionStatusChange}
          profile={profile}
        />
      </div>
    );
  }

  if (currentStep === 7) {
    return (
      <div className={`${STAGE_WRAPPER} h-full min-h-0`}>
        <PostproductionAssemblyContainer
          artifactId={artifact.id}
          onNext={() => setCurrentStep(8)}
          profile={profile}
        />
      </div>
    );
  }

  if (currentStep === 8) {
    return (
      <div className={STAGE_WRAPPER}>
        {sessions && sessionPanel}
        <PublicationClientView
          artifactId={artifact.id}
          artifactTitle={artifact.idea_central || "Artefacto"}
          lessons={publicationLessons || []}
          existingRequest={publicationRequest}
          profile={profile}
          basePath={basePath}
        />
      </div>
    );
  }

  return null;
}
