"use client";

import { Loader2, MonitorPlay, Save, Video } from "lucide-react";
import type { ProductionStatus } from "../types/materials.types";
import {
  DodIndicator,
  getProductionComponentLabel,
  getProductionStatusBadge,
  PRODUCTION_THEME,
} from "./production-asset-ui";

interface ProductionAssetHeaderProps {
  componentType: string;
  lessonTitle: string;
  productionStatus: ProductionStatus;
  isSaving: boolean;
  needsFinalVideo: boolean;
  needsScreencast: boolean;
  needsSlides: boolean;
  needsVideo: boolean;
  slidesUrl: string;
  bRollPrompts: string;
  screencastUrl: string;
  finalVideoUrl: string;
  onSave: () => Promise<void>;
}

export function ProductionAssetHeader({
  componentType,
  lessonTitle,
  productionStatus,
  isSaving,
  needsFinalVideo,
  needsScreencast,
  needsSlides,
  needsVideo,
  slidesUrl,
  bRollPrompts,
  screencastUrl,
  finalVideoUrl,
  onSave,
}: ProductionAssetHeaderProps) {
  const statusBadge = getProductionStatusBadge(productionStatus, finalVideoUrl);
  const StatusIcon = statusBadge.icon;

  return (
    <div className={PRODUCTION_THEME.header}>
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`rounded-lg p-2 ${
              componentType.includes("VIDEO")
                ? "bg-purple-500/10 text-purple-400"
                : "bg-blue-500/10 text-blue-400"
            }`}
          >
            {componentType.includes("VIDEO") ? (
              <Video size={18} />
            ) : (
              <MonitorPlay size={18} />
            )}
          </div>
          <div>
            <h3 className={`text-sm font-bold ${PRODUCTION_THEME.primaryText}`}>
              {getProductionComponentLabel(componentType)}
            </h3>
            <p className={`text-xs ${PRODUCTION_THEME.secondaryText}`}>
              {lessonTitle}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${statusBadge.color}`}
          >
            <StatusIcon size={12} />
            {statusBadge.label}
          </div>
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving}
            className="flex items-center gap-2 rounded-lg bg-[#00D4B3]/10 px-3 py-1.5 text-xs font-bold text-[#00D4B3] transition-colors hover:bg-[#00D4B3]/20"
          >
            {isSaving ? (
              <Loader2 className="animate-spin" size={14} />
            ) : (
              <Save size={14} />
            )}
            Guardar
          </button>
        </div>
      </div>

      <div className={`mt-2 flex flex-wrap items-center gap-4 border-t pt-2 ${PRODUCTION_THEME.divider}`}>
        <span className={`text-xs font-medium ${PRODUCTION_THEME.secondaryText}`}>
          Checklist:
        </span>
        <DodIndicator
          label="Slides"
          completed={Boolean(slidesUrl)}
          required={needsSlides}
        />
        <DodIndicator
          label="Prompts"
          completed={Boolean(bRollPrompts)}
          required={needsVideo}
        />
        <DodIndicator
          label="Screencast"
          completed={Boolean(screencastUrl)}
          required={needsScreencast}
        />
        <DodIndicator
          label="Video Final"
          completed={Boolean(finalVideoUrl)}
          required={needsFinalVideo}
        />
      </div>
    </div>
  );
}
