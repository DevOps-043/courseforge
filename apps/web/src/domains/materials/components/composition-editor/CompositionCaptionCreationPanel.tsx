"use client";
import { Sparkles, Subtitles } from "lucide-react";

export function CompositionCaptionCreationPanel({ transcriptWordCount, onCreateManual, onGenerateTranscript }: {
  transcriptWordCount: number;
  onCreateManual: () => void;
  onGenerateTranscript: () => void;
}) {
  return <section aria-label="Crear subtítulos" className="space-y-3 p-3">
    <h3 className="text-sm font-bold text-slate-800 dark:text-white">Subtítulos manuales</h3>
    <p className="text-xs leading-5 text-slate-500 dark:text-gray-400">Crea una capa en el cursor y escribe tus frases y tiempos desde Propiedades. No necesitas voz, transcripción ni un archivo de subtítulos.</p>
    <button type="button" onClick={onCreateManual} className="flex w-full items-center gap-3 rounded-lg border border-violet-400 bg-violet-50 p-3 text-left font-semibold text-violet-900 dark:border-violet-400/40 dark:bg-violet-400/10 dark:text-violet-100"><Subtitles size={19} aria-hidden="true" /><span>Crear subtítulos manuales</span></button>
    <p className="text-[11px] text-slate-500 dark:text-gray-400">Podrás añadir más frases, ajustar inicio y fin y cambiar su estilo. Crear una capa conserva los subtítulos existentes.</p>
    <details className="border-t border-slate-200 pt-3 dark:border-white/10">
      <summary className="cursor-pointer text-xs font-semibold text-slate-600 dark:text-gray-300">Opcional: generar desde la voz</summary>
      <p className="my-2 text-[11px] text-slate-500 dark:text-gray-400">Esta opción usa los tiempos de una voz existente y sólo se ejecuta al pulsar el botón.</p>
      <button type="button" disabled={transcriptWordCount === 0} onClick={onGenerateTranscript} className="inline-flex items-center gap-2 rounded-md border border-slate-300 p-2 text-xs disabled:opacity-50 dark:border-white/15"><Sparkles size={14} aria-hidden="true" />Generar desde la voz</button>
      <p className="mt-1 text-[11px] text-slate-500 dark:text-gray-400">{transcriptWordCount > 0 ? `${transcriptWordCount} palabras sincronizadas disponibles` : "Sin voz con tiempos disponibles. La creación manual está habilitada."}</p>
    </details>
  </section>;
}
