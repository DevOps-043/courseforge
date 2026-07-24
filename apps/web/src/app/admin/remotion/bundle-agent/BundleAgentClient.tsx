"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Bot, CheckCircle2, Download, ExternalLink, FileCode2, ImagePlus, Loader2, PackageCheck, Send, Sparkles, Trash2, User } from "lucide-react";
import { uploadWithSignedUrl } from "@/lib/storage-upload";
import type { BundleAgentVisualReference } from "@/domains/production/bundle-agent/types";

interface ConversationState {
  conversation: { id: string; title: string; status: string; template_id: string | null } | null;
  messages: Array<{
    id: string;
    role: string;
    content_redacted: string;
    metadata?: { visualReferences?: BundleAgentVisualReference[] } | null;
    created_at: string;
  }>;
  specs: Array<{ id: string; version_number: number; spec_json: Record<string, unknown>; spec_hash: string }>;
  generationRuns: Array<{ id: string; status: string; bundle_storage_path: string | null; error_sanitized: string | null }>;
  versionLinks: Array<{ id: string; change_summary: string | null; template_version?: { id: string; status: string; build_status: string } }>;
}

const EMPTY_STATE: ConversationState = {
  conversation: null,
  messages: [],
  specs: [],
  generationRuns: [],
  versionLinks: [],
};

const QUICK_PROMPTS = [
  "Quiero una plantilla elegante para videos de lecciones, con slides, voz y transiciones suaves.",
  "Necesito un template dinamico para cursos corporativos, con portada, progreso y cierre.",
  "Disena una plantilla sobria para videos teoricos con texto grande, fondo limpio y ritmo pausado.",
];

const VISUAL_REFERENCE_LIMIT = 6;
const VISUAL_REFERENCE_MAX_BYTES = 75 * 1024 * 1024;

async function readJson(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return payload;
}

function roleLabel(role: string) {
  if (role === "USER") return "Tu";
  if (role === "TOOL") return "Sistema";
  return "SofLIA";
}

function statusLabel(status?: string | null) {
  switch (status) {
    case "DRAFTING":
      return "Conversando";
    case "READY_FOR_GENERATION":
      return "Spec lista";
    case "GENERATING":
      return "Generando";
    case "VERSION_PENDING_REVIEW":
      return "Pendiente de revision";
    case "ACTIVE":
      return "Activa";
    case "FAILED":
      return "Requiere atencion";
    default:
      return "Sin iniciar";
  }
}

function formatSpecSummary(spec: Record<string, unknown> | undefined) {
  if (!spec) return null;
  return [
    typeof spec.visualStyle === "string" ? spec.visualStyle : null,
    typeof spec.durationFrames === "number" ? `${spec.durationFrames} frames` : null,
    typeof spec.fps === "number" ? `${spec.fps} fps` : null,
  ].filter(Boolean).join(" - ");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function formatCreativeBriefSummary(spec: Record<string, unknown> | undefined) {
  const brief = asRecord(spec?.creativeBrief);
  if (!brief) return null;

  const similarityCheck = asRecord(brief.similarityCheck);
  const visualVariants = Array.isArray(brief.visualVariants) ? brief.visualVariants : [];
  const variantNames = visualVariants
    .map((variant) => asRecord(variant)?.name)
    .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
    .slice(0, 3);
  const differentiators = Array.isArray(similarityCheck?.differentiators)
    ? similarityCheck.differentiators.filter((item): item is string => typeof item === "string").slice(0, 4)
    : [];

  return {
    directionName: typeof brief.directionName === "string" ? brief.directionName : "Direccion creativa",
    layoutSystem: typeof brief.layoutSystem === "string" ? brief.layoutSystem : null,
    motionLanguage: typeof brief.motionLanguage === "string" ? brief.motionLanguage : null,
    variantNames,
    differentiators,
  };
}

function getReferenceType(file: File): BundleAgentVisualReference["type"] | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return null;
}

function sanitizeUploadFileName(fileName: string) {
  const safeName = fileName
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^[._-]+/, "")
    .slice(0, 140);

  return safeName || "visual-reference";
}

