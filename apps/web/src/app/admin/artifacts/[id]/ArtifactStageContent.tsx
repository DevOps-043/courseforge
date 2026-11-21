"use client";

import type { Dispatch, SetStateAction } from "react";
import dynamic from "next/dynamic";
import { HybridPlanLayout } from "@/domains/plan/components/HybridPlanLayout";
import { DeliveryStagePanel } from "@/domains/course-delivery/components/DeliveryStagePanel";
import { academyLessonId } from "@/domains/course-delivery/lib/academy-scope";
import type { CourseDeliveryController } from "@/domains/course-delivery/hooks/useCourseDelivery";
import type {
  PublicationProfile,
  PublicationRequestRecord,
  PublicationVideoLesson,
} from "@/domains/publication/types/publication.types";
import { ArtifactBaseStage } from "./ArtifactBaseStage";
import { CourseSourceLibrary } from "@/domains/course-sources/CourseSourceLibrary";
import { CourseSourceCuration } from "@/domains/course-sources/CourseSourceCuration";
import type {
  ArtifactEditedContent,
  ArtifactEditingSection,
  ArtifactValidationReport,
  ArtifactViewRecord,
} from "./artifact-view.types";

function StageLoading() {
  return <div role="status" className="flex min-h-40 items-center justify-center text-sm text-gray-500">Cargando etapa…</div>;
}

const SyllabusGenerationContainer = dynamic(() => import("@/domains/syllabus/components/SyllabusGenerationContainer").then((module) => module.SyllabusGenerationContainer), { loading: StageLoading });
const InstructionalPlanGenerationContainer = dynamic(() => import("@/domains/plan/components/InstructionalPlanGenerationContainer").then((module) => module.InstructionalPlanGenerationContainer), { loading: StageLoading });
const SourcesCurationGenerationContainer = dynamic(() => import("@/domains/curation/components/SourcesCurationGenerationContainer").then((module) => module.SourcesCurationGenerationContainer), { loading: StageLoading });
const MaterialsForm = dynamic(() => import("@/domains/materials/components/MaterialsForm").then((module) => module.MaterialsForm), { loading: StageLoading });
const HybridMaterialsWorkspace = dynamic(() => import("@/domains/materials/components/HybridMaterialsWorkspace").then(module => module.HybridMaterialsWorkspace), { loading: StageLoading });
const VisualProductionContainer = dynamic(() => import("@/domains/materials/components/VisualProductionContainer").then((module) => module.VisualProductionContainer), { loading: StageLoading });
const PostproductionAssemblyContainer = dynamic(() => import("@/domains/materials/components/PostproductionAssemblyContainer").then((module) => module.PostproductionAssemblyContainer), { loading: StageLoading });
const PublicationClientView = dynamic(() => import("./publish/PublicationClientView"), { loading: StageLoading });

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
  onDocumentaryBaseStarted: () => void;
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
  onDocumentaryBaseStarted,
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
  const academyLessonIds = new Set(delivery.snapshot?.workspace.document.hybridRoute?.flatMap(item => item.kind === "ASYNCHRONOUS" ? item.lessonIds : []) || []);
  const academyNotice = mode === "HYBRID" ? <aside role="note" className="mb-6 space-y-2 rounded-xl border border-[var(--engine-border)] bg-[var(--engine-surface-solid)] p-5 text-sm leading-relaxed text-[var(--engine-text)]">
    <strong className="block">Estudio asíncrono · Academy</strong>
    <p>Este apartado trabaja con las lecciones asignadas a Academy en el recorrido del paso 2. Las sesiones en vivo y sus documentos se preparan por separado para Hub. Producción y ensamble corresponden a los recursos asíncronos.</p>
  </aside> : null;
  if (sessions && [3, 5, 6, 8].includes(currentStep) && !nexus) return sessionPanel;
  if (sessions && currentStep === 7 && !nexus) return <div className={STAGE_WRAPPER}><p>Ensamble no requerido: este curso no necesita producción audiovisual.</p><button className="mt-4 rounded border px-4 py-2" onClick={() => setCurrentStep(8)}>Continuar a entrega</button></div>;
  if (currentStep === 1) {
    return (
      <div><CourseSourceLibrary artifactId={artifact.id} />{sessionPanel}<ArtifactBaseStage
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
        onDocumentaryBaseStarted={onDocumentaryBaseStarted}
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
        <CourseSourceLibrary artifactId={artifact.id} />
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
    const academyPlan = <InstructionalPlanGenerationContainer
      coordinatedReview={sessions}
      artifactId={artifact.id}
      onNext={() => setCurrentStep(4)}
      profile={profile}
    />;
    return <div className={STAGE_WRAPPER}>
      {mode === "HYBRID"
        ? <HybridPlanLayout hub={sessionPanel} academy={academyPlan} />
        : academyPlan}
    </div>;
  }

  if (currentStep === 4) {
    return (
      <div className={STAGE_WRAPPER}>
        <CourseSourceLibrary artifactId={artifact.id} />
        <CourseSourceCuration artifactId={artifact.id} onNext={() => setCurrentStep(5)}><SourcesCurationGenerationContainer
          artifactId={artifact.id}
          courseId={artifact.courseId || artifact.course_id || undefined}
          temario={artifact.temario?.modules ?? undefined}
          ideaCentral={artifact.idea_central || undefined}
          profile={profile}
          onNext={() => setCurrentStep(5)}
        /></CourseSourceCuration>
      </div>
    );
  }

  if (currentStep === 5) {
    if (mode === "HYBRID") return <div className={STAGE_WRAPPER}><HybridMaterialsWorkspace artifactId={artifact.id} delivery={delivery} profile={profile} /></div>;
    return (
      <div className={STAGE_WRAPPER}>
        {sessions && sessionPanel}
        {academyNotice}
        <MaterialsForm artifactId={artifact.id} profile={profile} coordinatedReview={sessions} />
      </div>
    );
  }

  if (currentStep === 6) {
    return (
      <div className={STAGE_WRAPPER}>
        {sessions && sessionPanel}
        {academyNotice}
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
        {academyNotice}
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
        {academyNotice}
        <PublicationClientView
          artifactId={artifact.id}
          artifactTitle={artifact.idea_central || "Artefacto"}
          lessons={mode === "HYBRID" ? (publicationLessons || []).filter(lesson => academyLessonIds.has(academyLessonId(lesson.id))) : publicationLessons || []}
          existingRequest={publicationRequest}
          profile={profile}
          basePath={basePath}
        />
      </div>
    );
  }

  return null;
}
