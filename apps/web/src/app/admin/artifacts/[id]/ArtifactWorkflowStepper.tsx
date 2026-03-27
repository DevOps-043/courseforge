"use client";

import { BookOpen, CheckCircle2, FileText, Layers, Target } from "lucide-react";

interface ArtifactWorkflowStepperProps {
  canAccessMaterialsStep: boolean;
  canAccessProductionStep: boolean;
  canAccessPublicationStep: boolean;
  canAccessSourcesStep: boolean;
  currentStep: number;
  onStepChange: (step: number) => void;
  stepStatus: {
    baseDone: boolean;
    syllabusDone: boolean;
    planDone: boolean;
    curationDone: boolean;
    materialsDone: boolean;
    productionDone: boolean;
    publicationDone: boolean;
  };
}

function StepDivider({ done }: { done: boolean }) {
  return (
    <div
      className={`h-0.5 flex-1 mx-4 rounded-full transition-colors relative top-[-10px] ${
        done ? "bg-[#1F5AF6]" : "bg-gray-200 dark:bg-[#2D333B]"
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
      className={`flex flex-col items-center gap-2 min-w-[90px] transition-all ${
        disabled ? "opacity-40 cursor-not-allowed" : "hover:opacity-90 cursor-pointer"
      }`}
    >
      <div
        className={`w-14 h-14 rounded-full border-2 flex items-center justify-center transition-all ${
          active
            ? "border-[#1F5AF6] text-[#1F5AF6]"
            : done
              ? "border-[#00D4B3] text-[#00D4B3]"
              : "border-gray-300 dark:border-[#2D333B] text-gray-500 dark:text-[#6C757D]"
        }`}
      >
        {done ? <CheckCircle2 size={16} /> : icon}
      </div>
      <span
        className={`text-xs font-semibold uppercase tracking-wide ${
          active
            ? "text-[#1F5AF6]"
            : done
              ? "text-[#00D4B3]"
              : "text-gray-500 dark:text-[#6C757D]"
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
  canAccessPublicationStep,
  canAccessSourcesStep,
  currentStep,
  onStepChange,
  stepStatus,
}: ArtifactWorkflowStepperProps) {
  return (
    <div className="px-8 py-6 bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl flex items-center justify-between overflow-x-auto">
      <StepItem
        label="Base"
        active={currentStep === 1}
        onClick={() => onStepChange(1)}
        icon={<Target size={18} />}
        done={stepStatus.baseDone}
      />
      <StepDivider done={stepStatus.baseDone} />
      <StepItem
        label="Temario"
        active={currentStep === 2}
        onClick={() => onStepChange(2)}
        icon={<BookOpen size={18} />}
        disabled={!stepStatus.baseDone}
        done={stepStatus.syllabusDone}
      />
      <StepDivider done={stepStatus.syllabusDone} />
      <StepItem
        label="Plan"
        active={currentStep === 3}
        onClick={() => onStepChange(3)}
        icon={<Layers size={18} />}
        disabled={!stepStatus.syllabusDone}
        done={stepStatus.planDone}
      />
      <StepDivider done={stepStatus.planDone} />
      <StepItem
        label="Fuentes"
        active={currentStep === 4}
        onClick={() => onStepChange(4)}
        icon={<FileText size={18} />}
        disabled={!canAccessSourcesStep}
        done={stepStatus.curationDone}
      />
      <StepDivider done={stepStatus.curationDone} />
      <StepItem
        label="Materiales"
        active={currentStep === 5}
        onClick={() => onStepChange(5)}
        icon={<Layers size={18} />}
        disabled={!canAccessMaterialsStep}
        done={stepStatus.materialsDone}
      />
      <StepDivider done={stepStatus.materialsDone} />
      <StepItem
        label="Produccion"
        active={currentStep === 6}
        onClick={() => onStepChange(6)}
        icon={<Target size={18} />}
        disabled={!canAccessProductionStep}
        done={stepStatus.productionDone}
      />
      <StepDivider done={stepStatus.productionDone} />
      <StepItem
        label="Publicar"
        active={currentStep === 7}
        onClick={() => onStepChange(7)}
        icon={<Target size={18} />}
        disabled={!canAccessPublicationStep}
        done={stepStatus.publicationDone}
      />
    </div>
  );
}
