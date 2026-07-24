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

function getLatestUserText(messages: Array<{ role: string; content_redacted: string }>) {
  return [...messages]
    .reverse()
    .find((message) => message.role === "USER")
    ?.content_redacted
    .trim() || "";
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
  return (firstRequirement || fallbackTitle || "SofLIA video bundle").slice(0, 120);
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
  const usesReferenceWireframe = normalized.includes("wireframe structure") || normalized.includes("large left region plus right column split");

  if (usesReferenceWireframe) {
    styleParts.push("wireframe de referencia como restriccion: marco de color, avatar a la izquierda, diapositiva arriba derecha y B-roll abajo derecha");
  }
  if (normalized.includes("izquierda a derecha")) styleParts.push("transiciones suaves de izquierda a derecha");
  if (normalized.includes("avatar")) styleParts.push("avatar protagonista en primera persona");
  if (normalized.includes("avatar a la derecha") || normalized.includes("avatar del lado derecho")) {
    styleParts.push("avatar ubicado a la derecha con contenido principal a la izquierda");
  }
  if (normalized.includes("pantalla completa") || normalized.includes("full screen") || normalized.includes("fullscreen")) {
    styleParts.push("visual principal a pantalla completa");
  }
  if (normalized.includes("vertical") || normalized.includes("apilado") || normalized.includes("arriba y abajo")) {
    styleParts.push("composicion apilada con soporte visual superior e inferior");
  }
  if (normalized.includes("mitad") || normalized.includes("derecha")) styleParts.push("layout dividido 50/50 para avatar y contenido");
  if (normalized.includes("morado")) styleParts.push("acentos morado elegante u oscuro");
  if (normalized.includes("subtitulo") || normalized.includes("subtítulo")) styleParts.push("subtitulos blancos de alta legibilidad");

  return (styleParts.join("; ") || "Clean educational motion graphics with readable text and soft transitions.").slice(0, 240);
}

