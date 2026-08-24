"use client";

import { BookOpen, CheckCircle2, FileText, Layers, Target } from "lucide-react";

interface ArtifactWorkflowStepperProps {
  canAccessMaterialsStep: boolean;
  canAccessProductionStep: boolean;
  canAccessPostproductionStep: boolean;
  canAccessPublicationStep: boolean;
  canAccessSourcesStep: boolean;
  currentStep: number;
  compact?: boolean;
  onStepChange: (step: number) => void;
  stepStatus: {
    baseDone: boolean;
    syllabusDone: boolean;
    planDone: boolean;
    curationDone: boolean;
    materialsDone: boolean;
    productionDone: boolean;
    postproductionDone: boolean;
    publicationDone: boolean;
  };
}

function StepDivider({ done }: { done: boolean }) {
  return (
    <div
      className={`h-0.5 w-5 shrink-0 rounded-full transition-colors md:w-8 ${
        done ? "bg-[var(--engine-info)]" : "bg-gray-200 dark:bg-[#2D333B]"
      }`}
    />
  );
}

function StepItem({
  active,
  disabled,
  done,
  icon,
  label,
  onClick,
}: {
  active?: boolean;
  disabled?: boolean;
  done?: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`group flex min-w-[68px] shrink-0 flex-col items-center gap-1 rounded-lg px-1.5 py-1 transition-all ${
        disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5"
      }`}
    >
      <div
        className={`flex h-8 w-8 items-center justify-center rounded-full border transition-all md:h-9 md:w-9 ${
          active
            ? "border-[var(--engine-info)] bg-[var(--engine-info)] text-white shadow-sm shadow-[var(--engine-info)]/25"
            : done
              ? "border-[var(--engine-accent)] bg-[var(--engine-accent)]/10 text-[var(--engine-accent)]"
              : "border-gray-300 dark:border-[#2D333B] text-gray-500 dark:text-[var(--engine-muted)]"
        }`}
      >
        {done ? <CheckCircle2 size={15} /> : icon}
      </div>
      <span
        className={`text-[10px] font-semibold uppercase tracking-wide ${
          active
            ? "text-[var(--engine-info)]"
            : done
              ? "text-[var(--engine-accent)]"
              : "text-gray-500 dark:text-[var(--engine-muted)]"
        }`}
      >
        {label}
      </span>
    </button>
  );
}

export function ArtifactWorkflowStepper({
  canAccessMaterialsStep,
  canAccessProductionStep,
  canAccessPostproductionStep,
  canAccessPublicationStep,
  canAccessSourcesStep,
  currentStep,
  compact = false,
  onStepChange,
  stepStatus,
}: ArtifactWorkflowStepperProps) {
  const currentStepLabel =
    [
      "Base",
      "Temario",
      "Plan",
      "Fuentes",
      "Materiales",
      "Produccion",
      "Ensamble",
      "Publicar",
    ][currentStep - 1] ?? "Curso";

  return (
    <div className={compact ? "min-w-0 flex-1" : "sticky top-0 z-50 rounded-b-xl border-b border-x border-gray-200 bg-[#F8FAFC] px-3 py-2 shadow-[0_14px_30px_rgba(15,23,42,0.10)] dark:border-[var(--engine-muted)]/10 dark:bg-[#10151C]"}>
      <div className={compact ? "hidden" : "mb-2 flex items-center justify-between gap-3"}>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">
            Flujo del curso
          </p>
          <p className="truncate text-sm font-bold text-gray-900 dark:text-white">
            Fase {currentStep} de 8: {currentStepLabel}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-[var(--engine-info)]/20 bg-[var(--engine-info)]/10 px-3 py-1 text-xs font-bold text-[var(--engine-info)]">
          {currentStep}/8
        </span>
      </div>

      <div className={compact ? "flex items-center justify-end overflow-x-auto" : "flex items-center overflow-x-auto pb-1"}>
        <StepItem
          label="Base"
          active={currentStep === 1}
          onClick={() => onStepChange(1)}
          icon={<Target size={17} />}
          done={stepStatus.baseDone}
        />
        <StepDivider done={stepStatus.baseDone} />
        <StepItem
          label="Temario"
          active={currentStep === 2}
          onClick={() => onStepChange(2)}
          icon={<BookOpen size={17} />}
          disabled={!stepStatus.baseDone}
          done={stepStatus.syllabusDone}
        />
        <StepDivider done={stepStatus.syllabusDone} />
        <StepItem
          label="Plan"
          active={currentStep === 3}
          onClick={() => onStepChange(3)}
          icon={<Layers size={17} />}
          disabled={!stepStatus.syllabusDone}
          done={stepStatus.planDone}
        />
        <StepDivider done={stepStatus.planDone} />
        <StepItem
          label="Fuentes"
          active={currentStep === 4}
          onClick={() => onStepChange(4)}
          icon={<FileText size={17} />}
          disabled={!canAccessSourcesStep}
          done={stepStatus.curationDone}
        />
        <StepDivider done={stepStatus.curationDone} />
        <StepItem
          label="Materiales"
          active={currentStep === 5}
          onClick={() => onStepChange(5)}
          icon={<Layers size={17} />}
          disabled={!canAccessMaterialsStep}
          done={stepStatus.materialsDone}
        />
        <StepDivider done={stepStatus.materialsDone} />
        <StepItem
          label="Produccion"
          active={currentStep === 6}
          onClick={() => onStepChange(6)}
          icon={<Target size={17} />}
          disabled={!canAccessProductionStep}
          done={stepStatus.productionDone}
        />
        <StepDivider done={stepStatus.productionDone} />
        <StepItem
          label="Ensamble"
          active={currentStep === 7}
          onClick={() => onStepChange(7)}
          icon={<Layers size={17} />}
          disabled={!canAccessPostproductionStep}
          done={stepStatus.postproductionDone}
        />
        <StepDivider done={stepStatus.postproductionDone} />
        <StepItem
          label="Publicar"
          active={currentStep === 8}
          onClick={() => onStepChange(8)}
          icon={<Target size={17} />}
          disabled={!canAccessPublicationStep}
          done={stepStatus.publicationDone}
        />
      </div>
    </div>
  );
}
