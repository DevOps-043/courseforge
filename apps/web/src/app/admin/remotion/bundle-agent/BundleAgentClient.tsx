"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  CheckCircle2,
  Download,
  ExternalLink,
  FileCode2,
  ImagePlus,
  Loader2,
  PackageCheck,
  Send,
  Settings2,
  Sparkles,
  Trash2,
  User,
} from "lucide-react";
import { uploadWithSignedUrl } from "@/lib/storage-upload";
import {
  BUNDLE_TEMPLATE_FAMILY_OPTIONS,
  type BundleAgentVisualReference,
  type BundleTemplateFamily,
} from "@/domains/production/bundle-agent/types";

interface ConversationState {
  conversation: { id: string; title: string; status: string; template_id: string | null } | null;
  messages: Array<{
    id: string;
    role: string;
    content_redacted: string;
    metadata?: {
      visualReferences?: BundleAgentVisualReference[];
      source?: string;
      model?: string;
      warning?: string | null;
      specId?: string;
    } | null;
    created_at: string;
  }>;
  specs: Array<{ id: string; version_number: number; spec_json: Record<string, unknown>; spec_hash: string }>;
  generationRuns: Array<{
    id: string;
    status: string;
    bundle_storage_path: string | null;
    error_sanitized: string | null;
    design_plan?: Record<string, unknown> | null;
    visual_fingerprint?: Record<string, unknown> | null;
    similarity_guard_result?: Record<string, unknown> | null;
  }>;
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

interface BundleDesignTokens {
  accent: string;
  background: string;
  muted: string;
  surface: string;
  text: string;
}

interface BundleModifiers {
  durationFrames: number;
  fps: number;
  height: number;
  width: number;
}

const DEFAULT_BUNDLE_TOKENS: BundleDesignTokens = {
  accent: "#00D4B3",
  background: "#05070B",
  muted: "#CBD5E1",
  surface: "#111827",
  text: "#F8FAFC",
};

const DEFAULT_BUNDLE_MODIFIERS: BundleModifiers = {
  durationFrames: 150,
  fps: 30,
  height: 1080,
  width: 1920,
};

const BUNDLE_COLOR_FIELDS: Array<{ key: keyof BundleDesignTokens; label: string }> = [
  { key: "background", label: "Fondo" },
  { key: "surface", label: "Superficie" },
  { key: "accent", label: "Acento" },
  { key: "text", label: "Texto" },
  { key: "muted", label: "Secundario" },
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

function formatDesignPlanSummary(spec: Record<string, unknown> | undefined) {
  const plan = asRecord(spec?.designPlan);
  if (!plan) return null;

  return {
    family: typeof plan.templateFamily === "string" ? plan.templateFamily : null,
    layout: typeof plan.layoutStrategy === "string" ? plan.layoutStrategy : null,
    transition: typeof plan.transition === "string" ? plan.transition : null,
    background: typeof plan.backgroundTreatment === "string" ? plan.backgroundTreatment : null,
  };
}

function formatTimelinePlanSummary(spec: Record<string, unknown> | undefined) {
  const plan = asRecord(spec?.timelinePlan);
  const main = asRecord(plan?.main);
  const opening = asRecord(plan?.opening);
  const ending = asRecord(plan?.ending);
  const overlays = Array.isArray(plan?.overlays) ? plan.overlays : [];
  if (!plan || !main) return null;

  return {
    mode: typeof plan.mode === "string" ? plan.mode : null,
    transition: typeof plan.transition === "string" ? plan.transition : null,
    mainAsset: typeof main.asset === "string" ? main.asset : null,
    mainLayout: typeof main.layout === "string" ? main.layout : null,
    openingFrames: typeof opening?.durationFrames === "number" ? opening.durationFrames : null,
    endingFrames: typeof ending?.durationFrames === "number" ? ending.durationFrames : null,
    overlayCount: overlays.length,
  };
}

function formatSimilarityGuard(run: ConversationState["generationRuns"][number] | undefined) {
  const guard = asRecord(run?.similarity_guard_result);
  if (!guard) return null;

  const score = typeof guard.highestScore === "number" ? Math.round(guard.highestScore * 100) : null;
  const decision = typeof guard.decision === "string" ? guard.decision : null;
  const traits = Array.isArray(guard.matchingTraits)
    ? guard.matchingTraits.filter((trait): trait is string => typeof trait === "string").slice(0, 4)
    : [];

  return { score, decision, traits };
}

function getSpecDesignTokens(spec: Record<string, unknown> | undefined): BundleDesignTokens {
  const creativeBrief = asRecord(spec?.creativeBrief);
  const colorTokens = asRecord(creativeBrief?.colorTokens);
  const defaultProps = asRecord(spec?.defaultProps);
  const propTokens = asRecord(defaultProps?.designTokens);

  return {
    accent: String(colorTokens?.accent || defaultProps?.accentColor || propTokens?.accentColor || DEFAULT_BUNDLE_TOKENS.accent),
    background: String(colorTokens?.background || propTokens?.backgroundColor || DEFAULT_BUNDLE_TOKENS.background),
    muted: String(colorTokens?.muted || propTokens?.mutedTextColor || DEFAULT_BUNDLE_TOKENS.muted),
    surface: String(colorTokens?.surface || propTokens?.surfaceColor || DEFAULT_BUNDLE_TOKENS.surface),
    text: String(colorTokens?.text || propTokens?.textColor || DEFAULT_BUNDLE_TOKENS.text),
  };
}

function getSpecModifiers(spec: Record<string, unknown> | undefined): BundleModifiers {
  return {
    durationFrames: typeof spec?.durationFrames === "number" ? spec.durationFrames : DEFAULT_BUNDLE_MODIFIERS.durationFrames,
    fps: typeof spec?.fps === "number" ? spec.fps : DEFAULT_BUNDLE_MODIFIERS.fps,
    height: typeof spec?.height === "number" ? spec.height : DEFAULT_BUNDLE_MODIFIERS.height,
    width: typeof spec?.width === "number" ? spec.width : DEFAULT_BUNDLE_MODIFIERS.width,
  };
}

function buildBundleOverrides(
  templateFamily: BundleTemplateFamily | "auto",
  designTokens: BundleDesignTokens,
  modifiers: BundleModifiers,
) {
  return {
    ...(templateFamily === "auto" ? {} : { templateFamily }),
    creativeBrief: {
      colorTokens: {
        accent: designTokens.accent,
        background: designTokens.background,
        muted: designTokens.muted,
        surface: designTokens.surface,
        text: designTokens.text,
      },
    },
    defaultProps: {
      accentColor: designTokens.accent,
      designTokens: {
        accentColor: designTokens.accent,
        backgroundColor: designTokens.background,
        mutedTextColor: designTokens.muted,
        surfaceColor: designTokens.surface,
        textColor: designTokens.text,
      },
    },
    durationFrames: modifiers.durationFrames,
    fps: modifiers.fps,
    height: modifiers.height,
    width: modifiers.width,
  };
}

function BundleLivePreview({
  modifiers,
  spec,
  templateFamily,
  tokens,
}: {
  modifiers: BundleModifiers;
  spec?: Record<string, unknown>;
  templateFamily: BundleTemplateFamily | "auto";
  tokens: BundleDesignTokens;
}) {
  const defaultProps = asRecord(spec?.defaultProps);
  const title = normalizeLegacySofliaName(String(defaultProps?.title || spec?.title || "SofLIA Bundle"));
  const subtitle = normalizeLegacySofliaName(String(defaultProps?.subtitle || "Plantilla visual para lecciones con soporte multimedia."));
  const currentFamily = templateFamily === "auto"
    ? String(spec?.templateFamily || "auto")
    : templateFamily;
  const previewStyle = {
    "--bundle-preview-accent": tokens.accent,
    "--bundle-preview-background": tokens.background,
    "--bundle-preview-muted": tokens.muted,
    "--bundle-preview-surface": tokens.surface,
    "--bundle-preview-text": tokens.text,
    aspectRatio: `${Math.max(1, modifiers.width)} / ${Math.max(1, modifiers.height)}`,
  } as CSSProperties;

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="font-semibold text-slate-950">Preview</h2>
          <p className="text-xs text-slate-500">{modifiers.width}x{modifiers.height} - {modifiers.fps} fps</p>
        </div>
        <span className="rounded-full border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-500">
          {currentFamily}
        </span>
      </div>
      <div className="p-4">
        <div
          className="relative overflow-hidden rounded-lg border border-black/10 bg-[var(--bundle-preview-background)] shadow-sm"
          style={previewStyle}
        >
          <div className="absolute inset-0 opacity-30" style={{
            backgroundImage: `linear-gradient(90deg, ${tokens.surface} 1px, transparent 1px), linear-gradient(0deg, ${tokens.surface} 1px, transparent 1px)`,
            backgroundSize: "32px 32px",
          }} />
          <div className="absolute left-[7%] top-[12%] w-[46%]">
            <div className="mb-2 h-1.5 w-14 rounded-full bg-[var(--bundle-preview-accent)]" />
            <h3 className="line-clamp-2 text-[clamp(18px,2.2vw,30px)] font-black leading-tight text-[var(--bundle-preview-text)]">
              {title}
            </h3>
            <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--bundle-preview-muted)]">
              {subtitle}
            </p>
          </div>
          <div className="absolute bottom-[12%] left-[7%] h-[24%] w-[28%] rounded-lg border border-white/10 bg-[var(--bundle-preview-surface)] p-3 shadow-xl">
            <div className="h-full rounded-md bg-gradient-to-br from-white/20 to-transparent" />
            <span className="absolute bottom-2 left-3 text-[9px] font-bold uppercase tracking-wide text-[var(--bundle-preview-muted)]">Avatar</span>
          </div>
          <div className="absolute right-[7%] top-[14%] h-[36%] w-[34%] rounded-lg bg-white p-3 shadow-xl">
            <div className="mb-3 h-1.5 w-16 rounded-full bg-[var(--bundle-preview-accent)]" />
            <div className="space-y-2">
              <div className="h-2 w-3/4 rounded bg-slate-900" />
              <div className="h-2 w-1/2 rounded bg-[var(--bundle-preview-accent)]" />
              <div className="h-2 w-2/3 rounded bg-slate-200" />
            </div>
            <span className="absolute bottom-2 right-3 text-[9px] font-bold uppercase tracking-wide text-slate-400">Slides</span>
          </div>
          <div className="absolute bottom-[14%] right-[7%] h-[24%] w-[34%] rounded-lg border border-white/10 bg-[var(--bundle-preview-surface)] p-3 shadow-xl">
            <div className="flex h-full items-end gap-2">
              {[45, 70, 38, 88].map((height, index) => (
                <span
                  key={`${height}-${index}`}
                  className="flex-1 rounded-t"
                  style={{
                    backgroundColor: index % 2 === 0 ? tokens.accent : tokens.muted,
                    height: `${height}%`,
                  }}
                />
              ))}
            </div>
            <span className="absolute bottom-2 right-3 text-[9px] font-bold uppercase tracking-wide text-[var(--bundle-preview-muted)]">B-roll</span>
          </div>
        </div>
      </div>
    </section>
  );
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

