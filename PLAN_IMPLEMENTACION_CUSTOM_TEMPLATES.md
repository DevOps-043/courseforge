# Plan de implementación: Plantillas Remotion personalizadas (Custom Bundles)

Fecha: 2026-06-26  
Referencia diagnóstica: `REMOTION_CUSTOM_TEMPLATES_DIAGNOSTICO.md`  
Stack: Next.js 16 + Express + Supabase + Remotion

---

## Resumen ejecutivo

El sistema actual **no puede ejecutar plantillas personalizadas** en ningún flujo (preview ni render). Se identificaron 4 bloqueadores críticos que impiden que el sandbox funcione incluso cuando está habilitado, más 3 problemas estructurales que hacen que el bundle incorrecto se ejecute aunque el sandbox esté activo. El plan está dividido en 5 fases ordenadas por criticidad, cada una ejecutable de forma independiente y con validación propia.

---

## Bloqueadores críticos confirmados en el código

| # | Archivo | Problema concreto |
|---|---------|-------------------|
| C1 | `20260616100000_create_remotion_template_versions.sql:32` | El `CHECK` constraint NO incluye `APPROVED_FOR_SANDBOX`. El worker lo busca, nunca lo encuentra. El sandbox **nunca se activa**. |
| C2 | `remotion-assembly-props.service.ts:15` | `INTERNAL_COMPOSITION_IDS` solo acepta `full-slides`, `split-avatar`, `avatar-focus`. Todo ID externo se reemplaza silenciosamente por `full-slides`. |
| C3 | `sandbox-runner/bundle-cache.ts:98-144` | El wrapper genera un entry point propio que ignora `registerRoot` del bundle. Solo acepta `TemplateModule.MyComposition ?? TemplateModule.default`. Hardcodea `durationInFrames=300`, `fps=30`. |
| C4 | `sandbox-runner/props-adapter.ts:8-28` | Pasa el contrato interno de Courseforge (`slides`, `brollClips`, `avatarVideoUrl`) sin leer el schema del bundle. Props personalizadas del template nunca llegan. |

---

## Fase 1 — Desbloqueadores críticos (sin esto, nada funciona)

**Objetivo**: Hacer que el sandbox pueda activarse y ejecutar un bundle real con un composition ID correcto.  
**Impacto de no hacerlo**: El sandbox nunca se activa independientemente de la configuración.  
**Tiempo estimado**: 1-2 días.

---

### Paso 1.1 — Agregar `APPROVED_FOR_SANDBOX` al constraint de la tabla

**Archivo**: nueva migración en `supabase/migrations/`

**Problema**: El worker (`remotion-worker.service.ts:414-428`) busca versiones con `status = 'APPROVED_FOR_SANDBOX'`. El CHECK constraint actual no incluye ese valor. Cualquier intento de actualizar una versión a ese status falla silenciosamente en la DB, y la query del worker siempre retorna `null`.

**Cambio**:

```sql
-- supabase/migrations/20260627000000_add_approved_for_sandbox_status.sql

ALTER TABLE public.remotion_template_versions
  DROP CONSTRAINT IF EXISTS remotion_template_versions_status_check;

ALTER TABLE public.remotion_template_versions
  ADD CONSTRAINT remotion_template_versions_status_check CHECK (
    status IN (
      'UPLOADED',
      'VALIDATING',
      'VALIDATION_FAILED',
      'PENDING_REVIEW',
      'APPROVED',
      'APPROVED_FOR_SANDBOX',
      'REJECTED',
      'DEPRECATED'
    )
  );

COMMENT ON COLUMN public.remotion_template_versions.status IS
  'APPROVED_FOR_SANDBOX: versión validada y habilitada para ejecución en sandbox. APPROVED: validada pero no ejecutada aún.';
```

**Validación**: Ejecutar en Supabase SQL Editor:
```sql
UPDATE remotion_template_versions SET status = 'APPROVED_FOR_SANDBOX' WHERE id = '<test-id>';
-- Debe actualizar sin error de constraint
```

---

### Paso 1.2 — Separar resolución de composition ID interno vs. externo

**Archivo**: `apps/api/src/features/production/remotion-assembly-props.service.ts`

**Problema**: `resolveCompositionId` reemplaza cualquier ID que no sea de la lista interna con `full-slides`. Esto anula el `composition_id` de cualquier plantilla personalizada.

**Cambio**: Renombrar la función para dejar claro que es solo para uso interno y agregar una función separada para el caso externo.

```typescript
// En remotion-assembly-props.service.ts

// La función existente queda igual pero con nombre más explícito:
export function resolveInternalCompositionId(rawCompositionId: unknown): string {
  if (typeof rawCompositionId === 'string' && INTERNAL_COMPOSITION_IDS.has(rawCompositionId)) {
    return rawCompositionId;
  }
  return DEFAULT_COMPOSITION_ID;
}

// Mantener el alias para no romper imports existentes durante la transición:
export const resolveCompositionId = resolveInternalCompositionId;

// Nueva función para plantillas externas:
export function resolveExternalCompositionId(
  rawCompositionId: unknown,
  fallback: string = DEFAULT_COMPOSITION_ID,
): string {
  if (
    typeof rawCompositionId === 'string' &&
    rawCompositionId.trim().length > 0 &&
    rawCompositionId.length <= 128
  ) {
    return rawCompositionId.trim();
  }
  return fallback;
}
```

