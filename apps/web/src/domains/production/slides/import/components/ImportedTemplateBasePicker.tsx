"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSlideTemplatePackagesAction } from "../../slide-template-library.actions";

export function ImportedTemplateBasePicker({ adminBasePath, revision = 0 }: { adminBasePath: string; revision?: number }) {
  const [bases, setBases] = useState<Array<{ id: string; title: string }>>([]);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    getSlideTemplatePackagesAction().then(result => {
      if (!active) return;
      if (!result.success) { setError("No se pudieron cargar las bases importadas."); return; }
      setBases((result.slideTemplates ?? []).filter(item => item.imported && item.status === "PACKAGED").map(({ id, title }) => ({ id, title })));
    }).catch(() => { if (active) setError("No se pudieron cargar las bases importadas."); });
    return () => { active = false; };
  }, [revision]);
  return <div className="flex flex-wrap items-end gap-2 rounded-lg border border-[var(--engine-border)] bg-[var(--engine-surface-solid)] p-3 text-sm">
    <label className="flex min-w-48 flex-1 flex-col gap-1 font-semibold">Base para crear una plantilla nueva
      <select value={selected} onChange={event => setSelected(event.target.value)} className="rounded-md border border-[var(--engine-border)] bg-[var(--engine-canvas)] p-2 text-[var(--engine-text)]">
        <option value="">Base predeterminada</option>{bases.map(base => <option key={base.id} value={base.id}>{base.title}</option>)}
      </select>
    </label>
    {selected && <Link href={`${adminBasePath}/slides/templates?baseRunId=${selected}`} className="rounded-md bg-[var(--engine-action)] px-3 py-2 font-bold text-[var(--engine-on-action)]">Crear desde esta base</Link>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
