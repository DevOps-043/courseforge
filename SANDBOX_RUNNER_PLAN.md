# Plan: External Template Sandbox Runner

## Contexto y diagnóstico previo

### Por qué ambas plantillas producen el mismo resultado hoy

El flujo actual cuando llega un render job:

```
remotion-worker.service.ts
  ↓ resolveCompositionId(template.composition_id)
    → "alternating-focus-v1" ∉ VALID_COMPOSITION_IDS → devuelve "full-slides"
  ↓ buildAssemblyInputProps({ compositionId: "full-slides" })
  ↓ getApprovedSandboxVersion() → encuentra la versión
  ↓ sandboxRunner.isEnabled() → false (EXTERNAL_TEMPLATE_SANDBOX_ENABLED no está activo)
  ↓ renderInternalComposition({ compositionId: "full-slides" })
  → Root.tsx → FullSlides.tsx  ← misma composición siempre
```

El ZIP se guarda y valida estáticamente, pero nunca se ejecuta. El render siempre cae a las composiciones internas.

### Qué hay que construir

Un proceso Node.js independiente (`sandbox-runner`) que:
1. Recibe la request de render por stdin como JSON
2. Extrae el ZIP del bundle al disco
3. Bundlea el código con `@remotion/bundler`
4. Renderiza con `@remotion/renderer` y la composición correcta
5. Emite `{ outputPath }` por stdout y sale con código 0

---

## Arquitectura objetivo

```
Worker (remotion-worker.service.ts)
  spawn($EXTERNAL_TEMPLATE_SANDBOX_COMMAND) ──stdin──► Sandbox Runner
                                             ◄─stdout── { outputPath } | { error }

Sandbox Runner (nuevo: apps/api/src/features/production/sandbox-runner/index.ts)
  1. Lee stdin → ExternalTemplateSandboxRequest
  2. Extrae ZIP → {tmpdir}/courseforge-sandbox-bundles/{bundleHash}/extracted/
  3. bundle() → {tmpdir}/courseforge-sandbox-bundles/{bundleHash}/bundle/
  4. selectComposition({ id: request.compositionId })
  5. renderMedia() → {tmpdir}/courseforge-sandbox-out-{jobId}/output.mp4
  6. stdout: { outputPath }
  7. exit(0)
```

Los pasos 2 y 3 se cachean por `bundleHash`: si los directorios ya existen, se saltan.

---

## Archivos involucrados

| Acción | Archivo |
|---|---|
| **Crear** | `apps/api/src/features/production/sandbox-runner/index.ts` |
| **Crear** | `apps/api/src/features/production/sandbox-runner/props-adapter.ts` |
| **Crear** | `apps/api/src/features/production/sandbox-runner/bundle-cache.ts` |
| **Ajuste menor** | `apps/api/src/features/production/remotion-worker.service.ts` |
| **Ajuste menor** | `apps/api/src/features/production/remotion-assembly-props.service.ts` |
| **Env vars** | `.env` del API (o configuración del entorno de despliegue) |

---

## Paso 1 — `bundle-cache.ts`: extracción y cacheo de bundles

**Objetivo**: dado un `bundleZipPath` y un `bundleHash`, garantizar que el código fuente esté extraído y el bundle de Remotion esté compilado, sin repetir trabajo si ya existe.

```
{CACHE_ROOT}/{bundleHash}/
  extracted/           ← código fuente del ZIP
    src/
      index.tsx
    package.json
    courseforge-remotion-template.json
  bundle/              ← salida de @remotion/bundler (serve URL apuntando aquí)
    index.html
    ...assets...
```

`CACHE_ROOT` = `path.join(os.tmpdir(), 'courseforge-sandbox-bundles')`

**Interfaz a implementar**:

```typescript
export interface CachedBundle {
  extractedDir: string;   // ruta donde está el código fuente
  serveUrl: string;       // serve URL de @remotion/bundler (file:// path)
}

export async function getOrBuildBundle(params: {
  bundleZipPath: string;
  bundleHash: string;
  entryPoint: string;       // ej: "src/index.tsx"
}): Promise<CachedBundle>
```

**Lógica interna**:

1. `extractedDir = path.join(CACHE_ROOT, bundleHash, 'extracted')`
2. `bundleDir = path.join(CACHE_ROOT, bundleHash, 'bundle')`
3. Si `bundleDir` ya existe → asumir que el bundle está listo, devolver `{ extractedDir, serveUrl: bundleDir }`.
4. Si no: extraer con `JSZip` (ya en `package.json`) entrada a entrada, respetando la estructura de directorios.
5. Llamar `await bundle({ entryPoint: path.join(extractedDir, entryPoint), outDir: bundleDir })`.
6. Devolver `{ extractedDir, serveUrl: bundleDir }`.