**En `remotion-worker.service.ts`**: Reemplazar el uso de `sandboxCompositionId` para usar la nueva función cuando hay una versión sandbox:

```typescript
// remotion-worker.service.ts — línea ~103-107 (sección de resolución de composition)
const internalCompositionId = resolveInternalCompositionId(template.composition_id);
const sandboxCompositionId = sandboxVersion
  ? resolveExternalCompositionId(
      sandboxVersion.entry_point
        ? (template.composition_id ?? internalCompositionId)
        : internalCompositionId,
      internalCompositionId,
    )
  : internalCompositionId;
```

> **Nota**: El `composition_id` para el sandbox debe venir del manifest de la versión (campo a agregar en Fase 2). Por ahora se usa `template.composition_id` con la nueva función.

**Validación**: Test unitario verificando que IDs externos como `CustomBundleSmokeTest` no se reemplazan.

---

### Paso 1.3 — Corregir el wrapper del sandbox para respetar el bundle del template

**Archivo**: `apps/api/src/features/production/sandbox-runner/bundle-cache.ts`

**Problema**: `writeGeneratedRemotionEntry` genera un Root propio que:
- Sólo busca `TemplateModule.MyComposition ?? TemplateModule.default`
- Hardcodea `durationInFrames={300}`, `fps={30}`, `width={1920}`, `height={1080}`
- Si el bundle usa `registerRoot(Root)` con `Root` que tiene múltiples compositions, todo se ignora

**Estrategia recomendada**: Soporte para dos modos de export del bundle:

1. **Modo componente** (`MyComposition` o `default` export): Se crea el wrapper actual (ya funciona para bundles simples).
2. **Modo Root** (`registerRoot` en el entrypoint): Se usa el entrypoint directamente, sin wrapper.

El manifest `courseforge-remotion-template.json` debe declarar `"exportMode": "component" | "root"`.

**Cambio en `bundle-cache.ts`**:

```typescript
// Agregar tipo de modo de export
export type BundleExportMode = 'component' | 'root';

// Modificar writeGeneratedRemotionEntry para soportar ambos modos
async function writeGeneratedRemotionEntry(params: {
  extractedDir: string;
  templateEntryPointPath: string;
  compositionId: string;
  exportMode: BundleExportMode;
  defaultDurationInFrames?: number;
  defaultFps?: number;
  defaultWidth?: number;
  defaultHeight?: number;
}): Promise<string> {
  // Si el bundle ya registra su propio Root, usarlo directamente
  if (params.exportMode === 'root') {
    // No generar wrapper; devolver el entrypoint original
    return params.templateEntryPointPath;
  }

  // Modo componente: comportamiento actual pero con dimensiones configurables
  const durationInFrames = params.defaultDurationInFrames ?? 300;
  const fps = params.defaultFps ?? 30;
  const width = params.defaultWidth ?? 1920;
  const height = params.defaultHeight ?? 1080;

  const generatedDir = path.join(params.extractedDir, '.courseforge');
  const generatedEntryPath = path.join(generatedDir, 'remotion-entry.tsx');
  const templateImportSpecifier = toImportSpecifier(generatedEntryPath, params.templateEntryPointPath);
  const serializedCompositionId = JSON.stringify(params.compositionId);

  await fsp.mkdir(generatedDir, { recursive: true });
  await fsp.writeFile(
    generatedEntryPath,
    [
      "import React from 'react';",
      "import { Composition, registerRoot } from 'remotion';",
      `import * as TemplateModule from '${templateImportSpecifier}';`,
      '',
      'const ExternalComposition = TemplateModule.MyComposition ?? TemplateModule.default;',
      'const calculateMetadata = TemplateModule.calculateMetadata;',
      '',
      'function CourseforgeSandboxRoot() {',
      '  if (!ExternalComposition) {',
      "    throw new Error(",
      "      'External template (component mode) must export MyComposition or a default component.',",
      "    );",
      '  }',
      '  return (',
      '    <Composition',
      `      id={${serializedCompositionId}}`,
      '      component={ExternalComposition}',
      '      calculateMetadata={calculateMetadata}',
      `      durationInFrames={${durationInFrames}}`,
      `      fps={${fps}}`,
      `      width={${width}}`,
      `      height={${height}}`,
      '    />',
      '  );',
      '}',
      '',
      'registerRoot(CourseforgeSandboxRoot);',
      '',
    ].join('\n'),
    'utf8',
  );

  return generatedEntryPath;
}

// Modificar getOrBuildBundle para recibir exportMode y dimensiones del manifest
export async function getOrBuildBundle(params: {
  bundleZipPath: string;
  bundleHash: string;
  entryPoint: string;
  compositionId: string;
  exportMode?: BundleExportMode;
  defaultDurationInFrames?: number;
  defaultFps?: number;
  defaultWidth?: number;
  defaultHeight?: number;
}): Promise<CachedBundle> {
  // ... lógica existente de caché ...
  const exportMode = params.exportMode ?? 'component';
  const generatedEntryPointPath = await writeGeneratedRemotionEntry({
    extractedDir,
    templateEntryPointPath,
    compositionId: params.compositionId,
    exportMode,
    defaultDurationInFrames: params.defaultDurationInFrames,
    defaultFps: params.defaultFps,
    defaultWidth: params.defaultWidth,
    defaultHeight: params.defaultHeight,
  });
  // ...
}
```

