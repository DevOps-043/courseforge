import {
  BookOpen,
  Dumbbell,
  FileText,
  Film,
  HelpCircle,
  Image,
  MessageSquare,
  Mic,
  MonitorPlay,
  Music,
  UserCircle,
  Video,
} from "lucide-react";
import type { ComponentType } from "@/domains/materials/types/materials.types";
import type { LibraryAssetType, LibraryContentCategory } from "./types";

export const LIBRARY_CATEGORY_OPTIONS: {
  label: string;
  value: LibraryContentCategory;
}[] = [
  { value: "ALL", label: "Todo" },
  { value: "MATERIALS", label: "Materiales" },
  { value: "ASSETS", label: "Assets" },
];

export const LIBRARY_ASSET_TYPE_OPTIONS: {
  label: string;
  value: LibraryAssetType;
}[] = [
  { value: "ALL", label: "Todos los assets" },
  { value: "voice", label: "Voz" },
  { value: "music", label: "Musica" },
  { value: "broll", label: "B-roll" },
  { value: "avatar", label: "Avatar" },
  { value: "slides", label: "Slides" },
  { value: "video_final", label: "Video final" },
  { value: "screencast", label: "Screencast" },
];

export const LIBRARY_COMPONENT_TYPE_OPTIONS: {
  label: string;
  value: ComponentType | "ALL";
}[] = [
  { value: "ALL", label: "Todos los componentes" },
  { value: "VIDEO_THEORETICAL", label: "Video teorico" },
  { value: "VIDEO_GUIDE", label: "Video guia" },
  { value: "VIDEO_DEMO", label: "Video demo" },
  { value: "DEMO_GUIDE", label: "Guia interactiva" },
  { value: "DIALOGUE", label: "Dialogo" },
  { value: "READING", label: "Lectura" },
  { value: "QUIZ", label: "Quiz" },
  { value: "EXERCISE", label: "Ejercicio" },
];

export const LIBRARY_PRODUCTION_STATUS_OPTIONS = [
  { value: "ALL", label: "Todos los estados" },
  { value: "PENDING", label: "Pendiente" },
  { value: "IN_PROGRESS", label: "En progreso" },
  { value: "DECK_READY", label: "Deck listo" },
  { value: "EXPORTED", label: "Exportado" },
  { value: "COMPLETED", label: "Completado" },
] as const;

export function getLibraryAssetTypeLabel(assetType: Exclude<LibraryAssetType, "ALL">) {
  return LIBRARY_ASSET_TYPE_OPTIONS.find((option) => option.value === assetType)?.label ?? assetType;
}

export function getLibraryComponentTypeLabel(type: string): string {
  const option = LIBRARY_COMPONENT_TYPE_OPTIONS.find((item) => item.value === type);
  return option?.label ?? type.replace(/_/g, " ");
}

export function getLibraryItemIcon(type: string, kind: "asset" | "material") {
  if (kind === "asset") {
    switch (type) {
      case "voice":
        return Mic;
      case "music":
        return Music;
      case "broll":
        return Film;
      case "avatar":
        return UserCircle;
      case "slides":
        return Image;
      case "video_final":
      case "screencast":
        return Video;
      default:
        return FileText;
    }
  }

  if (type.includes("VIDEO")) return Video;
  if (type === "DEMO_GUIDE") return MonitorPlay;
  if (type === "DIALOGUE") return MessageSquare;
  if (type === "READING") return BookOpen;
  if (type === "QUIZ") return HelpCircle;
  if (type === "EXERCISE") return Dumbbell;
  return FileText;
}

