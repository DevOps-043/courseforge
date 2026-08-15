"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff, Lock, Unlock, Volume2, VolumeX } from "lucide-react";
import type { CompositionTrack } from "@/domains/production/composition-editor/composition-document.types";
import type { CompositionTrackUpdateHandler } from "./composition-studio.types";

interface TrackControlsProps {
  disabled: boolean;
  onUpdate: CompositionTrackUpdateHandler;
  track: CompositionTrack;
}

export function TrackControls({ disabled, onUpdate, track }: TrackControlsProps) {
  const [volume, setVolume] = useState(track.volume ?? 1);

  useEffect(() => setVolume(track.volume ?? 1), [track.volume]);

  const isAudio = track.kind === "AUDIO" || track.semanticRole === "AVATAR";
  const commitVolume = () => {
    const storedVolume = track.volume ?? 1;
    if (Math.abs(storedVolume - volume) < 0.005) return;

    onUpdate(
      track,
      { volume },
      `Ajustó el volumen de ${track.label} a ${Math.round(volume * 100)}%.`,
    );
  };

  return (
    <div className="min-w-0 pt-1">
      <span
        className="block truncate text-xs font-semibold text-slate-700 dark:text-gray-200"
        title={`${track.label} · ${track.semanticRole || track.kind}`}
      >
        {track.label}
      </span>
      <span className="sr-only">Capa semántica: {track.semanticRole || track.kind}</span>
      <div className="mt-1 flex items-center gap-1 text-slate-500 dark:text-gray-400">
        <button
          type="button"
          disabled={disabled}
          aria-label={track.hidden ? `Mostrar ${track.label}` : `Ocultar ${track.label}`}
          aria-pressed={Boolean(track.hidden)}
          onClick={() =>
            onUpdate(
              track,
              { hidden: !track.hidden },
              `${track.hidden ? "Mostró" : "Ocultó"} la capa ${track.label}.`,
            )
          }
          title={track.hidden ? `Mostrar ${track.label}` : `Ocultar ${track.label}`}
          className="rounded p-1 hover:bg-slate-200 disabled:opacity-50 dark:hover:bg-white/10"
        >
          {track.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-label={track.locked ? `Desbloquear ${track.label}` : `Bloquear ${track.label}`}
          aria-pressed={Boolean(track.locked)}
          onClick={() =>
            onUpdate(
              track,
              { locked: !track.locked },
              `${track.locked ? "Desbloqueó" : "Bloqueó"} la capa ${track.label}.`,
            )
          }
          title={track.locked ? `Desbloquear ${track.label}` : `Bloquear ${track.label}`}
          className="rounded p-1 hover:bg-slate-200 disabled:opacity-50 dark:hover:bg-white/10"
        >
          {track.locked ? <Lock size={13} /> : <Unlock size={13} />}
        </button>
        {isAudio && (
          <>
            <button
              type="button"
              disabled={disabled}
              aria-label={track.muted ? `Activar audio de ${track.label}` : `Silenciar ${track.label}`}
              aria-pressed={Boolean(track.muted)}
              onClick={() =>
                onUpdate(
                  track,
                  { muted: !track.muted },
                  `${track.muted ? "Activó" : "Silenció"} el audio de ${track.label}.`,
                )
              }
              title={track.muted ? `Activar audio de ${track.label}` : `Silenciar ${track.label}`}
              className="rounded p-1 hover:bg-slate-200 disabled:opacity-50 dark:hover:bg-white/10"
            >
              {track.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
            </button>
            <input
              aria-label={`Volumen de ${track.label}`}
              aria-valuetext={`${Math.round(volume * 100)}%`}
              disabled={disabled || track.muted}
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(event) => setVolume(Number(event.target.value))}
              onPointerUp={commitVolume}
              onKeyUp={commitVolume}
              onBlur={commitVolume}
              className="w-14 accent-[#00D4B3] disabled:opacity-40"
            />
          </>
        )}
      </div>
    </div>
  );
}
