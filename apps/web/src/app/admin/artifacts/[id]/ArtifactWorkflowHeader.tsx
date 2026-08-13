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
  displayState?: string;
  compact?: boolean;
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
  displayState = artifact.state,
  compact = false,
}: ArtifactWorkflowHeaderProps) {
  return (
    <div className={`relative flex min-w-0 items-center justify-between gap-4 overflow-hidden ${compact ? "p-0" : "rounded-2xl border border-gray-200 bg-white p-6 dark:border-[#6C757D]/10 dark:bg-[#151A21]"}`}>
      {!compact && <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-[#1F5AF6]/5 rounded-full blur-[80px] pointer-events-none translate-x-1/2 -translate-y-1/2" />}
      <div className="relative z-10 min-w-0 flex-1">
        <div className={`flex items-center gap-3 ${compact ? "" : "mb-1"}`}>
          <h1
            className={`${compact ? "text-base text-slate-900 dark:text-white" : "text-xl text-gray-900 dark:text-white"} font-bold truncate`}
            title={artifact.idea_central || undefined}
          >
            {getArtifactTitle(artifact.idea_central)}
          </h1>
          <div
            className={`px-2 py-0.5 rounded-full text-[10px] font-bold border flex items-center gap-1 uppercase tracking-wider ${currentStatusStyle}`}
          >
            {displayState === "READY_FOR_QA" ? (
              <CheckCircle2 size={10} />
            ) : (
              <AlertCircle size={10} />
            )}
            {displayState.replaceAll("_", " ")}
          </div>
        </div>
        {!compact && <p className="text-gray-500 dark:text-[#6C757D] text-xs font-mono">
          {artifact.courseId || artifact.id} " Creado hace{" "}
          {new Date(artifact.created_at).toLocaleDateString()}
        </p>}
      </div>
    </div>
  );
}
