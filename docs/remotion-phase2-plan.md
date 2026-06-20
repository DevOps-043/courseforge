# Fase 2 — Bundles Remotion Pre-compilados + Render Externo

## Contexto

**Fase 1** implementó un flujo de auditoría para ZIPs de Remotion: se suben, se validan estáticamente (sin ejecución), y pasan por un workflow de aprobación (`PENDING_REVIEW → APPROVED`). Los bundles nunca se ejecutan.

**Fase 2** habilita que bundles APPROVED **realmente se usen para renderizar videos MP4**. El cambio clave de diseño: el ZIP debe contener el **output de `remotion bundle`** (archivos estáticos pre-compilados por webpack), no código fuente. Esto elimina `npm install` y la compilación en tiempo de render.

> El Express API (`apps/api/`) ya tiene `@remotion/bundler` y `@remotion/renderer` instalados con un sistema de render por child processes funcional. La Fase 2 reutiliza esta infraestructura añadiendo una ruta de render "externo" que descarga el ZIP aprobado, lo extrae a un directorio temporal, lo sirve via HTTP local, y pasa la URL al child process existente.

---

## Cambio de formato del ZIP

### Antes — Fase 1 (código fuente)
```
courseforge-remotion-template.json   ← { entryPoint: "src/index.tsx" }
src/index.tsx
package.json
```

### Después — Fase 2 (pre-compilado)
```
courseforge-remotion-template.json   ← { bundleEntry: "index.html" }
index.html                           ← output de `remotion bundle`
bundle.js                            ← webpack bundle (~MB)
... otros chunks estáticos
```

**Instrucción para el desarrollador del bundle:**
```bash
npx remotion bundle src/index.tsx --out=dist/
# Luego zipar: courseforge-remotion-template.json + contenido de dist/
```

---

## Plan de implementación

### 1 — Actualizar `bundle-validator.ts`

**Archivo:** `apps/web/src/domains/production/validation/bundle-validator.ts`

| Qué cambia | Detalle |
|---|---|
| Campo manifest | `entryPoint` (con extensión `.tsx/.ts/.jsx/.js`) → `bundleEntry` (cualquier archivo, típicamente `index.html`) |
| Validación entry | Verificar que `bundleEntry` exista en el ZIP como archivo regular |
| Eliminar | Chequeo de extensión de código fuente |
| Eliminar | Allowlist de dependencias npm (irrelevante para pre-compilado) |
| Conservar | Límites tamaño (10 MB), conteo archivos (1000), prevención path traversal, hash SHA-256 |
| Agregar | Campo `bundleType: "PRECOMPILED"` en `ValidationReport.info` |

---

### 2 — Actualizar `generate-test-zip.ts` y `test-validator.ts`

**Archivos:**
- `apps/web/src/domains/production/validation/generate-test-zip.ts`
- `apps/web/src/domains/production/validation/test-validator.ts`

El test ZIP pasa a generar estructura de bundle pre-compilado mínima:
```
courseforge-remotion-template.json   → { bundleEntry: "index.html", compositionId: "full-slides" }
index.html                           → HTML stub con <script src="bundle.js">
bundle.js                            → JS stub vacío (suficiente para pasar validación)
```

En `test-validator.ts`, actualizar los test cases al nuevo schema (`bundleEntry` en lugar de `entryPoint`). Añadir test que verifica que ZIPs con el schema antiguo (`entryPoint`) fallan con mensaje claro.

---

### 3 — Migración de base de datos

**Archivo nuevo:** `supabase/migrations/20260617120000_add_precompiled_fields.sql`

```sql
-- bundle_type distingue código fuente (Fase 1) de bundle pre-compilado (Fase 2)
-- test_render_url almacena el MP4 de prueba generado al probar el bundle aprobado
ALTER TABLE public.remotion_template_versions
  ADD COLUMN IF NOT EXISTS bundle_type text NOT NULL DEFAULT 'PRECOMPILED'
    CHECK (bundle_type IN ('SOURCE', 'PRECOMPILED')),
  ADD COLUMN IF NOT EXISTS test_render_url text;

-- Versiones existentes (Fase 1) eran código fuente
UPDATE public.remotion_template_versions
SET bundle_type = 'SOURCE'
WHERE created_at < NOW();

COMMENT ON COLUMN public.remotion_template_versions.bundle_type IS
  'SOURCE = código fuente (Fase 1, no ejecutable). PRECOMPILED = output de remotion bundle (Fase 2, renderizable).';
COMMENT ON COLUMN public.remotion_template_versions.test_render_url IS
  'URL pública del MP4 de prueba generado al ejecutar el render de validación del bundle.';
```

Actualizar interfaz `RemotionTemplateVersion` en `apps/web/src/domains/production/actions/templates.actions.ts`:
```typescript
bundle_type: "SOURCE" | "PRECOMPILED";
test_render_url: string | null;
```

---

### 4 — Dockerfile para `apps/api/`

**Archivo nuevo:** `apps/api/Dockerfile`

```dockerfile
FROM node:20-slim

# Chromium y fuentes para @remotion/renderer
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-noto-color-emoji \
    fonts-liberation \
    --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV CHROME_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

EXPOSE 4000
CMD ["node", "dist/server.js"]
```

**Archivo nuevo:** `apps/api/.dockerignore`
```
node_modules
dist
*.log
.env*
```

---

### 5 — Servicio de render externo

**Archivo nuevo:** `apps/api/src/features/production/remotion-external-bundle.service.ts`

Responsabilidades y métodos:

```
downloadBundle(storagePath: string): Promise<Buffer>
  └── Descarga ZIP de Supabase bucket "production-assets"

extractBundle(buffer: Buffer, tempDir: string): Promise<void>
  └── Extrae con unzipper/jszip al directorio temporal

serveBundle(bundleDir: string): Promise<{ serveUrl: string; close: () => void }>
  └── http.createServer + serve-static en puerto efímero
  └── Retorna URL local (ej. http://localhost:49231) y función de cierre

renderExternalBundle(params: ExternalBundleRenderParams): Promise<string>
  └── Orquesta: download → extract → serve → render → cleanup
  └── Retorna URL pública del MP4 en Supabase Storage
```

**`ExternalBundleRenderParams`:**
```typescript
interface ExternalBundleRenderParams {
  versionId: string;
  storagePath: string;          // path del ZIP en "production-assets"
  compositionId: string;        // del manifest del bundle
  durationInFrames: number;     // para el test render (default: 150 = 5s a 30fps)
  outputStoragePath: string;    // destino en "production-videos"
}
```

**Integración con el worker existente:**

El `RemotionWorkerService.runRenderJob()` ya acepta un `serveUrl` opcional que omite la fase de bundling. Para bundles externos, `resolveCompositionId()` actualmente valida contra `['full-slides', 'split-avatar', 'avatar-focus']`. Solución: añadir un método `renderWithExternalServeUrl(serveUrl, compositionId, inputProps)` que bypasse esa validación y use la compositionId del manifest directamente.

---

### 6 — Nueva ruta API: test render

**Archivo a modificar:** `apps/api/src/features/production/production.controller.ts`

```
POST /api/render/external-bundle
Authorization: Bearer <token>  (rol ADMIN / ARQUITECTO / SUPERADMIN)
Body: {
  templateVersionId: string,
  durationInSeconds?: number    // default: 5
}
```

Flujo:
1. Verificar rol del usuario (solo ADMIN/ARQUITECTO/SUPERADMIN)
2. Fetch de la versión en `remotion_template_versions` — verificar `status = "APPROVED"` y `bundle_type = "PRECOMPILED"`
3. Llamar a `renderExternalBundle` con `inputProps` mínimos:
   ```json
   { "fps": 30, "totalDurationInFrames": 150, "slides": [], "brollClips": [] }
   ```
   *(el bundle debe manejar gracefully assets vacíos — responsabilidad del desarrollador)*
4. Subir MP4 a `production-videos/test-renders/{versionId}.mp4`
5. Actualizar `remotion_template_versions.test_render_url`
6. Retornar `{ success: true, videoUrl: "..." }`

---

### 7 — Acción de servidor y UI

**`apps/web/src/domains/production/actions/templates.actions.ts`** — agregar:
```typescript
export async function triggerTestRenderAction(
  versionId: string
): Promise<{ success: boolean; videoUrl?: string; error?: string }>
```
Llama al endpoint `POST /api/render/external-bundle` del Express API.

**`apps/web/src/app/admin/templates/TemplatesContainer.tsx`** — en versiones con `status === "APPROVED"` y `bundle_type === "PRECOMPILED"`:
- Botón "Probar Render" (ícono `Play`)
- Si `test_render_url` ya existe, mostrar miniatura/link del video previo
- Estado local: `"idle" | "rendering" | "done" | "error"`
- Al completar, mostrar `<video>` inline con el MP4 resultante

---

## Archivos a modificar / crear

| Archivo | Acción |
|---|---|
| `apps/web/src/domains/production/validation/bundle-validator.ts` | Modificar |
| `apps/web/src/domains/production/validation/generate-test-zip.ts` | Modificar |
| `apps/web/src/domains/production/validation/test-validator.ts` | Modificar |
| `apps/web/src/domains/production/actions/templates.actions.ts` | Modificar |
| `apps/web/src/app/admin/templates/TemplatesContainer.tsx` | Modificar |
| `supabase/migrations/20260617120000_add_precompiled_fields.sql` | Crear |
| `apps/api/Dockerfile` | Crear |
| `apps/api/.dockerignore` | Crear |
| `apps/api/src/features/production/remotion-external-bundle.service.ts` | Crear |
| `apps/api/src/features/production/remotion-worker.service.ts` | Modificar (bypass composition validation) |
| `apps/api/src/features/production/production.controller.ts` | Modificar (nueva ruta) |

---

## Verificación end-to-end

1. Regenerar test ZIP con `generate-test-zip.ts` → estructura pre-compilada
2. Subir desde UI de versiones → debe quedar en `PENDING_REVIEW`
3. Aprobar como admin → `bundle_status = APPROVED`
4. Click "Probar Render" → debe devolver URL de MP4
5. Build Docker: `docker build -t courseforge-api apps/api/` → sin errores
6. Subir ZIP con schema antiguo (`entryPoint`) → debe fallar con mensaje claro

---

## Orden de implementación

```
1. bundle-validator.ts          ← sin dependencias, se puede probar solo
2. generate-test-zip.ts         ← genera ZIP para probar el validator
3. test-validator.ts            ← actualizar test cases
4. DB migration                 ← columnas bundle_type + test_render_url
5. templates.actions.ts         ← tipos + triggerTestRenderAction
6. remotion-worker.service.ts   ← bypass composition validation
7. remotion-external-bundle.service.ts  ← nuevo servicio
8. production.controller.ts     ← nueva ruta POST
9. TemplatesContainer.tsx       ← botón Probar Render + video inline
10. Dockerfile + .dockerignore  ← imagen para Cloud Run
```
