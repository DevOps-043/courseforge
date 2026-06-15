export type TemplateTransition = 'fade' | 'slide' | 'none';
export type TemplateAvatarPosition =
  | 'bottom-right'
  | 'bottom-left'
  | 'top-right'
  | 'top-left';

export interface TemplateRenderConfig {
  accentColor: string;
  backgroundColor: string;
  surfaceColor: string;
  transitionType: TemplateTransition;
  avatarPosition: TemplateAvatarPosition;
  avatarScale: number;
  supportStripHeight: number;
  backgroundStyle: 'solid' | 'gradient';
}

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export const DEFAULT_TEMPLATE_RENDER_CONFIG: TemplateRenderConfig = {
  accentColor: '#00D4B3',
  backgroundColor: '#000000',
  surfaceColor: '#151A21',
  transitionType: 'fade',
  avatarPosition: 'bottom-right',
  avatarScale: 0.24,
  supportStripHeight: 0.22,
  backgroundStyle: 'gradient',
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function parseColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value) ? value : fallback;
}

function parseEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === 'string' && allowed.includes(value as T)
    ? value as T
    : fallback;
}

function parseNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : fallback;
}

export function parseTemplateRenderConfig(raw: unknown): TemplateRenderConfig {
  const source = asRecord(raw);

  return {
    accentColor: parseColor(source.accentColor, DEFAULT_TEMPLATE_RENDER_CONFIG.accentColor),
    backgroundColor: parseColor(source.backgroundColor, DEFAULT_TEMPLATE_RENDER_CONFIG.backgroundColor),
    surfaceColor: parseColor(source.surfaceColor, DEFAULT_TEMPLATE_RENDER_CONFIG.surfaceColor),
    transitionType: parseEnum(
      source.transitionType,
      ['fade', 'slide', 'none'] as const,
      DEFAULT_TEMPLATE_RENDER_CONFIG.transitionType,
    ),
    avatarPosition: parseEnum(
      source.avatarPosition,
      ['bottom-right', 'bottom-left', 'top-right', 'top-left'] as const,
      DEFAULT_TEMPLATE_RENDER_CONFIG.avatarPosition,
    ),
    avatarScale: parseNumber(
      source.avatarScale,
      0.16,
      0.36,
      DEFAULT_TEMPLATE_RENDER_CONFIG.avatarScale,
    ),
    supportStripHeight: parseNumber(
      source.supportStripHeight,
      0.16,
      0.34,
      DEFAULT_TEMPLATE_RENDER_CONFIG.supportStripHeight,
    ),
    backgroundStyle: parseEnum(
      source.backgroundStyle,
      ['solid', 'gradient'] as const,
      DEFAULT_TEMPLATE_RENDER_CONFIG.backgroundStyle,
    ),
  };
}

export function mergeTemplateRenderConfigs(base: unknown, override: unknown): TemplateRenderConfig {
  return parseTemplateRenderConfig({
    ...asRecord(base),
    ...asRecord(override),
  });
}
