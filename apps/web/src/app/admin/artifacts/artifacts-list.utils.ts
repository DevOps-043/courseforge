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

export function getArtifactProgress(artifact: Artifact) {
  if (artifact.state === "REJECTED") {
    return { percent: 100, color: "bg-red-500", animated: false };
  }

  if (artifact.production_complete) {
    return { percent: 100, color: "bg-emerald-500", animated: false };
  }

  if (artifact.state === "APPROVED") {
    if (artifact.plan_state === "STEP_APPROVED") {
      return { percent: 60, color: "bg-indigo-500", animated: false };
    }

    if (artifact.syllabus_state === "STEP_APPROVED") {
      return { percent: 40, color: "bg-blue-500", animated: false };
    }

    return { percent: 20, color: "bg-[#00D4B3]", animated: false };
  }

  switch (artifact.state) {
    case "DRAFT":
      return {
        percent: 5,
        color: "bg-gray-400 dark:bg-gray-600",
        animated: false,
      };
    case "GENERATING":
      return { percent: 10, color: "bg-blue-500", animated: true };
    case "VALIDATING":
      return { percent: 12, color: "bg-purple-500", animated: true };
    case "READY_FOR_QA":
    case "PENDING_QA":
      return { percent: 18, color: "bg-cyan-500", animated: false };
    case "ESCALATED":
      return { percent: 18, color: "bg-orange-500", animated: false };
    case "IN_PROCESS":
      return { percent: 10, color: "bg-blue-500", animated: true };
    default:
      return { percent: 5, color: "bg-gray-300", animated: false };
  }
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
