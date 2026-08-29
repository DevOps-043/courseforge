"use client";

import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  Download,
  FileCode2,
  Grid2X2,
  Layers3,
  List,
  Loader2,
  Moon,
  Palette,
  Plus,
  Save,
  Send,
  Settings2,
  Sparkles,
  Sun,
  User,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { EngineSelect } from "@/components/ui/EngineSelect";

type SlideLayoutId = "center" | "closing" | "data" | "framework" | "split" | "split_reverse";
type SlideTypeId = string;
type SlidePreviewMode = "list" | "grid";

interface StudioMessage {
  id?: string;
  role: string;
  content_redacted: string;
}

interface StudioState {
  conversation: { id: string; status: string; title: string } | null;
  generationRuns: Array<{ id: string; status: string; bundle_storage_path: string | null; error_sanitized: string | null }>;
  messages: StudioMessage[];
  specs: Array<{ id: string; version_number: number; spec_json: SlideTemplateSpec }>;
}

interface DesignTokens {
  accent: string;
  accent2: string;
  background: string;
  muted: string;
  surface: string;
  text: string;
}

interface TemplateModifiers {
  cornerRadius: number;
  density: "compact" | "comfortable" | "spacious";
  fontPairing: "system_sans" | "editorial_serif" | "technical_mono";
  showBrandMark: boolean;
}

interface TemplateLayout {
  id: SlideLayoutId;
  label: string;
  purpose: string;
  regions: string[];
}

interface TemplateSlideType {
  defaultLayout: SlideLayoutId;
  id: SlideTypeId;
  label: string;
  purpose: string;
  requiredContent: string[];
}

interface SlideTemplateSpec {
  artifactKind: "slide_template";
  changeSummary: string;
  description: string;
  packageId: string;
  templateBlueprint?: {
    designTokens: DesignTokens;
    layouts: TemplateLayout[];
    modifiers: TemplateModifiers;
    slideTypes: TemplateSlideType[];
  };
  title: string;
}

const EMPTY_STATE: StudioState = {
  conversation: null,
  generationRuns: [],
  messages: [],
  specs: [],
};

const DEFAULT_TOKENS: DesignTokens = {
  accent: "#00D4B3",
  accent2: "#2D7D6E",
  background: "#F7FAFC",
  muted: "#65758B",
  surface: "#FFFFFF",
  text: "#0A2540",
};

const DARK_TOKENS: DesignTokens = {
  accent: "#2DD4BF",
  accent2: "#8B5CF6",
  background: "#05070B",
  muted: "#94A3B8",
  surface: "#111827",
  text: "#F8FAFC",
};

const DEFAULT_MODIFIERS: TemplateModifiers = {
  cornerRadius: 8,
  density: "comfortable",
  fontPairing: "system_sans",
  showBrandMark: true,
};

const FALLBACK_SLIDE_TYPES: TemplateSlideType[] = [
  {
    id: "cover",
    label: "Titulo",
    defaultLayout: "center",
    purpose: "Abrir la leccion con tema y promesa visual.",
    requiredContent: ["title", "subtitle"],
  },
  {
    id: "objectives",
    label: "Objetivos",
    defaultLayout: "framework",
    purpose: "Mostrar resultados de aprendizaje.",
    requiredContent: ["objective_list"],
  },
  {
    id: "concept",
    label: "Explicacion",
    defaultLayout: "split",
    purpose: "Desarrollar una idea clave con apoyo visual.",
    requiredContent: ["claim", "support_points"],
  },
  {
    id: "data_explainer",
    label: "Grafica",
    defaultLayout: "data",
    purpose: "Visualizar datos cuando la leccion lo requiere.",
    requiredContent: ["chart_data", "insight", "source"],
  },
  {
    id: "summary",
    label: "Resumen",
    defaultLayout: "closing",
    purpose: "Cerrar con aprendizajes y siguiente paso.",
    requiredContent: ["takeaways", "next_step"],
  },
];

