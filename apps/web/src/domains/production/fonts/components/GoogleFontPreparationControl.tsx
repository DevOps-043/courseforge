"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Save, Search, ShieldCheck } from "lucide-react";
import type { GoogleFontPreparationDto, GoogleFontBundleReceipt } from "../google-font-bundle.contract";
import { GoogleFontPreparationClientError, requestGoogleFontPreparation } from "../google-font-preparation.client";
import { GOOGLE_FONT_PREPARATION_POLICY } from "../google-font-preparation-policy";
import type { GoogleFontNativePin } from "../google-font-native-face.contract";

/** Mount with key=fontId. No acquisition on mount, selection or preview. */
export function GoogleFontPreparationControl({ fontId, family, disabled, onAdmitted }: {
  fontId: string; family: string; disabled?: boolean; onAdmitted?(pin: GoogleFontNativePin): void;
}) {
  const [candidate, setCandidate] = useState<GoogleFontPreparationDto | null>(null);
  const [bundle, setBundle] = useState<GoogleFontBundleReceipt | null>(null);
  const [phase, setPhase] = useState<"idle" | "inspecting" | "reviewed" | "persisting" | "saved" | "uncertain" | "admitting" | "admitted" | "admission-uncertain">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => { pending.current?.abort(); }, []);
  const busy = phase === "inspecting" || phase === "persisting" || phase === "admitting";

  async function run(persist: boolean) {
    if (pending.current || disabled || persist && !candidate) return;
    const controller = new AbortController(); pending.current = controller;
    const deadline = AbortSignal.timeout(GOOGLE_FONT_PREPARATION_POLICY.clientTimeoutMs), signal = AbortSignal.any([controller.signal, deadline]);
    setPhase(persist ? "persisting" : "inspecting"); setMessage(null);
    if (!persist) setBundle(null);
    try {
      const result = await requestGoogleFontPreparation(fontId, signal, persist ? candidate!.candidateSha256 : undefined);
      if (controller.signal.aborted) return;
      if (result.kind === "PREPARATION") {
        if (result.preparation.family !== family) throw new GoogleFontPreparationClientError(409, "La familia seleccionada cambió. Vuelve a elegirla antes de guardar.");
        setCandidate(result.preparation); setPhase("reviewed");
      }
      else if (result.kind === "BUNDLE") { setBundle(result.bundle); setPhase("saved"); setMessage("Archivos guardados. Valida ahora sus variantes para comprobar que pueden decodificarse."); }
      else throw new GoogleFontPreparationClientError(503, "Respuesta de guardado no válida.");
    } catch (error) {
      if (controller.signal.aborted) return;
      const stale = error instanceof GoogleFontPreparationClientError && error.status === 409;
      if (stale || !persist) setCandidate(null);
      setPhase(persist && !stale ? "uncertain" : "idle");
      setMessage(error instanceof GoogleFontPreparationClientError ? error.message
        : persist ? "No se pudo confirmar el guardado. Puedes verificar con el mismo conjunto revisado; no se activó la fuente."
          : "No se pudieron consultar los archivos. Intenta nuevamente.");
    } finally { if (pending.current === controller) pending.current = null; }
  }

  async function runAdmission() {
    if (pending.current || disabled || !bundle) return;
    const controller = new AbortController(); pending.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(GOOGLE_FONT_PREPARATION_POLICY.clientTimeoutMs)]);
    setPhase("admitting"); setMessage(null);
    try {
      const result = await requestGoogleFontPreparation(fontId, signal, bundle.candidateSha256, "admit");
      if (controller.signal.aborted) return;
      if (result.kind !== "ADMISSION" || result.admission.bundleId !== bundle.bundleId)
        throw new GoogleFontPreparationClientError(503, "No se pudo confirmar el conjunto validado.");
      onAdmitted?.({ fontId: result.admission.fontId, bundleId: result.admission.bundleId, candidateSha256: result.admission.candidateSha256 });
      setPhase("admitted"); setMessage(`${result.admission.faceIds.length} variantes decodificadas y registradas. Esto no acredita su render ni modifica diapositivas existentes.`);
    } catch (error) {
      if (controller.signal.aborted) return;
      const stale = error instanceof GoogleFontPreparationClientError && error.status === 409;
      if (stale) { setBundle(null); setCandidate(null); }
      setPhase(stale ? "idle" : "admission-uncertain");
      setMessage(error instanceof GoogleFontPreparationClientError ? error.message
        : "No se pudo confirmar la validación. Verifica explícitamente el mismo conjunto antes de continuar.");
    } finally { if (pending.current === controller) pending.current = null; }
  }

  return <section aria-label={`Preparación local de ${family}`} aria-busy={busy} className="rounded-lg border border-[var(--engine-accent)]/20 bg-[var(--engine-accent)]/5 p-3 text-xs text-[var(--engine-text)]">
    <p className="font-semibold">Archivos locales de {family}</p>
    <p className="mt-1 text-[11px] font-normal text-[var(--engine-text-muted)]">Consulta, guarda y valida sus variantes. Después guarda la plantilla para usarlas en nuevas diapositivas editables; no cambia materiales existentes.</p>
    {candidate && <p className="mt-2 text-[11px]">{candidate.faces.length} variantes · {candidate.uniqueFiles} archivos · {(candidate.totalBytes / (1024 * 1024)).toFixed(2)} MB</p>}
    <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" disabled={disabled || busy} onClick={() => void run(false)} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--engine-accent)]/30 px-2.5 py-2 font-medium disabled:opacity-50">
        {phase === "inspecting" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} Consultar archivos
      </button>
      {candidate && !bundle && <button type="button" disabled={disabled || busy} onClick={() => void run(true)} className="inline-flex items-center gap-1.5 rounded-md bg-[var(--engine-accent)] px-2.5 py-2 font-medium text-white disabled:opacity-50">
        {phase === "persisting" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} {phase === "uncertain" ? "Verificar guardado" : "Guardar archivos revisados"}
      </button>}
      {bundle && phase !== "admitted" && <button type="button" disabled={disabled || busy} onClick={() => void runAdmission()} className="inline-flex items-center gap-1.5 rounded-md bg-[var(--engine-accent)] px-2.5 py-2 font-medium text-white disabled:opacity-50">
        {phase === "admitting" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />} {phase === "admission-uncertain" ? "Verificar validación" : "Validar variantes"}
      </button>}
    </div>
    {message && <p role="status" className="mt-2 text-[11px] font-normal">{message}</p>}
  </section>;
}
