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
    <div className={`relative flex min-w-0 items-center justify-between gap-4 overflow-hidden ${compact ? "min-w-[12rem] p-0" : "engine-page-hero min-h-[8.5rem] p-6 md:p-8"}`}>
      {!compact && <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-[var(--engine-info)]/5 rounded-full blur-[80px] pointer-events-none translate-x-1/2 -translate-y-1/2" />}
      <div className="relative z-10 min-w-0 flex-1">
        <div className={`flex min-w-0 items-center gap-3 ${compact ? "" : "mb-2"}`}>
          <h1
            className={`${compact ? "font-display !text-[1.45rem] !font-normal !leading-none text-[var(--engine-text)]" : "font-display text-3xl font-normal text-white md:text-4xl"} truncate`}
            title={artifact.idea_central || undefined}
          >
            {getArtifactTitle(artifact.idea_central)}
          </h1>
          <div
            className={`${compact ? "hidden 2xl:flex" : "flex"} items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${currentStatusStyle}`}
          >
            {displayState === "READY_FOR_QA" ? (
              <CheckCircle2 size={10} />
            ) : (
              <AlertCircle size={10} />
            )}
            {displayState.replaceAll("_", " ")}
          </div>
        </div>
        {!compact && <p className="font-sans text-xs text-white/65">
          {artifact.courseId || artifact.id} " Creado hace{" "}
          {new Date(artifact.created_at).toLocaleDateString()}
        </p>}
      </div>
    </div>
  );
}