**Validación**: Un bundle con `registerRoot(Root)` debe compilar y `selectComposition` debe encontrar la composition registrada por el bundle, no una creada por Courseforge.

---

### Paso 1.4 — Desactivar fallback silencioso en desarrollo

**Archivo**: `apps/api/.env` (o `.env.local`)

Mientras se depura, el fallback silencioso oculta los fallos. Establecer:

```env
EXTERNAL_TEMPLATE_SANDBOX_ENABLED=true
EXTERNAL_TEMPLATE_SANDBOX_FALLBACK_INTERNAL=false
```

Esto fuerza errores explícitos si el bundle no carga, evitando que el sistema produzca un video "correcto" con la composición interna sin avisar.

**Validación**: Un bundle inválido debe resultar en job `FAILED` con `provider_error` descriptivo, no en un video con composición interna.

---

## Fase 2 — Modelo de datos y props contractuales

**Objetivo**: Persistir metadata del bundle y habilitar `resolvedProps` basado en el schema del template.  
**Dependencia**: Fase 1 completada.  
**Tiempo estimado**: 2-3 días.

---

### Paso 2.1 — Agregar columnas faltantes a `remotion_template_versions`

**Archivo**: nueva migración

```sql
-- supabase/migrations/20260627010000_extend_remotion_template_versions.sql

ALTER TABLE public.remotion_template_versions
  ADD COLUMN IF NOT EXISTS template_type text NOT NULL DEFAULT 'custom_bundle'
    CHECK (template_type IN ('simple', 'custom_bundle')),
  ADD COLUMN IF NOT EXISTS export_mode text NOT NULL DEFAULT 'component'
    CHECK (export_mode IN ('component', 'root')),
  ADD COLUMN IF NOT EXISTS composition_id text,
  ADD COLUMN IF NOT EXISTS composition_ids jsonb,
  ADD COLUMN IF NOT EXISTS props_schema jsonb,
  ADD COLUMN IF NOT EXISTS default_props jsonb,
  ADD COLUMN IF NOT EXISTS default_duration_frames integer,
  ADD COLUMN IF NOT EXISTS default_fps integer,
  ADD COLUMN IF NOT EXISTS default_width integer,
  ADD COLUMN IF NOT EXISTS default_height integer,
  ADD COLUMN IF NOT EXISTS build_status text NOT NULL DEFAULT 'PENDING'
    CHECK (build_status IN ('PENDING', 'BUILDING', 'BUILT', 'BUILD_FAILED')),
  ADD COLUMN IF NOT EXISTS build_hash text,
  ADD COLUMN IF NOT EXISTS build_output_path text,
  ADD COLUMN IF NOT EXISTS built_at timestamp with time zone;

COMMENT ON COLUMN public.remotion_template_versions.export_mode IS
  'component: template exporta MyComposition/default. root: template llama registerRoot() propio.';

COMMENT ON COLUMN public.remotion_template_versions.composition_id IS
  'ID de la composition principal declarado en el manifest del bundle.';

COMMENT ON COLUMN public.remotion_template_versions.props_schema IS
  'JSON Schema del contrato de props del bundle, extraído del manifest o del bundle en tiempo de build.';

COMMENT ON COLUMN public.remotion_template_versions.default_props IS
  'Props por defecto declaradas por el bundle en su manifest.';

COMMENT ON COLUMN public.remotion_template_versions.build_hash IS
  'Hash SHA-256 del bundle compilado. Diferente del bundle_hash del ZIP fuente.';
```

---

### Paso 2.2 — Leer manifest `courseforge-remotion-template.json` durante upload

**Archivo**: nuevo servicio `apps/api/src/features/production/template-manifest.service.ts`

El manifest debe declarar:

```json
{
  "entryPoint": "src/index.tsx",
  "compositionId": "CustomBundleSmokeTest",
  "exportMode": "component",
  "defaultDurationFrames": 300,
  "fps": 30,
  "width": 1920,
  "height": 1080,
  "propsSchema": { ... },
  "defaultProps": { ... }
}
```

**Implementación**:

