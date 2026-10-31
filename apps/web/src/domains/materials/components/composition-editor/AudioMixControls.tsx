"use client";

import { useEffect, useState } from "react";
import { AudioLines, CircleGauge } from "lucide-react";
import type { CompositionAudioMix } from "@/domains/production/composition-editor/composition-document.types";
import styles from "./CompositionStudio.module.css";
import { MasterVolumeControls } from "./MasterVolumeControls";

export type CompositionAudioMixUpdate = Partial<Pick<
  CompositionAudioMix["ducking"],
  "attackSeconds" | "duckedVolumeRatio" | "enabled" | "releaseSeconds"
>> & { masterVolume?: number };

interface AudioMixControlsProps {
  audioMix: CompositionAudioMix;
  disabled: boolean;
  onUpdate: (settings: CompositionAudioMixUpdate, summary: string) => Promise<boolean | void> | void;
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
    <>
    <MasterVolumeControls value={audioMix.masterVolume ?? 1} disabled={disabled} onCommit={masterVolume => onUpdate(
      { masterVolume }, `Ajustó el volumen maestro a ${Math.round(masterVolume * 100)}%.`,
    )} />
    <div className={styles.audioMix}>
      <div className={styles.audioIdentity}>
        <span className={styles.audioIcon}><AudioLines size={15} aria-hidden="true" /></span>
        <div className="min-w-0">
          <strong>Mezcla automática de voz</strong>
          <small>Reduce la música mientras hay narración.</small>
        </div>
      </div>
      <div className={styles.audioControls}>
        <button
          type="button"
          disabled={disabled}
          aria-pressed={ducking.enabled}
          onClick={() => onUpdate(
            { enabled: !ducking.enabled },
            `${ducking.enabled ? "Desactivó" : "Activó"} la mezcla automática de música y voz.`,
          )}
          className={`${styles.audioToggle} ${ducking.enabled ? styles.audioToggleActive : ""}`}
        >
          {ducking.enabled ? "Activa" : "Inactiva"}
        </button>
        <label className={styles.audioLevel}>
          <CircleGauge size={14} />
          Nivel
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
            className="w-20 accent-[var(--engine-accent)] disabled:opacity-40"
          />
          <span className={styles.audioValue}>{Math.round(duckedVolumeRatio * 100)}%</span>
        </label>
      </div>
    </div>
    </>
  );
}
