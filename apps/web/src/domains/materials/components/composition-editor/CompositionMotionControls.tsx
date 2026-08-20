"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import type { CompositionClip } from "@/domains/production/composition-editor/composition-document.types";
import type { CompositionEditorPatchOperation } from "@/domains/production/composition-editor/editor-patch.types";
import {
  COMPOSITION_MOTION_PHASES,
  COMPOSITION_MOTION_PRESETS,
  getCompositionMotionPhase,
  getCompositionMotionPresetDefinition,
  type CompositionMotionPhase,
} from "@/domains/production/composition-editor/composition-motion-preset.service";
import {
  findCompositionAnimationTimingConflict,
  planCompositionPresetInsertion,
  resolveCompositionAnimationWindow,
} from "@/domains/production/composition-editor/composition-motion-scheduling.service";
import {
  COMPOSITION_MOTION_EASES,
  type CompositionAnimation,
} from "@/domains/production/composition-editor/composition-motion.types";

type CompositionMotionPatchHandler = (
  operations: CompositionEditorPatchOperation[],
  summary: string,
) => Promise<boolean>;

type CompositionMotionControlsProps = {
  animations: CompositionAnimation[];
  clip: CompositionClip;
  disabled: boolean;
  onSelectAnimation: (animationId: string | null) => void;
  onPatch: CompositionMotionPatchHandler;
  selectedAnimationId: string | null;
};

