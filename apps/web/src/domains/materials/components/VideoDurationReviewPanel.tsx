"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { VideoDurationPolicyFields } from "@/domains/artifacts/components/VideoDurationPolicyFields";
import { updateMaterialComponentVideoDurationAction } from "../actions/materials.actions";
import {
  buildVideoDurationContract,
  resolveVideoDurationPolicy,
  type VideoDurationPolicy,
} from "@/domains/video-duration/video-duration-policy";
import { validateVideoDurationContent } from "@/domains/video-duration/video-duration-validation";
import type { MaterialComponent } from "../types/materials.types";

interface VideoDurationReviewPanelProps {
  component: MaterialComponent;
  lessonId: string;
  onRegenerate: (lessonId: string, instructions: string, componentTypes?: string[]) => void;
}

export function VideoDurationReviewPanel({ component, lessonId, onRegenerate }: VideoDurationReviewPanelProps) {
  const initialPolicy = resolveVideoDurationPolicy(component.assets?.video_duration_contract);
  const [draft, setDraft] = useState<VideoDurationPolicy>(initialPolicy);
  const [isSaving, setIsSaving] = useState(false);
  const contract = useMemo(
    () => buildVideoDurationContract(draft, component.type as "VIDEO_THEORETICAL" | "VIDEO_DEMO" | "VIDEO_GUIDE"),
    [component.type, draft],
  );
  const validation = useMemo(
    () => validateVideoDurationContent(component.content, contract),
    [component.content, contract],
  );

  const saveAndRegenerate = async () => {
    setIsSaving(true);
    const result = await updateMaterialComponentVideoDurationAction(component.id, draft);
    if (!result.success) {
      toast.error(result.error);
      setIsSaving(false);
      return;
    }
    const instructions = [
      `Regenera el guion y storyboard para una duración objetivo de ${contract.targetDurationSeconds} segundos`,
      `con rango obligatorio de ${contract.minimumDurationSeconds} a ${contract.maximumDurationSeconds} segundos.`,
      `Usa entre ${contract.minimumWordCount} y ${contract.maximumWordCount} palabras de narración`,
      `y al menos ${contract.minimumStoryboardTakes} tomas, ${contract.minimumBrollTakes} de B-roll y ${contract.minimumSlideCount} diapositivas potenciales.`,
      "Si las fuentes no contienen información sustantiva suficiente, repórtalo explícitamente en lugar de rellenar con repeticiones.",
    ].join(" ");
    onRegenerate(lessonId, instructions, [component.type]);
    toast.success("Duración guardada; se inició la regeneración dirigida.");
    setIsSaving(false);
  };

  return (
    <section className="rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-white/10 dark:bg-white/5">
      <div className="mb-4">
        <h3 className="font-semibold text-gray-900 dark:text-white">Duración y cobertura del video</h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Ajusta este video sin cambiar el estándar del resto del curso.
        </p>
      </div>
      <VideoDurationPolicyFields onChange={setDraft} value={draft} />
      <div className={`mt-4 rounded-xl border p-3 text-sm ${validation.valid ? "border-green-200 bg-green-50 text-green-800 dark:border-green-500/20 dark:bg-green-500/10 dark:text-green-300" : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200"}`}>
        <div className="flex items-center gap-2 font-semibold">
          {validation.valid ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          {validation.valid ? "Cobertura suficiente" : `${validation.issues.length} ajustes pendientes`}
        </div>
        <p className="mt-1 text-xs">Guion: {validation.scriptDurationSeconds}s · Narración estimada: {validation.estimatedNarrationDurationSeconds}s</p>
        {!validation.valid ? <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">{validation.issues.map((issue) => <li key={issue.code}>{issue.message}</li>)}</ul> : null}
      </div>
      <div className="mt-4 flex justify-end">
        <button type="button" disabled={isSaving} onClick={saveAndRegenerate} className="inline-flex items-center gap-2 rounded-lg bg-[var(--engine-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:text-[var(--engine-primary)]">
          <RefreshCw size={15} className={isSaving ? "animate-spin" : ""} />
          {isSaving ? "Guardando..." : "Guardar y regenerar"}
        </button>
      </div>
    </section>
  );
}
