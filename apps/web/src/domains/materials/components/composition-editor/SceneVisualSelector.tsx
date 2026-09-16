"use client";

import { useEffect, useRef, useState } from "react";
import type { SceneVisualCatalog, SceneVisualPlan } from "@/domains/production/composition-editor/composition-narrative.types";

function words(text: string) {
  return new Set(text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().match(/[a-z]{4,}/g) || []);
}

export function SceneVisualSelector({ catalog, scriptText, plan, disabled, onChange }: {
  catalog: SceneVisualCatalog | null; scriptText: string; plan?: SceneVisualPlan; disabled: boolean;
  onChange: (plan: SceneVisualPlan) => void;
}) {
  const [selected, setSelected] = useState<SceneVisualPlan["slides"]>(plan?.slides || []);
  const [reviewedScript, setReviewedScript] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentScript = useRef(scriptText);
  currentScript.current = scriptText;
  useEffect(() => { setSelected(plan?.slides || []); }, [plan]);
  useEffect(() => {
    let cancelled = false;
    setReviewedScript(null);
    if (plan) void crypto.subtle.digest("SHA-256", new TextEncoder().encode(scriptText)).then((digest) => {
      const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (!cancelled && hash === plan.scriptHash) setReviewedScript(scriptText);
    }).catch(() => { if (!cancelled) setError("No se pudo verificar el guion. Intenta confirmar de nuevo."); });
    return () => { cancelled = true; };
  }, [plan, scriptText]);
  if (!catalog) return <p className="mt-3 text-xs text-slate-500">Genera una presentación para asociar slides a esta escena.</p>;
  const confirmed = reviewedScript === scriptText && plan?.deckRevision === catalog.deckRevision && JSON.stringify(plan.slides) === JSON.stringify(selected);
  const confirm = async () => {
    setBusy(true); setError(null);
    const text = scriptText;
    try {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      if (currentScript.current !== text) return;
      const scriptHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      onChange({ deckRevision: catalog.deckRevision, scriptHash, slides: selected });
    } catch { setError("No se pudo confirmar la asociación. Intenta de nuevo."); }
    finally { setBusy(false); }
  };
  const suggest = () => {
    const spoken = words(scriptText);
    const candidates = catalog.slides.map((slide) => {
      const title = words(slide.label);
      const content = words(slide.text);
      return { slide, score: [...spoken].reduce((sum, word) => sum + (title.has(word) ? 3 : content.has(word) ? 1 : 0), 0) };
    }).sort((a, b) => b.score - a.score);
    const best = candidates[0];
    if (best && best.score > 0) setSelected([{ key: best.slide.key, label: best.slide.label, weight: 1 }]);
    else setError("No hay una coincidencia clara. Selecciona una slide o confirma la escena sin slides.");
  };
  return <section aria-label="Visuales de la escena" className="mt-3 space-y-2 rounded-xl border border-cyan-500/30 p-3 text-xs">
    <div className="flex flex-wrap items-center justify-between gap-2"><strong>Visuales de esta escena</strong><span role="status">{confirmed ? "Asociación revisada · guarda las escenas" : "Pendiente de revisión"}</span></div>
    <p>Selecciona las slides en el orden de aparición. El audio determina la duración; puedes repartirla con pesos relativos o dejar la escena sin slides.</p>
    <select aria-label="Agregar slide a la escena" disabled={disabled || busy || selected.length >= 30} value="" onChange={(event) => {
      const slide = catalog.slides.find((item) => item.key === event.target.value);
      if (slide) setSelected((items) => [...items, { key: slide.key, label: slide.label, weight: 1 }]);
    }} className="w-full rounded border bg-white p-2 text-slate-900 dark:bg-slate-900 dark:text-white">
      <option value="">Agregar slide…</option>{catalog.slides.map((slide) => <option key={`${slide.key}-${slide.index}`} value={slide.key}>{slide.index + 1}. {slide.label}</option>)}
    </select>
    {selected.map((slide, index) => <div key={`${slide.key}-${index}`} className="rounded border border-slate-400/20 p-2">
      <div className="flex items-center gap-2"><span className="min-w-0 flex-1">{index + 1}. {slide.label || "Slide"}</span>
        <label> Peso <input aria-label={`Peso de slide ${index + 1}`} type="number" min="0.1" max="100" step="0.1" value={slide.weight} disabled={disabled || busy} onChange={(event) => {
          const weight = Number(event.target.value);
          if (Number.isFinite(weight) && weight >= 0.1 && weight <= 100) setSelected((items) => items.map((item, i) => i === index ? { ...item, weight } : item));
        }} className="w-14 rounded border bg-transparent p-1" /></label>
        <button type="button" disabled={disabled || busy} aria-label={`Quitar slide ${index + 1} de la escena`} onClick={() => setSelected((items) => items.filter((_, i) => i !== index))}>Quitar</button>
      </div><p className="mt-1 line-clamp-3 text-slate-500">{catalog.slides.find((item) => item.key === slide.key)?.text || "La slide cambió; vuelve a seleccionarla."}</p>
    </div>)}
    {!selected.length && <p>Sin slides: se conserva el avatar o el visual que agregues en el ensamble.</p>}
    <div className="flex flex-wrap gap-3"><button type="button" disabled={disabled || busy} onClick={suggest}>Sugerir por contenido</button><button type="button" disabled={disabled || busy || !scriptText.trim() || selected.some((slide) => !catalog.slides.some((item) => item.key === slide.key))} onClick={() => void confirm()} className="rounded bg-cyan-700 px-3 py-1 text-white">{busy ? "Confirmando…" : "Confirmar asociación"}</button></div>
    {error && <p role="alert" className="text-red-500">{error}</p>}
  </section>;
}
