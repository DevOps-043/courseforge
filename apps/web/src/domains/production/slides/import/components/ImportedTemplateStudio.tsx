"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ImportedSlidePreview } from "./ImportedSlidePreview";
import type { ImportedSlideDesign } from "../imported-slide-design.contract";
import type { ImportedTemplateBase } from "../imported-template-base.contract";

interface StudioView { design: ImportedSlideDesign; previews: string[]; base: ImportedTemplateBase }
interface StudioMessage { id?: string; role: string; content_redacted: string }
interface StudioRun { id: string; status: string }
async function requestStudio(url: string, body?: unknown, signal?: AbortSignal) {
  const response = await fetch(url, { method: body === undefined ? "GET" : "POST", cache: "no-store",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body), signal: signal ?? AbortSignal.timeout(120_000) });
  const payload = await response.json();
  if (!response.ok || !payload.success) throw new Error(payload.error || "No se pudo actualizar el estudio.");
  return payload;
}

/** Estudio de derivados HTML: muestra la fuente real, sin miniaturas del catálogo fijo. */
export function ImportedTemplateStudio() {
  const params = useParams<{ empresaSlug?: string }>(), search = useSearchParams(), router = useRouter();
  const adminBasePath = params?.empresaSlug ? `/${params.empresaSlug}/admin` : "/admin";
  const [view, setView] = useState<StudioView | null>(null);
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<StudioMessage[]>([]);
  const [runs, setRuns] = useState<StudioRun[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [operation, setOperation] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const loaded = useRef("");
  const busyRef = useRef(false);
  const busy = Boolean(operation);
  const baseRunId = search.get("baseRunId"), requestedConversation = search.get("conversationId");

  const applyView = useCallback((next: StudioView) => {
    setView(next); setSelected(next.design.layouts.map(layout => layout.id)); setActive(0);
  }, []);
  const loadConversation = useCallback(async (id: string, signal?: AbortSignal) => {
    const state = await requestStudio(`/api/admin/remotion/bundle-agent/conversations/${id}`, undefined, signal);
    const base = state.specs?.[0]?.spec_json?.designBase as ImportedTemplateBase | undefined;
    if (!base) throw new Error("Esta importación es una base de origen. Usa «Usar como base» desde la biblioteca para crear una plantilla independiente.");
    const preview = await requestStudio("/api/admin/slides/templates/import", { action: "load", conversationId: id }, signal);
    return { view: { ...preview, base } as StudioView, title: state.conversation.title as string,
      messages: (state.messages ?? []) as StudioMessage[], runs: (state.generationRuns ?? []) as StudioRun[] };
  }, []);
  useEffect(() => {
    const key = requestedConversation ? `conversation:${requestedConversation}` : `base:${baseRunId}`;
    if (loaded.current === key) return;
    loaded.current = key;
    const controller = new AbortController();
    setOperation("Cargando base…"); setError(""); setStatus(""); setView(null);
    setConversationId(null); setMessages([]); setRuns([]);
    (async () => {
      if (requestedConversation) {
        const result = await loadConversation(requestedConversation, controller.signal);
        if (controller.signal.aborted) return;
        applyView(result.view); setTitle(result.title); setMessages(result.messages); setRuns(result.runs); setConversationId(requestedConversation);
      } else if (baseRunId) {
        const result = await requestStudio(`/api/admin/slides/templates/design-bases/${encodeURIComponent(baseRunId)}`, undefined, controller.signal);
        if (controller.signal.aborted) return;
        applyView(result); setTitle(`${result.base.title} — nueva plantilla`.slice(0, 120));
      } else throw new Error("Selecciona una base importada desde la biblioteca.");
    })().catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "No se pudo cargar la base."); })
      .finally(() => { if (!controller.signal.aborted) setOperation(""); });
    return () => { controller.abort(); if (loaded.current === key) loaded.current = ""; };
  }, [baseRunId, requestedConversation, applyView, loadConversation]);

  async function ensureConversation() {
    if (conversationId) return conversationId;
    const result = await requestStudio("/api/admin/remotion/bundle-agent/conversations", { artifactKind: "slide_template", title: title.trim() });
    const id = result.conversation.id as string;
    setConversationId(id);
    if (!view) throw new Error("La base todavía no está disponible.");
    // Conserva un borrador recuperable antes de una revisión del proveedor.
    await requestStudio(`/api/admin/remotion/bundle-agent/conversations/${id}/specs`, { artifactKind: "slide_template",
      importedBase: { baseRunId: view.base.runId, layoutIds: selected, reviseWithAi: false } });
    const indices = selected.map(layoutId => view.design.layouts.findIndex(layout => layout.id === layoutId));
    applyView({ ...view, design: { ...view.design, layouts: indices.map(index => view.design.layouts[index]) }, previews: indices.map(index => view.previews[index]) });
    loaded.current = `conversation:${id}`;
    router.replace(`${adminBasePath}/slides/templates?mode=imported&conversationId=${id}`, { scroll: false });
    return id;
  }
  async function revise(withAi: boolean, save: boolean) {
    if (busyRef.current || busy || !view || !selected.length || !title.trim() || withAi && !prompt.trim()) return;
    busyRef.current = true;
    setOperation(withAi ? "Revisando el diseño con IA…" : save ? "Guardando plantilla independiente…" : "Preparando plantilla…");
    setError(""); setStatus("");
    try {
      const id = await ensureConversation();
      const titleResponse = await fetch(`/api/admin/remotion/bundle-agent/conversations/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim() }), signal: AbortSignal.timeout(30_000) });
      if (!titleResponse.ok) { const failure = await titleResponse.json(); throw new Error(failure.error || "No se pudo guardar el nombre."); }
      if (withAi) await requestStudio(`/api/admin/remotion/bundle-agent/conversations/${id}/messages`, { content: prompt.trim(), role: "USER" });
      const result = await requestStudio(`/api/admin/remotion/bundle-agent/conversations/${id}/specs`, { artifactKind: "slide_template",
        importedBase: { baseRunId: view.base.runId, layoutIds: selected, reviseWithAi: withAi } });
      if (save) await requestStudio(`/api/admin/remotion/bundle-agent/conversations/${id}/generate`, { artifactKind: "slide_template", specId: result.spec.id });
      const refreshed = await loadConversation(id);
      applyView(refreshed.view); setMessages(refreshed.messages); setRuns(refreshed.runs);
      if (withAi) setPrompt("");
      setStatus(save ? "Plantilla nueva guardada en la biblioteca. La base original se conserva." : "Revisión preparada. Revisa el diseño antes de guardar la plantilla.");
      router.replace(`${adminBasePath}/slides/templates?mode=imported&conversationId=${id}`, { scroll: false });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo completar la revisión."); }
    finally { busyRef.current = false; setOperation(""); }
  }
  const layout = view?.design.layouts[active];
  const latestRun = runs.find(run => run.status === "PACKAGED");
  return <main className="space-y-4 p-4 text-[var(--engine-text)]">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-bold">Crear plantilla desde una base importada</h1>
        <p className="mt-1 text-sm">Edita textos, estilos y diseños con IA. Cada plantilla se guarda de forma independiente.</p></div>
      <Link href={`${adminBasePath}/templates`} className="rounded-lg border border-[var(--engine-border)] px-3 py-2">Biblioteca de plantillas</Link>
    </header>
    {operation && <p role="status">{operation}</p>}{error && <p role="alert" className="rounded-lg border border-red-400 p-3 text-red-700 dark:text-red-300">{error}</p>}
    {status && <p role="status" className="rounded-lg border border-[var(--engine-accent)] p-3">{status}</p>}
    {view && layout && <>
      <div className="rounded-lg border border-[var(--engine-border)] bg-[var(--engine-surface-solid)] p-3">
        <p className="text-sm">Base: <strong>{view.base.title}</strong> · {view.design.layouts.length} diseños disponibles. La fuente no se modifica.</p>
        <label className="mt-3 flex flex-col gap-1 text-sm font-semibold">Nombre de la nueva plantilla
          <input value={title} maxLength={120} disabled={busy} onChange={event => setTitle(event.target.value)} className="rounded-lg border border-[var(--engine-border)] bg-[var(--engine-canvas)] p-2" />
        </label>
      </div>
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)]">
        <div className="min-w-0 space-y-3">
          <label className="flex flex-col gap-1 text-sm font-semibold">Diseño para revisar
            <select value={active} disabled={busy} onChange={event => setActive(Number(event.target.value))} className="rounded-lg border border-[var(--engine-border)] bg-[var(--engine-surface-solid)] p-2">
              {view.design.layouts.map((item, index) => <option key={item.id} value={index}>{index + 1}. {item.label}</option>)}
            </select>
          </label>
          <ImportedSlidePreview html={view.previews[active]} assets={view.design.assets} title={`Diseño de ${layout.label}`} />
          <p className="text-xs">Vista HTML real · diseño estático · imágenes y fuentes conservadas. La edición no ejecuta scripts importados.</p>
          <fieldset className="rounded-lg border border-[var(--engine-border)] p-3"><legend className="px-1 font-semibold">Diseños de la nueva plantilla</legend>
            <p className="mb-2 text-xs">Puedes elegir uno para una plantilla individual. Al guardar, solo se incluyen los seleccionados.</p>
            {view.design.layouts.map(item => <label key={item.id} className="flex items-start gap-2 py-1 text-sm">
              <input type="checkbox" disabled={busy} checked={selected.includes(item.id)} onChange={event => setSelected(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} />{item.label}
            </label>)}
          </fieldset>
        </div>
        <aside className="min-w-0 space-y-3 rounded-lg border border-[var(--engine-border)] bg-[var(--engine-surface-solid)] p-4">
          <h2 className="font-bold">Editar esta plantilla con IA</h2>
          <p className="text-sm">Describe cambios de texto, campos reutilizables, colores o composición. Para retirar contexto anterior, indica qué fechas, nombres o pies deben vaciarse. Los gráficos y sus cifras requieren revisión.</p>
          <div className="max-h-72 space-y-2 overflow-y-auto" aria-label="Historial de revisiones">{messages.map((message, index) => <p key={message.id ?? index} className="rounded-lg bg-[var(--engine-canvas)] p-2 text-sm"><strong>{message.role === "USER" ? "Tú" : "Sistema"}: </strong>{message.content_redacted}</p>)}</div>
          <form onSubmit={event => { event.preventDefault(); void revise(true, false); }} className="space-y-2">
            <label className="flex flex-col gap-1 text-sm font-semibold">Instrucción para la IA<textarea value={prompt} disabled={busy} maxLength={12_000} onChange={event => setPrompt(event.target.value)} rows={5}
              placeholder="Ej. Crea una variante para cursos de liderazgo: cambia la portada, conserva las fuentes y vacía las fechas y el nombre del cliente anterior."
              className="rounded-lg border border-[var(--engine-border)] bg-[var(--engine-canvas)] p-2 font-normal" /></label>
            <button disabled={busy || !prompt.trim() || !selected.length || !title.trim()} className="w-full rounded-lg bg-[var(--engine-action)] px-3 py-2 font-bold text-[var(--engine-on-action)] disabled:opacity-50">Aplicar cambios con IA</button>
          </form>
          <button type="button" disabled={busy || !selected.length || !title.trim()} onClick={() => void revise(false, true)} className="w-full rounded-lg bg-[var(--engine-action)] px-3 py-2 font-bold text-[var(--engine-on-action)] disabled:opacity-50">Guardar como plantilla nueva</button>
          {latestRun && conversationId && <a className="block text-center underline" href={`/api/admin/remotion/bundle-agent/conversations/${conversationId}/runs/${latestRun.id}/download`}>Descargar plantilla guardada</a>}
        </aside>
      </section>
    </>}
  </main>;
}
