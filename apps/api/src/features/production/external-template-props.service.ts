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
}

export interface ExternalTemplatePropsResult extends ResolvedPropsResult {
  propsSource: typeof EXTERNAL_PROPS_SOURCE;
  courseProps: AssemblyInputProps;
  propKeys: string[];
}

export function buildExternalTemplateProps(input: ExternalTemplatePropsInput): ExternalTemplatePropsResult {
  const variables = input.variables ?? {};
  const courseProps = buildAssemblyInputProps({
    assets: input.assets,
    compositionId: input.compositionId,
    transitionType: variables.transitionType,
    templateConfig: mergeTemplateRenderConfigs(input.templateDefaultConfig, variables.templateConfig),
  });
  const resolved = buildResolvedProps({
    bundleDefaultProps: input.bundleDefaultProps,
    courseProps: courseProps as unknown as Record<string, unknown>,
    userOverrides: extractExternalTemplateOverrides(variables),
  });

  validatePropsSchema(resolved.resolvedProps, input.propsSchema);

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
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? candidate as Record<string, unknown>
    : null;
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