```typescript
// apps/api/src/features/production/template-manifest.service.ts

import JSZip from 'jszip';

export const MANIFEST_FILE_NAME = 'courseforge-remotion-template.json';
const MAX_MANIFEST_BYTES = 64 * 1024;

export interface TemplateBundleManifest {
  entryPoint: string;
  compositionId: string;
  exportMode: 'component' | 'root';
  defaultDurationFrames?: number;
  fps?: number;
  width?: number;
  height?: number;
  propsSchema?: Record<string, unknown>;
  defaultProps?: Record<string, unknown>;
}

export interface ManifestReadResult {
  manifest: TemplateBundleManifest | null;
  error: string | null;
}

export async function readManifestFromZipBuffer(
  zipBuffer: Buffer,
): Promise<ManifestReadResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(zipBuffer);
  } catch {
    return { manifest: null, error: 'ZIP inválido o corrupto' };
  }

  const manifestEntry = zip.file(MANIFEST_FILE_NAME);
  if (!manifestEntry) {
    return {
      manifest: null,
      error: `Manifest '${MANIFEST_FILE_NAME}' no encontrado en el ZIP`,
    };
  }

  const rawBytes = await manifestEntry.async('nodebuffer');
  if (rawBytes.length > MAX_MANIFEST_BYTES) {
    return { manifest: null, error: 'Manifest excede 64KB' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBytes.toString('utf8'));
  } catch {
    return { manifest: null, error: 'Manifest no es JSON válido' };
  }

  const result = validateManifestShape(parsed);
  if (!result.valid) {
    return { manifest: null, error: result.error };
  }

  return { manifest: result.manifest, error: null };
}

function validateManifestShape(
  parsed: unknown,
): { valid: true; manifest: TemplateBundleManifest } | { valid: false; error: string } {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false, error: 'Manifest debe ser un objeto JSON' };
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.entryPoint !== 'string' || !obj.entryPoint.trim()) {
    return { valid: false, error: 'Manifest debe incluir "entryPoint" (string)' };
  }

  if (typeof obj.compositionId !== 'string' || !obj.compositionId.trim()) {
    return { valid: false, error: 'Manifest debe incluir "compositionId" (string)' };
  }

  const exportMode =
    obj.exportMode === 'root' ? 'root' : ('component' as const);

  return {
    valid: true,
    manifest: {
      entryPoint: obj.entryPoint.trim(),
      compositionId: obj.compositionId.trim(),
      exportMode,
      defaultDurationFrames:
        typeof obj.defaultDurationFrames === 'number' ? obj.defaultDurationFrames : undefined,
      fps: typeof obj.fps === 'number' ? obj.fps : undefined,
      width: typeof obj.width === 'number' ? obj.width : undefined,
      height: typeof obj.height === 'number' ? obj.height : undefined,
      propsSchema:
        obj.propsSchema && typeof obj.propsSchema === 'object'
          ? (obj.propsSchema as Record<string, unknown>)
          : undefined,
      defaultProps:
        obj.defaultProps && typeof obj.defaultProps === 'object'
          ? (obj.defaultProps as Record<string, unknown>)
          : undefined,
    },
  };
}
```

**Integración**: Al subir un ZIP y crear/actualizar la `remotion_template_version`, leer el manifest y persistir sus campos en las columnas agregadas en el paso 2.1.

---

### Paso 2.3 — Implementar `resolvedProps` para templates custom

**Archivo**: nuevo servicio `apps/api/src/features/production/resolved-props.service.ts`

```typescript
// apps/api/src/features/production/resolved-props.service.ts

import crypto from 'crypto';

export interface ResolvedPropsInput {
  bundleDefaultProps?: Record<string, unknown>;
  courseProps: Record<string, unknown>;
  userOverrides?: Record<string, unknown>;
}

export interface ResolvedPropsResult {
  resolvedProps: Record<string, unknown>;
  propsHash: string;
}

export function buildResolvedProps(input: ResolvedPropsInput): ResolvedPropsResult {
  const defaults = input.bundleDefaultProps ?? {};
  const merged: Record<string, unknown> = {
    ...defaults,
    ...input.courseProps,
    ...input.userOverrides,
  };

  const resolvedProps = merged;
  const propsHash = stableHash(resolvedProps);

  return { resolvedProps, propsHash };
}

function stableHash(value: unknown): string {
  return crypto
    .createHash('sha256')
    .update(stableStringify(value))
    .digest('hex');
}

function stableStringify(value: unknown): string {
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
```

**Integración**: En `remotion-worker.service.ts`, cuando `templateType === 'custom_bundle'`, usar `buildResolvedProps` en lugar de `buildAssemblyInputProps` y pasar el resultado directamente al sandbox runner.

---

### Paso 2.4 — Actualizar `production_jobs.input_snapshot` con trazabilidad completa

**Archivo**: `apps/api/src/features/production/production.controller.ts`

El `input_snapshot` debe incluir todos los campos necesarios para reproducir exactamente el render:

```typescript
// Reemplazar el inputSnapshot actual (línea ~215-221) con:
const inputSnapshot = {
  templateId,
  templateVersionId: sandboxVersion?.id ?? null,
  bundleHash: sandboxVersion?.bundle_hash ?? null,
  buildHash: sandboxVersion?.build_hash ?? null,          // hash del bundle compilado
  compositionId: sandboxVersion?.composition_id ?? null,  // ID del manifest
  exportMode: sandboxVersion?.export_mode ?? 'component',
  renderMode,
  propsHash: null,      // se llenará en el worker tras buildResolvedProps
  resolvedProps: null,  // se llenará en el worker
  variables,
};
```

Y en `output_snapshot` del worker, incluir `propsHash`, `resolvedProps`, `compositionId`, `exportMode`, `serveUrl`.

---

## Fase 3 — Pipeline de build del sandbox

**Objetivo**: Separar el build como entidad propia, persistir el artefacto compilado y validar que el bundle correcto se ejecuta.  
**Dependencia**: Fases 1 y 2 completadas.  
**Tiempo estimado**: 2-3 días.

---

### Paso 3.1 — Crear tabla `remotion_template_builds`