function inferAccentColor(userText: string) {
  const explicitHex = userText.match(/#[0-9a-fA-F]{6}\b/);
  if (explicitHex) return explicitHex[0].toUpperCase();

  const normalized = userText.toLowerCase();
  const colorHints: Array<[string[], string]> = [
    [["turquesa", "cyan", "cian"], "#00D4B3"],
    [["azul", "blue"], "#2563EB"],
    [["verde", "green"], "#16A34A"],
    [["rojo", "red"], "#DC2626"],
    [["naranja", "orange"], "#F97316"],
    [["amarillo", "yellow", "dorado"], "#F59E0B"],
    [["rosa", "pink", "magenta"], "#DB2777"],
    [["morado", "purpura", "purple", "violeta"], "#5B21B6"],
    [["negro", "black"], "#111827"],
    [["blanco", "white"], "#F8FAFC"],
  ];

  return colorHints.find(([terms]) => terms.some((term) => normalized.includes(term)))?.[1] || "#5B21B6";
}

function shouldSwapScenesOnSlideChange(userText: string) {
  const normalized = userText.toLowerCase();

  return (
    normalized.includes("cambio de escena") && normalized.includes("cambiar la diapositiva") ||
    normalized.includes("todos los elementos de la izquierda se van a la derecha") ||
    normalized.includes("los de la derecha a la izquierda")
  );
}

function shouldExpandMissingSupportMedia(userText: string) {
  const normalized = userText.toLowerCase();

  return (
    normalized.includes("si no hay b-roll") ||
    normalized.includes("si no hay broll") ||
    normalized.includes("si no hay diapositiva") ||
    normalized.includes("tomará el espacio del otro") ||
    normalized.includes("tomara el espacio del otro")
  );
}

function inferCreativeDirectionName(userText: string, requiredAssets: string[]) {
  const normalized = userText.toLowerCase();

  if (normalized.includes("wireframe structure") || normalized.includes("large left region plus right column split")) {
    return "Reference Wireframe Lock";
  }

  if (normalized.includes("cinematic") || normalized.includes("inmersivo") || normalized.includes("pantalla completa")) {
    return "Cinematic Learning Field";
  }

  if (normalized.includes("corporativo") || normalized.includes("sobrio")) {
    return "Executive Knowledge Desk";
  }

  if (normalized.includes("vertical") || normalized.includes("apilado")) {
    return "Stacked Studio System";
  }

  if (requiredAssets.includes("avatar") && requiredAssets.includes("broll")) {
    return "Guided Media Studio";
  }

  return "Editorial Course Console";
}

function inferPaletteName(userText: string) {
  const normalized = userText.toLowerCase();
  if (normalized.includes("dominant frame/border color")) return "Reference frame color";
  if (normalized.includes("azul")) return "Signal blue";
  if (normalized.includes("verde") || normalized.includes("turquesa")) return "SofLIA teal";
  if (normalized.includes("claro") || normalized.includes("minimal")) return "Editorial light";
  if (normalized.includes("naranja") || normalized.includes("dorado")) return "Warm focus";
  if (normalized.includes("morado") || normalized.includes("violeta")) return "Deep violet";
  return "Dark learning console";
}

function buildCreativeBrief(input: {
  userText: string;
  revisionWeightedText: string;
  visualStyle: string;
  requiredAssets: string[];
  accentColor: string;
}): BundleAgentSpec["creativeBrief"] {
  const normalized = input.revisionWeightedText.toLowerCase();
  const isLight = normalized.includes("claro") || normalized.includes("minimal") || normalized.includes("white");
  const isCinematic = normalized.includes("cinematic") || normalized.includes("inmersivo") || normalized.includes("pantalla completa");
  const isStacked = normalized.includes("vertical") || normalized.includes("apilado") || normalized.includes("arriba y abajo");
  const usesReferenceWireframe = normalized.includes("wireframe structure") || normalized.includes("large left region plus right column split");
  const sceneSwapOnSlideChange = shouldSwapScenesOnSlideChange(input.revisionWeightedText);
  const expandMissingSupportMedia = shouldExpandMissingSupportMedia(input.revisionWeightedText);
  const hasAvatar = input.requiredAssets.includes("avatar");
  const hasSlides = input.requiredAssets.includes("slides");
  const hasBroll = input.requiredAssets.includes("broll");
  const directionName = inferCreativeDirectionName(input.revisionWeightedText, input.requiredAssets);
  const visualReferences = [
    isCinematic
      ? "Documentary-style educational opener with full-frame media and sparse overlays."
      : "Editorial software lesson with deliberate hierarchy and visible media zones.",
    hasAvatar
      ? "Instructor-led studio frame where the presenter has a stable spatial role."
      : "Media-first explainer with text acting as annotation rather than centerpiece.",
    hasSlides && hasBroll
      ? "Dual-source learning canvas where slides and B-roll are both intentionally visible."
      : "Single-support visual system with clear focus changes.",
  ];
  const layoutSystem = isStacked
    ? "Stacked support layout: presenter or narration rail plus upper slide region and lower B-roll region."
    : usesReferenceWireframe
      ? "Reference wireframe lock: thick colored outer frame, left half reserved for avatar, right half split equally with slide region above and B-roll region below."
    : isCinematic
      ? "Media-first layout: full-frame support visuals with compact lower-third learning copy."
      : hasAvatar
        ? "Asymmetric studio layout: avatar and support media occupy distinct non-centered zones."
        : "Editorial media layout: primary visual field with a compact narrative anchor.";
  const motionLanguageBase = normalized.includes("rapido") || normalized.includes("dinamico")
    ? "Quick cuts between support visuals, short opacity snaps and accent pulses for progress."
    : normalized.includes("suave") || normalized.includes("sobrio")
      ? "Soft opacity changes, measured holds and low-amplitude emphasis without generic card fades."
      : "Rhythmic scene changes using support-visual alternation and brief accent reveals.";
  const motionLanguage = [
    motionLanguageBase,
    sceneSwapOnSlideChange ? "Scene changes occur on slide changes; left and right regions trade sides with smooth positional interpolation." : null,
    expandMissingSupportMedia ? "When slide or B-roll is absent, the available support media expands to occupy both support regions." : null,
  ].filter(Boolean).join(" ").slice(0, 500);
  const colorTokens = {
    paletteName: inferPaletteName(input.revisionWeightedText),
    background: usesReferenceWireframe ? input.accentColor : isLight ? "#F8FAFC" : "#05070B",
    surface: usesReferenceWireframe ? "#FFFFFF" : isLight ? "#FFFFFF" : "#111827",
    accent: input.accentColor,
    text: usesReferenceWireframe || isLight ? "#0F172A" : "#F8FAFC",
    muted: usesReferenceWireframe || isLight ? "#475569" : "#CBD5E1",
  };
  const typographyTokens = {
    display: isCinematic ? "Wide cinematic display" : isLight ? "Editorial serif-like display" : "Compact high-contrast sans display",
    body: "Readable humanist sans for lesson context",
    label: "Small uppercase production labels kept outside visible video copy",
  };
  const differentiators = [
    layoutSystem,
    motionLanguage,
    `Palette: ${colorTokens.paletteName}`,
    hasBroll ? "B-roll has a declared region instead of being hidden behind slides." : "Media region changes scale with available assets.",
    hasAvatar ? "Avatar placement is a deliberate composition decision." : "No avatar zone is invented when not requested.",
  ];

  return {
    directionName,
    visualReferences,
    layoutSystem,
    motionLanguage,
    colorTokens,
    typographyTokens,
    similarityCheck: {
      avoidedPatterns: [
        "Centered title with subtitle below",
        "Single purple gradient background",
        "Fade-in card stack",
        "Generic slide crossfade as the only transition",
      ],
      differentiators: differentiators.slice(0, 5).map((item) => item.slice(0, 160)),
    },
    componentArchitecture: [
      "Typed root composition receives media props, design tokens and animation variant ids.",
      "Layout resolver chooses media boxes before rendering any Remotion layer.",
      "Support visual layers remain independently editable for slides and B-roll.",
      "Preview and ZIP generation share the same blueprint geometry.",
    ],
    visualVariants: [
      {
        id: "variant-studio-asymmetric",
        name: "Asymmetric studio",
        composition: usesReferenceWireframe
          ? "Reference-matched frame: avatar left, slide top-right, B-roll bottom-right."
          : hasAvatar ? "Presenter zone balanced against a larger support-media field." : "Narrative rail balanced against a larger support-media field.",
        palette: `${colorTokens.paletteName} with dark surface contrast and one accent rail.`,
        motion: sceneSwapOnSlideChange ? "Scene-indexed left/right position swap with smooth interpolation." : "Measured opacity transitions with accent progress reveals.",
        emphasis: "Instructor presence, stable media hierarchy and readable captions.",
      },
      {
        id: "variant-media-field",
        name: "Media field",
        composition: "Full or near-full frame media with compact overlay copy and anchored accent marks.",
        palette: `Cinematic neutrals with ${input.accentColor} as motion cue.`,
        motion: "Faster support-visual switches, short holds and overlay cuts.",
        emphasis: "Immersion, B-roll energy and large visual evidence.",
      },
      {
        id: "variant-stacked-evidence",
        name: "Stacked evidence",
        composition: "Two support regions create a vertical comparison between slide logic and B-roll context.",
        palette: "Studio-dark background with separated translucent surfaces.",
        motion: "Alternating focus between upper and lower support regions.",
        emphasis: "Parallel explanation, evidence and step-by-step learning structure.",
      },
    ],
  };
}

function inferAnimationVariant(motionLanguage: string) {
  const normalized = motionLanguage.toLowerCase();
  if (normalized.includes("quick") || normalized.includes("rapido") || normalized.includes("dinamico")) return "kinetic";
  if (normalized.includes("soft") || normalized.includes("suave") || normalized.includes("sobrio")) return "measured";
  return "adaptive";
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
  const latestUserText = getLatestUserText(input.messages);
  const revisionWeightedText = [latestUserText, userText].filter(Boolean).join("\n");
  const title = inferTitle(userText, input.title);
  const description = inferDescription(userText, title);
  const inferredStyle = inferVisualStyle(revisionWeightedText);
  const requiredAssets = inferRequiredAssets(revisionWeightedText);
  const displaySubtitle = inferDisplaySubtitle(revisionWeightedText, requiredAssets);
  const accentColor = inferAccentColor(revisionWeightedText);
  const sceneSwapOnSlideChange = shouldSwapScenesOnSlideChange(revisionWeightedText);
  const expandMissingSupportMedia = shouldExpandMissingSupportMedia(revisionWeightedText);
  const creativeBrief = buildCreativeBrief({
    userText,
    revisionWeightedText,
    visualStyle: inferredStyle,
    requiredAssets,
    accentColor,
  });
  const changeSummary = input.messages.filter((message) => message.role === "USER").length > 1
    ? `SofLIA adjusted the bundle draft using the latest feedback: ${latestUserText.slice(0, 220)}`
    : "SofLIA generated a controlled video bundle draft from the conversation.";

  return normalizeBundleAgentSpecForRendering(bundleAgentSpecSchema.parse({
    title,
    description,
    visualStyle: inferredStyle,
    creativeBrief,
    compositionId: slugifyCompositionId(title),
    durationFrames: 150,
    fps: 30,
    width: 1920,
    height: 1080,
    requiredAssets,
    defaultProps: {
      title,
      subtitle: displaySubtitle,
      accentColor,
      animationVariant: sceneSwapOnSlideChange ? "scene-swap" : inferAnimationVariant(creativeBrief.motionLanguage),
      designTokens: {
        backgroundColor: creativeBrief.colorTokens.background,
        surfaceColor: creativeBrief.colorTokens.surface,
        accentColor: creativeBrief.colorTokens.accent,
        textColor: creativeBrief.colorTokens.text,
        mutedTextColor: creativeBrief.colorTokens.muted,
        typographyDisplay: creativeBrief.typographyTokens.display,
        typographyBody: creativeBrief.typographyTokens.body,
      },
      expandMissingSupportMedia,
      sceneSwapOnSlideChange,
      visualVariantId: creativeBrief.visualVariants[0].id,
    },
    propsSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Titulo principal de la leccion o composicion." },
        subtitle: { type: "string", description: "Subtitulo o texto narrativo corto en pantalla." },
        accentColor: { type: "string", description: "Color de acento para subrayados, bordes y progreso." },
        visualVariantId: { type: "string", description: "Variante visual seleccionada del creative brief." },
        animationVariant: { type: "string", description: "Ritmo de motion elegido para esta plantilla." },
        designTokens: { type: "object", description: "Tokens visuales expuestos por la direccion creativa." },
        expandMissingSupportMedia: { type: "boolean", description: "Expande slide o B-roll cuando falta el otro soporte visual." },
        sceneSwapOnSlideChange: { type: "boolean", description: "Intercambia izquierda/derecha al cambiar de diapositiva." },
      },
    },
    changeSummary,
    ...(input.overrides && typeof input.overrides === "object" ? input.overrides : {}),
  }));
}

export function computeSpecHash(spec: BundleAgentSpec): string {
  return stableJsonHash(spec);
}
