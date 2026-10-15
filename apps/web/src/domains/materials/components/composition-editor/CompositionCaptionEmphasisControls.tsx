"use client";

import { useState } from "react";
import type { CompositionCaptionCue } from "@/domains/production/composition-editor/composition-text-layer.types";
import { captionSelectionTokens } from "@/domains/production/composition-editor/composition-caption-effects.service";
import { CAPTION_EFFECT_LIMITS } from "@/domains/production/composition-editor/composition-caption-effects.types";

export function CompositionCaptionEmphasisControls({ cue, disabled, onChange }: {
  cue: CompositionCaptionCue;
  disabled: boolean;
  onChange: (cue: CompositionCaptionCue) => void;
}) {
  const [color, setColor] = useState("#facc15");
  const [background, setBackground] = useState(false);
  const ranges = cue.emphasis || [];
  return <fieldset disabled={disabled} className="space-y-2 border-t border-violet-200 pt-2 text-[10px] dark:border-white/10">
    <legend className="text-xs font-medium">Palabras clave</legend>
    <div className="flex items-center gap-2"><label className="flex items-center gap-1">Color<input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label><label className="flex items-center gap-1"><input type="checkbox" checked={background} onChange={(event) => setBackground(event.target.checked)} /> Aplicar como fondo</label></div>
    <p className="text-slate-500">Pulsa una palabra para marcarla; vuelve a pulsarla para quitar el énfasis. Se mantiene durante toda la frase.</p>
    <div className="flex flex-wrap gap-1">{captionSelectionTokens(cue.text).map((token) => {
      const selected = ranges.some((range) => range.start < token.end && range.end > token.start);
      return <button key={token.start} type="button" aria-pressed={selected} disabled={disabled || (!selected && ranges.length >= CAPTION_EFFECT_LIMITS.maxEmphasisRanges)} className={`rounded border px-1.5 py-1 ${selected ? "border-violet-500 bg-violet-100 text-violet-900 dark:bg-violet-900 dark:text-violet-100" : "border-slate-300 dark:border-white/15"}`} onClick={() => {
        const retained = ranges.filter((range) => !(range.start < token.end && range.end > token.start));
        onChange({ ...cue, emphasis: selected ? retained : [...retained, { start: token.start, end: token.end, ...(background ? { backgroundColor: color } : { color }) }].sort((left, right) => left.start - right.start) });
      }}>{token.text}</button>;
    })}</div>
    {ranges.length > 0 && <button type="button" disabled={disabled} className="underline" onClick={() => { const updated = { ...cue }; delete updated.emphasis; onChange(updated); }}>Quitar todo el énfasis de esta frase</button>}
  </fieldset>;
}
