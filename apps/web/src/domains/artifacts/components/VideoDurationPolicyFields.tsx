"use client";
import { useId } from "react";
import { FieldHelp } from "@/components/ui/FieldHelp";

import {
  DEFAULT_VIDEO_DURATION_POLICY,
  VIDEO_DURATION_PRESETS,
  videoDurationPolicySchema,
  type VideoDurationPolicy,
} from "@/domains/video-duration/video-duration-policy";

interface VideoDurationPolicyFieldsProps {
  showHelp?: boolean;
  onChange: (policy: VideoDurationPolicy) => void;
  value: VideoDurationPolicy;
}

const PRESET_HELP: Record<(typeof VIDEO_DURATION_PRESETS)[number]["label"], string> = {
  "Breve (3–5 min)": "Para abordar un concepto puntual en una pieza corta.",
  "Taller (6–8 min)": "Para desarrollar una explicación con ejemplos o una demostración breve.",
  "Profundo (8–10 min)": "Para explicar un tema con mayor detalle y varios ejemplos.",
  "Extenso (10–12 min)": "Para contenidos que requieren una explicación más amplia o una demostración larga.",
};

export function VideoDurationPolicyFields({
  showHelp = false,
  onChange,
  value,
}: VideoDurationPolicyFieldsProps) {
  const validation = videoDurationPolicySchema.safeParse(value);
  const validationIssues = validation.success ? [] : validation.error.issues;
  const invalidFields = new Set(
    validationIssues.map((issue) => String(issue.path[0] || "")),
  );
  const validationMessage = Array.from(
    new Set(validationIssues.map((issue) => issue.message)),
  ).join(" ");
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
    <fieldset
      aria-describedby={!validation.success ? "video-duration-policy-error" : undefined}
      aria-invalid={!validation.success}
      className={`space-y-3 rounded-xl border bg-gray-50 p-4 dark:bg-white/5 ${
        validation.success
          ? "border-gray-200 dark:border-white/10"
          : "border-red-400/70 dark:border-red-400/50"
      }`}
    >
      <legend className="w-full px-1 text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-[var(--engine-muted)]">
        <span className="flex items-center justify-between gap-3"><span>Duración objetivo por video</span>
          {showHelp && <FieldHelp label="Perfil de duración por video" description="Define el rango de duración de los videos asíncronos. Elegir un perfil actualiza mínimo, objetivo y máximo; también puedes ajustar cada valor."
            selection={{ label: selectedPreset?.label ?? "Personalizado", description: `${selectedPreset ? PRESET_HELP[selectedPreset.label] : "Los valores fueron ajustados manualmente y no coinciden con un perfil predefinido."} El perfil actual propone videos de ${value.minimumDurationSeconds / 60} a ${value.maximumDurationSeconds / 60} minutos, con un objetivo de ${value.targetDurationSeconds / 60} minutos.` }} />}
        </span>
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

      <div className={showHelp ? "grid grid-cols-1 gap-3 xl:grid-cols-3" : "grid grid-cols-3 gap-3"}>
        <DurationInput
          help={showHelp ? "Duración mínima esperada de cada video. Debe ser menor o igual al objetivo." : undefined}
          invalid={invalidFields.has("minimumDurationSeconds")}
          label="Mínimo"
          max={value.targetDurationSeconds / 60}
          onChange={(minutes) => updateDuration("minimumDurationSeconds", minutes)}
          value={value.minimumDurationSeconds / 60}
        />
        <DurationInput
          help={showHelp ? "Duración de referencia para planear y generar el video. Debe estar entre el mínimo y el máximo." : undefined}
          invalid={invalidFields.has("targetDurationSeconds")}
          label="Objetivo"
          max={value.maximumDurationSeconds / 60}
          min={value.minimumDurationSeconds / 60}
          onChange={(minutes) => updateDuration("targetDurationSeconds", minutes)}
          value={value.targetDurationSeconds / 60}
        />
        <DurationInput
          help={showHelp ? "Límite superior de duración esperado por video. Debe ser mayor o igual al objetivo." : undefined}
          invalid={invalidFields.has("maximumDurationSeconds")}
          label="Máximo"
          min={value.targetDurationSeconds / 60}
          onChange={(minutes) => updateDuration("maximumDurationSeconds", minutes)}
          value={value.maximumDurationSeconds / 60}
        />
      </div>

      {!validation.success ? (
        <p
          className="text-xs font-medium text-red-600 dark:text-red-300"
          id="video-duration-policy-error"
          role="alert"
        >
          {validationMessage}
        </p>
      ) : null}

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
  help?: string;
  invalid?: boolean;
  label: string;
  max?: number;
  min?: number;
  onChange: (value: string) => void;
  value: number;
}) {
  const id = useId();
  return (
    <div className="space-y-1 text-xs text-gray-500 dark:text-[var(--engine-muted)]">
      <span className="flex items-center justify-between gap-2"><label htmlFor={id}>{props.label}</label>{props.help && <FieldHelp label={`${props.label} por video`} description={props.help} />}</span>
      <span className="flex items-center gap-1">
        <input
          id={id}
          aria-label={`${props.label} min`}
          aria-describedby={props.invalid ? "video-duration-policy-error" : undefined}
          aria-invalid={props.invalid}
          className={`min-w-0 w-full rounded-lg border bg-white px-2 py-2 text-sm text-gray-900 focus:outline-none dark:bg-[var(--engine-canvas)] dark:text-white ${
            props.invalid
              ? "border-red-500 focus:border-red-500 dark:border-red-400"
              : "border-gray-200 focus:border-[var(--engine-accent)]/40 dark:border-white/10"
          }`}
          max={props.max ?? 60}
          min={props.min ?? 1}
          onChange={(event) => props.onChange(event.target.value)}
          step="0.5"
          type="number"
          value={props.value}
        />
        <span>min</span>
      </span>
    </div>
  );
}
