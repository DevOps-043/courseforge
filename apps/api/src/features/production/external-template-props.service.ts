import {
  buildAssemblyInputProps,
  type AssemblyInputProps,
} from './remotion-assembly-props.service';
import {
  buildResolvedProps,
  type ResolvedPropsResult,
} from './resolved-props.service';
import { mergeTemplateRenderConfigs } from './template-render-config.service';

export const EXTERNAL_PROPS_SOURCE = 'courseforge-canonical-v1';

export interface ExternalTemplatePropsInput {
  assets: unknown;
  compositionId: string;
  templateDefaultConfig?: unknown;
  variables?: Record<string, unknown>;
  bundleDefaultProps?: Record<string, unknown> | null;
  propsSchema?: Record<string, unknown> | null;
  manifest?: unknown;
}

export interface ExternalTemplatePropsResult extends ResolvedPropsResult {
  propsSource: typeof EXTERNAL_PROPS_SOURCE;
  courseProps: AssemblyInputProps;
  propKeys: string[];
}

const PROTECTED_COURSE_PROP_KEYS = new Set([
  'avatarVideoUrl',
  'bgMusicUrl',
  'bgMusicVolume',
  'brollClips',
  'deckCss',
  'deckFonts',
  'fps',
  'layoutOverrides',
  'slides',
  'template',
  'templateConfig',
  'timelineOverrides',
  'totalDurationInFrames',
  'transitionType',
  'voiceAudioUrl',
]);

export function buildExternalTemplateProps(input: ExternalTemplatePropsInput): ExternalTemplatePropsResult {
  const variables = input.variables ?? {};
  const hasTemplateConfigInput = Boolean(input.templateDefaultConfig || variables.templateConfig);
  const templateConfig = mergeTemplateRenderConfigs(input.templateDefaultConfig, variables.templateConfig);
  const courseProps = buildAssemblyInputProps({
    assets: input.assets,
    compositionId: input.compositionId,
    transitionType: variables.transitionType,
    templateConfig,
    layoutOverrides: variables.layoutOverrides,
    timelineOverrides: variables.timelineOverrides,
  });
  const resolved = buildResolvedProps({
    bundleDefaultProps: input.bundleDefaultProps,
    courseProps: {
      ...(courseProps as unknown as Record<string, unknown>),
      ...(hasTemplateConfigInput
        ? {
            accentColor: templateConfig.accentColor,
            backgroundColor: templateConfig.backgroundColor,
            surfaceColor: templateConfig.surfaceColor,
          }
        : {}),
    },
    userOverrides: extractExternalTemplateOverrides(variables),
  });

  validatePropsSchema(resolved.resolvedProps, input.propsSchema);
  assertExternalTemplateCanRenderHtmlSlides({
    resolvedProps: resolved.resolvedProps,
    bundleDefaultProps: input.bundleDefaultProps,
    propsSchema: input.propsSchema,
    manifest: input.manifest,
  });

  return {
    ...resolved,
    propsSource: EXTERNAL_PROPS_SOURCE,
    courseProps,
    propKeys: Object.keys(resolved.resolvedProps).sort(),
  };
}

export function extractExternalTemplateOverrides(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const variables = value as Record<string, unknown>;
  const candidate = variables.resolvedProps ?? variables.customTemplateProps ?? variables.templateProps;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return null;
  }

  return filterProtectedCoursePropOverrides(candidate as Record<string, unknown>);
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function hasOwnRecordKey(value: unknown, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(readRecord(value), key);
}

function propsContainHtmlSlides(props: Record<string, unknown>): boolean {
  const slides = Array.isArray(props.slides) ? props.slides : [];
  return slides.some((slide) => {
    if (!slide || typeof slide !== 'object' || Array.isArray(slide)) return false;
    const record = slide as Record<string, unknown>;
    return record.kind === 'html' || typeof record.html === 'string';
  });
}

function templateDeclaresHtmlDeckSupport(input: {
  bundleDefaultProps?: Record<string, unknown> | null;
  propsSchema?: Record<string, unknown> | null;
  manifest?: unknown;
}): boolean {
  const manifest = readRecord(input.manifest);
  const capabilities = readRecord(manifest.capabilities);
  if (
    capabilities.htmlDeck === true ||
    capabilities.htmlSlides === true ||
    capabilities.animatedDeck === true
  ) {
    return true;
  }

  const schemaProperties = readRecord(input.propsSchema?.properties);
  const manifestSchemaProperties = readRecord(readRecord(manifest.propsSchema).properties);
  const manifestDefaultProps = readRecord(manifest.defaultProps);

  return [
    input.bundleDefaultProps,
    schemaProperties,
    manifestSchemaProperties,
    manifestDefaultProps,
  ].some((record) => hasOwnRecordKey(record, 'deckCss') && hasOwnRecordKey(record, 'deckFonts'));
}

function assertExternalTemplateCanRenderHtmlSlides(input: {
  resolvedProps: Record<string, unknown>;
  bundleDefaultProps?: Record<string, unknown> | null;
  propsSchema?: Record<string, unknown> | null;
  manifest?: unknown;
}): void {
  if (!propsContainHtmlSlides(input.resolvedProps)) return;
  if (templateDeclaresHtmlDeckSupport(input)) return;

  throw new Error(
    'EXTERNAL_TEMPLATE_HTML_DECK_UNSUPPORTED: la plantilla externa no declara soporte para slides HTML animadas. Usa una composicion interna compatible o publica una version de plantilla que acepte deckCss, deckFonts y slides kind=html.',
  );
}

export function filterProtectedCoursePropOverrides(
  overrides: Record<string, unknown>,
): Record<string, unknown> | null {
  const filtered = Object.fromEntries(
    Object.entries(overrides).filter(([key]) => !PROTECTED_COURSE_PROP_KEYS.has(key)),
  );

  return Object.keys(filtered).length > 0 ? filtered : null;
}

export function validatePropsSchema(
  props: Record<string, unknown>,
  schema: Record<string, unknown> | null | undefined,
): void {
  if (!schema || schema.type !== 'object') {
    return;
  }

  const required = Array.isArray(schema.required)
    ? schema.required.filter((key): key is string => typeof key === 'string')
    : [];
  const missing = required.filter((key) => props[key] === undefined || props[key] === null);
  if (missing.length > 0) {
    throw new Error(`EXTERNAL_PROPS_INVALID: faltan props requeridos: ${missing.join(', ')}`);
  }

  if (!schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) {
    return;
  }

  const properties = schema.properties as Record<string, unknown>;
  for (const [key, definition] of Object.entries(properties)) {
    if (props[key] === undefined || props[key] === null) {
      continue;
    }
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
      continue;
    }
    const expectedType = (definition as Record<string, unknown>).type;
    if (typeof expectedType !== 'string') {
      continue;
    }
    if (!matchesJsonSchemaType(props[key], expectedType)) {
      throw new Error(`EXTERNAL_PROPS_INVALID: prop "${key}" debe ser ${expectedType}.`);
    }
  }
}

function matchesJsonSchemaType(value: unknown, expectedType: string): boolean {
  switch (expectedType) {
    case 'array':
      return Array.isArray(value);
    case 'object':
      return Boolean(value && typeof value === 'object' && !Array.isArray(value));
    case 'number':
    case 'integer':
      return typeof value === 'number' && Number.isFinite(value);
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return true;
  }
}
