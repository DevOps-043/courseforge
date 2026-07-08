import crypto from "crypto";
import { bundleAgentSpecSchema, type BundleAgentSpec } from "./types";

function slugifyCompositionId(value: string) {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^\w\s.:-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/_+/g, "-")
    .slice(0, 72);

  return /^[A-Za-z0-9]/.test(normalized) ? normalized : "soflia-template";
}

function isGenericTitle(value?: string | null) {
  if (!value) return true;
  const normalized = value.trim().toLowerCase();
  return normalized === "nuevo bundle remotion" || normalized === "soflia remotion bundle";
}

function extractRequirements(userText: string) {
  const bulletLines = userText
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter((line) => line.length > 0 && !/^necesito que generes/i.test(line));

  if (bulletLines.length > 0) {
    return bulletLines;
  }

  return userText
    .split(/[.;]\s+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6);
}

function inferTitle(userText: string, fallbackTitle?: string | null) {
  if (!isGenericTitle(fallbackTitle)) {
    return fallbackTitle!.trim().slice(0, 120);
  }

  const normalized = userText.toLowerCase();
  const hasAvatar = normalized.includes("avatar");
  const hasSlides = normalized.includes("diapositiva") || normalized.includes("slide");
  const hasBroll = normalized.includes("b-roll") || normalized.includes("broll");

  if (hasAvatar && hasSlides && hasBroll) {
    return "Plantilla avatar inmersivo con slides y B-roll";
  }

  if (hasAvatar && hasSlides) {
    return "Plantilla avatar con diapositivas laterales";
  }

  const firstRequirement = extractRequirements(userText)[0];
  return (firstRequirement || fallbackTitle || "SofLIA Remotion bundle").slice(0, 120);
}

function inferRequiredAssets(userText: string) {
  const normalized = userText.toLowerCase();
  const assets = new Set<"slides" | "audio" | "avatar" | "broll" | "captions">(["audio"]);

  if (normalized.includes("diapositiva") || normalized.includes("slide")) assets.add("slides");
  if (normalized.includes("avatar")) assets.add("avatar");
  if (normalized.includes("b-roll") || normalized.includes("broll")) assets.add("broll");
  if (normalized.includes("subtitulo") || normalized.includes("subtítulo")) assets.add("captions");

  return Array.from(assets);
}

function inferDescription(userText: string, title: string) {
  const requirements = extractRequirements(userText);
  if (requirements.length === 0) {
    return userText.slice(0, 1000);
  }

  return `${title}: ${requirements.join(" ")}`.slice(0, 1000);
}

function inferDisplaySubtitle(userText: string, requiredAssets: string[]) {
  const normalized = userText.toLowerCase();
  const parts: string[] = [];

  if (requiredAssets.includes("avatar")) parts.push("avatar");
  if (requiredAssets.includes("slides")) parts.push("diapositivas");
  if (requiredAssets.includes("broll")) parts.push("B-roll");
  if (normalized.includes("subtitulo") || normalized.includes("subtítulo")) parts.push("subtitulos claros");

  if (parts.length > 0) {
    return `Video educativo con ${parts.join(", ")}.`;
  }

  return "Video educativo con ritmo visual claro.";
}

function inferVisualStyle(userText: string) {
  const normalized = userText.toLowerCase();
  const styleParts: string[] = [];

  if (normalized.includes("izquierda a derecha")) styleParts.push("transiciones suaves de izquierda a derecha");
  if (normalized.includes("avatar")) styleParts.push("avatar protagonista en primera persona");
  if (normalized.includes("mitad") || normalized.includes("derecha")) styleParts.push("layout dividido 50/50 para avatar y contenido");
  if (normalized.includes("morado")) styleParts.push("acentos morado elegante u oscuro");
  if (normalized.includes("subtitulo") || normalized.includes("subtítulo")) styleParts.push("subtitulos blancos de alta legibilidad");

  return (styleParts.join("; ") || "Clean educational motion graphics with readable text and soft transitions.").slice(0, 240);
}

export function stableJsonHash(value: unknown): string {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function sanitizeVisibleText(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;

  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return fallback;

  const technicalMarkers = [
    "avatarvideourl",
    "brollclips",
    "courseforge",
    "defaultprops",
    "importante:",
    "objetivo:",
    "propsschema",
    "remotion",
    "voiceaudiourl",
  ];
  const normalized = compact.toLowerCase();

  if (technicalMarkers.some((marker) => normalized.includes(marker))) {
    return fallback;
  }

  return compact.slice(0, 160);
}

export function normalizeBundleAgentSpecForRendering(spec: BundleAgentSpec): BundleAgentSpec {
  const title = sanitizeVisibleText(spec.defaultProps.title, spec.title);
  const subtitle = sanitizeVisibleText(
    spec.defaultProps.subtitle,
    inferDisplaySubtitle(`${spec.description} ${spec.visualStyle}`, spec.requiredAssets),
  );

  return bundleAgentSpecSchema.parse({
    ...spec,
    defaultProps: {
      ...spec.defaultProps,
      title,
      subtitle,
    },
  });
}

export function buildSpecFromConversation(input: {
  title?: string | null;
  messages: Array<{ role: string; content_redacted: string }>;
  overrides?: unknown;
}): BundleAgentSpec {
  const userText = input.messages
    .filter((message) => message.role === "USER")
    .map((message) => message.content_redacted)
    .join("\n")
    .trim();
  const title = inferTitle(userText, input.title);
  const description = inferDescription(userText, title);
  const inferredStyle = inferVisualStyle(userText);
  const requiredAssets = inferRequiredAssets(userText);
  const displaySubtitle = inferDisplaySubtitle(userText, requiredAssets);

  return normalizeBundleAgentSpecForRendering(bundleAgentSpecSchema.parse({
    title,
    description,
    visualStyle: inferredStyle,
    compositionId: slugifyCompositionId(title),
    durationFrames: 150,
    fps: 30,
    width: 1920,
    height: 1080,
    requiredAssets,
    defaultProps: {
      title,
      subtitle: displaySubtitle,
      accentColor: "#5B21B6",
    },
    propsSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Titulo principal de la leccion o composicion." },
        subtitle: { type: "string", description: "Subtitulo o texto narrativo corto en pantalla." },
        accentColor: { type: "string", description: "Color de acento para subrayados, bordes y progreso." },
      },
    },
    changeSummary: "SofLIA generated a controlled Remotion bundle draft from the conversation.",
    ...(input.overrides && typeof input.overrides === "object" ? input.overrides : {}),
  }));
}

export function computeSpecHash(spec: BundleAgentSpec): string {
  return stableJsonHash(spec);
}