**Advertencias de implementación**:

- Sanitizar rutas al extraer el ZIP (path traversal): rechazar cualquier entrada cuya ruta resuelta salga de `extractedDir`.
- El bundle de Remotion espera que las dependencias (`react`, `remotion`) estén resolvibles. El ZIP no lleva `node_modules`. Hay dos opciones:
  - **Opción A (recomendada para MVP)**: configurar `webpackOverride` en `bundle()` para que Remotion resuelva `react` y `remotion` desde los `node_modules` de la API, no del ZIP. Esto funciona porque el ZIP solo trae código fuente, no deps.
  - **Opción B**: instalar deps del ZIP antes de bundlear (`npm install --prefix extractedDir`). Más costoso y potencialmente inseguro.

  La opción A requiere una función de override en la llamada a `bundle()`:

  ```typescript
  import { bundle } from '@remotion/bundler';
  import { webpackOverride } from './webpack-override'; // pequeño helper

  await bundle({
    entryPoint,
    outDir: bundleDir,
    webpackOverride: (config) => ({
      ...config,
      resolve: {
        ...config.resolve,
        modules: [
          path.resolve(__dirname, '../../../../node_modules'), // node_modules del API
          'node_modules',
        ],
      },
    }),
  });
  ```

---

## Paso 2 — `props-adapter.ts`: mapeo de AssemblyInputProps → TemplateProps

El worker envía `AssemblyInputProps` (el tipo interno de la app). Las plantillas externas esperan `TemplateProps`:

```typescript
// Forma que los templates externos exponen
type ExternalTemplateProps = {
  slides?: { index: number; url: string }[];
  brollClips?: { url: string; durationInFrames: number; order: number }[];
  avatarVideoUrl?: string;
  totalDurationInFrames?: number;
}
```

`AssemblyInputProps` ya tiene todos esos campos con los mismos nombres. El adaptador es una copia simple más la validación:

```typescript
export function adaptToExternalTemplateProps(inputProps: unknown): Record<string, unknown> {
  const props = inputProps as any;
  return {
    slides: Array.isArray(props.slides) ? props.slides : [],
    brollClips: Array.isArray(props.brollClips) ? props.brollClips : [],
    avatarVideoUrl: typeof props.avatarVideoUrl === 'string' ? props.avatarVideoUrl : undefined,
    totalDurationInFrames: typeof props.totalDurationInFrames === 'number' ? props.totalDurationInFrames : undefined,
    // Pasar campos adicionales por si la plantilla los usa
    voiceAudioUrl: typeof props.voiceAudioUrl === 'string' ? props.voiceAudioUrl : undefined,
    bgMusicUrl: typeof props.bgMusicUrl === 'string' ? props.bgMusicUrl : undefined,
    bgMusicVolume: typeof props.bgMusicVolume === 'number' ? props.bgMusicVolume : 0.15,
    fps: typeof props.fps === 'number' ? props.fps : 30,
    templateConfig: typeof props.templateConfig === 'object' ? props.templateConfig : {},
  };
}
```

---

## Paso 3 — `index.ts`: el runner principal

**Flujo completo**:

```typescript
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ensureBrowser, renderMedia, selectComposition } from '@remotion/renderer';
import { getOrBuildBundle } from './bundle-cache';
import { adaptToExternalTemplateProps } from './props-adapter';
import type { ExternalTemplateSandboxRequest } from '../external-template-sandbox-runner.service';

async function main() {
  // 1. Leer stdin completo
  const payload = await readStdin();
  const request: ExternalTemplateSandboxRequest = JSON.parse(payload);

  // 2. Validación básica de la request
  validateRequest(request);  // lanza Error si falta campo crítico

  // 3. Extraer y bundlear (con caché por bundleHash)
  const { serveUrl } = await getOrBuildBundle({
    bundleZipPath: request.bundleZipPath,
    bundleHash: request.bundleHash,
    entryPoint: request.entryPoint,
  });

  // 4. Preparar browser
  await ensureBrowser();

  // 5. Adaptar props
  const inputProps = adaptToExternalTemplateProps(request.inputProps);

  // 6. Seleccionar composición
  const composition = await selectComposition({
    serveUrl,
    id: request.compositionId,
    inputProps,
  });

  // 7. Directorio de output
  const outputDir = path.join(os.tmpdir(), `courseforge-sandbox-out-${request.jobId}`);
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'output.mp4');

  // 8. Render
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: outputPath,
    inputProps,
  });

  // 9. Emitir resultado
  process.stdout.write(JSON.stringify({ outputPath }));
  process.exit(0);
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({ error: String(err?.message || err) }));
  process.exit(1);
});
```

