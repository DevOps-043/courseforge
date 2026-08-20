"use client";

import { useEffect, useState } from "react";
import { AudioLines, CircleGauge } from "lucide-react";
import type { CompositionAudioMix } from "@/domains/production/composition-editor/composition-document.types";

export type CompositionDuckingUpdate = Partial<Pick<
  CompositionAudioMix["ducking"],
  "attackSeconds" | "duckedVolumeRatio" | "enabled" | "releaseSeconds"
>>;

interface AudioMixControlsProps {
  audioMix: CompositionAudioMix;
  disabled: boolean;
  onUpdate: (settings: CompositionDuckingUpdate, summary: string) => void;
}

export function AudioMixControls({ audioMix, disabled, onUpdate }: AudioMixControlsProps) {
  const { ducking } = audioMix;
  const [duckedVolumeRatio, setDuckedVolumeRatio] = useState(ducking.duckedVolumeRatio);

  useEffect(() => setDuckedVolumeRatio(ducking.duckedVolumeRatio), [ducking.duckedVolumeRatio]);

  const commitRatio = () => {
    if (Math.abs(ducking.duckedVolumeRatio - duckedVolumeRatio) < 0.005) return;
    onUpdate(
      { duckedVolumeRatio },
      `Ajustó la música durante la voz a ${Math.round(duckedVolumeRatio * 100)}% de su volumen base.`,
    );
  };

  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 dark:border-white/10 dark:bg-white/5">
      <div className="flex min-w-0 items-center gap-2">
        <AudioLines className="shrink-0 text-[#00A98F]" size={16} />
        <div className="min-w-0">
          <p className="text-xs font-bold text-slate-800 dark:text-gray-100">Reducción de música durante voz</p>
          <p className="truncate text-[10px] text-slate-500 dark:text-gray-400">Reduce temporalmente la música respecto a su volumen base.</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          aria-pressed={ducking.enabled}
          onClick={() => onUpdate(
            { enabled: !ducking.enabled },
            `${ducking.enabled ? "Desactivó" : "Activó"} la mezcla automática de música y voz.`,
          )}
          className={`rounded-md border px-2.5 py-1 text-[11px] font-bold disabled:opacity-50 ${ducking.enabled ? "border-[#00D4B3] bg-[#00D4B3]/15 text-[#0A6455] dark:text-[#00D4B3]" : "border-slate-300 text-slate-500 dark:border-white/15 dark:text-gray-400"}`}
        >
          {ducking.enabled ? "Reducción activa" : "Reducción inactiva"}
        </button>
        <label className="flex items-center gap-2 text-[10px] font-semibold text-slate-600 dark:text-gray-300">
          <CircleGauge size={14} />
          Nivel durante voz
          <input
            aria-label="Volumen relativo de música durante voz"
            aria-valuetext={`${Math.round(duckedVolumeRatio * 100)}%`}
            disabled={disabled || !ducking.enabled}
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={duckedVolumeRatio}
            onChange={(event) => setDuckedVolumeRatio(Number(event.target.value))}
            onPointerUp={commitRatio}
            onKeyUp={commitRatio}
            onBlur={commitRatio}
            className="w-20 accent-[#00D4B3] disabled:opacity-40"
          />
          <span className="w-16 text-right tabular-nums">{Math.round(duckedVolumeRatio * 100)}% de base</span>
        </label>
      </div>
    </div>
  );
}
