"use client";

import { compositionLayoutSchema } from "@/domains/production/composition-editor/composition-document.types";

interface CompositionPositionControlsProps {
  canvasWidth: number;
  canvasHeight: number;
  disabled: boolean;
  x: string;
  y: string;
  onXChange: (value: string) => void;
  onYChange: (value: string) => void;
}

export function CompositionPositionControls({ canvasWidth, canvasHeight, disabled, x, y, onXChange, onYChange }: CompositionPositionControlsProps) {
  return (
    <fieldset disabled={disabled} className="space-y-3 rounded-lg border border-cyan-200 bg-cyan-50/40 p-3 disabled:opacity-50 dark:border-cyan-400/25 dark:bg-cyan-400/5">
      <legend className="px-1 text-xs font-bold text-slate-700 dark:text-slate-200">Posición manual</legend>
      <PositionAxis axis="x" extent={canvasWidth} value={x} onChange={onXChange} />
      <PositionAxis axis="y" extent={canvasHeight} value={y} onChange={onYChange} />
      <p className="text-[10px] text-slate-500 dark:text-gray-400">Arrastra los deslizadores para ver la posición en tiempo real. X mueve a izquierda o derecha; Y mueve arriba o abajo. Valores en píxeles desde la esquina superior izquierda del lienzo.</p>
    </fieldset>
  );
}

function PositionAxis({ axis, extent, value, onChange }: {
  axis: "x" | "y"; extent: number; value: string; onChange: (value: string) => void;
}) {
  const schema = compositionLayoutSchema.shape[axis];
  const minimum = schema.minValue!;
  const maximum = schema.maxValue!;
  const position = value.trim() && Number.isFinite(Number(value)) ? Number(value) : 0;
  const sliderPosition = Math.min(maximum, Math.max(minimum, position));
  const label = `Posición ${axis.toUpperCase()}`;

  return (
    <div className="space-y-1">
      <label className="flex items-center justify-between gap-2 text-xs font-medium text-slate-600 dark:text-gray-300">
        <span>{axis === "x" ? "Horizontal (X)" : "Vertical (Y)"} · px</span>
        <input type="number" aria-label={`${label} (px)`} step="any" min={minimum} max={maximum} value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-24 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 dark:border-white/15 dark:bg-slate-950 dark:text-white" />
      </label>
      <input type="range" aria-label={`${label}, deslizador`} step="1"
        min={Math.max(minimum, Math.min(-extent, sliderPosition))}
        max={Math.min(maximum, Math.max(extent, sliderPosition))}
        value={sliderPosition} onChange={(event) => onChange(event.target.value)}
        className="h-5 w-full cursor-ew-resize accent-cyan-500 disabled:cursor-not-allowed" />
    </div>
  );
}