**`readStdin()`**: leer hasta EOF respetando el límite `MAX_STDOUT_BYTES` del runner (`1 MB`).

```typescript
function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}
```

---

## Paso 4 — Ajuste en `remotion-worker.service.ts`

**Problema actual**: `compositionId` se resuelve con `resolveCompositionId()` antes de decidir si vamos a sandbox. Eso es correcto para el path interno, pero el `inputProps.template` queda como `"full-slides"`.

Las plantillas externas no leen `inputProps.template`, así que esto no rompe nada. Pero para que el worker pase el `compositionId` correcto al sandbox se necesita un pequeño refactor de orden:

**Cambio propuesto** (líneas ~102–131):

```typescript
// Antes (problema): compositionId filtrado se usa para todo
const compositionId = resolveCompositionId(template.composition_id);
const inputProps = buildAssemblyInputProps({ assets, compositionId, ... });
const sandboxResult = await sandboxRunner.render({
  compositionId: template.composition_id || compositionId,  // raw o filtrado
  inputProps,  // inputProps.template = "full-slides" (filtrado)
  ...
});

// Después (limpio): separar el compositionId para sandbox del interno
const internalCompositionId = resolveCompositionId(template.composition_id);
const sandboxCompositionId = template.composition_id || internalCompositionId;

const inputProps = buildAssemblyInputProps({
  assets,
  compositionId: internalCompositionId,  // solo cambia inputProps.template
  ...
});

// Para sandbox: usar sandboxCompositionId explícitamente
const sandboxResult = await sandboxRunner.render({
  compositionId: sandboxCompositionId,   // "alternating-focus-v1"
  inputProps,
  ...
});
```

Este cambio hace el código más explícito y elimina la ambigüedad del `||`.

---

## Paso 5 — Ajuste en `remotion-assembly-props.service.ts`

El `VALID_COMPOSITION_IDS` y `resolveCompositionId` son correctos para el path interno (solo acepta composiciones registradas en `Root.tsx`). **No cambiar** esta función — el sandbox runner no la usa.

Lo que sí conviene documentar (o extraer a constante con nombre) es que este filtro es intencional y solo aplica al render interno:

```typescript
// Solo composiciones registradas en apps/web/src/remotion/Root.tsx
const INTERNAL_COMPOSITION_IDS = new Set(['full-slides', 'split-avatar', 'avatar-focus']);
```

Renombrar `VALID_COMPOSITION_IDS` → `INTERNAL_COMPOSITION_IDS` para que quede claro que el sandbox externo puede usar IDs fuera de este set.

---

## Paso 6 — Configuración de entorno (`.env`)

Variables nuevas que hay que definir en el entorno del API:

```env
# Habilita la ejecución de bundles externos en sandbox
EXTERNAL_TEMPLATE_SANDBOX_ENABLED=true

# Comando que lanza el runner. Después de `npm run build` en apps/api:
EXTERNAL_TEMPLATE_SANDBOX_COMMAND=node /ruta/absoluta/apps/api/dist/features/production/sandbox-runner/index.js

# Timeout para el render completo (10 minutos)
EXTERNAL_TEMPLATE_SANDBOX_TIMEOUT_MS=600000

# Si el sandbox falla, caer al render interno en lugar de marcar el job como FAILED
EXTERNAL_TEMPLATE_SANDBOX_FALLBACK_INTERNAL=true
```

En desarrollo local, el comando puede ser con `ts-node` para evitar el paso de build:

```env
EXTERNAL_TEMPLATE_SANDBOX_COMMAND=npx ts-node apps/api/src/features/production/sandbox-runner/index.ts
```

---

## Paso 7 — Script de prueba manual

Crear `scripts/test-sandbox-runner.mjs` para poder probar el runner sin tener que disparar un job completo:

```javascript
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Request de prueba con el bundle ya descargado
const request = {
  jobId: 'test-001',
  templateVersionId: 'test-version-id',
  bundleHash: 'test-hash-alternating-v2',
  bundleZipPath: path.resolve('./remotion-template-alternating-v2.zip'),
  entryPoint: 'src/index.tsx',
  compositionId: 'alternating-focus-v1',
  inputProps: {
    template: 'alternating-focus-v1',
    fps: 30,
    totalDurationInFrames: 300,
    avatarVideoUrl: undefined,
    slides: [],
    brollClips: [],
    transitionType: 'fade',
    templateConfig: {
      accentColor: '#00D4B3',
      backgroundColor: '#000000',
      surfaceColor: '#151A21',
      transitionType: 'fade',
      avatarPosition: 'bottom-right',
      avatarScale: 0.24,
      supportStripHeight: 0.22,
      backgroundStyle: 'gradient',
    },
  },
  assetAllowlist: [],
};

const child = spawn(
  'node',
  ['apps/api/dist/features/production/sandbox-runner/index.js'],
  { stdio: ['pipe', 'pipe', 'inherit'] }
);

child.stdin.end(JSON.stringify(request));

let stdout = '';
child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });

child.on('exit', (code) => {
  console.log('Exit code:', code);
  console.log('Output:', stdout);
  try {
    const result = JSON.parse(stdout);
    if (result.outputPath && fs.existsSync(result.outputPath)) {
      console.log('✓ Video generado en:', result.outputPath);
    } else {
      console.error('✗ Error:', result.error);
    }
  } catch {
    console.error('Output no es JSON válido');
  }
});
```

