import { z } from "zod";

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export const templateRenderConfigSchema = z
  .object({
    accentColor: z
      .string()
      .regex(HEX_COLOR_PATTERN)
      .default("#00D4B3"),
    backgroundColor: z
      .string()
      .regex(HEX_COLOR_PATTERN)
      .default("#000000"),
    surfaceColor: z
      .string()
      .regex(HEX_COLOR_PATTERN)
      .default("#151A21"),
    transitionType: z.enum(["fade", "slide", "none"]).default("fade"),
    avatarPosition: z
      .enum(["bottom-right", "bottom-left", "top-right", "top-left"])
      .default("bottom-right"),
    avatarScale: z.number().min(0.16).max(0.36).default(0.24),
    supportStripHeight: z.number().min(0.16).max(0.34).default(0.22),
    backgroundStyle: z.enum(["solid", "gradient"]).default("gradient"),
  });

export type TemplateRenderConfig = z.infer<typeof templateRenderConfigSchema>;
export type TemplateRenderConfigInput = z.input<typeof templateRenderConfigSchema>;

export const DEFAULT_TEMPLATE_RENDER_CONFIG: TemplateRenderConfig =
  templateRenderConfigSchema.parse({});

export function parseTemplateRenderConfig(
  raw: unknown,
): TemplateRenderConfig {
  const parsed = templateRenderConfigSchema.safeParse(raw ?? {});

  if (parsed.success) {
    return parsed.data;
  }

  return DEFAULT_TEMPLATE_RENDER_CONFIG;
}

export function mergeTemplateRenderConfigs(
  base: unknown,
  override: unknown,
): TemplateRenderConfig {
  const baseConfig =
    typeof base === "object" && base !== null ? base : {};
  const overrideConfig =
    typeof override === "object" && override !== null ? override : {};

  return parseTemplateRenderConfig({
    ...baseConfig,
    ...overrideConfig,
  });
}

export function createTemplateConfigSchemaDefinition() {
  return {
    accentColor: {
      type: "color",
      label: "Color de acento",
      default: DEFAULT_TEMPLATE_RENDER_CONFIG.accentColor,
    },
    backgroundColor: {
      type: "color",
      label: "Color de fondo",
      default: DEFAULT_TEMPLATE_RENDER_CONFIG.backgroundColor,
    },
    surfaceColor: {
      type: "color",
      label: "Color de superficie",
      default: DEFAULT_TEMPLATE_RENDER_CONFIG.surfaceColor,
    },
    transitionType: {
      type: "select",
      label: "Transicion",
      options: ["fade", "slide", "none"],
      default: DEFAULT_TEMPLATE_RENDER_CONFIG.transitionType,
    },
    avatarPosition: {
      type: "select",
      label: "Posicion de avatar",
      options: ["bottom-right", "bottom-left", "top-right", "top-left"],
      default: DEFAULT_TEMPLATE_RENDER_CONFIG.avatarPosition,
    },
    avatarScale: {
      type: "number",
      label: "Tamano de avatar",
      min: 0.16,
      max: 0.36,
      default: DEFAULT_TEMPLATE_RENDER_CONFIG.avatarScale,
    },
    supportStripHeight: {
      type: "number",
      label: "Altura de apoyo visual",
      min: 0.16,
      max: 0.34,
      default: DEFAULT_TEMPLATE_RENDER_CONFIG.supportStripHeight,
    },
    backgroundStyle: {
      type: "select",
      label: "Fondo sin assets",
      options: ["solid", "gradient"],
      default: DEFAULT_TEMPLATE_RENDER_CONFIG.backgroundStyle,
    },
  };
}