export function CompositionMotionControls({
  animations,
  clip,
  disabled,
  onSelectAnimation,
  onPatch,
  selectedAnimationId,
}: CompositionMotionControlsProps) {
  const [activePhase, setActivePhase] = useState<CompositionMotionPhase>("ENTRY");
  const visiblePresets = useMemo(() => (
    COMPOSITION_MOTION_PRESETS
      .filter((preset) => preset.phase === activePhase)
      .map((preset) => ({
        plan: planCompositionPresetInsertion({
          animations,
          clipDurationSeconds: clip.durationSeconds,
          clipId: clip.id,
          presetId: preset.id,
        }),
        preset,
      }))
  ), [activePhase, animations, clip.durationSeconds, clip.id]);
  const sortedAnimations = useMemo(() => (
    [...animations].sort((left, right) => (
      resolveCompositionAnimationWindow(left, clip.durationSeconds).start
      - resolveCompositionAnimationWindow(right, clip.durationSeconds).start
    ))
  ), [animations, clip.durationSeconds]);

  const addPreset = async (item: typeof visiblePresets[number]) => {
    if (!item.plan.available) return;
    const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
    const animationId = `motion-${item.preset.id.toLowerCase().replaceAll("_", "-")}-${suffix}`;
    const added = await onPatch([{
      animationId,
      clipId: clip.id,
      durationSeconds: item.plan.durationSeconds,
      offsetSeconds: item.plan.offsetSeconds,
      presetId: item.preset.id,
      type: "animation.add-preset",
    }], `Añadió ${item.preset.label} a ${clip.label}.`);
    if (added) onSelectAnimation(animationId);
    return added;
  };

  return (
    <section className="border-t border-slate-200 pt-3 dark:border-white/10">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Animaciones</p>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-white/10">
          {animations.length}
        </span>
      </div>
      <p className="mt-1 text-[10px] leading-4 text-slate-500 dark:text-gray-400">
        El editor encuentra un intervalo libre automáticamente. Los efectos son finitos, buscables y conservan el layout base.
      </p>
      <div className="mt-2 grid grid-cols-3 rounded-md bg-slate-100 p-0.5 dark:bg-white/5">
        {COMPOSITION_MOTION_PHASES.map((phase) => (
          <button
            key={phase}
            type="button"
            onClick={() => setActivePhase(phase)}
            className={`rounded px-1.5 py-1 text-[9px] font-bold ${activePhase === phase
              ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white"
              : "text-slate-500 dark:text-gray-400"}`}
          >
            {motionPhaseLabel(phase)}
          </button>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {visiblePresets.map((item) => (
          <button
            key={item.preset.id}
            type="button"
            disabled={disabled || !item.plan.available}
            onClick={() => void addPreset(item)}
            title={item.plan.reason || `Duración inicial: ${item.plan.durationSeconds}s`}
            className="rounded-md border border-cyan-200 px-2 py-1.5 text-left text-[10px] font-semibold text-cyan-800 hover:bg-cyan-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400 disabled:opacity-70 dark:border-cyan-400/30 dark:text-cyan-200 dark:hover:bg-cyan-400/10 dark:disabled:border-white/10 dark:disabled:text-gray-500"
          >
            <span className="block">{item.preset.label}</span>
            <span className="mt-0.5 block text-[8px] font-normal opacity-75">
              {item.plan.available ? `${item.plan.durationSeconds}s · espacio disponible` : "Sin espacio compatible"}
            </span>
          </button>
        ))}
      </div>
      {visiblePresets.some((item) => !item.plan.available) && (
        <p className="mt-2 flex gap-1 text-[9px] leading-4 text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 shrink-0" size={11} />
          Los presets deshabilitados escribirían sobre una propiedad que ya está animada en ese intervalo.
        </p>
      )}
      {sortedAnimations.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {sortedAnimations.map((animation) => (
            <MotionAnimationRow
              key={animation.id}
              animation={animation}
              animations={animations}
              clip={clip}
              disabled={disabled}
              onSelectAnimation={onSelectAnimation}
              onPatch={onPatch}
              selected={selectedAnimationId === animation.id}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function MotionAnimationRow({
  animation,
  animations,
  clip,
  disabled,
  onSelectAnimation,
  onPatch,
  selected,
}: {
  animation: CompositionAnimation;
  animations: CompositionAnimation[];
  clip: CompositionClip;
  disabled: boolean;
  onSelectAnimation: (animationId: string | null) => void;
  onPatch: CompositionMotionPatchHandler;
  selected: boolean;
}) {
  const definition = animation.preset
    ? getCompositionMotionPresetDefinition(animation.preset.id)
    : null;
  const phase = getCompositionMotionPhase(animation);
  const [duration, setDuration] = useState(String(animation.timing.durationSeconds));
  const [offset, setOffset] = useState(String(animation.timing.offsetSeconds));
  const [intensity, setIntensity] = useState(String(
    animation.preset?.parameters?.intensity ?? definition?.defaultIntensity ?? 1,
  ));
  const [cycles, setCycles] = useState(String(
    animation.preset?.parameters?.cycles ?? definition?.defaultCycles ?? 1,
  ));
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    setDuration(String(animation.timing.durationSeconds));
    setOffset(String(animation.timing.offsetSeconds));
    setIntensity(String(animation.preset?.parameters?.intensity ?? definition?.defaultIntensity ?? 1));
    setCycles(String(animation.preset?.parameters?.cycles ?? definition?.defaultCycles ?? 1));
    setValidationError(null);
  }, [
    animation.id,
    animation.preset?.parameters?.cycles,
    animation.preset?.parameters?.intensity,
    animation.timing.durationSeconds,
    animation.timing.offsetSeconds,
    definition?.defaultCycles,
    definition?.defaultIntensity,
  ]);

  const maximumDuration = Math.min(
    definition?.maxDurationSeconds ?? clip.durationSeconds,
    clip.durationSeconds,
  );

  const saveConfiguration = () => {
    const durationValue = Number(duration);
    const offsetValue = Number(offset);
    const intensityValue = Number(intensity);
    const cyclesValue = Number(cycles);
    const inputError = validateMotionInput({
      clipDurationSeconds: clip.durationSeconds,
      cycles: cyclesValue,
      duration: durationValue,
      intensity: intensityValue,
      maximumDuration,
      offset: offsetValue,
      requiresPresetParameters: Boolean(definition && animation.preset),
    });
    if (inputError) {
      setValidationError(inputError);
      return;
    }

    const timing = {
      ...animation.timing,
      durationSeconds: durationValue,
      offsetSeconds: offsetValue,
    };
    const conflict = findCompositionAnimationTimingConflict({
      animationId: animation.id,
      animations,
      clipDurationSeconds: clip.durationSeconds,
      clipId: clip.id,
      propertyGroup: animation.propertyGroup,
      timing,
    });
    if (conflict) {
      const conflictingDefinition = conflict.preset
        ? getCompositionMotionPresetDefinition(conflict.preset.id)
        : null;
      setValidationError(`Este intervalo se cruza con ${conflictingDefinition?.label || conflict.propertyGroup.toLowerCase()}.`);
      return;
    }

    setValidationError(null);
    if (!definition || !animation.preset) {
      return onPatch([{
        animationId: animation.id,
        timing: { durationSeconds: durationValue, offsetSeconds: offsetValue },
        type: "animation.update-timing",
      }], `Ajustó el tiempo de una animación de ${clip.label}.`);
    }
    return onPatch([{
      animationId: animation.id,
      cycles: cyclesValue,
      durationSeconds: durationValue,
      intensity: intensityValue,
      offsetSeconds: offsetValue,
      type: "animation.configure-preset",
    }], `Configuró ${definition.label} en ${clip.label}.`);
  };

  return (
    <div onClickCapture={() => onSelectAnimation(animation.id)} className={`rounded-md bg-slate-50 px-2 py-2 dark:bg-white/5 ${selected ? "ring-2 ring-cyan-400" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0">
          <span className="block truncate text-[10px] font-semibold text-slate-700 dark:text-gray-200">
            {definition?.label || animation.propertyGroup}
          </span>
          <span className="block text-[9px] text-slate-400">
            {motionPhaseLabel(phase)} · {animation.propertyGroup.toLowerCase()}
          </span>
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => void onPatch([{
            animationId: animation.id,
            type: "animation.remove",
          }], `Quitó una animación de ${clip.label}.`).then((removed) => {
            if (removed) onSelectAnimation(null);
          })}
          className="rounded p-1 text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-400/10"
          title="Quitar animación"
        >
          <Trash2 size={12} />
        </button>
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
        <MotionNumberField
          label="Duración (s)"
          min={0.05}
          max={maximumDuration}
          step={0.05}
          value={duration}
          onChange={setDuration}
        />
        <MotionNumberField
          label={phase === "EXIT" ? "Antes del final (s)" : "Retardo (s)"}
          min={0}
          max={Math.max(0, clip.durationSeconds - Number(duration || 0))}
          step={0.05}
          value={offset}
          onChange={setOffset}
        />
        {definition?.controls.includes("INTENSITY") && (
          <MotionNumberField
            label="Intensidad"
            min={0.25}
            max={2}
            step={0.05}
            value={intensity}
            onChange={setIntensity}
          />
        )}
        {definition?.controls.includes("CYCLES") && (
          <MotionNumberField
            label="Ciclos"
            min={1}
            max={12}
            step={1}
            value={cycles}
            onChange={setCycles}
          />
        )}
      </div>
      {validationError && (
        <p role="alert" className="mt-1.5 rounded bg-red-50 px-1.5 py-1 text-[9px] text-red-700 dark:bg-red-500/10 dark:text-red-200">
          {validationError}
        </p>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={() => void saveConfiguration()}
        className="mt-1.5 w-full rounded border border-slate-300 px-2 py-1 text-[9px] font-bold text-slate-700 disabled:opacity-50 dark:border-white/15 dark:text-gray-200"
      >
        Guardar animación
      </button>
      <details className="mt-2 border-t border-slate-200 pt-1.5 dark:border-white/10">
        <summary className="cursor-pointer text-[9px] font-bold text-slate-500">
          Avanzado · keyframes ({animation.keyframes.length})
        </summary>
        <div className="mt-1.5 space-y-1.5">
          {animation.keyframes.map((_, index) => (
            <MotionKeyframeEditor
              key={`${animation.id}-${index}`}
              animation={animation}
              clip={clip}
              disabled={disabled}
              index={index}
              onPatch={onPatch}
            />
          ))}
        </div>
      </details>
    </div>
  );
}

function MotionKeyframeEditor({
  animation,
  clip,
  disabled,
  index,
  onPatch,
}: {
  animation: CompositionAnimation;
  clip: CompositionClip;
  disabled: boolean;
  index: number;
  onPatch: CompositionMotionPatchHandler;
}) {
  const keyframe = animation.keyframes[index]!;
  const propertyNames = Object.keys(keyframe.values) as Array<keyof typeof keyframe.values>;
  const [values, setValues] = useState<Record<string, string>>(() => (
    Object.fromEntries(propertyNames.map((name) => [name, String(keyframe.values[name])]))
  ));
  const [ease, setEase] = useState(keyframe.ease || "none");
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    setValues(Object.fromEntries(
      (Object.keys(keyframe.values) as Array<keyof typeof keyframe.values>)
        .map((name) => [name, String(keyframe.values[name])]),
    ));
    setEase(keyframe.ease || "none");
    setValidationError(null);
  }, [animation.id, index, keyframe.ease, keyframe.values]);

  const save = () => {
    const parsedValues = Object.fromEntries(
      Object.entries(values).map(([name, value]) => [name, Number(value)]),
    );
    if (Object.values(parsedValues).some((value) => !Number.isFinite(value))) {
      setValidationError("Todos los valores de la pose deben ser números válidos.");
      return;
    }
    setValidationError(null);
    return onPatch([{
      animationId: animation.id,
      ease: index === 0 ? undefined : ease as typeof COMPOSITION_MOTION_EASES[number],
      keyframeIndex: index,
      values: parsedValues as CompositionAnimation["keyframes"][number]["values"],
      type: "animation.update-keyframe",
    }], `Editó el keyframe ${index + 1} de ${clip.label}.`);
  };

  return (
    <div className="rounded border border-slate-200 bg-white p-1.5 dark:border-white/10 dark:bg-slate-950">
      <div className="mb-1 flex items-center justify-between text-[9px] text-slate-500">
        <span>Pose {index + 1}</span>
        <span>{Math.round(keyframe.offset * 100)}%</span>
      </div>
      <div className="grid grid-cols-2 gap-1">
        {propertyNames.map((name) => (
          <label key={name} className="text-[8px] uppercase text-slate-400">
            {name}
            <input
              type="number"
              step="0.05"
              value={values[name] || ""}
              onChange={(event) => setValues((current) => ({
                ...current,
                [name]: event.target.value,
              }))}
              className="mt-0.5 w-full rounded border border-slate-200 px-1 py-0.5 text-[9px] text-slate-800 dark:border-white/10 dark:bg-slate-900 dark:text-white"
            />
          </label>
        ))}
        {index > 0 && (
          <label className="col-span-2 text-[8px] uppercase text-slate-400">
            Easing
            <select
              value={ease}
              onChange={(event) => setEase(event.target.value as typeof COMPOSITION_MOTION_EASES[number])}
              className="mt-0.5 w-full rounded border border-slate-200 px-1 py-0.5 text-[9px] normal-case text-slate-800 dark:border-white/10 dark:bg-slate-900 dark:text-white"
            >
              {COMPOSITION_MOTION_EASES.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      {validationError && <p className="mt-1 text-[8px] text-red-600">{validationError}</p>}
      <button
        type="button"
        disabled={disabled}
        onClick={() => void save()}
        className="mt-1 w-full rounded border border-cyan-200 py-1 text-[8px] font-bold text-cyan-800 disabled:opacity-50 dark:border-cyan-400/30 dark:text-cyan-200"
      >
        Guardar pose
      </button>
    </div>
  );
}

function MotionNumberField({
  label,
  max,
  min,
  onChange,
  step,
  value,
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: string) => void;
  step: number;
  value: string;
}) {
  return (
    <label className="text-[9px] text-slate-500">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-0.5 w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-[10px] text-slate-800 dark:border-white/10 dark:bg-slate-950 dark:text-white"
      />
    </label>
  );
}

function validateMotionInput(params: {
  clipDurationSeconds: number;
  cycles: number;
  duration: number;
  intensity: number;
  maximumDuration: number;
  offset: number;
  requiresPresetParameters: boolean;
}) {
  if (!Number.isFinite(params.duration) || params.duration < 0.05 || params.duration > params.maximumDuration) {
    return `La duración debe estar entre 0.05 y ${params.maximumDuration} segundos.`;
  }
  if (
    !Number.isFinite(params.offset)
    || params.offset < 0
    || params.offset + params.duration > params.clipDurationSeconds + 0.001
  ) {
    return "El intervalo de la animación debe permanecer dentro del clip.";
  }
  if (!params.requiresPresetParameters) return null;
  if (!Number.isFinite(params.intensity) || params.intensity < 0.25 || params.intensity > 2) {
    return "La intensidad debe estar entre 0.25 y 2.";
  }
  if (!Number.isInteger(params.cycles) || params.cycles < 1 || params.cycles > 12) {
    return "Los ciclos deben ser un entero entre 1 y 12.";
  }
  return null;
}

function motionPhaseLabel(phase: CompositionMotionPhase) {
  return phase === "ENTRY" ? "Entrada" : phase === "PLAYBACK" ? "Durante" : "Salida";
}
