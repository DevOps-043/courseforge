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

export function getProductionStatusBadge(
  productionStatus: ProductionStatus,
  finalVideoUrl: string,
) {
  if (finalVideoUrl) {
    return {
      label: "Completado",
      color: "bg-green-500/20 text-green-400 border-green-500/30",
      icon: CheckCircle2,
    };
  }

  switch (productionStatus) {
    case "COMPLETED":
      return {
        label: "Completado",
        color: "bg-green-500/20 text-green-400 border-green-500/30",
        icon: CheckCircle2,
      };
    case "IN_PROGRESS":
      return {
        label: "En Progreso",
        color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
        icon: AlertCircle,
      };
    case "DECK_READY":
      return {
        label: "Deck Listo",
        color: "bg-blue-500/20 text-blue-400 border-blue-500/30",
        icon: FileText,
      };
    case "EXPORTED":
      return {
        label: "Exportado",
        color: "bg-purple-500/20 text-purple-400 border-purple-500/30",
        icon: CheckCircle,
      };
    default:
      return {
        label: "Pendiente",
        color: "bg-gray-500/20 text-gray-400 border-gray-500/30",
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
      className={`flex items-center gap-1.5 text-xs ${completed ? "text-green-400" : "text-gray-500"}`}
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
    <div className="bg-[#0F1419] rounded-xl p-4 border border-[#6C757D]/10 max-h-[300px] overflow-y-auto custom-scrollbar">
      <h4 className="text-xs font-bold text-[#6C757D] mb-2 uppercase tracking-wide">
        Storyboard Reference
      </h4>
      <div className="space-y-4">
        {content.storyboard?.map((item, index) => (
          <div key={index} className="flex gap-3 text-sm">
            <span className="text-[#1F5AF6] font-mono shrink-0">
              {item.timecode_start}
            </span>
            <div className="flex-1">
              <p className="text-[#E9ECEF] mb-1">{item.visual_content}</p>
              <p className="text-[#6C757D] text-xs italic">
                {item.narration_text}
              </p>
            </div>
          </div>
        )) || <p className="text-gray-500">No storyboard data.</p>}
      </div>
    </div>
  );
}