```sql
-- supabase/migrations/20260627020000_create_remotion_template_builds.sql

CREATE TABLE IF NOT EXISTS public.remotion_template_builds (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  template_version_id uuid NOT NULL
    REFERENCES public.remotion_template_versions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'BUILDING', 'BUILT', 'BUILD_FAILED')),
  bundle_hash text NOT NULL,
  build_hash text,
  entrypoint_path text,
  generated_entrypoint_path text,
  serve_url text,
  build_output_storage_path text,
  composition_id text,
  composition_ids jsonb,
  export_mode text NOT NULL DEFAULT 'component'
    CHECK (export_mode IN ('component', 'root')),
  build_log text,
  built_at timestamp with time zone,
  build_failed_at timestamp with time zone,
  build_error text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT remotion_template_builds_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_remotion_template_builds_version
  ON public.remotion_template_builds (template_version_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_remotion_template_builds_bundle_hash
  ON public.remotion_template_builds (bundle_hash);

ALTER TABLE public.remotion_template_builds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_remotion_template_builds"
  ON public.remotion_template_builds FOR SELECT
  USING (organization_id::text = public.get_active_org_id());
```

---

### Paso 3.2 — Implementar `SandboxBuildService`

**Archivo**: nuevo servicio `apps/api/src/features/production/sandbox-build.service.ts`

Responsabilidades:
- Descargar ZIP de Supabase Storage
- Leer manifest
- Llamar a `getOrBuildBundle` con los parámetros correctos del manifest
- Registrar el build en `remotion_template_builds`
- Actualizar el `build_status` en `remotion_template_versions`

```typescript
// apps/api/src/features/production/sandbox-build.service.ts

import { getOrBuildBundle } from './sandbox-runner/bundle-cache';
import { readManifestFromZipBuffer } from './template-manifest.service';

export interface SandboxBuildInput {
  templateVersionId: string;
  bundleZipPath: string;
  bundleHash: string;
  organizationId: string;
}

export interface SandboxBuildResult {
  success: boolean;
  buildId?: string;
  serveUrl?: string;
  compositionId?: string;
  error?: string;
}

export class SandboxBuildService {
  constructor(private readonly supabase: any) {}

  async buildFromZip(input: SandboxBuildInput): Promise<SandboxBuildResult> {
    const zipBuffer = await this.downloadZip(input.bundleZipPath);
    const { manifest, error: manifestError } = await readManifestFromZipBuffer(zipBuffer);

    if (!manifest) {
      return { success: false, error: manifestError ?? 'Manifest inválido' };
    }

    const { data: build } = await this.supabase
      .from('remotion_template_builds')
      .insert({
        template_version_id: input.templateVersionId,
        organization_id: input.organizationId,
        bundle_hash: input.bundleHash,
        status: 'BUILDING',
        composition_id: manifest.compositionId,
        export_mode: manifest.exportMode,
      })
      .select('id')
      .single();

    if (!build) {
      return { success: false, error: 'No se pudo registrar el build' };
    }

    const zipPath = await this.writeTempZip(zipBuffer, input.bundleHash);

    try {
      const { serveUrl } = await getOrBuildBundle({
        bundleZipPath: zipPath,
        bundleHash: input.bundleHash,
        entryPoint: manifest.entryPoint,
        compositionId: manifest.compositionId,
        exportMode: manifest.exportMode,
        defaultDurationInFrames: manifest.defaultDurationFrames,
        defaultFps: manifest.fps,
        defaultWidth: manifest.width,
        defaultHeight: manifest.height,
      });

      await this.supabase
        .from('remotion_template_builds')
        .update({
          status: 'BUILT',
          serve_url: serveUrl,
          entrypoint_path: manifest.entryPoint,
          built_at: new Date().toISOString(),
        })
        .eq('id', build.id);

      await this.supabase
        .from('remotion_template_versions')
        .update({ build_status: 'BUILT', build_output_path: serveUrl })
        .eq('id', input.templateVersionId);

      return {
        success: true,
        buildId: build.id,
        serveUrl,
        compositionId: manifest.compositionId,
      };
    } catch (err: any) {
      const errorMsg = String(err?.message ?? err ?? 'Build failed');
      await this.supabase
        .from('remotion_template_builds')
        .update({ status: 'BUILD_FAILED', build_error: errorMsg.slice(0, 2000), build_failed_at: new Date().toISOString() })
        .eq('id', build.id);
      return { success: false, error: errorMsg };
    }
  }

  private async downloadZip(storagePath: string): Promise<Buffer> {
    // Lógica de descarga desde Supabase Storage (similar a downloadSandboxBundle en worker)
    throw new Error('Implementar según lógica de resolveBundleStorageLocation');
  }

  private async writeTempZip(buffer: Buffer, bundleHash: string): Promise<string> {
    // Escribir buffer a archivo temporal y devolver la ruta
    throw new Error('Implementar con fs/promises y os.tmpdir()');
  }
}
```

---

### Paso 3.3 — Integrar `SandboxBuildService` en el worker

**Archivo**: `apps/api/src/features/production/remotion-worker.service.ts`

En lugar de llamar directamente a `getOrBuildBundle` desde `ExternalTemplateSandboxRunner`, el worker debe:

