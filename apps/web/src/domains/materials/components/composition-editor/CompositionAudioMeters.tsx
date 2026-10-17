"use client";

import type { CompositionAudioMeterMessage } from "@/domains/production/composition-editor/composition-preview-protocol";

const REASON_MESSAGES = {
  GESTURE_REQUIRED: "Activa el audio desde el botón del preview para iniciar la medición.",
  SOURCE_LIMIT: "La composición supera el límite de 32 fuentes para medición en vivo.",
  CORS_REQUIRED: "Estas fuentes no permiten medición en vivo.",
  UNSUPPORTED: "El navegador no admite este analizador de audio.",
  ANALYSIS_FAILED: "La medición no está disponible. Recarga el preview para reintentar.",
  NO_AUDIO: "La composición no contiene fuentes de audio para medir.",
} as const;

export function CompositionAudioMeters({ message, onReset }: {
  message: CompositionAudioMeterMessage | null;
  onReset: () => void;
}) {
  const active = message?.state === "ACTIVE";
  const clipped = message?.channels.some((channel) => channel.clipping) ?? false;
  return <section aria-label="Metros de mezcla estéreo" className="space-y-1 border-b border-slate-200 px-3 py-2 text-[10px] dark:border-white/10">
    <div className="flex items-center justify-between gap-2">
      <span className="font-semibold text-slate-700 dark:text-gray-200">Mezcla en vivo · pico / RMS (dBFS)</span>
      <button type="button" onClick={onReset} disabled={!active} className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40 dark:border-white/20">Limpiar clipping</button>
    </div>
    {(["L", "R"] as const).map((label, index) => {
      const channel = active ? message.channels[index] : null;
      const peak = channel?.peakDbfs ?? null;
      const levelPercent = peak === null ? 0 : Math.max(0, Math.min(100, (peak + 60) / 60 * 100));
      return <div key={label} className="flex items-center gap-2 text-slate-600 dark:text-gray-300">
        <span className="w-3">{label}</span>
        <div role="meter" aria-label={`Pico canal ${label}`} aria-valuemin={-60} aria-valuemax={0} aria-valuenow={peak === null ? -60 : Math.max(-60, Math.min(0, peak))} aria-valuetext={peak === null ? (active ? "Sin señal" : "Sin medición activa") : `${peak.toFixed(1)} dBFS`} className="h-2 flex-1 overflow-hidden rounded bg-slate-200 dark:bg-white/10">
          <div className={`h-full ${channel?.clipping ? "bg-red-500" : peak !== null && peak >= -6 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${levelPercent}%` }} />
        </div>
        <span className="w-24 text-right tabular-nums">{formatLevel(peak)} / {formatLevel(channel?.rmsDbfs ?? null)}</span>
      </div>;
    })}
    {clipped && <p role="status" className="font-semibold text-red-600 dark:text-red-300">Clipping detectado en las muestras de la mezcla. Reduce el volumen.</p>}
    {!active && <p className="text-slate-500 dark:text-gray-400">{message?.reason ? REASON_MESSAGES[message.reason] : message?.state === "PAUSED" ? "Medición pausada." : "Reproduce para medir la mezcla."}</p>}
    <p className="text-slate-500 dark:text-gray-400">Pico de muestras y RMS observados; no son LUFS ni true peak. El archivo exportado requiere su propia medición.</p>
  </section>;
}

function formatLevel(value: number | null): string {
  return value === null ? "—" : value.toFixed(1);
}