function formatFileSize(sizeBytes: number) {
  if (sizeBytes >= 1024 * 1024) return `${Math.round(sizeBytes / (1024 * 1024))} MB`;
  return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
}

function rgbToHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue]
    .map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0"))
    .join("")}`.toUpperCase();
}

function getSaturation(red: number, green: number, blue: number) {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  return max === 0 ? 0 : (max - min) / max;
}

function colorDistance(left: [number, number, number], right: [number, number, number]) {
  return Math.sqrt(
    (left[0] - right[0]) ** 2 +
    (left[1] - right[1]) ** 2 +
    (left[2] - right[2]) ** 2,
  );
}

function loadImageElement(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`No se pudo analizar la imagen ${file.name}.`));
    };
    image.src = url;
  });
}

function averageSamples(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  predicate: (x: number, y: number) => boolean,
): [number, number, number] {
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!predicate(x, y)) continue;
      const offset = (y * width + x) * 4;
      red += data[offset];
      green += data[offset + 1];
      blue += data[offset + 2];
      count += 1;
    }
  }

  if (count === 0) return [0, 0, 0];
  return [red / count, green / count, blue / count];
}

function findDivider(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  targetColor: [number, number, number],
  orientation: "vertical" | "horizontal",
) {
  const outerMargin = orientation === "vertical" ? width * 0.08 : height * 0.08;
  const limit = orientation === "vertical" ? width : height;
  const span = orientation === "vertical" ? height : width;
  let bestIndex = -1;
  let bestScore = 0;

  for (let index = Math.round(outerMargin); index < limit - outerMargin; index += 1) {
    let matches = 0;
    for (let position = 0; position < span; position += 1) {
      const x = orientation === "vertical" ? index : position;
      const y = orientation === "vertical" ? position : index;
      const offset = (y * width + x) * 4;
      const pixel: [number, number, number] = [data[offset], data[offset + 1], data[offset + 2]];
      if (colorDistance(pixel, targetColor) < 82 && getSaturation(pixel[0], pixel[1], pixel[2]) > 0.25) {
        matches += 1;
      }
    }

    const score = matches / span;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestScore > (orientation === "vertical" ? 0.45 : 0.2)
    ? { ratio: bestIndex / limit, score: bestScore }
    : null;
}

async function analyzeImageReference(file: File) {
  try {
    const image = await loadImageElement(file);
    const maxWidth = 640;
    const scale = Math.min(1, maxWidth / image.naturalWidth);
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;

    context.drawImage(image, 0, 0, width, height);
    const data = context.getImageData(0, 0, width, height).data;
    const band = Math.max(2, Math.round(Math.min(width, height) * 0.025));
    const edgeColor = averageSamples(data, width, height, (x, y) => (
      x < band || x >= width - band || y < band || y >= height - band
    ));
    const edgeColorHex = rgbToHex(edgeColor[0], edgeColor[1], edgeColor[2]);
    const verticalDivider = findDivider(data, width, height, edgeColor, "vertical");
    const horizontalDivider = findDivider(data, width, height, edgeColor, "horizontal");
    const hints: string[] = [
      `canvas ${image.naturalWidth}x${image.naturalHeight}`,
      `dominant frame/border color ${edgeColorHex}`,
    ];

    if (verticalDivider) {
      hints.push(`strong vertical divider near ${Math.round(verticalDivider.ratio * 100)}% width`);
    }
    if (horizontalDivider) {
      hints.push(`strong horizontal divider near ${Math.round(horizontalDivider.ratio * 100)}% height`);
    }
    if (verticalDivider && horizontalDivider) {
      hints.push("wireframe structure: large left region plus right column split into top and bottom regions");
      hints.push("map left region to avatar, top-right to slides, bottom-right to B-roll when those assets are requested");
    }

    return `Automatic visual reference analysis: ${hints.join("; ")}. Treat detected frame color and region divisions as hard layout constraints when the user asks to use the reference structure.`;
  } catch {
    return null;
  }
}

export function BundleAgentClient({ initialTemplateId = null }: { initialTemplateId?: string | null }) {
  const pathname = usePathname();
  const templateId = initialTemplateId;
  const [state, setState] = useState<ConversationState>(EMPTY_STATE);
  const [title, setTitle] = useState("Nuevo bundle de video");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadingReferences, setUploadingReferences] = useState(false);
  const [visualReferences, setVisualReferences] = useState<BundleAgentVisualReference[]>([]);
  const [error, setError] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const latestSpec = state.specs[0];
  const latestRun = state.generationRuns[0];
  const latestVersion = state.versionLinks[0]?.template_version;
  const isTemplateScoped = Boolean(templateId || state.conversation?.template_id);
  const hasRequestedTemplateConversation = !templateId || state.conversation?.template_id === templateId;
  const specSummary = useMemo(() => formatSpecSummary(latestSpec?.spec_json), [latestSpec]);
  const creativeBriefSummary = useMemo(() => formatCreativeBriefSummary(latestSpec?.spec_json), [latestSpec]);
  const baseBundleHref = "/api/admin/remotion/bundle-agent/base-bundle";
  const templatesHref = useMemo(() => {
    const normalizedPath = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
    return normalizedPath.replace(/\/admin\/remotion\/bundle-agent$/, "/admin/templates");
  }, [pathname]);
  const previewHref = useMemo(() => {
    if (!state.conversation?.id || !latestSpec?.id) return null;
    const basePath = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
    const params = new URLSearchParams({
      conversationId: state.conversation.id,
      specId: latestSpec.id,
    });
    return `${basePath}/preview?${params.toString()}`;
  }, [latestSpec?.id, pathname, state.conversation?.id]);
  const generatedBundleHref = useMemo(() => {
    if (!state.conversation?.id || !latestRun?.id || !latestRun.bundle_storage_path) return null;
    return `/api/admin/remotion/bundle-agent/conversations/${state.conversation.id}/runs/${latestRun.id}/download`;
  }, [latestRun?.bundle_storage_path, latestRun?.id, state.conversation?.id]);

  async function refresh(conversationId = state.conversation?.id) {
    if (!conversationId) return;
    const payload = await readJson(await fetch(`/api/admin/remotion/bundle-agent/conversations/${conversationId}`, { cache: "no-store" }));
    setState({
      conversation: payload.conversation,
      messages: payload.messages || [],
      specs: payload.specs || [],
      generationRuns: payload.generationRuns || [],
      versionLinks: payload.versionLinks || [],
    });
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function ensureConversation() {
    if (state.conversation && hasRequestedTemplateConversation) return state.conversation.id;

    const payload = await readJson(await fetch("/api/admin/remotion/bundle-agent/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, templateId }),
    }));
    await refresh(payload.conversation.id);
    return payload.conversation.id as string;
  }

  useEffect(() => {
    if (!templateId || state.conversation?.template_id === templateId) return;

    setState(EMPTY_STATE);
    void run(async () => {
      const payload = await readJson(await fetch("/api/admin/remotion/bundle-agent/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, templateId }),
      }));
      setTitle(payload.conversation.title || title);
      await refresh(payload.conversation.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  async function sendCurrentMessage(event?: FormEvent) {
    event?.preventDefault();
    const trimmed = message.trim();
    if ((!trimmed && visualReferences.length === 0) || busy || uploadingReferences) return;

    await run(async () => {
      const conversationId = await ensureConversation();
      await readJson(await fetch(`/api/admin/remotion/bundle-agent/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: "USER",
          content: trimmed || "Adjunto referencias visuales para orientar el estilo del bundle.",
          metadata: visualReferences.length > 0 ? { visualReferences } : {},
        }),
      }));
      setMessage("");
      setVisualReferences([]);
      await refresh(conversationId);
    });
  }

  async function generateSpec() {
    await run(async () => {
      const conversationId = await ensureConversation();
      await readJson(await fetch(`/api/admin/remotion/bundle-agent/conversations/${conversationId}/specs`, { method: "POST" }));
      await refresh(conversationId);
    });
  }

  async function generateVersion() {
    await run(async () => {
      const conversationId = await ensureConversation();
      await readJson(await fetch(`/api/admin/remotion/bundle-agent/conversations/${conversationId}/generate`, { method: "POST" }));
      await refresh(conversationId);
    });
  }

  function useQuickPrompt(prompt: string) {
    setMessage(prompt);
    composerRef.current?.focus();
  }

  async function uploadSelectedReferences(files: FileList | null) {
    if (!files || files.length === 0) return;

    setUploadingReferences(true);
    setError(null);
    try {
      const availableSlots = VISUAL_REFERENCE_LIMIT - visualReferences.length;
      if (availableSlots <= 0) {
        throw new Error(`Puedes adjuntar hasta ${VISUAL_REFERENCE_LIMIT} referencias visuales por mensaje.`);
      }

      const selectedFiles = Array.from(files).slice(0, availableSlots);
      const uploadedReferences: BundleAgentVisualReference[] = [];

      for (const file of selectedFiles) {
        const referenceType = getReferenceType(file);
        if (!referenceType) {
          throw new Error(`Formato no permitido: ${file.name}. Usa imagenes o videos.`);
        }

        if (file.size <= 0 || file.size > VISUAL_REFERENCE_MAX_BYTES) {
          throw new Error(`"${file.name}" supera el limite de 75 MB.`);
        }

        const id = crypto.randomUUID();
        const safeFileName = sanitizeUploadFileName(file.name);
        const visualSummary = referenceType === "image" ? await analyzeImageReference(file) : null;
        const uploaded = await uploadWithSignedUrl(
          "production-assets",
          `bundle-agent-references/${id}/${safeFileName}`,
          file,
          {
            purpose: "bundle-agent-reference",
            contentType: file.type,
            fileSizeBytes: file.size,
            upsert: false,
          },
        );

        uploadedReferences.push({
          id,
          type: referenceType,
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          storagePath: uploaded.path,
          publicUrl: uploaded.publicUrl,
          ...(visualSummary ? { visualSummary } : {}),
        });
      }

      setVisualReferences((current) => [...current, ...uploadedReferences].slice(0, VISUAL_REFERENCE_LIMIT));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploadingReferences(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function updateReferenceNote(referenceId: string, note: string) {
    setVisualReferences((current) => current.map((reference) => (
      reference.id === referenceId ? { ...reference, note: note.slice(0, 500) } : reference
    )));
  }

  function removeReference(referenceId: string) {
    setVisualReferences((current) => current.filter((reference) => reference.id !== referenceId));
  }

  return (
    <main className="mx-auto flex h-[calc(100vh-96px)] max-w-7xl flex-col gap-5 p-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Link
            href={templatesHref}
            className="mb-4 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 shadow-sm transition hover:border-[#00D4B3]/40 hover:text-[#009688]"
          >
            <ArrowLeft size={16} />
            Regresar a plantillas
          </Link>
          <p className="text-sm font-medium text-slate-500">Produccion visual</p>
          <h1 className="text-3xl font-semibold text-slate-950">SofLIA Bundle Agent</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            {isTemplateScoped
              ? "Edita este bundle manteniendo su conversacion, specs y versiones generadas dentro del mismo historial auditable."
              : "Conversa con SofLIA para definir una plantilla de video. El agente genera una spec auditable y un ZIP borrador que siempre pasa por validacion y revision humana."}
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 shadow-sm">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          {statusLabel(state.conversation?.status)}
        </div>
      </header>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      ) : null}

      <section className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="conversation-title">
              Nombre de la conversacion
            </label>
            <input
              id="conversation-title"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none transition focus:border-[#00D4B3] focus:bg-white disabled:text-slate-500"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={Boolean(state.conversation)}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/70 px-5 py-6">
            {state.messages.length === 0 ? (
              <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center text-center">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#00D4B3]/10 text-[#009688]">
                  <Sparkles size={26} />
                </div>
                <h2 className="text-2xl font-semibold text-slate-950">Cuentame que plantilla quieres crear</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Describe estilo, ritmo, assets, formato, tono visual o props esperadas. La conversacion se crea automaticamente al enviar tu primer mensaje.
                </p>
                <div className="mt-6 grid w-full gap-2">
                  {QUICK_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => useQuickPrompt(prompt)}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm text-slate-700 transition hover:border-[#00D4B3]/50 hover:bg-[#00D4B3]/5"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mx-auto flex max-w-3xl flex-col gap-4">
                {state.messages.map((item) => {
                  const isUser = item.role === "USER";
                  const isTool = item.role === "TOOL";
                  return (
                    <div key={item.id} className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
                      {!isUser ? (
                        <div className={`mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${isTool ? "bg-slate-200 text-slate-600" : "bg-[#00D4B3]/10 text-[#009688]"}`}>
                          {isTool ? <FileCode2 size={18} /> : <Bot size={18} />}
                        </div>
                      ) : null}
                      <div className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm shadow-sm ${isUser ? "bg-blue-600 text-white" : isTool ? "border border-slate-200 bg-white text-slate-700" : "border border-slate-100 bg-white text-slate-800"}`}>
                        <p className={`mb-1 text-xs font-semibold ${isUser ? "text-blue-100" : "text-slate-500"}`}>{roleLabel(item.role)}</p>
                        <p className="whitespace-pre-wrap leading-6">{item.content_redacted}</p>
                        {item.metadata?.visualReferences?.length ? (
                          <div className={`mt-3 grid gap-1 text-xs ${isUser ? "text-blue-100" : "text-slate-500"}`}>
                            {item.metadata.visualReferences.map((reference) => (
                              <span key={reference.id} className="truncate">
                                {reference.type === "image" ? "Imagen" : "Video"}: {reference.fileName}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      {isUser ? (
                        <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700">
                          <User size={18} />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {busy ? (
                  <div className="flex items-center gap-3 text-sm text-slate-500">
                    <Loader2 className="animate-spin" size={18} />
                    SofLIA esta trabajando...
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <form onSubmit={sendCurrentMessage} className="border-t border-slate-100 bg-white p-4">
            {visualReferences.length > 0 ? (
              <div className="mb-3 grid gap-2">
                {visualReferences.map((reference) => (
                  <div key={reference.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{reference.fileName}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {reference.type === "image" ? "Imagen" : "Video"} - {formatFileSize(reference.sizeBytes)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeReference(reference.id)}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white hover:text-red-600"
                        title="Quitar referencia"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <input
                      className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none transition focus:border-[#00D4B3]"
                      value={reference.note || ""}
                      onChange={(event) => updateReferenceNote(reference.id, event.target.value)}
                      placeholder="Nota opcional: que debe observar SofLIA de esta referencia"
                    />
                  </div>
                ))}
              </div>
            ) : null}
            <div className="flex gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-2 focus-within:border-[#00D4B3]">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                multiple
                className="hidden"
                onChange={(event) => void uploadSelectedReferences(event.target.files)}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy || uploadingReferences || visualReferences.length >= VISUAL_REFERENCE_LIMIT}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-[#00D4B3]/60 hover:text-[#009688] disabled:cursor-not-allowed disabled:opacity-50"
                title="Adjuntar imagen o video de referencia"
              >
                {uploadingReferences ? <Loader2 className="animate-spin" size={18} /> : <ImagePlus size={18} />}
              </button>
              <textarea
                ref={composerRef}
                className="max-h-36 min-h-12 flex-1 resize-none bg-transparent px-3 py-2 text-sm outline-none"
                placeholder="Escribe como en un chat: estilo, colores, ritmo, assets, comportamiento..."
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendCurrentMessage();
                  }
                }}
              />
              <button
                type="submit"
                disabled={busy || uploadingReferences || (!message.trim() && visualReferences.length === 0)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#00D4B3] text-white transition hover:bg-[#00BFA5] disabled:cursor-not-allowed disabled:bg-slate-300"
                title="Enviar"
              >
                <Send size={18} />
              </button>
            </div>
          </form>
        </div>

        <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Bot className="text-[#009688]" size={20} />
              <h2 className="font-semibold text-slate-950">Pasos del agente</h2>
            </div>
            <div className="grid gap-3">
              <button
                type="button"
                onClick={generateSpec}
                disabled={busy || state.messages.filter((item) => item.role === "USER").length === 0}
                className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-left text-sm transition hover:border-[#00D4B3]/60 hover:bg-[#00D4B3]/5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span>
                  <span className="block font-semibold text-slate-900">Generar spec</span>
                  <span className="text-slate-500">OpenAI/Gemini produce el contrato JSON.</span>
                </span>
                {latestSpec ? <CheckCircle2 className="text-emerald-500" size={20} /> : <Sparkles size={20} />}
              </button>
              <button
                type="button"
                onClick={generateVersion}
                disabled={busy || !latestSpec}
                className="flex items-center justify-between rounded-xl bg-slate-950 px-4 py-3 text-left text-sm text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <span>
                  <span className="block font-semibold">Generar version ZIP</span>
                  <span className="text-slate-300">Crea borrador validado, no aprobado.</span>
                </span>
                <PackageCheck size={20} />
              </button>
              <a
                href={baseBundleHref}
                className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-left text-sm transition hover:border-[#5B21B6]/40 hover:bg-[#5B21B6]/5"
              >
                <span>
                  <span className="block font-semibold text-slate-900">Descargar base ZIP</span>
                  <span className="text-slate-500">Estructura minima para crear bundles por fuera.</span>
                </span>
                <Download size={20} />
              </a>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 font-semibold text-slate-950">Spec actual</h2>
            {latestSpec ? (
              <div className="grid gap-3 text-sm">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Version {latestSpec.version_number}</p>
                  <p className="mt-1 font-medium text-slate-900">{String(latestSpec.spec_json.title || title)}</p>
                  {specSummary ? <p className="mt-1 text-slate-600">{specSummary}</p> : null}
                </div>
                {creativeBriefSummary ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Direccion creativa</p>
                    <p className="mt-1 font-semibold text-slate-900">{creativeBriefSummary.directionName}</p>
                    {creativeBriefSummary.layoutSystem ? (
                      <p className="mt-1 text-xs leading-5 text-slate-600">{creativeBriefSummary.layoutSystem}</p>
                    ) : null}
                    {creativeBriefSummary.motionLanguage ? (
                      <p className="mt-2 text-xs leading-5 text-slate-500">{creativeBriefSummary.motionLanguage}</p>
                    ) : null}
                    {creativeBriefSummary.variantNames.length > 0 ? (
                      <p className="mt-2 text-xs text-slate-500">Variantes: {creativeBriefSummary.variantNames.join(", ")}</p>
                    ) : null}
                    {creativeBriefSummary.differentiators.length > 0 ? (
                      <p className="mt-1 text-xs text-slate-500">Diferencia: {creativeBriefSummary.differentiators.join(" / ")}</p>
                    ) : null}
                  </div>
                ) : null}
                {previewHref ? (
                  <a
                    href={previewHref}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#5B21B6]/30 bg-[#5B21B6]/5 px-4 py-2 text-sm font-semibold text-[#4C1D95] transition hover:border-[#5B21B6]/50 hover:bg-[#5B21B6]/10"
                  >
                    Ver vista estructural
                    <ExternalLink size={16} />
                  </a>
                ) : null}
                <details className="rounded-xl bg-slate-950 p-3 text-xs text-white">
                  <summary className="cursor-pointer text-slate-200">Ver JSON</summary>
                  <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap">
                    {JSON.stringify(latestSpec.spec_json, null, 2)}
                  </pre>
                </details>
              </div>
            ) : (
              <p className="text-sm leading-6 text-slate-600">Aun no hay spec. Primero conversa con SofLIA y luego genera el contrato.</p>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 font-semibold text-slate-950">Version y revision</h2>
            <div className="grid gap-3 text-sm">
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ultima generacion</p>
                <p className="mt-1 font-medium text-slate-900">{latestRun?.status || "Sin ZIP generado"}</p>
                {latestRun?.bundle_storage_path || latestRun?.error_sanitized ? (
                  <p className="mt-1 break-all text-xs text-slate-500">{latestRun.bundle_storage_path || latestRun.error_sanitized}</p>
                ) : null}
                {generatedBundleHref ? (
                  <a
                    href={generatedBundleHref}
                    className="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-[#5B21B6]/40 hover:text-[#4C1D95]"
                  >
                    <Download size={14} />
                    Descargar bundle generado
                  </a>
                ) : null}
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Version de plantilla</p>
                <p className="mt-1 font-medium text-slate-900">{latestVersion?.status || "No registrada"}</p>
                <p className="mt-1 text-xs text-slate-500">Build: {latestVersion?.build_status || "PENDING"}</p>
              </div>
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}
