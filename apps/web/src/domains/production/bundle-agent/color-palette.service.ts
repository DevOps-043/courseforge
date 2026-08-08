export interface BundleColorTokens {
  paletteName: string;
  background: string;
  surface: string;
  accent: string;
  secondary: string;
  text: string;
  muted: string;
}

interface NamedColor {
  name: string;
  hex: string;
  terms: readonly string[];
  role: "dark" | "light" | "neutral" | "vivid";
}

const NAMED_COLORS: readonly NamedColor[] = [
  { name: "amarillo mostaza", hex: "#D4A017", terms: ["amarillo mostaza", "mostaza", "mustard"], role: "vivid" },
  { name: "turquesa", hex: "#00A896", terms: ["turquesa", "cyan", "cian", "teal"], role: "vivid" },
  { name: "morado", hex: "#5B21B6", terms: ["morado", "purpura", "púrpura", "purple", "violeta"], role: "dark" },
  { name: "azul", hex: "#2563EB", terms: ["azul", "blue"], role: "vivid" },
  { name: "verde", hex: "#16A34A", terms: ["verde", "green"], role: "vivid" },
  { name: "rojo", hex: "#DC2626", terms: ["rojo", "red"], role: "vivid" },
  { name: "naranja", hex: "#F97316", terms: ["naranja", "orange"], role: "vivid" },
  { name: "amarillo", hex: "#F59E0B", terms: ["amarillo", "yellow", "dorado", "gold"], role: "vivid" },
  { name: "rosa", hex: "#DB2777", terms: ["rosa", "pink", "magenta"], role: "vivid" },
  { name: "negro", hex: "#111827", terms: ["negro", "black"], role: "dark" },
  { name: "gris", hex: "#6B7280", terms: ["gris", "gray", "grey"], role: "neutral" },
  { name: "beige", hex: "#F2E8D5", terms: ["beige", "crema", "cream"], role: "light" },
  { name: "blanco", hex: "#F8FAFC", terms: ["blanco", "white"], role: "light" },
];

const DEFAULT_DARK_TOKENS: BundleColorTokens = {
  paletteName: "Dark learning console",
  background: "#05070B",
  surface: "#111827",
  accent: "#5B21B6",
  secondary: "#8B5CF6",
  text: "#F8FAFC",
  muted: "#CBD5E1",
};

const DEFAULT_LIGHT_TOKENS: BundleColorTokens = {
  paletteName: "Editorial light",
  background: "#F8FAFC",
  surface: "#FFFFFF",
  accent: "#5B21B6",
  secondary: "#D4A017",
  text: "#0F172A",
  muted: "#64748B",
};

function normalizeSearchText(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function findNamedColors(value: string) {
  const normalized = normalizeSearchText(value);

  return NAMED_COLORS
    .map((color) => {
      const positions = color.terms
        .map((term) => normalized.indexOf(normalizeSearchText(term)))
        .filter((position) => position >= 0);
      return positions.length > 0 ? { color, position: Math.min(...positions) } : null;
    })
    .filter((match): match is { color: NamedColor; position: number } => Boolean(match))
    .sort((left, right) => left.position - right.position)
    .filter((match, index, matches) => matches.findIndex((candidate) => candidate.color.hex === match.color.hex) === index)
    .map((match) => match.color);
}

function findExplicitHexColors(value: string) {
  return Array.from(new Set((value.match(/#[0-9a-fA-F]{6}\b/g) || []).map((hex) => hex.toUpperCase())));
}

function isLightColor(hex: string) {
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  return (red * 299 + green * 587 + blue * 114) / 1000 >= 150;
}

/** Converts author color language into the complete semantic palette consumed by preview and Remotion. */
export function inferBundleColorTokens(userText: string): BundleColorTokens {
  const normalized = normalizeSearchText(userText);
  const requestsLightBase = ["fondo claro", "estilo claro", "minimal", "white background"].some((term) => normalized.includes(term));
  const defaults = requestsLightBase ? DEFAULT_LIGHT_TOKENS : DEFAULT_DARK_TOKENS;
  const namedColors = findNamedColors(userText);
  const explicitHexColors = findExplicitHexColors(userText);

  if (namedColors.length === 0 && explicitHexColors.length === 0) return { ...defaults };

  if (explicitHexColors.length > 0 && namedColors.length === 0) {
    const [accent, secondary = defaults.secondary, surface = defaults.surface, background = defaults.background] = explicitHexColors;
    return {
      ...defaults,
      paletteName: `Custom ${explicitHexColors.join(" / ")}`,
      background,
      surface,
      accent,
      secondary,
      text: isLightColor(background) ? "#0F172A" : "#F8FAFC",
    };
  }

  const dark = namedColors.find((color) => color.role === "dark");
  const light = namedColors.find((color) => color.role === "light");
  const neutral = namedColors.find((color) => color.role === "neutral");
  const vivid = namedColors.find((color) => color.role === "vivid");
  const first = namedColors[0]!;
  const accent = vivid?.hex || first.hex;
  const secondary = namedColors.find((color) => color.hex !== accent)?.hex || defaults.secondary;
  const background = dark?.hex || (light && namedColors.length === 1 ? light.hex : defaults.background);
  const surface = light?.hex || (neutral && isLightColor(neutral.hex) ? neutral.hex : defaults.surface);

  return {
    paletteName: namedColors.map((color) => color.name).join(" / "),
    background,
    surface,
    accent,
    secondary,
    text: isLightColor(background) ? "#0F172A" : "#F8FAFC",
    muted: neutral?.hex || (isLightColor(background) ? "#475569" : defaults.muted),
  };
}

export function resolveBundleAccentColor(userText: string) {
  return inferBundleColorTokens(userText).accent;
}
