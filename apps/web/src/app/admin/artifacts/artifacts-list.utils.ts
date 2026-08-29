import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import type { Artifact, ArtifactStatusConfig } from "./artifacts-list.types";

export const artifactStatusConfig: Record<string, ArtifactStatusConfig> = {
  DRAFT: {
    label: "Borrador",
    color:
      "text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-500/10 border-gray-200 dark:border-gray-500/20",
  },
  GENERATING: {
    label: "Generando...",
    color:
      "text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/20 animate-pulse",
    icon: Loader2,
  },
  VALIDATING: {
    label: "Validando",
    color:
      "text-purple-600 dark:text-purple-400 bg-purple-100 dark:bg-purple-500/10 border-purple-200 dark:border-purple-500/20 animate-pulse",
    icon: Loader2,
  },
  READY_FOR_QA: {
    label: "Listo para QA",
    color:
      "text-cyan-600 dark:text-cyan-400 bg-cyan-100 dark:bg-cyan-500/10 border-cyan-200 dark:border-cyan-500/20",
    icon: CheckCircle2,
  },
  ESCALATED: {
    label: "Revision Manual",
    color:
      "text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-500/10 border-orange-200 dark:border-orange-500/20",
    icon: AlertCircle,
  },
  PENDING_QA: {
    label: "Pendiente QA",
    color:
      "text-yellow-600 dark:text-yellow-400 bg-yellow-100 dark:bg-yellow-500/10 border-yellow-200 dark:border-yellow-500/20",
  },
  IN_PROCESS: {
    label: "En Proceso",
    color:
      "text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/20",
  },
  APPROVED: {
    label: "Aprobado",
    color:
      "text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-500/10 border-green-200 dark:border-green-500/20",
  },
  REJECTED: {
    label: "Rechazado",
    color:
      "text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-500/10 border-red-200 dark:border-red-500/20",
  },
  PRODUCTION_COMPLETE: {
    label: "Produccion Completa",
    color: "text-emerald-300 bg-emerald-500/20 border-emerald-400/40",
    icon: CheckCircle2,
  },
} satisfies Record<string, ArtifactStatusConfig>;

export const artifactStatusTabs = [
  { id: "all", label: "Estados: Todos" },
  { id: "APPROVED", label: "Aprobados" },
  { id: "PENDING_QA", label: "Pendientes QA" },
  { id: "IN_PROCESS", label: "En proceso" },
  { id: "ESCALATED", label: "Escalados" },
] as const;

export function getArtifactDisplayState(
  artifact: Artifact,
  normalizeReadyForQa: boolean = false,
) {
  if (artifact.production_complete) {
    return "PRODUCTION_COMPLETE";
  }

  if (
    normalizeReadyForQa &&
    artifact.state === "READY_FOR_QA" &&
    (artifact.plan_state === "STEP_APPROVED" ||
      artifact.syllabus_state === "STEP_APPROVED")
  ) {
    return "IN_PROCESS";
  }

  return artifact.state;
}

export function getArtifactProgress(artifact: Artifact) {
  if (artifact.production_complete) {
    return { percent: 100, color: "bg-emerald-500", animated: false };
  }

  const phases = [
    artifact.state,
    artifact.syllabus_state,
    artifact.plan_state,
    artifact.curation_state,
    artifact.materials_state,
  ];
  const furthestStartedPhase = phases.reduce(
    (furthest, state, index) => (state ? index : furthest),
    -1,
  );
  const completedBeforeFurthest = Math.max(0, furthestStartedPhase);
  const activePhaseProgress =
    furthestStartedPhase >= 0
      ? getPipelineStateProgress(phases[furthestStartedPhase])
      : 0;
  const productionProgress = getProductionPhaseProgress(artifact);
  const completedPhaseUnits =
    productionProgress > 0
      ? 5 + productionProgress
      : completedBeforeFurthest + activePhaseProgress;
  const percent = Math.min(100, Math.round((completedPhaseUnits / 6) * 100));
  const activeState = phases[furthestStartedPhase] || artifact.state;
  const isRejected = /REJECTED|BLOCKED|ESCALATED/.test(activeState || "");
  const animated = /GENERATING|VALIDATING|IN_PROCESS|IN_PROGRESS/.test(
    activeState || "",
  );

  return {
    percent,
    color: isRejected
      ? "bg-red-500"
      : animated
        ? "bg-blue-500"
        : "bg-[#00D4B3]",
    animated,
  };
}

