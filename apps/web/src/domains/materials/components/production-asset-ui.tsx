import {
  AlertCircle,
  CheckCircle,
  CheckCircle2,
  Circle,
  FileText,
} from "lucide-react";
import type {
  ProductionStatus,
  StoryboardItem,
  VideoContent,
  VideoGuideContent,
} from "../types/materials.types";

export const PRODUCTION_THEME = {
  card:
    "overflow-hidden rounded-2xl border bg-white dark:bg-[#151A21]",
  cardBorder: {
    default: "border-gray-200 dark:border-[#6C757D]/10",
    completed: "border-green-300 dark:border-green-500/30",
  },
  header:
    "border-b border-gray-200 bg-gray-50 px-6 py-4 dark:border-[#6C757D]/10 dark:bg-[#1A2027]",
  sectionTitle: "text-xs font-bold text-gray-700 dark:text-[#E9ECEF]",
  primaryText: "text-gray-900 dark:text-white",
  secondaryText: "text-gray-600 dark:text-[#6C757D]",
  panel:
    "rounded-xl border border-gray-200 bg-white dark:border-[#6C757D]/10 dark:bg-[#0F1419]",
  panelMuted:
    "rounded-xl border border-gray-200 bg-gray-50 dark:border-[#6C757D]/10 dark:bg-[#0F1419]/50",
  input:
    "rounded-lg border border-gray-300 bg-white text-xs text-gray-900 placeholder-gray-400 focus:border-[#1F5AF6] focus:outline-none dark:border-[#6C757D]/20 dark:bg-[#0F1419] dark:text-white dark:placeholder-gray-500",
  actionPurple:
    "border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100 dark:border-purple-500/20 dark:bg-purple-500/10 dark:text-purple-400 dark:hover:bg-purple-500/20",
  actionPurpleStrong:
    "border-purple-300 bg-gradient-to-r from-purple-50 to-blue-50 text-purple-700 hover:from-purple-100 hover:to-blue-100 dark:border-purple-500/30 dark:from-purple-500/20 dark:to-blue-500/20 dark:text-white dark:hover:from-purple-500/30 dark:hover:to-blue-500/30",
  actionPurpleMutedText: "text-purple-600 dark:text-gray-400",
  successLink:
    "text-green-700 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300",
  divider: "border-gray-200 dark:border-[#6C757D]/10",
  modal:
    "relative h-[80vh] w-full max-w-6xl overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-[#6C757D]/20 dark:bg-[#151A21]",
} as const;

export function getProductionStatusBadge(
  productionStatus: ProductionStatus,
  finalVideoUrl: string,
) {
  if (finalVideoUrl) {
    return {
      label: "Completado",
      color:
        "border-green-300 bg-green-50 text-green-700 dark:border-green-500/30 dark:bg-green-500/20 dark:text-green-400",
      icon: CheckCircle2,
    };
  }

  switch (productionStatus) {
    case "COMPLETED":
      return {
        label: "Completado",
        color:
          "border-green-300 bg-green-50 text-green-700 dark:border-green-500/30 dark:bg-green-500/20 dark:text-green-400",
        icon: CheckCircle2,
      };
    case "IN_PROGRESS":
      return {
        label: "En Progreso",
        color:
          "border-amber-300 bg-amber-50 text-amber-700 dark:border-yellow-500/30 dark:bg-yellow-500/20 dark:text-yellow-400",
        icon: AlertCircle,
      };
    case "DECK_READY":
      return {
        label: "Deck Listo",
        color:
          "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/20 dark:text-blue-400",
        icon: FileText,
      };
    case "EXPORTED":
      return {
        label: "Exportado",
        color:
          "border-purple-300 bg-purple-50 text-purple-700 dark:border-purple-500/30 dark:bg-purple-500/20 dark:text-purple-400",
        icon: CheckCircle,
      };
    default:
      return {
        label: "Pendiente",
        color:
          "border-gray-300 bg-gray-100 text-gray-600 dark:border-gray-500/30 dark:bg-gray-500/20 dark:text-gray-400",
        icon: Circle,
      };
  }
}

export function getProductionRequirements(componentType: string) {
  return {
    needsSlides:
      componentType === "VIDEO_THEORETICAL" ||
      componentType === "VIDEO_GUIDE" ||
      componentType === "VIDEO_DEMO",
    needsScreencast:
      componentType === "DEMO_GUIDE" || componentType === "VIDEO_GUIDE",
    needsVideo: componentType.includes("VIDEO"),
    needsFinalVideo: componentType.includes("VIDEO"),
  };
}

export function DodIndicator({
  label,
  completed,
  required,
}: {
  label: string;
  completed: boolean;
  required: boolean;
}) {
  if (!required) return null;

  return (
    <div
      className={`flex items-center gap-1.5 text-xs ${
        completed
          ? "text-green-700 dark:text-green-400"
          : "text-gray-500 dark:text-gray-500"
      }`}
    >
      {completed ? <CheckCircle2 size={12} /> : <Circle size={12} />}
      <span>{label}</span>
    </div>
  );
}

export function getProductionComponentLabel(type: string) {
  const labelMap: Record<string, string> = {
    VIDEO_THEORETICAL: "VIDEO TEORICO",
    VIDEO_GUIDE: "VIDEO GUIA",
    DEMO_GUIDE: "GUIA DEMOSTRATIVA",
    VIDEO_DEMO: "VIDEO DEMOSTRATIVO",
  };

  return labelMap[type] || type.replace(/_/g, " ");
}

interface StoryboardContent {
  storyboard?: StoryboardItem[];
}

export function ProductionStoryboardViewer({
  content,
}: {
  content: Partial<VideoContent & VideoGuideContent> | StoryboardContent;
}) {
  return (
    <div
      className={`max-h-[300px] overflow-y-auto p-4 custom-scrollbar ${PRODUCTION_THEME.panelMuted}`}
    >
      <h4
        className={`mb-2 text-xs font-bold uppercase tracking-wide ${PRODUCTION_THEME.secondaryText}`}
      >
        Storyboard Reference
      </h4>
      <div className="space-y-4">
        {content.storyboard?.map((item, index) => (
          <div key={index} className="flex gap-3 text-sm">
            <span className="text-[#1F5AF6] font-mono shrink-0">
              {item.timecode_start}
            </span>
            <div className="flex-1">
              <p className={`mb-1 ${PRODUCTION_THEME.primaryText}`}>
                {item.visual_content}
              </p>
              <p className={`text-xs italic ${PRODUCTION_THEME.secondaryText}`}>
                {item.narration_text}
              </p>
            </div>
          </div>
        )) || <p className="text-gray-500">No storyboard data.</p>}
      </div>
    </div>
  );
}
