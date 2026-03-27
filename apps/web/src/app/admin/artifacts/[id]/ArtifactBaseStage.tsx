"use client";

import {
  AlertCircle,
  Check,
  CheckCircle2,
  Edit2,
  Edit3,
  FileText,
  Layers,
  RotateCw,
  Target,
  X,
} from "lucide-react";

interface ArtifactBaseStageProps {
  artifact: any;
  profile?: any;
  activeTab: "content" | "validation";
  setActiveTab: (tab: "content" | "validation") => void;
  editingSection: "nombres" | "objetivos" | "descripcion" | null;
  setEditingSection: (
    section: "nombres" | "objetivos" | "descripcion" | null,
  ) => void;
  editedContent: any;
  setEditedContent: (updater: any) => void;
  feedback: string;
  setFeedback: (feedback: string) => void;
  reviewState: "pending" | "approved" | "rejected";
  isRegenerating: boolean;
  validation: any;
  onSaveContent: () => Promise<void>;
  onCancelEdit: () => void;
  onApprove: () => Promise<void>;
  onReject: () => Promise<void>;
  onRegenerate: () => Promise<void>;
  onContinue: () => void;
}

export function ArtifactBaseStage({
  artifact,
  profile,
  activeTab,
  setActiveTab,
  editingSection,
  setEditingSection,
  editedContent,
  setEditedContent,
  feedback,
  setFeedback,
  reviewState,
  isRegenerating,
  validation,
  onSaveContent,
  onCancelEdit,
  onApprove,
  onReject,
  onRegenerate,
  onContinue,
}: ArtifactBaseStageProps) {
  return (
    <>
      <div className="flex items-center gap-4">
        {["content", "validation"].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab as "content" | "validation")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === tab ? "bg-[#1F5AF6] text-white" : "bg-white dark:bg-[#151A21] text-gray-500 dark:text-[#94A3B8] hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-[#6C757D]/10"}`}
          >
            {tab === "content" ? "Idea Central" : "ValidaciÃ³n"}
          </button>
        ))}
      </div>

      {activeTab === "content" ? (
        <div className="space-y-6">
          <SectionCard
            title="Nombres del Curso"
            icon={<FileText size={18} className="text-[#00D4B3]" />}
            action={
              editingSection === "nombres" ? (
                <EditActions onSave={onSaveContent} onCancel={onCancelEdit} />
              ) : (
                <button
                  onClick={() => setEditingSection("nombres")}
                  className="p-1.5 hover:bg-[#1F5AF6]/10 text-[#6C757D] hover:text-[#1F5AF6] rounded-lg transition-colors"
                >
                  <Edit2 size={16} />
                </button>
              )
            }
          >
            {editingSection === "nombres" ? (
              <div className="space-y-3">
                {editedContent.nombres.map((nombre: string, idx: number) => (
                  <div key={idx} className="flex items-center gap-3">
                    <span className="text-[#6C757D] font-mono text-sm">
                      {idx + 1}.
                    </span>
                    <input
                      className="flex-1 bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 rounded-lg p-3 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-[#00D4B3] transition-colors"
                      value={nombre}
                      onChange={(e) => {
                        const nombres = [...editedContent.nombres];
                        nombres[idx] = e.target.value;
                        setEditedContent({ ...editedContent, nombres });
                      }}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {(artifact.nombres || []).map((nombre: string, idx: number) => (
                  <div
                    key={idx}
                    className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/10 text-gray-900 dark:text-white text-sm"
                  >
                    <span className="text-[#6C757D] font-mono">{idx + 1}.</span>
                    {nombre}
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Objetivos"
            icon={<Target size={18} className="text-[#F59E0B]" />}
            action={
              editingSection === "objetivos" ? (
                <EditActions onSave={onSaveContent} onCancel={onCancelEdit} />
              ) : (
                <button
                  onClick={() => setEditingSection("objetivos")}
                  className="p-1.5 hover:bg-[#1F5AF6]/10 text-[#6C757D] hover:text-[#1F5AF6] rounded-lg transition-colors"
                >
                  <Edit2 size={16} />
                </button>
              )
            }
          >
            {editingSection === "objetivos" ? (
              <div className="space-y-3">
                {editedContent.objetivos.map((obj: string, idx: number) => (
                  <div key={idx} className="flex items-start gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] mt-4 shrink-0" />
                    <textarea
                      className="flex-1 bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 rounded-lg p-3 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-[#F59E0B] transition-colors min-h-[60px]"
                      value={obj}
                      onChange={(e) => {
                        const objetivos = [...editedContent.objetivos];
                        objetivos[idx] = e.target.value;
                        setEditedContent({ ...editedContent, objetivos });
                      }}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <ul className="space-y-3">
                {(artifact.objetivos || []).map((obj: string, idx: number) => (
                  <li
                    key={idx}
                    className="flex gap-3 text-sm text-gray-700 dark:text-[#E9ECEF] bg-gray-50 dark:bg-[#0F1419] p-3 rounded-lg border border-gray-200 dark:border-[#6C757D]/10"
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] mt-2 shrink-0" />
                    {obj}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard
            title="DescripciÃ³n"
            icon={<Layers size={18} className="text-[#1F5AF6]" />}
            action={
              editingSection === "descripcion" ? (
                <EditActions onSave={onSaveContent} onCancel={onCancelEdit} />
              ) : (
                <button
                  onClick={() => setEditingSection("descripcion")}
                  className="p-1.5 hover:bg-[#1F5AF6]/10 text-[#6C757D] hover:text-[#1F5AF6] rounded-lg transition-colors"
                >
                  <Edit2 size={16} />
                </button>
              )
            }
          >
            {editingSection === "descripcion" ? (
              <textarea
                className="w-full bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 rounded-xl p-4 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-[#1F5AF6] min-h-[150px] leading-relaxed"
                value={editedContent.descripcion.texto}
                onChange={(e) =>
                  setEditedContent({
                    ...editedContent,
                    descripcion: {
                      ...editedContent.descripcion,
                      texto: e.target.value,
                    },
                  })
                }
              />
            ) : (
              <p className="text-sm text-gray-700 dark:text-[#E9ECEF] bg-gray-50 dark:bg-[#0F1419] p-4 rounded-xl border border-gray-200 dark:border-[#6C757D]/10 leading-relaxed">
                {artifact.descripcion?.texto || "N/A"}
              </p>
            )}
          </SectionCard>

          {profile?.platform_role !== "CONSTRUCTOR" && (
            <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl p-6 mt-8">
              <h3 className="text-gray-900 dark:text-white font-bold mb-4 flex items-center gap-2">
                <Edit3 size={18} /> RevisiÃ³n Fase 1 (QA)
              </h3>

              <textarea
                className="w-full bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 rounded-xl p-4 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-[#00D4B3]/50 min-h-[100px] placeholder-gray-400 dark:placeholder-gray-600"
                placeholder="Escribe tus comentarios o feedback para la IA..."
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                disabled={reviewState === "approved" || isRegenerating}
              />

              <div className="flex items-center gap-4 mt-4">
                {reviewState === "pending" && (
                  <>
                    <button
                      onClick={onApprove}
                      className="flex-1 bg-[#00D4B3]/10 hover:bg-[#00D4B3]/20 text-[#00D4B3] border border-[#00D4B3]/20 py-3 rounded-xl font-medium transition-all"
                    >
                      Aprobar Fase 1
                    </button>
                    <button
                      onClick={onReject}
                      className="flex-1 bg-[#EF4444]/10 hover:bg-[#EF4444]/20 text-[#EF4444] border border-[#EF4444]/20 py-3 rounded-xl font-medium transition-all"
                    >
                      Rechazar Fase 1
                    </button>
                  </>
                )}

                {reviewState === "rejected" && (
                  <button
                    onClick={onRegenerate}
                    disabled={isRegenerating}
                    className="w-full bg-[#EF4444] hover:bg-[#cc3a3a] text-white py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2"
                  >
                    {isRegenerating ? (
                      <RotateCw className="animate-spin" />
                    ) : (
                      <RotateCw />
                    )}
                    {isRegenerating
                      ? "Regenerando..."
                      : "Regenerar Contenido con IA"}
                  </button>
                )}

                {reviewState === "approved" && (
                  <div className="w-full flex gap-4">
                    <div className="flex-1 bg-[#00D4B3]/20 text-[#00D4B3] py-3 rounded-xl font-bold text-center flex items-center justify-center gap-2">
                      <CheckCircle2 /> Fase 1 Aprobada
                    </div>
                    <button
                      onClick={onContinue}
                      className="flex-1 bg-[#1F5AF6] hover:bg-[#1548c7] text-white py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#1F5AF6]/20"
                    >
                      Continuar a Estructura
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {artifact.generation_metadata?.search_queries &&
            artifact.generation_metadata.search_queries.length > 0 && (
              <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-xl p-5">
                <h3 className="text-gray-900 dark:text-white font-bold text-sm mb-3 flex items-center gap-2">
                  <Layers size={16} className="text-[#1F5AF6]" />
                  BÃºsquedas de InvestigaciÃ³n
                </h3>
                <div className="flex flex-wrap gap-2">
                  {artifact.generation_metadata.search_queries.map(
                    (q: string, idx: number) => (
                      <span
                        key={idx}
                        className="text-xs text-gray-600 dark:text-[#E9ECEF] bg-gray-100 dark:bg-[#0F1419] px-3 py-1.5 rounded-full border border-gray-200 dark:border-[#6C757D]/20"
                      >
                        ðŸ” {q}
                      </span>
                    ),
                  )}
                </div>
              </div>
            )}

          <div className="space-y-2">
            {validation.results?.map((res: any, idx: number) => (
              <div
                key={idx}
                className={`p-4 rounded-xl border flex items-start gap-4 ${res.passed ? "bg-[#00D4B3]/10 border-[#00D4B3]/20" : "bg-[#EF4444]/10 border-[#EF4444]/20"}`}
              >
                {res.passed ? (
                  <CheckCircle2 className="text-[#00D4B3]" />
                ) : (
                  <AlertCircle className="text-[#EF4444]" />
                )}
                <p className="text-sm text-gray-900 dark:text-white mt-1">
                  {res.message}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function EditActions({
  onSave,
  onCancel,
}: {
  onSave: () => Promise<void>;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onSave}
        className="p-1.5 bg-green-500/10 hover:bg-green-500/20 text-green-500 rounded-lg transition-colors"
      >
        <Check size={16} />
      </button>
      <button
        onClick={onCancel}
        className="p-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-lg transition-colors"
      >
        <X size={16} />
      </button>
    </div>
  );
}

function SectionCard({ title, icon, action, children }: any) {
  return (
    <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 dark:border-[#6C757D]/10 flex justify-between items-center bg-gray-50 dark:bg-[#1A2027]">
        <h3 className="text-gray-900 dark:text-white font-bold flex items-center gap-2">
          {icon} {title}
        </h3>
        {action && <div>{action}</div>}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}
