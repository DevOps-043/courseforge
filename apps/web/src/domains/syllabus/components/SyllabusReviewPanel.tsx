import { Esp02StepState } from "../types/syllabus.types";

interface SyllabusReviewPanelProps {
  status: Esp02StepState;
  reviewNotes: string;
  canReview: boolean;
  onReviewNotesChange: (value: string) => void;
  onApprove: () => Promise<void>;
  onReject: () => Promise<void>;
  onReset: () => Promise<void>;
  onNext?: () => void;
}

export function SyllabusReviewPanel({
  status,
  reviewNotes,
  canReview,
  onReviewNotesChange,
  onApprove,
  onReject,
  onReset,
  onNext,
}: SyllabusReviewPanelProps) {
  const isApproved = status === "STEP_APPROVED";
  const showReviewActions =
    canReview && status !== "STEP_APPROVED" && status !== "STEP_REJECTED";
  const showResetActions =
    status === "STEP_REJECTED" || status === "STEP_READY_FOR_QA";

  return (
    <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-white/5 rounded-2xl p-6 mt-8">
      <h3 className="text-gray-900 dark:text-white font-bold mb-4 flex items-center gap-2">
        <svg
          className="w-4 h-4 text-[#00D4B3]"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
          />
        </svg>
        Revisión Fase 2: Estructura
      </h3>

      <textarea
        className="w-full bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-white/10 rounded-xl p-4 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-[#00D4B3]/50 min-h-[100px] placeholder-gray-400 dark:placeholder-gray-600"
        placeholder="Escribe tus comentarios o feedback sobre la estructura del temario..."
        value={reviewNotes}
        onChange={(event) => onReviewNotesChange(event.target.value)}
        disabled={isApproved}
      />

      <div className="flex items-center gap-4 mt-4">
        {showReviewActions && (
          <>
            <button
              onClick={onApprove}
              className="flex-1 bg-[#00D4B3]/10 hover:bg-[#00D4B3]/20 text-[#00D4B3] border border-[#00D4B3]/20 py-3 rounded-xl font-medium transition-all flex items-center justify-center gap-2"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
              Aprobar Fase 2
            </button>
            <button
              onClick={onReject}
              className="flex-1 bg-[#EF4444]/10 hover:bg-[#EF4444]/20 text-[#EF4444] border border-[#EF4444]/20 py-3 rounded-xl font-medium transition-all flex items-center justify-center gap-2"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
              Rechazar Fase 2
            </button>
          </>
        )}

        {isApproved && (
          <div className="w-full flex gap-4">
            <div className="flex-1 bg-[#00D4B3]/20 text-[#00D4B3] py-3 rounded-xl font-bold text-center flex items-center justify-center gap-2">
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              Fase 2 Aprobada
            </div>
            {onNext && (
              <button
                type="button"
                onClick={onNext}
                className="flex-1 bg-[#1F5AF6] hover:bg-[#1548c7] text-white py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#1F5AF6]/20"
              >
                Continuar a Plan
              </button>
            )}
          </div>
        )}
      </div>

      {showResetActions && (
        <div className="mt-6 pt-6 border-t border-gray-200 dark:border-white/5">
          <button
            onClick={onReset}
            className="w-full flex items-center justify-center gap-2 text-gray-500 hover:text-red-400 text-sm transition-colors py-2"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
            Descartar temario actual y volver a empezar
          </button>
        </div>
      )}
    </div>
  );
}