---

## Modelo de seguridad

### Lo que ya está implementado

| Control | Dónde | Estado |
|---|---|---|
| Env vars mínimas (sin Supabase keys, sin API keys) | `buildSandboxEnv()` en `external-template-sandbox-runner.service.ts` | ✅ Implementado |
| Timeout configurable con SIGKILL | Mismo archivo | ✅ Implementado |
| Sanitización de secretos en logs de error | `sanitizeMessage()` | ✅ Implementado |
| Validación estática del ZIP antes de aprobar | `bundle-validator.ts` | ✅ Implementado |
| Doble aprobación (audit + sandbox) | `approveTemplateVersionAction` + `approveTemplateVersionForSandboxAction` | ✅ Implementado |

### Lo que falta / limitaciones conocidas

| Riesgo | Impacto | Mitigación recomendada |
|---|---|---|
| El template puede leer archivos del disco del servidor | Alto | A futuro: ejecutar en Docker o con `firejail` |
| No hay límite de memoria | Medio | Añadir `--max-old-space-size=2048` al comando del runner |
| Las URLs de assets se pasan pero no se validan en red | Bajo | El Chrome headless solo fetchea lo que el template solicita; las URLs están en el allowlist |
| Extracción de ZIP sin sanitización de rutas | Alto | **Implementar** path traversal check al extraer (ver Paso 1) |

### Path traversal check (obligatorio al implementar el Paso 1)

```typescript
// Al extraer cada entrada del ZIP:
const entryPath = path.resolve(extractedDir, entry.name);
if (!entryPath.startsWith(path.resolve(extractedDir) + path.sep)) {
  throw new Error(`Path traversal detectado en entrada del ZIP: ${entry.name}`);
}
```

---

## Secuencia de implementación

```
1. bundle-cache.ts
   ├── Lógica de extracción con JSZip
   ├── Path traversal check
   └── Llamada a bundle() con webpackOverride

2. props-adapter.ts
   └── adaptToExternalTemplateProps()

3. sandbox-runner/index.ts
   ├── readStdin()
   ├── validateRequest()
   ├── getOrBuildBundle()
   ├── selectComposition()
   └── renderMedia()

4. remotion-worker.service.ts
   └── Separar internalCompositionId / sandboxCompositionId

5. remotion-assembly-props.service.ts
   └── Renombrar VALID_COMPOSITION_IDS → INTERNAL_COMPOSITION_IDS

6. npm run build (en apps/api)

7. Configurar .env

8. node scripts/test-sandbox-runner.mjs (prueba local)

9. Test de integración: job completo con plantilla alternating-v2
```

---

## Criterios de aceptación

- [ ] `scripts/test-sandbox-runner.mjs` genera un archivo `.mp4` válido en el directorio tmp.
- [ ] El video del test muestra visualmente la lógica de `AlternatingFocus` (no `FullSlides`).
- [ ] Un job de producción con plantilla `alternating-v2` aprobada para sandbox genera un video diferente al de `advanced-v2`.
- [ ] Si el runner falla (ej. composición inválida), el job cae al render interno sin marcar error (con `FALLBACK_INTERNAL=true`).
- [ ] El mismo ZIP no se re-extrae ni re-bundlea en renders consecutivos (verificar que el directorio de caché persiste entre llamadas).
- [ ] El runner no tiene acceso a `SUPABASE_SERVICE_ROLE_KEY` ni otras variables de producción (verificar en logs del child process).

---

## Dependencias externas

Todas ya disponibles en `apps/api/package.json`:

| Paquete | Uso |
|---|---|
| `@remotion/bundler` `^4.0.474` | `bundle()` |
| `@remotion/renderer` `^4.0.474` | `selectComposition()`, `renderMedia()`, `ensureBrowser()` |
| `remotion` `^4.0.474` | Tipos y runtime |
| `jszip` `^3.10.1` | Extracción del ZIP |

No se necesitan dependencias nuevas.
