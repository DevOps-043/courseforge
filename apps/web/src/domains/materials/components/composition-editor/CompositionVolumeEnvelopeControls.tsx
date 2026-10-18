"use client";

import { CompositionAutosaveBoundary, useCompositionAutosavePending } from "./CompositionAutosaveBoundary";

import { useEffect, useState } from "react";
import type { CompositionClip } from "@/domains/production/composition-editor/composition-document.types";
import type { CompositionEditorPatchOperation } from "@/domains/production/composition-editor/editor-patch.types";
import {
  compositionVolumeEnvelopeSchema,
  MAX_VOLUME_ENVELOPE_POINTS,
  areCompositionVolumeEnvelopeEditsEnabled,
  type CompositionVolumeEnvelopePoint,
} from "@/domains/production/composition-editor/composition-volume-envelope";
import { buildVolumeEnvelopePath } from "@/domains/production/composition-editor/composition-volume-envelope-projection";

interface VolumeEnvelopeControlsProps {
  clip: CompositionClip;
  disabled: boolean;
  onPatch: (
    operations: CompositionEditorPatchOperation[],
    summary: string,
  ) => Promise<boolean>;
}

export function CompositionVolumeEnvelopeControls(
  props: VolumeEnvelopeControlsProps,
) {
  if (!areCompositionVolumeEnvelopeEditsEnabled()) return null;
  return (
    <VolumeEnvelopeDraftControls
      key={props.clip.id}
      {...props}
    />
  );
}

