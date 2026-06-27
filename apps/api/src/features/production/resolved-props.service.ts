import crypto from 'crypto';

export interface ResolvedPropsInput {
  bundleDefaultProps?: Record<string, unknown> | null;
  courseProps: Record<string, unknown>;
  userOverrides?: Record<string, unknown> | null;
}

export interface ResolvedPropsResult {
  resolvedProps: Record<string, unknown>;
  propsHash: string;
}

export function buildResolvedProps(input: ResolvedPropsInput): ResolvedPropsResult {
  const resolvedProps = {
    ...(input.bundleDefaultProps ?? {}),
    ...input.courseProps,
    ...(input.userOverrides ?? {}),
  };

  return {
    resolvedProps,
    propsHash: stableHash(resolvedProps),
  };
}

export function stableHash(value: unknown): string {
  return crypto
    .createHash('sha256')
    .update(stableStringify(value))
    .digest('hex');
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}
