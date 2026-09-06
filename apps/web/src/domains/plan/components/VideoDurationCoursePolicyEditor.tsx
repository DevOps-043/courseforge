"use client";

import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import {
  VideoDurationPolicyFields,
} from "@/domains/artifacts/components/VideoDurationPolicyFields";
import type { VideoDurationPolicy } from "@/domains/video-duration/video-duration-policy";

interface VideoDurationCoursePolicyEditorProps {
  disabled?: boolean;
  onSave: (policy: VideoDurationPolicy) => Promise<boolean>;
  value: VideoDurationPolicy;
}

export function VideoDurationCoursePolicyEditor({
  disabled = false,
  onSave,
  value,
}: VideoDurationCoursePolicyEditorProps) {
  const [draft, setDraft] = useState(value);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => setDraft(value), [value]);

  const hasChanges = JSON.stringify(draft) !== JSON.stringify(value);

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-white/10 dark:bg-[var(--engine-surface-hover)]">
      <div className="mb-4">
        <h3 className="font-semibold text-gray-900 dark:text-white">
          Estándar de duración del curso
        </h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Recalcula los contratos de todos los videos y marca los pasos posteriores para revisión.
        </p>
      </div>
      <VideoDurationPolicyFields onChange={setDraft} value={draft} />
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          disabled={disabled || isSaving || !hasChanges}
          onClick={async () => {
            setIsSaving(true);
            await onSave(draft);
            setIsSaving(false);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--engine-accent)] px-4 py-2 text-sm font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50 dark:text-[var(--engine-primary)]"
        >
          <Save size={15} />
          {isSaving ? "Guardando..." : "Aplicar a todos los videos"}
        </button>
      </div>
    </section>
  );
}