1. Verificar si ya existe un build registrado (`remotion_template_builds`) con status `BUILT` para el `bundleHash` + `compositionId`.
2. Si existe, reutilizar el `serveUrl` del build (no recompilar).
3. Si no existe, llamar a `SandboxBuildService.buildFromZip`.
4. Pasar `serveUrl` al runner junto con `compositionId` del manifest.

```typescript
// En runRenderJob, reemplazar la llamada directa al sandbox runner con:
const buildResult = await this.getOrCreateBuild(supabase, {
  templateVersionId: sandboxVersion.id,
  bundleZipPath,
  bundleHash: sandboxVersion.bundle_hash ?? '',
  organizationId: /* del job */,
});

if (!buildResult.success) {
  throw new Error(`Build del bundle falló: ${buildResult.error}`);
}

const sandboxResult = await sandboxRunner.render({
  ...request,
  serveUrl: buildResult.serveUrl,        // pasar serveUrl al runner
  compositionId: buildResult.compositionId ?? sandboxCompositionId,
});
```

---

### Paso 3.4 — Smoke test: bundle de validación

**Objetivo**: Crear un ZIP mínimo que confirme visualmente si el sistema ejecuta el bundle personalizado.

Estructura del ZIP:
```
smoke-test-bundle/
├── courseforge-remotion-template.json
├── package.json
└── src/
    └── index.tsx
```

`courseforge-remotion-template.json`:
```json
{
  "entryPoint": "src/index.tsx",
  "compositionId": "CustomBundleSmokeTest",
  "exportMode": "component",
  "defaultDurationFrames": 90,
  "fps": 30,
  "width": 1920,
  "height": 1080
}
```

`src/index.tsx`:
```tsx
import React from 'react';

export function MyComposition() {
  console.log('CUSTOM_BUNDLE_RENDERED');
  return (
    <div style={{
      backgroundColor: 'red',
      width: 1920,
      height: 1080,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <span style={{ color: 'white', fontSize: 120, fontWeight: 'bold' }}>
        CUSTOM_BUNDLE_RENDERED
      </span>
    </div>
  );
}
```

Si el output del render es un video con fondo rojo y el texto, el sistema ejecuta el bundle correcto.  
Si el output es el video habitual de Courseforge, el bundle no se está ejecutando.

---

## Fase 4 — Preview para plantillas custom

**Objetivo**: El preview debe mostrar la salida del bundle personalizado, no la composición interna.  
**Dependencia**: Fase 3 completada (builds persistidos y accesibles).  
**Tiempo estimado**: 2-3 días.

---

### Paso 4.1 — Agregar endpoint de preview para bundles externos

**Archivo**: nuevo endpoint en `apps/api/src/features/production/` o route en el frontend

El preview de un bundle externo requiere:
1. Resolver el `template_version_id` aprobado (status `APPROVED_FOR_SANDBOX`)
2. Obtener o construir el build (`remotion_template_builds`)
3. Obtener el `serveUrl`
4. Obtener `compositionId` del manifest
5. Construir `resolvedProps` con `buildResolvedProps`
6. Devolver `{ serveUrl, compositionId, resolvedProps, propsHash, buildHash }` al cliente

El cliente carga `@remotion/player` con esos datos en lugar de usar `getAssemblyComposition`.

---

### Paso 4.2 — Agregar `RemotionExternalPreviewPlayer` en el frontend

**Archivo**: nuevo componente en `apps/web/src/domains/materials/components/`

Comportamiento:
- Si `template.template_type === 'simple'` → usar el `RemotionPreviewPlayer` actual (sin cambios)
- Si `template.template_type === 'custom_bundle'` → usar `RemotionExternalPreviewPlayer`

`RemotionExternalPreviewPlayer`:
- Llama al endpoint del paso 4.1 para obtener `serveUrl`, `compositionId`, `resolvedProps`
- Monta `@remotion/player` con esos datos
- Muestra error explícito si no hay versión aprobada o build disponible

**Regla de diseño**: No modificar el player existente. Agregar el nuevo como componente paralelo.

---

### Paso 4.3 — Server action para preview de bundle externo

**Archivo**: `apps/web/src/domains/production/actions/templates.actions.ts`

```typescript
export async function getExternalBundlePreviewDataAction(templateId: string) {
  // 1. Buscar versión APPROVED_FOR_SANDBOX
  // 2. Buscar build BUILT para esa versión
  // 3. Construir resolvedProps base (defaults del manifest)
  // 4. Retornar { serveUrl, compositionId, resolvedProps, propsHash, buildHash, error }
}
```

---

## Fase 5 — Observabilidad y trazabilidad

**Objetivo**: Que cualquier fallo en el pipeline de custom templates sea diagnosticable en <5 minutos sin acceso a la máquina.  
**Dependencia**: Puede implementarse en paralelo a partir de Fase 2.  
**Tiempo estimado**: 1-2 días.

---

### Paso 5.1 — Instrumentar el worker con eventos de trazabilidad

**Archivo**: `apps/api/src/features/production/remotion-worker.service.ts`

Agregar logs estructurados en cada punto de decisión con los campos mínimos requeridos:

```typescript
// Estructura de log estándar para el pipeline de custom templates
interface CustomBundleTraceEvent {
  event: string;
  jobId: string;
  templateId: string;
  templateVersionId: string | null;
  bundleHash: string | null;
  buildHash: string | null;
  compositionId: string | null;
  exportMode: string | null;
  renderMode: string;
  propsHash: string | null;
  serveUrl: string | null;
  error?: string;
}
```

Eventos a instrumentar:

| Evento | Cuándo | Campos clave |
|--------|--------|--------------|
| `sandbox.version.resolved` | Al encontrar/no encontrar versión aprobada | `templateVersionId`, `bundleHash`, `hasVersion` |
| `sandbox.enabled.check` | Al evaluar feature flags | `sandboxEnabled`, `fallbackEnabled`, `commandConfigured` |
| `sandbox.build.resolved` | Al reutilizar o crear build | `buildId`, `buildHash`, `serveUrl`, `cacheHit` |
| `sandbox.composition.selected` | Tras `selectComposition` | `compositionId`, `durationInFrames`, `fps` |
| `sandbox.render.completed` | Render exitoso | `outputPath`, `durationMs` |
| `sandbox.render.failed` | Fallo del sandbox | `error`, `fallbackTriggered` |
| `sandbox.fallback.triggered` | Cuando se usa fallback | `reason`, `fallbackMode` |

---

### Paso 5.2 — Agregar tabla de eventos de template lifecycle

**Archivo**: nueva migración

```sql
-- supabase/migrations/20260627030000_create_template_lifecycle_events.sql

CREATE TABLE IF NOT EXISTS public.remotion_template_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  template_id uuid REFERENCES public.remotion_templates(id) ON DELETE SET NULL,
  template_version_id uuid REFERENCES public.remotion_template_versions(id) ON DELETE SET NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  production_job_id uuid REFERENCES public.production_jobs(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  event_data jsonb NOT NULL DEFAULT '{}',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT remotion_template_events_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_remotion_template_events_template
  ON public.remotion_template_events (template_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_remotion_template_events_version
  ON public.remotion_template_events (template_version_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_remotion_template_events_job
  ON public.remotion_template_events (production_job_id);

ALTER TABLE public.remotion_template_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_remotion_template_events"
  ON public.remotion_template_events FOR SELECT
  USING (organization_id::text = public.get_active_org_id());
```

---

### Paso 5.3 — Checklist de diagnóstico para debugging activo

Antes de reportar un problema con custom templates, verificar en orden:

1. `remotion_template_versions` → ¿Existe versión con `status = 'APPROVED_FOR_SANDBOX'`?
2. Variables de entorno → `EXTERNAL_TEMPLATE_SANDBOX_ENABLED=true`, `EXTERNAL_TEMPLATE_SANDBOX_COMMAND` configurado
3. `EXTERNAL_TEMPLATE_SANDBOX_FALLBACK_INTERNAL` → debe ser `false` en debugging
4. `production_jobs.input_snapshot` → ¿`templateVersionId` es no nulo? ¿`renderMode = EXTERNAL_SANDBOX_CANDIDATE`?
5. `production_jobs.output_snapshot` → ¿`renderMode = EXTERNAL_SANDBOX`?
6. Logs del worker → ¿`sandbox.version.resolved` aparece con `hasVersion=true`?
7. `remotion_template_builds` → ¿Existe build con `status = 'BUILT'` para el `bundle_hash`?
8. Logs del bundle → ¿Aparece `CUSTOM_BUNDLE_RENDERED` (si usaste el smoke test)?
9. Output visual → ¿El video tiene fondo rojo? (confirmación definitiva)

---

## Tabla de prioridades y orden de ejecución

| Paso | Descripción | Prioridad | Dependencia | Riesgo de regresión |
|------|-------------|-----------|-------------|---------------------|
| 1.1 | Agregar `APPROVED_FOR_SANDBOX` al constraint | CRÍTICO | Ninguna | Ninguno (solo agrega valor) |
| 1.2 | Separar `resolveCompositionId` interno/externo | CRÍTICO | Ninguna | Bajo (alias mantiene compatibilidad) |
| 1.4 | Desactivar fallback silencioso | CRÍTICO | Ninguna | Ninguno (solo config) |
| 1.3 | Corregir wrapper del sandbox | ALTO | 1.1, 1.2 | Medio (cambia generación del entry point) |
| 2.1 | Columnas en `remotion_template_versions` | ALTO | 1.1 | Ninguno (solo ADD COLUMN) |
| 2.2 | Leer manifest del ZIP | ALTO | 2.1 | Bajo (nuevo servicio) |
| 2.3 | `resolvedProps` para templates custom | ALTO | 2.2 | Bajo (nuevo servicio) |
| 2.4 | Actualizar `input_snapshot` | ALTO | 2.1, 2.3 | Bajo (campo adicional) |
| 3.1 | Tabla `remotion_template_builds` | MEDIO | 2.1 | Ninguno |
| 3.2 | `SandboxBuildService` | MEDIO | 3.1, 2.2 | Bajo (nuevo servicio) |
| 3.3 | Integrar build service en worker | MEDIO | 3.2 | Medio (modifica worker) |
| 3.4 | Smoke test bundle | MEDIO | 1.3 | Ninguno |
| 4.1 | Endpoint de preview externo | MEDIO | 3.2 | Bajo (nuevo endpoint) |
| 4.2 | `RemotionExternalPreviewPlayer` | MEDIO | 4.1 | Bajo (componente paralelo) |
| 4.3 | Server action preview | MEDIO | 4.1 | Bajo |
| 5.1 | Logs estructurados en worker | BAJO | Ninguna | Ninguno |
| 5.2 | Tabla de lifecycle events | BAJO | Ninguna | Ninguno |
| 5.3 | Checklist de diagnóstico | BAJO | Ninguna | Ninguno |