function normalizeLegacySofliaName(value: string) {
  return value
    .replace(/ZofLIA/g, "SofLIA")
    .replace(/Zoflia/g, "SofLIA")
    .replace(/zoflia/g, "soflia");
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

export function BundleAgentClient({
  initialTemplateId = null,
}: {
  initialTemplateId?: string | null;
}) {
  const pathname = usePathname();
  const templateId = initialTemplateId;
  const [state, setState] = useState<ConversationState>(EMPTY_STATE);
  const [title, setTitle] = useState("Nuevo bundle de video");
  const [templateFamily, setTemplateFamily] = useState<BundleTemplateFamily | "auto">("auto");
  const [designTokens, setDesignTokens] = useState<BundleDesignTokens>(DEFAULT_BUNDLE_TOKENS);
  const [modifiers, setModifiers] = useState<BundleModifiers>(DEFAULT_BUNDLE_MODIFIERS);
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
  const designPlanSummary = useMemo(() => formatDesignPlanSummary(latestSpec?.spec_json), [latestSpec]);
  const timelinePlanSummary = useMemo(() => formatTimelinePlanSummary(latestSpec?.spec_json), [latestSpec]);
  const generationMetadata = useMemo(() => [...state.messages]
    .reverse()
    .find((item) => item.role === "TOOL" && item.metadata?.specId === latestSpec?.id)
    ?.metadata || null, [latestSpec?.id, state.messages]);
  const similarityGuardSummary = useMemo(() => formatSimilarityGuard(latestRun), [latestRun]);
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
    if (payload.conversation?.title) {
      setTitle(normalizeLegacySofliaName(payload.conversation.title));
    }
    const loadedFamily = payload.specs?.[0]?.spec_json?.templateFamily;
    if (typeof loadedFamily === "string" && BUNDLE_TEMPLATE_FAMILY_OPTIONS.some((option) => option.id === loadedFamily)) {
      setTemplateFamily(loadedFamily as BundleTemplateFamily);
    }
    const loadedSpec = payload.specs?.[0]?.spec_json as Record<string, unknown> | undefined;
    if (loadedSpec) {
      setDesignTokens(getSpecDesignTokens(loadedSpec));
      setModifiers(getSpecModifiers(loadedSpec));
    }
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
      body: JSON.stringify({ artifactKind: "video_bundle", title: normalizeLegacySofliaName(title), templateId }),
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
        body: JSON.stringify({ artifactKind: "video_bundle", title: normalizeLegacySofliaName(title), templateId }),
      }));
      setTitle(normalizeLegacySofliaName(payload.conversation.title || title));
      await refresh(payload.conversation.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  async function requestSpec(conversationId: string) {
    await readJson(await fetch(`/api/admin/remotion/bundle-agent/conversations/${conversationId}/specs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        artifactKind: "video_bundle",
        overrides: buildBundleOverrides(templateFamily, designTokens, modifiers),
      }),
    }));
  }

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
      await requestSpec(conversationId);
      await refresh(conversationId);
    });
  }

  async function generateVersion() {
    await run(async () => {
      const conversationId = await ensureConversation();
      await readJson(await fetch(`/api/admin/remotion/bundle-agent/conversations/${conversationId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artifactKind: "video_bundle" }),
      }));
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
    <main className="mx-auto flex h-[calc(100vh-84px)] max-w-7xl flex-col gap-3 overflow-hidden p-4">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Link
            href={templatesHref}
            className="mb-3 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 shadow-sm transition hover:border-[#00D4B3]/40 hover:text-[#009688]"
          >
            <ArrowLeft size={16} />
            Regresar a plantillas
          </Link>
          <p className="text-sm font-medium text-slate-500">Produccion visual</p>
          <h1 className="text-2xl font-semibold text-slate-950">SofLIA Bundle Agent</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            {isTemplateScoped
              ? "Edita este bundle manteniendo su conversacion, specs y versiones generadas dentro del mismo historial auditable."
              : "Conversa con SofLIA para definir una plantilla de video. El agente genera una spec auditable y un paquete ZIP validado."}
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

      <section className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(390px,0.9fr)_minmax(420px,0.62fr)]">
        <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
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

          <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/70 px-4 py-4">
            {state.messages.length === 0 ? (
              <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-[#00D4B3]/10 text-[#009688]">
                  <Sparkles size={24} />
                </div>
                <h2 className="text-lg font-semibold text-slate-950">Cuentame que bundle quieres crear</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Describe estilo, ritmo, assets, formato, tono visual o props esperadas. La conversacion se crea automaticamente al enviar tu primer mensaje.
                </p>
                <div className="mt-5 grid w-full gap-2">
                  {QUICK_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => useQuickPrompt(prompt)}
                      className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-left text-sm text-slate-700 transition hover:border-[#00D4B3]/50 hover:bg-[#00D4B3]/5"
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
                        <p className="whitespace-pre-wrap leading-6">{normalizeLegacySofliaName(item.content_redacted)}</p>
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

          <form onSubmit={sendCurrentMessage} className="border-t border-slate-100 bg-white p-3">
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
            <div className="flex gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2 focus-within:border-[#00D4B3]">
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

        <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          <BundleLivePreview
            modifiers={modifiers}
            spec={latestSpec?.spec_json}
            templateFamily={templateFamily}
            tokens={designTokens}
          />

          <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
              <Settings2 className="text-[#009688]" size={18} />
              <h2 className="font-semibold text-slate-950">Modificadores</h2>
            </div>
            <div className="space-y-3 p-4">
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="template-family">
                Familia visual
                <select
                  id="template-family"
                  value={templateFamily}
                  onChange={(event) => setTemplateFamily(event.target.value as BundleTemplateFamily | "auto")}
                  disabled={busy}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm normal-case tracking-normal text-slate-700 outline-none transition focus:border-[#00D4B3] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="auto">Automatica segun la direccion creativa</option>
                  {BUNDLE_TEMPLATE_FAMILY_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label} - {option.description}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-2">
                {BUNDLE_COLOR_FIELDS.map((field) => (
                  <label key={field.key} className="text-xs font-semibold text-slate-600">
                    {field.label}
                    <div className="mt-1 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-1.5">
                      <input
                        type="color"
                        value={designTokens[field.key]}
                        onChange={(event) => setDesignTokens((current) => ({
                          ...current,
                          [field.key]: event.target.value.toUpperCase(),
                        }))}
                        className="h-7 w-8 cursor-pointer border-0 bg-transparent p-0"
                      />
                      <span className="min-w-0 truncate font-mono text-[11px] text-slate-700">
                        {designTokens[field.key]}
                      </span>
                    </div>
                  </label>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs font-semibold text-slate-600">
                  Duracion
                  <input
                    type="number"
                    min={30}
                    max={900}
                    step={15}
                    value={modifiers.durationFrames}
                    onChange={(event) => setModifiers((current) => ({
                      ...current,
                      durationFrames: Number(event.target.value),
                    }))}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-[#00D4B3]"
                  />
                </label>
                <label className="text-xs font-semibold text-slate-600">
                  FPS
                  <input
                    type="number"
                    min={12}
                    max={60}
                    step={1}
                    value={modifiers.fps}
                    onChange={(event) => setModifiers((current) => ({
                      ...current,
                      fps: Number(event.target.value),
                    }))}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-[#00D4B3]"
                  />
                </label>
                <label className="text-xs font-semibold text-slate-600">
                  Ancho
                  <input
                    type="number"
                    min={320}
                    max={3840}
                    step={160}
                    value={modifiers.width}
                    onChange={(event) => setModifiers((current) => ({
                      ...current,
                      width: Number(event.target.value),
                    }))}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-[#00D4B3]"
                  />
                </label>
                <label className="text-xs font-semibold text-slate-600">
                  Alto
                  <input
                    type="number"
                    min={240}
                    max={2160}
                    step={90}
                    value={modifiers.height}
                    onChange={(event) => setModifiers((current) => ({
                      ...current,
                      height: Number(event.target.value),
                    }))}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-[#00D4B3]"
                  />
                </label>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Bot className="text-[#009688]" size={20} />
              <h2 className="font-semibold text-slate-950">Pasos del agente</h2>
            </div>
            <div className="grid gap-3">
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
                  <p className="mt-1 font-medium text-slate-900">{normalizeLegacySofliaName(String(latestSpec.spec_json.title || title))}</p>
                  {specSummary ? <p className="mt-1 text-slate-600">{specSummary}</p> : null}
                </div>
                {generationMetadata ? (
                  <div className={`rounded-xl border p-3 ${generationMetadata.source === "deterministic_fallback"
                    ? "border-amber-300 bg-amber-50 text-amber-900"
                    : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>
                    <div className="flex items-start gap-2">
                      {generationMetadata.source === "deterministic_fallback" ? <AlertTriangle className="mt-0.5 shrink-0" size={16} /> : <CheckCircle2 className="mt-0.5 shrink-0" size={16} />}
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide">
                          Origen: {generationMetadata.source || "desconocido"}
                        </p>
                        <p className="mt-1 text-xs">Modelo: {generationMetadata.model || "no registrado"}</p>
                        {generationMetadata.warning ? (
                          <p className="mt-2 break-words text-xs leading-5">{generationMetadata.warning}</p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}
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
                {designPlanSummary ? (
                  <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Plan compilado</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {designPlanSummary.family || "Familia sin resolver"}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      Layout: {designPlanSummary.layout || "—"} · Fondo: {designPlanSummary.background || "—"} · Transición: {designPlanSummary.transition || "—"}
                    </p>
                  </div>
                ) : null}
                {timelinePlanSummary ? (
                  <div className="rounded-xl border border-cyan-200 bg-cyan-50/70 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-cyan-800">Secuencia temporal</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {timelinePlanSummary.mode || "continuous"} · {timelinePlanSummary.mainAsset || "media"} / {timelinePlanSummary.mainLayout || "primary"}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      Apertura: {timelinePlanSummary.openingFrames ?? 0} frames · Cierre: {timelinePlanSummary.endingFrames ?? 0} frames · Transición: {timelinePlanSummary.transition || "—"} · Overlays: {timelinePlanSummary.overlayCount}
                    </p>
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
                    {normalizeLegacySofliaName(JSON.stringify(latestSpec.spec_json, null, 2))}
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
                {similarityGuardSummary ? (
                  <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${similarityGuardSummary.decision === "block"
                    ? "border-red-200 bg-red-50 text-red-700"
                    : similarityGuardSummary.decision === "review"
                      ? "border-amber-200 bg-amber-50 text-amber-800"
                      : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
                    <p className="font-semibold">
                      Guardia de similitud: {similarityGuardSummary.decision || "allow"}
                      {similarityGuardSummary.score !== null ? ` (${similarityGuardSummary.score}%)` : ""}
                    </p>
                    {similarityGuardSummary.traits.length > 0 ? (
                      <p className="mt-1">Coinciden: {similarityGuardSummary.traits.join(", ")}</p>
                    ) : null}
                  </div>
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
