"use client";

import { SyllabusGenerationContainer } from "@/domains/syllabus/components/SyllabusGenerationContainer";
import { InstructionalPlanGenerationContainer } from "@/domains/plan/components/InstructionalPlanGenerationContainer";
import { SourcesCurationGenerationContainer } from "@/domains/curation/components/SourcesCurationGenerationContainer";
import { MaterialsForm } from "@/domains/materials/components/MaterialsForm";
import { VisualProductionContainer } from "@/domains/materials/components/VisualProductionContainer";
import PublicationClientView from "./publish/PublicationClientView";
import { ArtifactBaseStage } from "./ArtifactBaseStage";

interface ArtifactStageContentProps {
  activeTab: "content" | "validation";
  artifact: any;
  basePath: string;
  currentStep: number;
  editedContent: any;
  editingSection: "nombres" | "objetivos" | "descripcion" | null;
  feedback: string;
  isRegenerating: boolean;
  onApproveBase: () => Promise<void>;
  onCancelEdit: () => void;
  onLocalProductionStatusChange: (complete: boolean) => void;
  onRejectBase: () => Promise<void>;
  onRegenerate: () => Promise<void>;
  onSaveContent: () => Promise<void>;
  profile?: any;
  productionComplete: boolean;
  publicationLessons?: any[];
  publicationRequest?: any;
  reviewState: "pending" | "approved" | "rejected";
  setActiveTab: (tab: "content" | "validation") => void;
  setCurrentStep: (step: number) => void;
  setEditedContent: (updater: any) => void;
  setEditingSection: (
    section: "nombres" | "objetivos" | "descripcion" | null,
  ) => void;
  setFeedback: (feedback: string) => void;
  validation: any;
}

const STAGE_WRAPPER = "animate-in fade-in slide-in-from-right-4 duration-300";

export function ArtifactStageContent({
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
  productionComplete,
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
  if (currentStep === 1) {
    return (
      <ArtifactBaseStage
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
      />
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
      </div>
    );
  }

  if (currentStep === 3) {
    return (
      <div className={STAGE_WRAPPER}>
        <InstructionalPlanGenerationContainer
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
          courseId={artifact.courseId || artifact.course_id}
          temario={artifact.temario?.modules}
          ideaCentral={artifact.idea_central}
          profile={profile}
          onNext={() => setCurrentStep(5)}
        />
      </div>
    );
  }

  if (currentStep === 5) {
    return (
      <div className={STAGE_WRAPPER}>
        <MaterialsForm artifactId={artifact.id} profile={profile} />
      </div>
    );
  }

  if (currentStep === 6) {
    return (
      <div className={STAGE_WRAPPER}>
        <VisualProductionContainer
          artifactId={artifact.id}
          productionComplete={productionComplete}
          onStatusChange={onLocalProductionStatusChange}
          profile={profile}
        />
      </div>
    );
  }

  if (currentStep === 7) {
    return (
      <div className={STAGE_WRAPPER}>
        <PublicationClientView
          artifactId={artifact.id}
          artifactTitle={artifact.idea_central}
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
