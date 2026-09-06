"use client";

import {
  DEFAULT_VIDEO_DURATION_POLICY,
  VIDEO_DURATION_PRESETS,
  type VideoDurationPolicy,
} from "@/domains/video-duration/video-duration-policy";

interface VideoDurationPolicyFieldsProps {
  onChange: (policy: VideoDurationPolicy) => void;
  value: VideoDurationPolicy;
}

export function VideoDurationPolicyFields({
  onChange,
  value,
}: VideoDurationPolicyFieldsProps) {
  const selectedPreset = VIDEO_DURATION_PRESETS.find(
    (preset) => preset.minimumDurationSeconds === value.minimumDurationSeconds
      && preset.targetDurationSeconds === value.targetDurationSeconds
      && preset.maximumDurationSeconds === value.maximumDurationSeconds,
  );

  const updateDuration = (
    field: "maximumDurationSeconds" | "minimumDurationSeconds" | "targetDurationSeconds",
    minutes: string,
  ) => {
    const parsedMinutes = Number(minutes);
    if (!Number.isFinite(parsedMinutes)) return;
    onChange({ ...value, [field]: Math.round(parsedMinutes * 60) });
  };

  return (
    <fieldset className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-white/10 dark:bg-white/5">
      <legend className="px-1 text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-[var(--engine-muted)]">
        Duración objetivo por video
      </legend>

      <select
        aria-label="Perfil de duración por video"
        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-[var(--engine-accent)]/40 focus:outline-none dark:border-white/10 dark:bg-[var(--engine-canvas)] dark:text-white"
        value={selectedPreset?.label || "CUSTOM"}
        onChange={(event) => {
          const preset = VIDEO_DURATION_PRESETS.find(({ label }) => label === event.target.value);
          if (!preset) return;
          onChange({
            ...value,
            maximumDurationSeconds: preset.maximumDurationSeconds,
            minimumDurationSeconds: preset.minimumDurationSeconds,
            targetDurationSeconds: preset.targetDurationSeconds,
          });
        }}
      >
        {VIDEO_DURATION_PRESETS.map((preset) => (
          <option key={preset.label} value={preset.label}>{preset.label}</option>
        ))}
        {!selectedPreset ? <option value="CUSTOM">Personalizado</option> : null}
      </select>

      <div className="grid grid-cols-3 gap-3">
        <DurationInput
          label="Mínimo"
          onChange={(minutes) => updateDuration("minimumDurationSeconds", minutes)}
          value={value.minimumDurationSeconds / 60}
        />
        <DurationInput
          label="Objetivo"
          onChange={(minutes) => updateDuration("targetDurationSeconds", minutes)}
          value={value.targetDurationSeconds / 60}
        />
        <DurationInput
          label="Máximo"
          onChange={(minutes) => updateDuration("maximumDurationSeconds", minutes)}
          value={value.maximumDurationSeconds / 60}
        />
      </div>

      <p className="text-xs leading-relaxed text-gray-500 dark:text-[var(--engine-text-muted)]">
        Se aplicará al plan, guion, storyboard y producción. Podrás ajustar componentes individuales durante la revisión del plan.
      </p>
    </fieldset>
  );
}

export function createDefaultVideoDurationPolicy() {
  return { ...DEFAULT_VIDEO_DURATION_POLICY };
}

function DurationInput(props: {
  label: string;
  onChange: (value: string) => void;
  value: number;
}) {
  return (
    <label className="space-y-1 text-xs text-gray-500 dark:text-[var(--engine-muted)]">
      <span>{props.label}</span>
      <span className="flex items-center gap-1">
        <input
          className="min-w-0 w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm text-gray-900 focus:border-[var(--engine-accent)]/40 focus:outline-none dark:border-white/10 dark:bg-[var(--engine-canvas)] dark:text-white"
          max={60}
          min={1}
          onChange={(event) => props.onChange(event.target.value)}
          step="0.5"
          type="number"
          value={props.value}
        />
        <span>min</span>
      </span>
    </label>
  );
}
