"use client";

import { AlertCircle, CheckCircle2 } from "lucide-react";

interface ArtifactWorkflowHeaderProps {
  artifact: {
    courseId?: string | null;
    created_at: string;
    id: string;
    idea_central?: string | null;
    state: string;
  };
  currentStatusStyle: string;
}

function getArtifactTitle(title?: string | null) {
  return (title || "Artefacto sin nombre")
    .replace(/(TEMA:|IDEA PRINCIPAL:|PÒšBLICO:|RESULTADOS:)/g, "")
    .split(".")[0]
    .trim();
}

export function ArtifactWorkflowHeader({
  artifact,
  currentStatusStyle,
}: ArtifactWorkflowHeaderProps) {
  return (
    <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl p-6 relative overflow-hidden flex items-center justify-between gap-4">
      <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-[#1F5AF6]/5 rounded-full blur-[80px] pointer-events-none translate-x-1/2 -translate-y-1/2" />
      <div className="relative z-10 flex-1 min-w-0">
        <div className="flex items-center gap-3 mb-1">
          <h1
            className="text-xl font-bold text-gray-900 dark:text-white truncate"
            title={artifact.idea_central || undefined}
          >
            {getArtifactTitle(artifact.idea_central)}
          </h1>
          <div
            className={`px-2 py-0.5 rounded-full text-[10px] font-bold border flex items-center gap-1 uppercase tracking-wider ${currentStatusStyle}`}
          >
            {artifact.state === "READY_FOR_QA" ? (
              <CheckCircle2 size={10} />
            ) : (
              <AlertCircle size={10} />
            )}
            {artifact.state.replace("_", " ")}
          </div>
        </div>
        <p className="text-gray-500 dark:text-[#6C757D] text-xs font-mono">
          {artifact.courseId || artifact.id} " Creado hace{" "}
          {new Date(artifact.created_at).toLocaleDateString()}
        </p>
      </div>
    </div>
  );
}