const COLOR_FIELDS: Array<{ key: keyof DesignTokens; label: string }> = [
  { key: "background", label: "Fondo" },
  { key: "surface", label: "Superficie" },
  { key: "accent", label: "Acento" },
  { key: "accent2", label: "Acento 2" },
  { key: "text", label: "Texto" },
  { key: "muted", label: "Secundario" },
];

const DENSITY_PADDING: Record<TemplateModifiers["density"], number> = {
  compact: 28,
  comfortable: 38,
  spacious: 50,
};

interface DirtyOverrides {
  designTokens: boolean;
  modifiers: boolean;
  slideTypes: boolean;
}

async function readJson(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return payload;
}

async function fetchJson(input: RequestInfo | URL, init?: RequestInit, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await readJson(await fetch(input, {
      ...init,
      signal: controller.signal,
    }));
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("La solicitud tardo demasiado. Intenta de nuevo.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function getRoleLabel(role: string) {
  if (role === "USER") return "Tu";
  if (role === "TOOL") return "Sistema";
  return "SofLIA";
}

function getFontFamily(fontPairing: TemplateModifiers["fontPairing"]) {
  if (fontPairing === "editorial_serif") return "Georgia, 'Times New Roman', serif";
  if (fontPairing === "technical_mono") return "'SFMono-Regular', Consolas, 'Liberation Mono', monospace";
  return "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
}

function buildBlueprintOverride(
  baseBlueprint: SlideTemplateSpec["templateBlueprint"] | undefined,
  designTokens: DesignTokens,
  modifiers: TemplateModifiers,
  slideTypes: TemplateSlideType[],
  dirtyOverrides: DirtyOverrides = { designTokens: true, modifiers: true, slideTypes: true },
) {
  return {
    ...(baseBlueprint || {}),
    ...(dirtyOverrides.designTokens ? { designTokens } : {}),
    ...(dirtyOverrides.modifiers ? { modifiers } : {}),
    slideTypes: dirtyOverrides.slideTypes
      ? slideTypes
      : baseBlueprint?.slideTypes?.length ? baseBlueprint.slideTypes : FALLBACK_SLIDE_TYPES,
  };
}

function getPreviewSlides(spec: SlideTemplateSpec | undefined) {
  return spec?.templateBlueprint?.slideTypes?.length
    ? spec.templateBlueprint.slideTypes
    : FALLBACK_SLIDE_TYPES;
}

function latestDownloadHref(state: StudioState) {
  const run = state.generationRuns.find((generationRun) => Boolean(generationRun.bundle_storage_path));
  if (!state.conversation?.id || !run) return null;
  return `/api/admin/remotion/bundle-agent/conversations/${state.conversation.id}/runs/${run.id}/download`;
}

function SlidePreview({
  modifiers,
  slideType,
  tokens,
  variant = "regular",
}: {
  modifiers: TemplateModifiers;
  slideType: TemplateSlideType;
  tokens: DesignTokens;
  variant?: "regular" | "thumbnail";
}) {
  const padding = DENSITY_PADDING[modifiers.density];
  const scaledPadding = variant === "thumbnail" ? Math.max(12, Math.round(padding * 0.42)) : padding;
  const style = {
    "--studio-accent": tokens.accent,
    "--studio-accent-2": tokens.accent2,
    "--studio-background": tokens.background,
    "--studio-muted": tokens.muted,
    "--studio-surface": tokens.surface,
    "--studio-text": tokens.text,
    borderRadius: `${modifiers.cornerRadius}px`,
    fontFamily: getFontFamily(modifiers.fontPairing),
  } as CSSProperties;

  return (
    <article
      className="aspect-video overflow-hidden border border-black/10 bg-[var(--studio-background)] shadow-sm dark:border-white/10"
      style={style}
    >
      <div className="grid h-full grid-cols-12 gap-3" style={{ padding: scaledPadding }}>
        {modifiers.showBrandMark && (
          <div className={`${variant === "thumbnail" ? "hidden" : "flex"} col-span-12 items-center justify-between text-[8px] font-black uppercase tracking-wider text-[var(--studio-muted)]`}>
            <span>SofLIA</span>
            <span>{slideType.id.replace(/_/g, " ")}</span>
          </div>
        )}

        {slideType.defaultLayout === "center" || slideType.defaultLayout === "closing" ? (
          <div className="col-span-12 flex h-full flex-col justify-center">
            <span className={`${variant === "thumbnail" ? "mb-1 h-1 w-8" : "mb-2 h-1.5 w-14"} rounded-full bg-[var(--studio-accent)]`} />
            <h3 className={`${variant === "thumbnail" ? "text-[10px]" : "text-[clamp(18px,2.2vw,34px)]"} font-black leading-tight text-[var(--studio-text)]`}>
              {slideType.label}
            </h3>
            <p className={`${variant === "thumbnail" ? "hidden" : "mt-2"} max-w-[72%] text-[clamp(9px,1vw,14px)] leading-snug text-[var(--studio-muted)]`}>
              {slideType.purpose}
            </p>
          </div>
        ) : null}

        {slideType.defaultLayout === "split" || slideType.defaultLayout === "split_reverse" ? (
          <>
            <div className={`col-span-7 flex flex-col justify-center ${slideType.defaultLayout === "split_reverse" ? "order-2" : ""}`}>
              <span className={`${variant === "thumbnail" ? "mb-1 h-1 w-8" : "mb-2 h-1.5 w-12"} rounded-full bg-[var(--studio-accent)]`} />
              <h3 className={`${variant === "thumbnail" ? "text-[10px]" : "text-[clamp(16px,1.8vw,28px)]"} font-black leading-tight text-[var(--studio-text)]`}>
                {slideType.label}
              </h3>
              <ul className={`${variant === "thumbnail" ? "hidden" : "mt-3"} space-y-1 text-[clamp(8px,.9vw,12px)] text-[var(--studio-muted)]`}>
                {slideType.requiredContent.slice(0, 3).map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--studio-accent-2)]" />
                    {item.replace(/_/g, " ")}
                  </li>
                ))}
              </ul>
            </div>
            <div className="col-span-5 flex items-center">
              <div className="h-[72%] w-full bg-[var(--studio-surface)] p-2 shadow-sm" style={{ borderRadius: modifiers.cornerRadius }}>
                <div className="h-full border border-[var(--studio-accent)]/30 bg-[linear-gradient(135deg,var(--studio-accent),var(--studio-accent-2))] opacity-80" style={{ borderRadius: Math.max(2, modifiers.cornerRadius - 2) }} />
              </div>
            </div>
          </>
        ) : null}

        {slideType.defaultLayout === "framework" ? (
          <div className="col-span-12 grid h-full grid-cols-3 gap-3">
            <div className="col-span-3">
              <h3 className={`${variant === "thumbnail" ? "text-[10px]" : "text-[clamp(15px,1.7vw,26px)]"} font-black text-[var(--studio-text)]`}>
                {slideType.label}
              </h3>
            </div>
            {slideType.requiredContent.slice(0, 3).map((item, index) => (
              <div key={item} className="bg-[var(--studio-surface)] p-2 shadow-sm" style={{ borderRadius: modifiers.cornerRadius }}>
                <span className="text-[8px] font-black text-[var(--studio-accent)]">0{index + 1}</span>
                <p className={`${variant === "thumbnail" ? "hidden" : "mt-3"} text-[clamp(8px,.9vw,12px)] font-bold text-[var(--studio-text)]`}>
                  {item.replace(/_/g, " ")}
                </p>
              </div>
            ))}
          </div>
        ) : null}

        {slideType.defaultLayout === "data" ? (
          <div className="col-span-12 grid h-full grid-cols-5 gap-4">
            <div className="col-span-2 flex flex-col justify-center">
              <h3 className={`${variant === "thumbnail" ? "text-[10px]" : "text-[clamp(16px,1.8vw,28px)]"} font-black text-[var(--studio-text)]`}>
                {slideType.label}
              </h3>
              <p className={`${variant === "thumbnail" ? "hidden" : "mt-2"} text-[clamp(8px,.9vw,12px)] text-[var(--studio-muted)]`}>
                {slideType.purpose}
              </p>
            </div>
            <div className="col-span-3 flex items-end gap-2 bg-[var(--studio-surface)] p-4 shadow-sm" style={{ borderRadius: modifiers.cornerRadius }}>
              {[64, 42, 86, 58].map((height, index) => (
                <span
                  key={height}
                  className="flex-1 rounded-t-sm"
                  style={{
                    background: index % 2 === 0 ? tokens.accent : tokens.accent2,
                    height: `${height}%`,
                  }}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function SlideTemplateStudioClient() {
  const params = useParams<{ empresaSlug?: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<StudioState>(EMPTY_STATE);
  const [prompt, setPrompt] = useState("");
  const [title, setTitle] = useState("Plantilla HTML de slides");
  const [designTokens, setDesignTokens] = useState<DesignTokens>(DEFAULT_TOKENS);
  const [modifiers, setModifiers] = useState<TemplateModifiers>(DEFAULT_MODIFIERS);
  const [slideTypes, setSlideTypes] = useState<TemplateSlideType[]>(FALLBACK_SLIDE_TYPES);
  const [dirtyOverrides, setDirtyOverrides] = useState<DirtyOverrides>({ designTokens: false, modifiers: false, slideTypes: false });
  const [slidePreviewMode, setSlidePreviewMode] = useState<SlidePreviewMode>("grid");
  const [loadedConversationId, setLoadedConversationId] = useState<string | null>(null);
  const [operation, setOperation] = useState<"loading" | "message" | "saving_spec" | "packaging" | null>(null);

  const latestSpec = state.specs[0]?.spec_json;
  const previewSlides = useMemo(() => slideTypes.length ? slideTypes : getPreviewSlides(latestSpec), [latestSpec, slideTypes]);
  const downloadHref = latestDownloadHref(state);
  const adminBasePath = params?.empresaSlug ? `/${params.empresaSlug}/admin` : "/admin";

  useEffect(() => {
    const conversationId = searchParams.get("conversationId");
    if (!conversationId || loadedConversationId === conversationId) return;

    let cancelled = false;
    setLoadedConversationId(conversationId);
    setOperation("loading");
    refresh(conversationId)
      .catch((error) => {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "No se pudo cargar la conversacion.");
        }
      })
      .finally(() => {
        if (!cancelled) setOperation(null);
      });

    return () => {
      cancelled = true;
    };
  }, [loadedConversationId, searchParams]);

  async function refresh(conversationId = state.conversation?.id) {
    if (!conversationId) return;
    const payload = await fetchJson(`/api/admin/remotion/bundle-agent/conversations/${conversationId}`, { cache: "no-store" });
    setState({
      conversation: payload.conversation,
      generationRuns: payload.generationRuns || [],
      messages: payload.messages || [],
      specs: payload.specs || [],
    });
    if (payload.conversation?.title) {
      setTitle(payload.conversation.title);
    }

    const spec = payload.specs?.[0]?.spec_json as SlideTemplateSpec | undefined;
    if (spec?.templateBlueprint) {
      setDesignTokens(spec.templateBlueprint.designTokens);
      setModifiers(spec.templateBlueprint.modifiers);
      setSlideTypes(spec.templateBlueprint.slideTypes);
      setDirtyOverrides({ designTokens: false, modifiers: false, slideTypes: false });
    }
  }

  async function ensureConversation() {
    if (state.conversation?.id) return state.conversation.id;
    const conversationIdFromUrl = searchParams.get("conversationId");
    if (conversationIdFromUrl) {
      if (loadedConversationId !== conversationIdFromUrl) {
        setLoadedConversationId(conversationIdFromUrl);
      }
      return conversationIdFromUrl;
    }

    const payload = await fetchJson("/api/admin/remotion/bundle-agent/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artifactKind: "slide_template", title }),
    });
    setState((current) => ({ ...current, conversation: payload.conversation }));
    setLoadedConversationId(payload.conversation.id);
    router.replace(`${adminBasePath}/slides/templates?conversationId=${payload.conversation.id}`, { scroll: false });
    return payload.conversation.id as string;
  }

  async function run(nextOperation: NonNullable<typeof operation>, action: () => Promise<void>) {
    if (operation) return;
    setOperation(nextOperation);
    try {
      await action();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo completar la accion.");
    } finally {
      setOperation(null);
    }
  }

  async function persistTitle(conversationId: string) {
    if (title.trim() === state.conversation?.title) return;
    await fetchJson(`/api/admin/remotion/bundle-agent/conversations/${conversationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim() }),
    });
  }

  function buildSpecRequestBody() {
    const hasDirtyOverrides = dirtyOverrides.designTokens || dirtyOverrides.modifiers || dirtyOverrides.slideTypes;
    return {
      artifactKind: "slide_template",
      ...(hasDirtyOverrides ? {
        overrides: {
          templateBlueprint: buildBlueprintOverride(
            latestSpec?.templateBlueprint,
            designTokens,
            modifiers,
            slideTypes,
            dirtyOverrides,
          ),
        },
      } : {}),
    };
  }

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const content = prompt.trim();
    if (!content) return;

    await run("message", async () => {
      const conversationId = await ensureConversation();
      await fetchJson(`/api/admin/remotion/bundle-agent/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, role: "USER" }),
      });
      setPrompt("");
      await fetchJson(`/api/admin/remotion/bundle-agent/conversations/${conversationId}/specs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artifactKind: "slide_template" }),
      });
      await refresh(conversationId);
      toast.success("Plantilla actualizada desde la conversacion.");
    });
  }

  async function createSpec() {
    await run("saving_spec", async () => {
      const conversationId = await ensureConversation();
      await persistTitle(conversationId);
      const payload = await fetchJson(`/api/admin/remotion/bundle-agent/conversations/${conversationId}/specs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildSpecRequestBody()),
      });
      const spec = payload.spec?.spec_json as SlideTemplateSpec | undefined;
      if (spec?.templateBlueprint) {
        setDesignTokens(spec.templateBlueprint.designTokens);
        setModifiers(spec.templateBlueprint.modifiers);
      }
      await refresh(conversationId);
      toast.success("Spec de template actualizada.");
    });
  }

  async function savePackage() {
    await run("packaging", async () => {
      const conversationId = await ensureConversation();
      await persistTitle(conversationId);
      const specPayload = await fetchJson(`/api/admin/remotion/bundle-agent/conversations/${conversationId}/specs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildSpecRequestBody()),
      });
      await fetchJson(`/api/admin/remotion/bundle-agent/conversations/${conversationId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artifactKind: "slide_template",
          specId: specPayload.spec?.id,
        }),
      }, 120000);
      await refresh(conversationId);
      toast.success("Template HTML guardado como ZIP.");
    });
  }

  return (
    <main className="h-[calc(100vh-84px)] overflow-hidden bg-gray-50 p-3 text-gray-950 dark:bg-[var(--engine-canvas)] dark:text-white lg:p-4">
      <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-[var(--engine-accent-strong)]">
            <FileCode2 size={14} />
            Slide Template Studio
          </div>
          <h1 className="mt-0.5 text-xl font-black tracking-tight">Crear plantilla HTML de slides</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`${adminBasePath}/slides`}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700 transition hover:bg-gray-100 dark:border-white/10 dark:bg-[var(--engine-surface-solid)] dark:text-gray-200 dark:hover:bg-white/5"
          >
            <ArrowLeft size={16} />
            Regresar
          </Link>
          <Link
            href={`${adminBasePath}/templates`}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700 transition hover:bg-gray-100 dark:border-white/10 dark:bg-[var(--engine-surface-solid)] dark:text-gray-200 dark:hover:bg-white/5"
          >
            <Layers3 size={16} />
            Biblioteca
          </Link>
          {downloadHref && (
            <a
              href={downloadHref}
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--engine-primary)] px-3 py-2 text-sm font-bold text-white transition hover:bg-[#10395f]"
            >
              <Download size={16} />
              Descargar ZIP
            </a>
          )}
        </div>
      </div>

      <section className="grid h-[calc(100%-56px)] min-h-0 gap-3 xl:grid-cols-[minmax(380px,0.82fr)_minmax(560px,1.18fr)]">
        <div className="flex min-h-0 flex-col rounded-lg border border-gray-200 bg-white dark:border-white/10 dark:bg-[var(--engine-surface-solid)]">
          <div className="border-b border-gray-100 p-2.5 dark:border-white/10">
            <label className="block text-[11px] font-black uppercase text-gray-500 dark:text-gray-400">
              Nombre del deck template
            </label>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-semibold outline-none transition focus:border-[var(--engine-accent)] dark:border-white/10 dark:bg-[var(--engine-canvas)]"
            />
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            {state.messages.length === 0 ? (
              <div className="flex h-full min-h-[96px] flex-col items-center justify-center text-center">
                <Sparkles className="mb-1.5 text-[var(--engine-accent-strong)]" size={24} />
                <h2 className="text-sm font-black">Describe la plantilla que necesitas</h2>
                <p className="mt-1 max-w-md text-[11px] leading-5 text-gray-500 dark:text-gray-400">
                  El sistema separara decisiones de tipos de diapositiva, layouts, estilo grafico y contrato HTML.
                </p>
              </div>
            ) : (
              state.messages.map((message, index) => (
                <div
                  key={message.id || `${message.role}-${index}`}
                  className={`flex gap-3 ${message.role === "USER" ? "justify-end" : "justify-start"}`}
                >
                  <div className={`flex max-w-[78%] gap-2 ${message.role === "USER" ? "flex-row-reverse" : ""}`}>
                    <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300">
                      {message.role === "USER" ? <User size={16} /> : <Bot size={16} />}
                    </span>
                    <div className={`rounded-lg px-4 py-3 text-sm leading-6 ${message.role === "USER" ? "bg-[var(--engine-primary)] text-white" : "bg-gray-100 text-gray-800 dark:bg-white/10 dark:text-gray-100"}`}>
                      <p className="mb-1 text-[11px] font-black uppercase opacity-70">{getRoleLabel(message.role)}</p>
                      {message.content_redacted}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <form onSubmit={sendMessage} className="shrink-0 border-t border-gray-100 p-2.5 dark:border-white/10">
            <div className="flex gap-2">
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Ej. Necesito una plantilla corporativa para cursos de liderazgo, con portada, objetivos, explicacion, graficas solo cuando haya datos, y cierre practico."
                className="h-14 flex-1 resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-[var(--engine-accent)] dark:border-white/10 dark:bg-[var(--engine-canvas)]"
              />
              <button
                type="submit"
                disabled={Boolean(operation) || !prompt.trim()}
                className="inline-flex w-12 items-center justify-center rounded-lg bg-[var(--engine-accent-strong)] text-white transition hover:bg-[#008f79] disabled:cursor-not-allowed disabled:bg-gray-300"
                title="Enviar"
              >
                {operation === "message" ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
              </button>
            </div>
          </form>
        </div>

        <aside className="grid min-h-0 grid-rows-[minmax(230px,1fr)_minmax(270px,0.92fr)] gap-3">
          <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] rounded-lg border border-gray-200 bg-white dark:border-white/10 dark:bg-[var(--engine-surface-solid)]">
            <div className="flex items-center justify-between border-b border-gray-100 p-3 dark:border-white/10">
              <div className="flex items-center gap-2">
                <Palette className="text-[var(--engine-accent-strong)]" size={18} />
                <h2 className="text-sm font-black">Slides generadas</h2>
              </div>
              <div className="flex items-center gap-2">
                <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 dark:border-white/10 dark:bg-[var(--engine-canvas)]">
                  <button
                    type="button"
                    onClick={() => setSlidePreviewMode("list")}
                    title="Vista lista"
                    className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition ${
                      slidePreviewMode === "list"
                        ? "bg-white text-[var(--engine-accent-strong)] shadow-sm dark:bg-white/10"
                        : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                    }`}
                  >
                    <List size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSlidePreviewMode("grid")}
                    title="Vista mosaico"
                    className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition ${
                      slidePreviewMode === "grid"
                        ? "bg-white text-[var(--engine-accent-strong)] shadow-sm dark:bg-white/10"
                        : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                    }`}
                  >
                    <Grid2X2 size={15} />
                  </button>
                </div>
                <span className="rounded-full border border-gray-200 px-2 py-1 text-[11px] font-bold text-gray-500 dark:border-white/10">
                  {previewSlides.length} tipos
                </span>
              </div>
            </div>
            <div
              className={`min-h-0 overflow-y-auto p-3 ${
                slidePreviewMode === "grid"
                  ? "grid grid-cols-2 content-start gap-2"
                  : "space-y-3"
              }`}
            >
              {previewSlides.map((slideType) => (
                <div
                  key={slideType.id}
                  className={
                    slidePreviewMode === "list"
                      ? "grid grid-cols-[128px_minmax(0,1fr)] gap-3 rounded-lg border border-gray-200 bg-gray-50 p-2 dark:border-white/10 dark:bg-[var(--engine-canvas)]"
                      : ""
                  }
                >
                  <SlidePreview
                    modifiers={modifiers}
                    slideType={slideType}
                    tokens={designTokens}
                    variant={slidePreviewMode === "list" ? "thumbnail" : "regular"}
                  />
                  <div
                    className={
                      slidePreviewMode === "list"
                        ? "min-w-0 py-1"
                        : "mt-2 flex items-center justify-between gap-2 text-[11px]"
                    }
                  >
                    <div className="min-w-0">
                      <span className="block truncate text-xs font-black text-gray-900 dark:text-gray-100">
                        {slideType.label}
                      </span>
                      {slidePreviewMode === "list" && (
                        <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-gray-500 dark:text-gray-400">
                          {slideType.purpose}
                        </p>
                      )}
                    </div>
                    <div className={slidePreviewMode === "list" ? "mt-2 flex flex-wrap gap-1.5" : "shrink-0"}>
                      <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-bold text-gray-500 dark:border-white/10 dark:bg-white/5 dark:text-gray-400">
                        {slideType.id.replace(/_/g, " ")}
                      </span>
                      {slidePreviewMode === "list" && (
                        <span className="rounded-full border border-[var(--engine-accent)]/30 bg-[var(--engine-accent)]/10 px-2 py-0.5 text-[10px] font-bold text-[#007F6D] dark:text-[var(--engine-accent)]">
                          {slideType.defaultLayout}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] rounded-lg border border-gray-200 bg-white dark:border-white/10 dark:bg-[var(--engine-surface-solid)]">
            <div className="flex items-center gap-2 border-b border-gray-100 p-3 dark:border-white/10">
              <Settings2 className="text-[var(--engine-accent-strong)]" size={18} />
              <h2 className="text-sm font-black">Modificadores</h2>
            </div>
            <div className="min-h-0 space-y-3 overflow-y-auto p-3">
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-gray-600 dark:text-gray-300">Tipos de slide</span>
                  <button
                    type="button"
                    disabled={!FALLBACK_SLIDE_TYPES.some((candidate) => !slideTypes.some((item) => item.id === candidate.id))}
                    onClick={() => {
                      const candidate = FALLBACK_SLIDE_TYPES.find((item) => !slideTypes.some((current) => current.id === item.id));
                      if (!candidate) return;
                      setSlideTypes((current) => [...current, candidate]);
                      setDirtyOverrides((current) => ({ ...current, slideTypes: true }));
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-[var(--engine-accent-strong)] disabled:opacity-40"
                  >
                    <Plus size={12} /> Agregar tipo
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {slideTypes.map((slideType) => (
                    <span key={slideType.id} className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-bold text-gray-700 dark:border-white/10 dark:bg-white/5 dark:text-gray-200">
                      {slideType.label}
                      <button
                        type="button"
                        aria-label={`Quitar ${slideType.label}`}
                        disabled={slideTypes.length === 1}
                        onClick={() => {
                          setSlideTypes((current) => current.filter((item) => item.id !== slideType.id));
                          setDirtyOverrides((current) => ({ ...current, slideTypes: true }));
                        }}
                        className="rounded-full p-0.5 hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/10"
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setDesignTokens(DEFAULT_TOKENS);
                    setDirtyOverrides((current) => ({ ...current, designTokens: true }));
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-bold dark:border-white/10"
                >
                  <Sun size={13} /> Apariencia clara
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDesignTokens(DARK_TOKENS);
                    setDirtyOverrides((current) => ({ ...current, designTokens: true }));
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-bold dark:border-white/10"
                >
                  <Moon size={13} /> Apariencia oscura
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {COLOR_FIELDS.map((field) => (
                  <label key={field.key} className="text-xs font-bold text-gray-600 dark:text-gray-300">
                    {field.label}
                    <div className="mt-1 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-1.5 dark:border-white/10 dark:bg-[var(--engine-canvas)]">
                      <input
                        type="color"
                        value={designTokens[field.key]}
                        onChange={(event) => {
                          setDirtyOverrides((current) => ({ ...current, designTokens: true }));
                          setDesignTokens((current) => ({ ...current, [field.key]: event.target.value.toUpperCase() }));
                        }}
                        className="h-7 w-8 cursor-pointer border-0 bg-transparent p-0"
                      />
                      <span className="font-mono text-[11px]">{designTokens[field.key]}</span>
                    </div>
                  </label>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs font-bold text-gray-600 dark:text-gray-300">
                  Densidad
                  <EngineSelect
                    value={modifiers.density}
                    onValueChange={(value) => {
                      setDirtyOverrides((current) => ({ ...current, modifiers: true }));
                      setModifiers((current) => ({ ...current, density: value as TemplateModifiers["density"] }));
                    }}
                    className="mt-1"
                    options={[
                      { value: "compact", label: "Compacta" },
                      { value: "comfortable", label: "Cómoda" },
                      { value: "spacious", label: "Espaciada" },
                    ]}
                  />
                </label>
                <label className="text-xs font-bold text-gray-600 dark:text-gray-300">
                  Tipografia
                  <EngineSelect
                    value={modifiers.fontPairing}
                    onValueChange={(value) => {
                      setDirtyOverrides((current) => ({ ...current, modifiers: true }));
                      setModifiers((current) => ({ ...current, fontPairing: value as TemplateModifiers["fontPairing"] }));
                    }}
                    className="mt-1"
                    options={[
                      { value: "system_sans", label: "Sans de sistema" },
                      { value: "editorial_serif", label: "Serif editorial" },
                      { value: "technical_mono", label: "Mono técnica" },
                    ]}
                  />
                </label>
              </div>

              <label className="block text-xs font-bold text-gray-600 dark:text-gray-300">
                Radio {modifiers.cornerRadius}px
                <input
                  type="range"
                  min={0}
                  max={32}
                  value={modifiers.cornerRadius}
                  onChange={(event) => {
                    setDirtyOverrides((current) => ({ ...current, modifiers: true }));
                    setModifiers((current) => ({ ...current, cornerRadius: Number(event.target.value) }));
                  }}
                  className="mt-2 w-full accent-[var(--engine-accent-strong)]"
                />
              </label>

              <label className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold dark:border-white/10">
                Marca visible
                <input
                  type="checkbox"
                  checked={modifiers.showBrandMark}
                  onChange={(event) => {
                    setDirtyOverrides((current) => ({ ...current, modifiers: true }));
                    setModifiers((current) => ({ ...current, showBrandMark: event.target.checked }));
                  }}
                  className="h-4 w-4 accent-[var(--engine-accent-strong)]"
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={createSpec}
                  disabled={Boolean(operation)}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-black text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/5"
                >
                  {operation === "saving_spec" ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />}
                  {operation === "saving_spec" ? "Guardando spec…" : "Actualizar spec"}
                </button>
                <button
                  type="button"
                  onClick={savePackage}
                  disabled={Boolean(operation)}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--engine-accent-strong)] px-3 py-2 text-sm font-black text-white transition hover:bg-[#008f79] disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  {operation === "packaging" ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                  {operation === "packaging" ? "Generando HTML…" : "Guardar HTML + ZIP"}
                </button>
              </div>
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}