function VolumeEnvelopeDraftControls({
  clip,
  disabled,
  onPatch,
}: VolumeEnvelopeControlsProps) {
  const autosavePending = useCompositionAutosavePending();
  const [points, setPoints] = useState<CompositionVolumeEnvelopePoint[]>(
    clip.volumeEnvelope ?? [],
  );
  useEffect(() => { if (!autosavePending) setPoints(clip.volumeEnvelope ?? []); }, [autosavePending, clip.id, clip.volumeEnvelope]);
  const [message, setMessage] = useState<string | null>(null);
  const offset = clip.sourceOffsetSeconds ?? 0;
  const sourceDuration = clip.durationSeconds * (clip.playbackRate ?? 1);
  const path = buildVolumeEnvelopePath(points, offset, sourceDuration, 100);
  const update = (index: number, point: CompositionVolumeEnvelopePoint) => {
    setPoints((current) =>
      current.map((value, position) => (position === index ? point : value)),
    );
    setMessage(null);
  };
  const save = async () => {
    const parsed = compositionVolumeEnvelopeSchema.safeParse(
      [...points].sort(
        (left, right) => left.sourceTimeSeconds - right.sourceTimeSeconds,
      ),
    );
    if (!parsed.success) {
      setMessage(
        "Revisa los tiempos: deben ser únicos y los niveles deben estar entre silencio y 0 dB.",
      );
      return;
    }
    const saved = await onPatch(
        [
          {
            type: "clip.volume-envelope",
            clipId: clip.id,
            points: parsed.data,
          },
        ],
        "Ajustó la curva de volumen del clip.",
      );
    if (saved) setMessage("Curva guardada. Reproduce para escuchar el resultado.");
    return saved;
  };
  return (
    <CompositionAutosaveBoundary value={points} onCommit={save} disabled={disabled}><section
      className="mt-3 space-y-2 rounded-lg border border-slate-300 p-3 dark:border-white/15"
      aria-label="Curva de volumen"
    >
      <p className="text-xs font-semibold">Volumen por puntos</p>
      <p className="text-[10px]">
        Haz clic en la gráfica para añadir puntos. La curva atenúa el volumen
        base y se combina con fades y ducking.
      </p>
      <button
        type="button"
        disabled={disabled || points.length >= MAX_VOLUME_ENVELOPE_POINTS}
        aria-label="Añadir punto a la curva de volumen"
        className="block h-24 w-full rounded bg-slate-950"
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const sourceTimeSeconds =
            Math.round(
              (offset +
                sourceDuration *
                  (event.detail === 0
                    ? 0.5
                    : Math.max(
                        0,
                        Math.min(
                          1,
                          (event.clientX - bounds.left) / bounds.width,
                        ),
                      ))) *
                1000,
            ) / 1000;
          const gain =
            event.detail === 0
              ? 1
              : Math.round(
                  Math.max(
                    0,
                    Math.min(
                      1,
                      1 - (event.clientY - bounds.top) / bounds.height,
                    ),
                  ) * 1000,
                ) / 1000;
          setPoints((current) =>
            [
              ...current.filter(
                (point) => point.sourceTimeSeconds !== sourceTimeSeconds,
              ),
              { sourceTimeSeconds, gain },
            ].sort(
              (left, right) => left.sourceTimeSeconds - right.sourceTimeSeconds,
            ),
          );
        }}
      >
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="h-full w-full"
          aria-hidden="true"
        >
          <path
            d={path}
            stroke="#f59e0b"
            strokeWidth="2"
            fill="none"
            vectorEffect="non-scaling-stroke"
          />
          {points
            .filter(
              (point) =>
                point.sourceTimeSeconds >= offset &&
                point.sourceTimeSeconds <= offset + sourceDuration,
            )
            .map((point, index) => (
              <circle
                key={index}
                cx={(100 * (point.sourceTimeSeconds - offset)) / sourceDuration}
                cy={100 * (1 - point.gain)}
                r="2"
                fill="#f59e0b"
              />
            ))}
        </svg>
      </button>
      <div className="max-h-48 space-y-1 overflow-auto">
        {points.map((point, index) => (
          <div key={index} className="flex items-end gap-1">
            <label className="min-w-0 flex-1 text-[10px]">
              Archivo (s)
              <input
                aria-label={`Tiempo del punto ${index + 1}`}
                type="number"
                min="0"
                max="86400"
                step="0.001"
                disabled={disabled}
                value={point.sourceTimeSeconds}
                onChange={(event) => {
                  if (!Number.isFinite(event.target.valueAsNumber)) return;
                  update(index, {
                    ...point,
                    sourceTimeSeconds: event.target.valueAsNumber,
                  });
                }}
                className="w-full rounded border bg-transparent p-1"
              />
            </label>
            <label className="min-w-0 flex-1 text-[10px]">
              Nivel (dB)
              <input
                aria-label={`Nivel del punto ${index + 1} en decibelios`}
                type="number"
                min="-60"
                max="0"
                step="0.1"
                disabled={disabled}
                value={
                  point.gain === 0
                    ? -60
                    : Math.round(20 * Math.log10(point.gain) * 10) / 10
                }
                onChange={(event) => {
                  const db = event.target.valueAsNumber;
                  if (!Number.isFinite(db)) return;
                  update(index, {
                    ...point,
                    gain: db <= -60 ? 0 : Math.pow(10, db / 20),
                  });
                }}
                className="w-full rounded border bg-transparent p-1"
              />
            </label>
            <button
              type="button"
              disabled={disabled}
              aria-label={`Eliminar punto ${index + 1}`}
              onClick={() =>
                setPoints((current) =>
                  current.filter((_, position) => position !== index),
                )
              }
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <p className="text-[10px]">
        0 dB conserva el nivel; −60 dB representa silencio. Los tiempos
        pertenecen al archivo original.
      </p>
      <div className="flex gap-2 text-xs">
        <button
          type="button"
          disabled={disabled || points.length >= MAX_VOLUME_ENVELOPE_POINTS}
          onClick={() => {
            const sourceTimeSeconds =
              Math.round((offset + sourceDuration / 2) * 1000) / 1000;
            setPoints((current) =>
              [
                ...current.filter(
                  (point) => point.sourceTimeSeconds !== sourceTimeSeconds,
                ),
                { sourceTimeSeconds, gain: 1 },
              ].sort(
                (left, right) =>
                  left.sourceTimeSeconds - right.sourceTimeSeconds,
              ),
            );
          }}
        >
          Añadir punto
        </button>
        <button type="button" disabled={disabled} onClick={() => setPoints([])}>
          Restablecer
        </button>

      </div>
      {message && (
        <p role="status" className="text-[10px]">
          {message}
        </p>
      )}
    </section></CompositionAutosaveBoundary>
  );
}
