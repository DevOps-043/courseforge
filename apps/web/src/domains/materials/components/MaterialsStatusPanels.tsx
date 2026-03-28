"use client";

import {
  AlertTriangle,
  CheckCircle,
  Clock,
  Loader2,
  RefreshCw,
  Send,
  XCircle,
} from "lucide-react";
import { REVIEWER_ROLE_SET } from "@/lib/pipeline-constants";
import type { MaterialLesson, QADecision } from "../types/materials.types";

interface MaterialsGenerationStuckInfo {
  isStuck: boolean;
  minutesElapsed: number;
}

interface MaterialsProfile {
  platform_role?: string | null;
}

interface MaterialsStepHeaderProps {
  title: string;
  stateLabel: string;
  stateColor: string;
  isGenerating: boolean;
  isValidating: boolean;
}

export function MaterialsStepHeader({
  title,
  stateLabel,
  stateColor,
  isGenerating,
  isValidating,
}: MaterialsStepHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <h3 className="text-lg font-semibold">{title}</h3>
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${stateColor}`}>
          {stateLabel}
        </span>
        {(isGenerating || isValidating) && (
          <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            Actualizando...
          </span>
        )}
      </div>
    </div>
  );
}

interface MaterialsGeneratingBannerProps {
  generationStuckInfo: MaterialsGenerationStuckInfo | null;
  isResetting: boolean;
  onForceReset: () => Promise<void>;
}

export function MaterialsGeneratingBanner({
  generationStuckInfo,
  isResetting,
  onForceReset,
}: MaterialsGeneratingBannerProps) {
  return (
    <div
      className={`p-4 border rounded-lg ${
        generationStuckInfo?.isStuck
          ? "bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800"
          : "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {generationStuckInfo?.isStuck ? (
            <AlertTriangle className="h-5 w-5 text-orange-600 dark:text-orange-400" />
          ) : (
            <Loader2 className="h-5 w-5 animate-spin text-blue-600 dark:text-blue-400" />
          )}
          <div>
            <p
              className={`font-medium ${
                generationStuckInfo?.isStuck
                  ? "text-orange-800 dark:text-orange-300"
                  : "text-blue-800 dark:text-blue-300"
              }`}
            >
              {generationStuckInfo?.isStuck
                ? "Generacion posiblemente bloqueada"
                : "Generando materiales..."}
            </p>
            <p
              className={`text-sm ${
                generationStuckInfo?.isStuck
                  ? "text-orange-600 dark:text-orange-400"
                  : "text-blue-600 dark:text-blue-400"
              }`}
            >
              {generationStuckInfo?.minutesElapsed
                ? `Tiempo transcurrido: ${generationStuckInfo.minutesElapsed} minutos`
                : "Este proceso puede tomar varios minutos dependiendo del numero de lecciones."}
            </p>
            {generationStuckInfo?.isStuck && (
              <p className="text-xs text-orange-500 dark:text-orange-400 mt-1">
                La generacion lleva mas de 30 minutos. Puedes cancelarla e intentar de nuevo.
              </p>
            )}
          </div>
        </div>
        {generationStuckInfo && generationStuckInfo.minutesElapsed >= 5 && (
          <button
            onClick={onForceReset}
            disabled={isResetting}
            className="inline-flex items-center gap-2 px-4 py-2 text-white bg-orange-600 rounded-lg hover:bg-orange-700 disabled:opacity-50 transition-colors font-medium"
          >
            {isResetting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Cancelando...
              </>
            ) : (
              <>
                <XCircle className="h-4 w-4" />
                Cancelar Generacion
              </>
            )}
          </button>
        )}
      </div>
      {generationStuckInfo?.minutesElapsed !== undefined &&
        generationStuckInfo.minutesElapsed < 5 && (
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
            <Clock className="h-3 w-3" />
            El boton de cancelar aparecera despues de 5 minutos si la generacion no progresa.
          </p>
        )}
    </div>
  );
}

interface MaterialsValidationBannerProps {
  isValidatingAll: boolean;
  onValidateAll: () => Promise<void>;
}

