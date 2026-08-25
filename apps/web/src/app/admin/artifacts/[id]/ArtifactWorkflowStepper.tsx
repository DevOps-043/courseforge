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

function StepDivider({ compact, done }: { compact?: boolean; done: boolean }) {
  return (
    <div
      className={`h-px shrink-0 rounded-full transition-colors ${compact ? "w-3 xl:w-5" : "w-5 md:w-8"} ${
        done ? "bg-[var(--engine-accent-strong)]/70 dark:bg-[var(--engine-accent)]/70" : compact ? "bg-[var(--engine-border)]" : "bg-gray-200 dark:bg-[#2D333B]"
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
  compact,
}: {
  active?: boolean;
  disabled?: boolean;
  done?: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`group flex shrink-0 flex-col items-center gap-1 transition-all ${compact ? "min-w-9 rounded-xl px-0.5 py-1 xl:min-w-[54px]" : "min-w-[68px] rounded-lg px-1.5 py-1"} ${
        disabled ? "cursor-not-allowed opacity-35" : compact ? "cursor-pointer hover:bg-[var(--engine-surface-hover)]" : "cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5"
      }`}
    >
      <div
        className={`flex items-center justify-center rounded-full border transition-all ${compact ? "h-7 w-7 xl:h-8 xl:w-8" : "h-8 w-8 md:h-9 md:w-9"} ${
          active
            ? compact
              ? "border-[var(--engine-accent)] bg-[var(--engine-accent)] text-[#042119] shadow-[0_0_0_4px_rgba(13,212,183,0.10)]"
              : "border-[var(--engine-info)] bg-[var(--engine-info)] text-white shadow-sm shadow-[var(--engine-info)]/25"
            : done
              ? compact
                ? "border-[var(--engine-accent-strong)]/45 bg-[var(--engine-accent)]/10 text-[var(--engine-accent-strong)] dark:border-[var(--engine-accent)]/45 dark:text-[var(--engine-accent)]"
                : "border-[var(--engine-accent)] bg-[var(--engine-accent)]/10 text-[var(--engine-accent)]"
              : compact
                ? "border-[var(--engine-border)] bg-[var(--engine-surface-soft)] text-[var(--engine-text-muted)]"
                : "border-gray-300 text-gray-500 dark:border-[#2D333B] dark:text-[var(--engine-muted)]"
        }`}
      >
        {done ? <CheckCircle2 size={15} /> : icon}
      </div>
      <span
        className={`${compact ? "hidden text-[8px] xl:block" : "text-[10px]"} font-semibold uppercase tracking-wide ${
          active
            ? compact ? "text-[var(--engine-accent-strong)] dark:text-[var(--engine-accent)]" : "text-[var(--engine-info)]"
            : done
              ? compact ? "text-[var(--engine-accent-strong)] dark:text-[var(--engine-accent)]" : "text-[var(--engine-accent)]"
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
    <div className={compact ? "min-w-0 flex-1" : "sticky top-3 z-50 rounded-2xl border border-gray-200 bg-white/90 px-3 py-2 shadow-[0_14px_32px_rgba(15,23,42,0.10)] backdrop-blur-xl dark:border-white/10 dark:bg-[#10151C]/90"}>
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
          compact={compact}
          label="Base"
          active={currentStep === 1}
          onClick={() => onStepChange(1)}
          icon={<Target size={17} />}
          done={stepStatus.baseDone}
        />
        <StepDivider compact={compact} done={stepStatus.baseDone} />
        <StepItem
          compact={compact}
          label="Temario"
          active={currentStep === 2}
          onClick={() => onStepChange(2)}
          icon={<BookOpen size={17} />}
          disabled={!stepStatus.baseDone}
          done={stepStatus.syllabusDone}
        />
        <StepDivider compact={compact} done={stepStatus.syllabusDone} />
        <StepItem
          compact={compact}
          label="Plan"
          active={currentStep === 3}
          onClick={() => onStepChange(3)}
          icon={<Layers size={17} />}
          disabled={!stepStatus.syllabusDone}
          done={stepStatus.planDone}
        />
        <StepDivider compact={compact} done={stepStatus.planDone} />
        <StepItem
          compact={compact}
          label="Fuentes"
          active={currentStep === 4}
          onClick={() => onStepChange(4)}
          icon={<FileText size={17} />}
          disabled={!canAccessSourcesStep}
          done={stepStatus.curationDone}
        />
        <StepDivider compact={compact} done={stepStatus.curationDone} />
        <StepItem
          compact={compact}
          label="Materiales"
          active={currentStep === 5}
          onClick={() => onStepChange(5)}
          icon={<Layers size={17} />}
          disabled={!canAccessMaterialsStep}
          done={stepStatus.materialsDone}
        />
        <StepDivider compact={compact} done={stepStatus.materialsDone} />
        <StepItem
          compact={compact}
          label="Produccion"
          active={currentStep === 6}
          onClick={() => onStepChange(6)}
          icon={<Target size={17} />}
          disabled={!canAccessProductionStep}
          done={stepStatus.productionDone}
        />
        <StepDivider compact={compact} done={stepStatus.productionDone} />
        <StepItem
          compact={compact}
          label="Ensamble"
          active={currentStep === 7}
          onClick={() => onStepChange(7)}
          icon={<Layers size={17} />}
          disabled={!canAccessPostproductionStep}
          done={stepStatus.postproductionDone}
        />
        <StepDivider compact={compact} done={stepStatus.postproductionDone} />
        <StepItem
          compact={compact}
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
