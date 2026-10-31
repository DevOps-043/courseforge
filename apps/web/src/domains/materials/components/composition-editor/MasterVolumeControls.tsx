"use client";

import { useState } from "react";
import { Volume2 } from "lucide-react";
import { CompositionAutosaveBoundary, useCompositionAutosavePending } from "./CompositionAutosaveBoundary";
import { VolumeSlider } from "./VolumeSlider";
import styles from "./CompositionStudio.module.css";

export function MasterVolumeControls({ value, disabled, onCommit }: {
  value: number;
  disabled: boolean;
  onCommit: (volume: number) => Promise<boolean | void> | void;
}) {
  const [draft, setDraft] = useState({ persistedValue: value, volume: value });
  const autosavePending = useCompositionAutosavePending();
  if (!autosavePending && draft.persistedValue !== value) setDraft({ persistedValue: value, volume: value });
  const volume = draft.volume;
  const setVolume = (nextVolume: number) => setDraft(current => ({ ...current, volume: nextVolume }));

  return <CompositionAutosaveBoundary value={volume} disabled={disabled} onCommit={() => onCommit(volume)} className={styles.audioMix}>
    <div className={styles.audioIdentity}>
      <span className={styles.audioIcon}><Volume2 size={15} aria-hidden="true" /></span>
      <div><strong>Volumen maestro</strong><small>Controla todo el audio de la línea del tiempo.</small></div>
    </div>
    <div className="flex min-w-56 items-center gap-3">
      <div className="min-w-36 flex-1"><VolumeSlider label="Nivel general" ariaLabel="Volumen maestro de la composición"
        accentClassName="accent-cyan-500" disabled={disabled} value={volume} onChange={setVolume} /></div>
      <button type="button" disabled={disabled || volume === 1} onClick={() => setVolume(1)}
        className="rounded-md border border-slate-300 px-2 py-1 text-xs disabled:opacity-40 dark:border-white/20">Restablecer 100%</button>
    </div>
  </CompositionAutosaveBoundary>;
}