---

## Variables de entorno requeridas

```env
# Sandbox habilitado (crítico para activar el flujo externo)
EXTERNAL_TEMPLATE_SANDBOX_ENABLED=true

# Comando que ejecuta el sandbox runner externo
# Ejemplo local: node scripts/test-sandbox-runner.mjs
EXTERNAL_TEMPLATE_SANDBOX_COMMAND=node /ruta/al/sandbox-runner.mjs

# Timeout del sandbox (default 10 minutos)
EXTERNAL_TEMPLATE_SANDBOX_TIMEOUT_MS=600000

# Fallback a composición interna si el sandbox falla
# DEBE ser false durante debugging para forzar errores explícitos
EXTERNAL_TEMPLATE_SANDBOX_FALLBACK_INTERNAL=false

# Timeout del render (interno y externo)
EXTERNAL_TEMPLATE_RENDER_TIMEOUT_MS=180000
```

---

## Archivos afectados por fase

### Fase 1
- `supabase/migrations/20260627000000_add_approved_for_sandbox_status.sql` (nuevo)
- `apps/api/src/features/production/remotion-assembly-props.service.ts` (modificar)
- `apps/api/src/features/production/remotion-worker.service.ts` (modificar)
- `apps/api/src/features/production/sandbox-runner/bundle-cache.ts` (modificar)

### Fase 2
- `supabase/migrations/20260627010000_extend_remotion_template_versions.sql` (nuevo)
- `apps/api/src/features/production/template-manifest.service.ts` (nuevo)
- `apps/api/src/features/production/resolved-props.service.ts` (nuevo)
- `apps/api/src/features/production/production.controller.ts` (modificar)

### Fase 3
- `supabase/migrations/20260627020000_create_remotion_template_builds.sql` (nuevo)
- `apps/api/src/features/production/sandbox-build.service.ts` (nuevo)
- `apps/api/src/features/production/remotion-worker.service.ts` (modificar)
- `apps/api/src/features/production/sandbox-runner/bundle-cache.ts` (modificar — ya incluido en Fase 1)
- `smoke-test-bundle/` (nuevo, solo para testing)

### Fase 4
- `apps/web/src/domains/materials/components/RemotionExternalPreviewPlayer.tsx` (nuevo)
- `apps/web/src/domains/production/actions/templates.actions.ts` (modificar)

### Fase 5
- `supabase/migrations/20260627030000_create_template_lifecycle_events.sql` (nuevo)
- `apps/api/src/features/production/remotion-worker.service.ts` (modificar — logs adicionales)

---

## Riesgos residuales y mitigaciones

| Riesgo | Probabilidad | Mitigación |
|--------|-------------|------------|
| Bundle con `registerRoot` y múltiples compositions no selecciona la correcta | Media | Paso 1.3 + manifest `compositionId` obligatorio |
| Cache de bundle usa ZIP anterior cuando sube uno nuevo | Media | Hash del ZIP en `bundle_hash` + nueva versión genera nuevo hash |
| Fallback silencioso oculta fallos tras activar sandbox | Alta | Paso 1.4: desactivar fallback en debugging |
| Props internas de Courseforge anulan props del bundle | Alta | Fase 2: `resolvedProps` basado en manifest, no en `buildAssemblyInputProps` |
| URL de ngrok en `serveUrl` guardada en DB permanece | Media | Nunca persistir `serveUrl` de ngrok en DB; solo el path del build compilado |
| Idempotency key reutiliza job sin reflejar nuevo bundle | Media | Fase 2.4: incluir `bundleHash` y `buildHash` en la key |

---

## Criterio de éxito por fase

**Fase 1 completada**: Un job de render con versión `APPROVED_FOR_SANDBOX` y `EXTERNAL_TEMPLATE_SANDBOX_ENABLED=true` produce `output_snapshot.renderMode = "EXTERNAL_SANDBOX"` (no `INTERNAL_COMPOSITION`).

**Fase 2 completada**: `production_jobs.input_snapshot` contiene `templateVersionId`, `bundleHash`, `compositionId`, `propsHash` y `resolvedProps` no nulos para jobs de plantillas custom.

**Fase 3 completada**: El smoke test bundle produce un video con fondo rojo y texto `CUSTOM_BUNDLE_RENDERED`. Los logs del worker muestran el `compositionId = "CustomBundleSmokeTest"`, no `full-slides`.

**Fase 4 completada**: El preview de un componente con plantilla custom muestra el bundle personalizado (fondo rojo del smoke test), no el preview interno.

**Fase 5 completada**: Un fallo en el pipeline de custom templates produce un evento en `remotion_template_events` con error descriptivo, `templateVersionId`, `bundleHash` y `compositionId` dentro de los 30 segundos de ocurrido el fallo.