function getPipelineStateProgress(state?: string) {
  if (!state) return 0;
  if (/APPROVED$/.test(state)) return 1;
  if (/READY_FOR_QA|PENDING_QA|REVIEW|HITL_REVIEW|GENERATED/.test(state)) return 0.8;
  if (/VALIDATING/.test(state)) return 0.6;
  if (/GENERATING|IN_PROCESS|IN_PROGRESS/.test(state)) return 0.3;
  if (/REJECTED|BLOCKED|ESCALATED|NEEDS_FIX|CORRECTABLE/.test(state)) return 0.8;
  return 0;
}

function getProductionPhaseProgress(artifact: Artifact) {
  const status = artifact.production_status;
  if (!status || status.total <= 0) return 0;
  return Math.min(1, status.completed / status.total);
}

export function formatArtifactCreatedAt(createdAt: string) {
  const createdDate = new Date(createdAt);
  const now = new Date();
  const diffDays = Math.floor(
    (now.getTime() - createdDate.getTime()) / (1000 * 3600 * 24),
  );

  if (diffDays > 0) {
    return `Hace ${diffDays} dias`;
  }

  const diffHours = Math.floor(
    (now.getTime() - createdDate.getTime()) / (1000 * 3600),
  );

  if (diffHours === 0) {
    return "Hace momentos";
  }

  return `Hace ${diffHours} h`;
}

export function getArtifactDescription(descripcion: Artifact["descripcion"]) {
  if (!descripcion) {
    return "Sin descripcion";
  }

  if (typeof descripcion === "string") {
    return descripcion;
  }

  if (typeof descripcion === "object" && descripcion !== null) {
    const normalizedDescription = descripcion as {
      texto?: string;
      resumen?: string;
    };

    if (normalizedDescription.texto) {
      return normalizedDescription.texto;
    }

    if (normalizedDescription.resumen) {
      return normalizedDescription.resumen;
    }

    if (Object.keys(normalizedDescription).length > 0) {
      return JSON.stringify(normalizedDescription).substring(0, 100);
    }
  }

  return "Sin descripcion";
}

export function getArtifactTitle(ideaCentral: string) {
  return (ideaCentral || "Artefacto sin nombre")
    .replace(/^TEMA:\s*/i, "")
    .split(/IDEA PRINCIPAL:/i)[0]
    .trim();
}

export function isStandaloneAssemblyArtifact(
  artifact: Pick<Artifact, "descripcion" | "idea_central">,
) {
  if (hasStandaloneAssemblyMode(artifact.descripcion)) {
    return true;
  }

  const rawIdea = artifact.idea_central?.trim();

  if (!rawIdea) {
    return false;
  }

  if (
    rawIdea.includes('"mode":"standalone_assembly"') ||
    rawIdea.includes('"mode": "standalone_assembly"')
  ) {
    return true;
  }

  try {
    const parsedIdea = JSON.parse(rawIdea) as { mode?: unknown };
    return parsedIdea.mode === "standalone_assembly";
  } catch {
    // Standalone projects created by Courseforge keep a readable title in
    // idea_central and the authoritative mode in descripcion. The prefix is a
    // compatibility fallback for rows created before descripcion was stored.
    return /^\[Ensamble\]\s+/i.test(rawIdea);
  }
}

function hasStandaloneAssemblyMode(value: unknown) {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return (value as { mode?: unknown }).mode === "standalone_assembly";
  }

  if (typeof value !== "string") {
    return false;
  }

  try {
    return (JSON.parse(value) as { mode?: unknown }).mode === "standalone_assembly";
  } catch {
    return (
      value.includes('"mode":"standalone_assembly"') ||
      value.includes('"mode": "standalone_assembly"')
    );
  }
}
