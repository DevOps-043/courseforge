"use client";

import { useCallback, useMemo, useState } from "react";
import { ChevronDown, CircleHelp, Loader2, Play, Settings2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { SlideTemplateLibraryItem } from "@/domains/production/slides/slide-template-library.actions";

type AvatarPreset = { id: string; name: string; avatar_type?: string | null; supported_api_engines?: string[] | null };
type VoicePreset = { id: string; name: string; language?: string | null };
type AvatarConfiguration = {
  aspectRatio: "16:9" | "9:16";
  avatarPresetId: string;
  caption: boolean;
  engine: "avatar_iv" | "avatar_v";
  generationMode: "scene_clips" | "single_video";
  outputFormat: "mp4" | "webm";
  resolution: "720p" | "1080p" | "4k";
  voicePresetId: string;
};
type SlidesConfiguration = {
  appearance: "light" | "dark";
  generateVisuals: boolean;
  locale: "es" | "en";
  slideTemplateRunId?: string;
  template: "concept-lesson" | "course-module" | "data-explainer" | "demo-guide";
};
type Profile = { avatar: AvatarConfiguration; slides: SlidesConfiguration };
type ClipDraft = { id: string; script_text: string; avatar_preset_id?: string; voice_preset_id?: string; deleted?: boolean; order: number };
type RunItem = { material_component_id: string; module_order: number; lesson_order: number; requirements: Array<{ kind: string }>; configuration?: Partial<Profile>; status: string };
type Run = { id: string; status: string; configuration?: { defaults?: Partial<Profile>; approval_state?: string }; items: RunItem[] };

const emptyProfile: Profile = {
  avatar: { aspectRatio: "16:9", avatarPresetId: "", caption: false, engine: "avatar_iv", generationMode: "scene_clips", outputFormat: "mp4", resolution: "1080p", voicePresetId: "" },
  slides: { appearance: "light", generateVisuals: true, locale: "es", template: "concept-lesson" },
};

export function ProductionAutomationReviewPanel({ artifactId }: { artifactId: string }) {
  const [run, setRun] = useState<Run | null>(null);
  const [profile, setProfile] = useState<Profile>(emptyProfile);
  const [overrides, setOverrides] = useState<Record<string, Profile>>({});
  const [avatars, setAvatars] = useState<AvatarPreset[]>([]);
  const [voices, setVoices] = useState<VoicePreset[]>([]);
  const [templates, setTemplates] = useState<SlideTemplateLibraryItem[]>([]);
  const [clipDrafts, setClipDrafts] = useState<Record<string, ClipDraft[]>>({});
  const [loading, setLoading] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadRun = useCallback(async (runId: string) => {
    const response = await fetch(`/api/production/automation/runs/${runId}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "No se pudo cargar la automatizacion.");
    const nextRun = payload.data as Run;
    setRun(nextRun);
    const defaults = nextRun.configuration?.defaults;
    if (defaults?.avatar && defaults?.slides) {
      setProfile({
        avatar: { ...emptyProfile.avatar, ...defaults.avatar },
        slides: { ...emptyProfile.slides, ...defaults.slides },
      } as Profile);
    }
    setOverrides(Object.fromEntries(nextRun.items.flatMap((item) => item.configuration?.avatar || item.configuration?.slides
      ? [[item.material_component_id, { ...emptyProfile, ...item.configuration, avatar: { ...emptyProfile.avatar, ...item.configuration.avatar }, slides: { ...emptyProfile.slides, ...item.configuration.slides } } as Profile]]
      : [])));
  }, []);

  const loadCatalogs = useCallback(async () => {
    const [presetsResponse, templatesResponse] = await Promise.all([
      fetch("/api/production/heygen/presets", { cache: "no-store" }),
      fetch("/api/production/slides/templates", { cache: "no-store" }),
    ]);
    const presets = await presetsResponse.json();
    const templateResult = await templatesResponse.json().catch(() => ({}));
    if (!presetsResponse.ok) throw new Error(presets.error || "No se pudieron cargar los presets de avatar.");
    setAvatars(Array.isArray(presets.data?.avatars) ? presets.data.avatars : []);
    setVoices(Array.isArray(presets.data?.voices) ? presets.data.voices : []);
    // No template package must block opening the reviewer. The built-in deck
    // templates remain selectable even if the custom library is unavailable.
    if (templatesResponse.ok && templateResult.success) setTemplates(templateResult.slideTemplates || []);
  }, []);

  const start = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/production/automation/runs", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ artifactId }),
      });
      const payload = await response.json();
      if (!response.ok && response.status === 409) {
        const existingResponse = await fetch(`/api/production/automation/runs?artifactId=${artifactId}`, { cache: "no-store" });
        const existingPayload = await existingResponse.json();
        if (existingResponse.ok && existingPayload.data?.id) {
          await loadRun(existingPayload.data.id);
          void loadCatalogs();
          toast.success("Se reanudó la revisión existente.");
          return;
        }
      }
      if (!response.ok) throw new Error(payload.error || "No se pudo preparar la automatizacion.");
      await loadRun(payload.data.runId);
      void loadCatalogs().catch((error) => {
        console.warn("No se pudo cargar el catalogo completo de produccion:", error);
        toast.error("El perfil está listo; algunos catálogos no se pudieron cargar.");
      });
      toast.success("Revisa el perfil antes de generar los assets.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo preparar la automatizacion.");
    } finally { setLoading(false); }
  };

  const saveAndDispatch = async () => {
    if (!run) return;
    setSaving(true);
    try {
      const items = Object.entries(overrides).map(([componentId, value]) => ({ componentId, ...value }));
      const configResponse = await fetch(`/api/production/automation/runs/${run.id}/configuration`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approve: true, defaults: profile, items }),
      });
      const configPayload = await configResponse.json();
      if (!configResponse.ok) throw new Error(configPayload.error || "Revisa la configuracion requerida.");
      const dispatchResponse = await fetch(`/api/production/automation/runs/${run.id}/dispatch`, { method: "POST" });
      const dispatchPayload = await dispatchResponse.json();
      if (!dispatchResponse.ok) throw new Error(dispatchPayload.error || "No se pudo iniciar la produccion.");
      await loadRun(run.id);
      toast.success("Assets enviados a generacion. El ensamblaje seguira siendo manual.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar la configuracion.");
    } finally { setSaving(false); }
  };

  const saveDraft = async () => {
    if (!run) return;
    setSavingDraft(true);
    try {
      const items = Object.entries(overrides).map(([componentId, value]) => ({ componentId, ...value }));
      const response = await fetch(`/api/production/automation/runs/${run.id}/configuration`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approve: false, defaults: profile, items }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo guardar el borrador.");
      await loadRun(run.id);
      toast.success("Configuración guardada. Aún no se generó ningún asset.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el borrador.");
    } finally { setSavingDraft(false); }
  };

  const prepareClips = async (componentId: string) => {
    if (!run) return;
    try {
      const response = await fetch(`/api/production/automation/runs/${run.id}/items/${componentId}/clips`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudieron preparar los clips.");
      setClipDrafts((current) => ({ ...current, [componentId]: payload.data.clips || [] }));
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudieron preparar los clips."); }
  };

  const saveClips = async (componentId: string) => {
    if (!run) return;
    const clips = clipDrafts[componentId] || [];
    try {
      const response = await fetch(`/api/production/automation/runs/${run.id}/items/${componentId}/clips`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clips: clips.filter((clip) => !clip.deleted).map((clip) => ({ id: clip.id, ...(clip.avatar_preset_id ? { avatarPresetId: clip.avatar_preset_id } : {}), ...(clip.voice_preset_id ? { voicePresetId: clip.voice_preset_id } : {}) })) }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudieron guardar los clips.");
      toast.success("Configuración individual de clips guardada.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudieron guardar los clips."); }
  };

  // Show every planned video component. Older draft runs may predate the
  // requirement inference update, but must still be reviewable.
  const requiredItems = useMemo(() => run?.items || [], [run]);

  if (!run) return <section className="font-[var(--font-system-ui)] rounded-2xl border border-[#00D4B3]/30 bg-gradient-to-br from-[#0A2540] to-[#0D3B56] p-6 text-white shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-6"><div><p className="font-[var(--font-system-label)] text-xs font-semibold uppercase tracking-[0.16em] text-[#00D4B3]">Producción visual</p><h3 className="mt-2 flex items-center gap-2 font-[var(--font-system-display)] text-2xl font-semibold tracking-tight"><Sparkles size={20} className="text-[#00D4B3]" /> Configura antes de generar</h3><p className="mt-2 max-w-2xl text-sm leading-6 text-white/80">Define el perfil del curso y ajusta cada lección o clip antes de crear assets. Esta etapa no abre el editor ni inicia el render final.</p></div>
      <button type="button" onClick={start} disabled={loading} className="inline-flex items-center gap-2 rounded-xl bg-[#00D4B3] px-5 py-2.5 font-[var(--font-system-label)] text-sm font-semibold text-[#0A2540] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#22E2C5] disabled:cursor-not-allowed disabled:opacity-60">{loading ? <Loader2 size={16} className="animate-spin" /> : <Settings2 size={16} />} Preparar revisión</button>
    </div></section>;

  return <section className="font-[var(--font-system-ui)] space-y-6 rounded-2xl border border-[#E9ECEF] bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#1E2329]">
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#E9ECEF] pb-5 dark:border-white/10"><div><div className="flex items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#00D4B3]/15 text-[#0A2540] dark:text-[#00D4B3]"><Settings2 size={18} /></span><div><p className="font-[var(--font-system-label)] text-xs font-semibold uppercase tracking-[0.14em] text-[#6C757D]">Configuración previa</p><h3 className="font-[var(--font-system-display)] text-xl font-semibold tracking-tight text-[#0A2540] dark:text-white">Perfil de producción</h3></div></div><p className="mt-3 max-w-2xl text-sm leading-6 text-[#6C757D] dark:text-white/65">El perfil general se aplica a todo el curso. Usa una sobrescritura sólo cuando una lección o componente necesite una configuración distinta.</p></div><div className="flex items-center gap-2"><span className="rounded-full bg-[#F59E0B]/15 px-3 py-1 font-[var(--font-system-label)] text-xs font-semibold text-[#9A6500] dark:text-[#F8C65D]">{run.status.replaceAll("_", " ")}</span><span className="rounded-full bg-[#00D4B3]/15 px-3 py-1 font-[var(--font-system-label)] text-xs font-semibold text-[#0A8271] dark:text-[#00D4B3]">{requiredItems.length} componentes</span></div></div>
    <ProfileFields value={profile} onChange={setProfile} avatars={avatars} voices={voices} templates={templates} label="Perfil general del curso" />
    <details className="rounded-xl border border-[#E9ECEF] bg-[#F8FAFB] p-4 transition open:bg-white dark:border-white/10 dark:bg-black/10 dark:open:bg-[#1E2329]"><summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-[#0A2540] marker:hidden dark:text-white"><ChevronDown size={16} className="text-[#00A98F]" /> Sobrescrituras por lección o componente <Help text="Una sobrescritura cambia únicamente esta lección; el resto del curso conserva el perfil general." /></summary><p className="mt-2 pl-6 text-xs leading-5 text-[#6C757D] dark:text-white/65">Úsalo para excepciones puntuales, como una plantilla distinta, otro avatar o configuraciones específicas por clip.</p>{requiredItems.length === 0 && <div className="mt-4 rounded-lg border border-[#F59E0B]/30 bg-[#F59E0B]/10 px-4 py-3 text-xs leading-5 text-[#805300] dark:text-[#F8C65D]">Este borrador no tiene componentes de video asociados, por eso no hay lecciones que personalizar. Puedes guardar el perfil general; prepara una nueva revisión cuando los materiales de video estén disponibles.</div>}<div className="mt-4 space-y-4">{requiredItems.map((item) => {
      const override = overrides[item.material_component_id];
      const clips = clipDrafts[item.material_component_id];
      return <div key={item.material_component_id} className="rounded-xl border border-[#E9ECEF] bg-white p-4 dark:border-white/10 dark:bg-[#1E2329]"><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-semibold text-[#0A2540] dark:text-white">Módulo {item.module_order || 1} <span className="mx-1 text-[#6C757D]">·</span> Lección {item.lesson_order || 1}</p><div className="flex flex-wrap gap-3"><button type="button" onClick={() => { if (clips) { setClipDrafts((current) => { const next = { ...current }; delete next[item.material_component_id]; return next; }); } else { void prepareClips(item.material_component_id); } }} className="text-xs font-semibold text-[#008E78] transition hover:underline dark:text-[#00D4B3]">{clips ? "Cerrar configuración de clips" : "Configurar clips individuales"}</button><button type="button" onClick={() => setOverrides((current) => { const next = { ...current }; if (next[item.material_component_id]) delete next[item.material_component_id]; else next[item.material_component_id] = structuredClone(profile); return next; })} className="text-xs font-semibold text-[#0A2540] transition hover:text-[#008E78] dark:text-[#00D4B3]">{override ? "Usar perfil general" : "Personalizar esta lección"}</button></div></div>{override && <div className="mt-4"><ProfileFields value={override} onChange={(value) => setOverrides((current) => ({ ...current, [item.material_component_id]: value }))} avatars={avatars} voices={voices} templates={templates} compact /></div>}{clips && <div className="mt-4 space-y-3 rounded-lg border border-[#E9ECEF] bg-[#F8FAFB] p-4 dark:border-white/10 dark:bg-black/10">{clips.filter((clip) => !clip.deleted).map((clip) => <div key={clip.id} className="grid gap-3 md:grid-cols-[1fr_180px_180px]"><p className="text-xs leading-5 text-[#6C757D] dark:text-white/65"><span className="font-semibold text-[#0A2540] dark:text-white">Clip {clip.order + 1}</span> · {clip.script_text.slice(0, 110)}</p><select className="rounded-lg border border-[#E9ECEF] bg-white px-3 py-2 text-xs text-[#0A2540] dark:border-white/10 dark:bg-[#1E2329] dark:text-white" value={clip.avatar_preset_id || ""} onChange={(event) => setClipDrafts((current) => ({ ...current, [item.material_component_id]: current[item.material_component_id].map((entry) => entry.id === clip.id ? { ...entry, avatar_preset_id: event.target.value } : entry) }))}><option value="">Avatar del perfil</option>{avatars.map((avatar) => <option key={avatar.id} value={avatar.id}>{avatar.name}</option>)}</select><select className="rounded-lg border border-[#E9ECEF] bg-white px-3 py-2 text-xs text-[#0A2540] dark:border-white/10 dark:bg-[#1E2329] dark:text-white" value={clip.voice_preset_id || ""} onChange={(event) => setClipDrafts((current) => ({ ...current, [item.material_component_id]: current[item.material_component_id].map((entry) => entry.id === clip.id ? { ...entry, voice_preset_id: event.target.value } : entry) }))}><option value="">Voz del perfil</option>{voices.map((voice) => <option key={voice.id} value={voice.id}>{voice.name}</option>)}</select></div>)}<button type="button" onClick={() => void saveClips(item.material_component_id)} className="rounded-lg bg-[#0A2540] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#0D3B56] dark:bg-[#00A98F] dark:text-[#0A2540] dark:hover:bg-[#00D4B3]">Guardar configuraciones por clip</button></div>}</div>;
    })}</div></details>
    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[#E9ECEF] pt-5 dark:border-white/10"><p className="max-w-2xl text-xs leading-5 text-[#6C757D]">Al finalizar la generación podrás revisar los segmentos en el editor. <strong className="font-semibold text-[#0A2540] dark:text-white">READY FOR ASSEMBLY</strong> sólo indica que los assets están listos; no ensambla ni renderiza automáticamente.</p><div className="flex flex-wrap gap-3"><button type="button" disabled={savingDraft || saving} onClick={saveDraft} className="inline-flex items-center gap-2 rounded-xl border border-[#0A2540] px-4 py-2.5 text-sm font-semibold text-[#0A2540] transition hover:bg-[#0A2540]/5 disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#00D4B3] dark:text-[#00D4B3] dark:hover:bg-[#00D4B3]/10">{savingDraft ? <Loader2 size={16} className="animate-spin" /> : <Settings2 size={16} />} Guardar borrador</button><button type="button" disabled={saving || savingDraft} onClick={saveAndDispatch} className="inline-flex items-center gap-2 rounded-xl bg-[#0A2540] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-[#0D3B56] disabled:cursor-not-allowed disabled:opacity-60">{saving ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />} Aprobar y generar assets</button></div></div>
  </section>;
}

function ProfileFields({ value, onChange, avatars, voices, templates, label, compact = false }: { value: Profile; onChange: (value: Profile) => void; avatars: AvatarPreset[]; voices: VoicePreset[]; templates: SlideTemplateLibraryItem[]; label?: string; compact?: boolean }) {
  const updateAvatar = <K extends keyof AvatarConfiguration>(key: K, next: AvatarConfiguration[K]) => onChange({ ...value, avatar: { ...value.avatar, [key]: next } });
  const updateSlides = <K extends keyof SlidesConfiguration>(key: K, next: SlidesConfiguration[K]) => onChange({ ...value, slides: { ...value.slides, [key]: next } });
  const inputClass = "mt-1.5 w-full rounded-xl border border-[#E9ECEF] bg-white px-3 py-2 text-sm text-[#0A2540] shadow-sm outline-none transition focus:border-[#00D4B3] focus:ring-2 focus:ring-[#00D4B3]/20 dark:border-white/10 dark:bg-[#1E2329] dark:text-white";
  return <fieldset className={compact ? "grid gap-4 font-[var(--font-system-label)]" : "rounded-xl border border-[#E9ECEF] bg-[#F8FAFB] p-5 font-[var(--font-system-label)] dark:border-white/10 dark:bg-black/10"}><legend className="px-1 font-[var(--font-system-display)] text-base font-semibold text-[#0A2540] dark:text-white">{label}</legend><p className="mb-4 px-1 text-xs leading-5 text-[#6C757D]">Configura los valores predeterminados. Las excepciones de lección y clip tienen prioridad.</p><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
    <label className="text-xs font-semibold text-[#0A2540] dark:text-white"><Help text="Motor de HeyGen que interpreta el avatar. El catálogo indica cuáles avatares son compatibles." /> Tipo / engine<select className={inputClass} value={value.avatar.engine} onChange={(event) => updateAvatar("engine", event.target.value as AvatarConfiguration["engine"])}><option value="avatar_iv">Avatar IV</option><option value="avatar_v">Avatar V</option></select></label>
    <label className="text-xs font-medium"><Help text="Avatar base para el curso. Puede sustituirse por lección o por clip antes del despacho." /> Avatar<select className={inputClass} value={value.avatar.avatarPresetId} onChange={(event) => updateAvatar("avatarPresetId", event.target.value)}><option value="">Seleccionar avatar…</option>{avatars.map((avatar) => <option key={avatar.id} value={avatar.id}>{avatar.name}{avatar.avatar_type ? ` · ${avatar.avatar_type}` : ""}</option>)}</select></label>
    <label className="text-xs font-medium"><Help text="Voz base asociada a los clips. Se puede cambiar por clip cuando el formato sea Clips por escena." /> Voz<select className={inputClass} value={value.avatar.voicePresetId} onChange={(event) => updateAvatar("voicePresetId", event.target.value)}><option value="">Seleccionar voz…</option>{voices.map((voice) => <option key={voice.id} value={voice.id}>{voice.name}{voice.language ? ` · ${voice.language}` : ""}</option>)}</select></label>
    <label className="text-xs font-medium"><Help text="Clips por escena permite personalizar cada segmento. Video completo usa una sola toma para toda la lección." /> Formato de avatar<select className={inputClass} value={value.avatar.generationMode} onChange={(event) => updateAvatar("generationMode", event.target.value as AvatarConfiguration["generationMode"])}><option value="scene_clips">Clips por escena</option><option value="single_video">Video completo</option></select></label>
    <label className="text-xs font-medium"><Help text="Proporción del video que se generará." /> Relación<select className={inputClass} value={value.avatar.aspectRatio} onChange={(event) => updateAvatar("aspectRatio", event.target.value as AvatarConfiguration["aspectRatio"])}><option value="16:9">16:9</option><option value="9:16">9:16</option></select></label>
    <label className="text-xs font-medium"><Help text="Resolución de los assets de avatar. Verifica que el plan de HeyGen soporte la resolución elegida." /> Resolución<select className={inputClass} value={value.avatar.resolution} onChange={(event) => updateAvatar("resolution", event.target.value as AvatarConfiguration["resolution"])}><option value="720p">720p</option><option value="1080p">1080p</option><option value="4k">4K</option></select></label>
    <label className="text-xs font-medium"><Help text="Estructura editorial que el motor usará para organizar el deck generado." /> Plantilla de deck<select className={inputClass} value={value.slides.template} onChange={(event) => updateSlides("template", event.target.value as SlidesConfiguration["template"])}><option value="concept-lesson">Lección conceptual</option><option value="course-module">Módulo de curso</option><option value="data-explainer">Explicador de datos</option><option value="demo-guide">Guía demostrativa</option></select></label>
    <label className="text-xs font-medium"><Help text="Diseño visual reutilizable. Diseño estándar usa los estilos base; una plantilla guardada aplica su sistema de diseño." /> Plantilla visual<select className={inputClass} value={value.slides.slideTemplateRunId || ""} onChange={(event) => updateSlides("slideTemplateRunId", event.target.value || undefined)}><option value="">Diseño estándar</option>{templates.filter((template) => template.status === "PACKAGED").map((template) => <option key={template.id} value={template.id}>{template.title}</option>)}</select></label>
    <label className="text-xs font-medium"><Help text="Apariencia del deck renderizado. Claro es el valor predeterminado; oscuro conserva los acentos de marca sobre superficies SofLIA oscuras." /> Apariencia de slides<select className={inputClass} value={value.slides.appearance} onChange={(event) => updateSlides("appearance", event.target.value as SlidesConfiguration["appearance"])}><option value="light">Claro</option><option value="dark">Oscuro</option></select></label>
  </div><label className="mt-5 flex items-center gap-2 text-xs font-medium text-[#0A2540] dark:text-white"><input className="h-4 w-4 rounded border-[#6C757D] text-[#00A98F] focus:ring-[#00D4B3]" type="checkbox" checked={value.avatar.caption} onChange={(event) => updateAvatar("caption", event.target.checked)} /> <Help text="Solicita captions/subtítulos al proveedor del avatar." /> Incluir captions en avatar</label></fieldset>;
}

function Help({ text }: { text: string }) {
  return <span className="group relative mr-1 inline-flex align-middle"><button type="button" aria-label={text} className="inline-flex rounded-full text-[#008E78] outline-none focus-visible:ring-2 focus-visible:ring-[#00D4B3]"><CircleHelp size={14} strokeWidth={2} /></button><span role="tooltip" className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 hidden w-56 rounded-lg bg-[#0A2540] px-3 py-2 text-xs font-normal leading-5 text-white shadow-lg group-hover:block group-focus-within:block">{text}</span></span>;
}