export function MaterialsValidationBanner({
  isValidatingAll,
  onValidateAll,
}: MaterialsValidationBannerProps) {
  return (
    <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CheckCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
          <div>
            <p className="font-medium text-yellow-800 dark:text-yellow-300">
              Materiales generados - Validacion pendiente
            </p>
            <p className="text-sm text-yellow-600 dark:text-yellow-400">
              Ejecuta la validacion para verificar la calidad de los materiales generados.
            </p>
          </div>
        </div>
        <button
          onClick={onValidateAll}
          disabled={isValidatingAll}
          className="inline-flex items-center gap-2 px-4 py-2 text-white bg-yellow-600 rounded-lg hover:bg-yellow-700 transition-colors font-medium disabled:opacity-50"
        >
          {isValidatingAll ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Validando...
            </>
          ) : (
            <>
              <CheckCircle className="h-4 w-4" />
              Validar Materiales
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export function MaterialsStatsGrid({ lessons }: { lessons: MaterialLesson[] }) {
  return (
    <div className="grid grid-cols-4 gap-4">
      <div className="p-3 bg-gray-50 dark:bg-white/5 rounded-lg text-center border border-transparent dark:border-white/10">
        <p className="text-2xl font-bold text-gray-900 dark:text-white">
          {lessons.length}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400">Lecciones</p>
      </div>
      <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg text-center border border-transparent dark:border-green-800">
        <p className="text-2xl font-bold text-green-600 dark:text-green-400">
          {lessons.filter((lesson) => lesson.state === "APPROVABLE").length}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400">Listas</p>
      </div>
      <div className="p-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg text-center border border-transparent dark:border-orange-800">
        <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">
          {lessons.filter((lesson) => lesson.state === "NEEDS_FIX").length}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400">Por corregir</p>
      </div>
      <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-center border border-transparent dark:border-blue-800">
        <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
          {
            lessons.filter((lesson) =>
              ["GENERATING", "VALIDATING"].includes(lesson.state),
            ).length
          }
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400">En proceso</p>
      </div>
    </div>
  );
}

interface MaterialsBulkRegenerateButtonProps {
  pendingCount: number;
  onRegenerateAll: () => Promise<void>;
}

export function MaterialsBulkRegenerateButton({
  pendingCount,
  onRegenerateAll,
}: MaterialsBulkRegenerateButtonProps) {
  return (
    <button
      onClick={onRegenerateAll}
      className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-white bg-orange-600 rounded-lg hover:bg-orange-700 transition-colors font-medium"
    >
      <RefreshCw className="h-4 w-4" />
      Regenerar Todas las Pendientes ({pendingCount})
    </button>
  );
}

interface MaterialsQaReviewPanelProps {
  isReadyForQA: boolean;
  isApproved: boolean;
  allLessonsApprovable: boolean;
  qaNote: string;
  profile?: MaterialsProfile;
  onQaNoteChange: (value: string) => void;
  onSubmitToQA: () => Promise<void>;
  onDecision: (decision: "APPROVED" | "REJECTED") => Promise<void>;
}

export function MaterialsQaReviewPanel({
  isReadyForQA,
  isApproved,
  allLessonsApprovable,
  qaNote,
  profile,
  onQaNoteChange,
  onSubmitToQA,
  onDecision,
}: MaterialsQaReviewPanelProps) {
  if (!isReadyForQA && !isApproved) {
    return (
      <div className="flex justify-end">
        <button
          onClick={onSubmitToQA}
          disabled={!allLessonsApprovable}
          className="inline-flex items-center gap-2 px-4 py-2 text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Send className="h-4 w-4" />
          Enviar a QA
        </button>
      </div>
    );
  }

  if (!isReadyForQA) {
    return null;
  }

  return (
    <div className="p-4 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg space-y-4">
      <div className="flex items-center gap-2">
        <CheckCircle className="h-5 w-5 text-purple-600 dark:text-purple-400" />
        <span className="font-medium text-purple-800 dark:text-purple-300">
          Pendiente de revision QA
        </span>
      </div>
      {REVIEWER_ROLE_SET.has(profile?.platform_role || "") && (
        <>
          <textarea
            value={qaNote}
            onChange={(event) => onQaNoteChange(event.target.value)}
            placeholder="Notas de revision (opcional)"
            className="w-full p-3 text-sm border border-purple-200 dark:border-purple-700 rounded-lg bg-white dark:bg-[#1E2329] text-gray-900 dark:text-white placeholder-gray-400"
            rows={2}
          />
          <div className="flex gap-3">
            <button
              onClick={() => onDecision("APPROVED")}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
            >
              <CheckCircle className="h-4 w-4" />
              Aprobar
            </button>
            <button
              onClick={() => onDecision("REJECTED")}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
            >
              <AlertTriangle className="h-4 w-4" />
              Rechazar
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function MaterialsApprovedBanner({
  qaDecision,
}: {
  qaDecision: QADecision | null;
}) {
  return (
    <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
      <div className="flex items-center gap-2">
        <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
        <span className="font-medium text-green-800 dark:text-green-300">
          Materiales aprobados! Listos para produccion.
        </span>
      </div>
      {qaDecision?.notes && (
        <p className="mt-2 text-sm text-green-700 dark:text-green-400">
          Notas QA: {qaDecision.notes}
        </p>
      )}
    </div>
  );
}
