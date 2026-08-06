# Diagnostico tecnico: plantillas Remotion personalizadas en Courseforge / SofLIA Engine

Fecha: 2026-06-26

## Resumen ejecutivo

El problema principal no parece estar solamente en el comando de build del sandbox. En el estado actual del codigo, el sistema mantiene dos rutas separadas:

- El preview usa siempre composiciones internas del frontend con `@remotion/player`.
- El render final solo usa el sandbox externo si existe una version `APPROVED_FOR_SANDBOX` y si `EXTERNAL_TEMPLATE_SANDBOX_ENABLED=true`.

Ademas, cuando el sandbox externo si se activa, el bundle personalizado no se ejecuta necesariamente como un proyecto Remotion completo. El sistema genera un wrapper propio que importa el entrypoint del ZIP, busca exports concretos como `MyComposition` o `default`, y registra una unica `Composition` creada por Courseforge. Esto puede ignorar las compositions, defaults, Root, schemas, assets y logica interna definidos por el bundle.

La causa raiz probable es una combinacion de:

1. Preview desacoplado del bundle personalizado.
2. Render final cayendo a composicion interna por status, feature flag o fallback.
3. Wrapper del sandbox que no respeta el registro interno de Remotion del bundle.
4. Props normalizadas por Courseforge que sustituyen el contrato propio de la plantilla.
5. Falta de persistencia de `build_id`, `resolvedProps`, `props_hash` y metadata runtime del bundle.

---

## 1. Diagnostico tecnico inicial

### Hipotesis 1: el preview nunca ejecuta el bundle personalizado

**Probabilidad:** muy alta.

El preview actual en `apps/web/src/domains/materials/components/RemotionPreviewPlayer.tsx` construye props con `buildAssemblyProps`, resuelve una composicion interna con `getAssemblyComposition`, y monta `@remotion/player` con esa composicion. No descarga, compila ni carga el ZIP personalizado.

Esto explica que el preview se vea igual sin importar el bundle cargado.

**Archivos a revisar:**

- `apps/web/src/domains/materials/components/RemotionPreviewPlayer.tsx`
- `apps/web/src/remotion/compositions/registry.ts`
- `apps/web/src/remotion/buildAssemblyProps.ts`

**Evidencia que confirma:**

- El preview solo loggea `templateSlug` o `built.props.template`.
- No existen `template_version_id`, `bundle_hash`, `serveUrl`, `entryPoint` ni `compositionId` externo en preview.
- Una smoke template roja con texto `CUSTOM_BUNDLE_RENDERED` no aparece en preview.

**Evidencia que descarta:**

- Existe un servicio de preview externo que recibe `bundle_id`, `build_hash`, `composition_id` y `resolvedProps`, y carga el bundle compilado. En el codigo revisado no aparece.

---

### Hipotesis 2: el render final solo usa sandbox externo bajo condiciones muy especificas

**Probabilidad:** muy alta.

En `apps/api/src/features/production/production.controller.ts` se busca una version con status `APPROVED_FOR_SANDBOX`. En `apps/api/src/features/production/remotion-worker.service.ts` se decide si el sandbox esta habilitado mediante `EXTERNAL_TEMPLATE_SANDBOX_ENABLED`.

Si no existe una version `APPROVED_FOR_SANDBOX`, o si el feature flag/comando no esta configurado, el render cae a composicion interna.

**Archivos y datos a revisar:**

- `apps/api/src/features/production/production.controller.ts`
- `apps/api/src/features/production/remotion-worker.service.ts`
- Tabla `remotion_template_versions`
- `EXTERNAL_TEMPLATE_SANDBOX_ENABLED`
- `EXTERNAL_TEMPLATE_SANDBOX_COMMAND`
- `EXTERNAL_TEMPLATE_SANDBOX_FALLBACK_INTERNAL`

**Evidencia que confirma:**

- `production_jobs.input_snapshot.templateVersionId` es `null`.
- `production_jobs.output_snapshot.renderMode` no es `EXTERNAL_SANDBOX`.
- Logs con `renderMode: INTERNAL_COMPOSITION`.
- Logs: `Sandbox version available but feature flag is disabled; using internal composition`.

**Evidencia que descarta:**

- `output_snapshot.renderMode = EXTERNAL_SANDBOX`.
- El job tiene `templateVersionId`, `bundleHash` y logs del sandbox con `Bundle ready`, `Composition selected`, `Render completed`.

---

### Hipotesis 3: el sandbox reenvuelve el bundle y no respeta las compositions registradas por la plantilla

**Probabilidad:** alta.

En `apps/api/src/features/production/sandbox-runner/bundle-cache.ts`, el sistema genera un entry propio `.courseforge/remotion-entry.tsx`. Ese wrapper importa el entrypoint de la plantilla, busca `TemplateModule.MyComposition ?? TemplateModule.default`, y registra una unica `Composition` creada por Courseforge.

Esto significa que si el ZIP trae su propio `registerRoot`, varias `Composition`, defaults internos, IDs propios o Root avanzado, esa arquitectura queda ignorada o parcialmente bypassed.

**Archivos a revisar:**

- `apps/api/src/features/production/sandbox-runner/bundle-cache.ts`
- `apps/api/src/features/production/external-template-local-runner.ts`

**Evidencia que confirma:**

- La plantilla exporta un Root con `registerRoot`, pero no exporta `MyComposition` ni `default`.
- Logs del Root original no aparecen.
- Solo aparece el `compositionId` impuesto por Courseforge.
- Una plantilla con varias compositions internas siempre renderiza una sola.

**Evidencia que descarta:**

- El sandbox ejecuta directamente el entrypoint del ZIP y `selectComposition` encuentra una composition registrada por el bundle, sin wrapper que reemplace el Root.

---

### Hipotesis 4: las props del bundle son sustituidas por el contrato interno de Courseforge

**Probabilidad:** alta.

El worker construye `inputProps` con `buildAssemblyInputProps`, usando assets, slides, b-roll, avatar, audio y `templateConfig`. Luego el sandbox adapta esas props en `sandbox-runner/props-adapter.ts`, dejando solo campos del contrato interno.

No hay lectura runtime real de `props_schema`, `default_props` o defaults declarados por el bundle.

**Archivos a revisar:**

- `apps/api/src/features/production/remotion-worker.service.ts`
- `apps/api/src/features/production/sandbox-runner/props-adapter.ts`
- Tabla `remotion_template_versions`
- Tabla `remotion_templates`

**Evidencia que confirma:**

- No existe `resolvedProps` persistido.
- No existe `props_hash`.
- El sandbox recibe siempre campos como `slides`, `brollClips`, `avatarVideoUrl`, `voiceAudioUrl`, `templateConfig`.
- Props internas del bundle nunca aparecen en logs.

**Evidencia que descarta:**

- Existe una fase que lee schema/defaults del manifest o del bundle, valida user props, genera `resolvedProps`, lo guarda y usa exactamente eso en preview y render.

---

### Hipotesis 5: fallback silencioso oculta fallos del sandbox

**Probabilidad:** media-alta.

En `apps/api/src/features/production/remotion-worker.service.ts`, si `EXTERNAL_TEMPLATE_SANDBOX_FALLBACK_INTERNAL=true`, un fallo del sandbox renderiza composicion interna. Esto puede generar un video visualmente valido pero incorrecto.

**Revisar:**

- `EXTERNAL_TEMPLATE_SANDBOX_FALLBACK_INTERNAL`
- `production_jobs.provider_error`
- `production_jobs.output_snapshot.renderMode`

**Evidencia que confirma:**

- `renderMode = EXTERNAL_SANDBOX_FALLBACK_INTERNAL`.
- Log: `Sandbox failed; falling back to internal composition`.

**Evidencia que descarta:**

- Fallback desactivado y los errores aparecen como `FAILED`.

---

### Hipotesis 6: cache o idempotencia reutilizan builds anteriores

**Probabilidad:** media.

El cache del sandbox vive en `os.tmpdir()/courseforge-sandbox-bundles/{bundleHash}/{compositionId}`. Si el hash no cambia, si se reutiliza un job por idempotency o si el `templateVersionId` no cambia, puede renderizarse un bundle viejo.

**Archivos a revisar:**

- `apps/api/src/features/production/sandbox-runner/bundle-cache.ts`
- `apps/api/src/features/production/production.controller.ts`
- Tabla `production_jobs`

**Evidencia que confirma:**

- Log `Using cached Remotion bundle` con un hash que no corresponde al ZIP actual.
- `bundle_hash` igual para distintos uploads.
- `templateVersionId` viejo en `production_jobs.input_snapshot`.

**Evidencia que descarta:**

- Cada ZIP cambia `bundle_hash`, cada render nuevo apunta a `templateVersionId` actual y el cache se invalida correctamente.

---

## 2. Mapa completo del flujo esperado

Flujo correcto de una plantilla personalizada `.zip`:

1. Upload del ZIP a bucket privado `template-bundles`.
2. Registro inicial en `remotion_templates`.
3. Registro de version en `remotion_template_versions`.
4. Validacion estatica del archivo.
5. Extraccion en directorio temporal aislado.
6. Inspeccion de estructura.
7. Deteccion de `courseforge-remotion-template.json`.
8. Validacion de `entryPoint`, `compositionId`, `package.json`, `src`, assets y manifest.
9. Validacion de dependencias permitidas.
10. Instalacion o resolucion de dependencias dentro del sandbox.
11. Compilacion real del entrypoint de la plantilla.
12. Descubrimiento de compositions registradas por el bundle.
13. Seleccion explicita de `composition_id`.
14. Calculo de `build_hash`, separado del hash del ZIP.
15. Persistencia del bundle compilado o de un artefacto build reproducible.
16. Persistencia de metadata: `entrypoint_path`, `composition_ids`, `props_schema`, `default_props`, `assets_manifest`.
17. Asociacion: `template_id -> template_version_id -> build_id/bundle_id -> composition_id`.
18. Construccion de `resolvedProps`.
19. Preview usando ese bundle, version, composition y props.
20. Render final usando exactamente el mismo bundle, version, composition y props.
21. Upload del video a `production-videos`.
22. Registro en `production_jobs.output_snapshot`.
23. Limpieza del sandbox, conservando artefactos persistidos y logs seguros.

Puntos donde hoy parece romperse:

- Preview: usa composiciones internas.
- Runtime gating: requiere `APPROVED_FOR_SANDBOX` y feature flag.
- Composition registration: el wrapper puede ignorar `registerRoot` del bundle.
- Props/defaults: no hay `resolvedProps` basado en schema del bundle.
- Persistencia: se persiste ZIP/version, pero no build runtime como entidad estable.
- Fallback: puede ocultar errores.

---

## 3. Diferencia entre configuracion del sistema y configuracion del bundle

La configuracion simple del sistema (`default_config`, `templateConfig`, colores, layout, avatar, transiciones) debe tratarse como preset para composiciones internas. No debe dominar plantillas custom.

Estrategia recomendada de prioridad:

1. Validaciones de seguridad del sistema.
2. Restricciones globales: duracion maxima, dimensiones, FPS, codecs, dominios de assets.
3. Contrato de la plantilla custom: `props_schema`, `composition_id`, `default_props`.
4. Defaults internos del bundle.
5. Props explicitas del usuario permitidas por schema.
6. Props derivadas del curso/material: slides, avatar, audio, b-roll, textos y timings.
7. Normalizacion final de assets a URLs accesibles.
8. Fallback solo si esta explicitamente permitido y trazado.

Para `template_type = custom_bundle`:

- No aplicar `parseTemplateRenderConfig` como fuente dominante.
- No convertir `compositionId` externo a `full-slides`.
- No usar `getAssemblyComposition` en preview.
- No usar `buildAssemblyInputProps` como contrato final, solo como fuente derivada opcional.

---

## 4. Revision del bundle personalizado

Checklist tecnico:

- ZIP sin rutas absolutas, `..`, symlinks ni `node_modules`.
- Limites de tamano comprimido/descomprimido.
- Limite de cantidad de archivos.
- Manifest `courseforge-remotion-template.json`.
- Entry point existente.
- `package.json` valido.
- Scripts peligrosos bloqueados: `preinstall`, `install`, `postinstall`, `prepare`.
- Dependencias permitidas.
- Imports relativos resolubles.
- Aliases declarados o prohibidos explicitamente.
- Exports esperados o Root registrado, pero contrato unico y documentado.
- Composition registrada con ID esperado.
- Props esperadas y defaults declarados.
- Assets incluidos y resolubles.
- Assets externos permitidos por allowlist.
- Compatibilidad con version de Remotion, React y TypeScript.
- Bloqueo de APIs peligrosas: filesystem, network arbitrario, `child_process`, `eval`, acceso a secretos.

Errores comunes que compilan pero no renderizan la plantilla correcta:

- La plantilla registra `CustomBundleSmokeTest`, pero Courseforge crea `full-slides`.
- La plantilla depende de `defaultProps` internos, pero Courseforge pasa `{slides, templateConfig}`.
- El entrypoint solo hace `registerRoot(Root)` y no exporta `default`.
- Assets relativos no se copian o no se resuelven desde el bundle final.
- Aliases como `@/components` no existen en el webpack del sandbox.
- Dependencias declaradas no estan instaladas.
- `template.composition_id` fue normalizada a una composicion interna.

---

## 5. Revision del sandbox

El sandbox debe distinguir claramente:

- `zip_path`
- `extract_dir`
- `entrypoint_path`
- `build_dir`
- `serve_url`
- `output_path`

En el repo actual:

- `bundle-cache.ts` extrae a temp.
- Genera `.courseforge/remotion-entry.tsx`.
- Compila ese wrapper.
- Cachea por `bundleHash + compositionId`.
- Renderiza con props adaptadas.

Para detectar si compila una cosa pero renderiza otra:

1. Crear un ZIP con texto unico `CUSTOM_BUNDLE_RENDERED`.
2. Despues del build, buscar ese string en `courseforge-sandbox-bundles/{hash}/{composition}/bundle`.
3. Loggear `serveUrl`, `entryPoint`, `generatedEntryPointPath`, `compositionId`.
4. En `selectComposition`, loggear `composition.id`, `durationInFrames`, `fps`, `width`, `height`.
5. Verificar visualmente un frame del output.

Si el build contiene el string pero el video final no, el problema esta entre `serveUrl/selectComposition/renderMedia` o fallback. Si el build no contiene el string, el problema esta en extraccion, entrypoint, wrapper o build.

---

## 6. Revision del preview

El preview actual muestra siempre salida interna porque esta disenado como preview del ensamblado interno.

Preview correcto para custom bundles:

1. Recibir `template_id`.
2. Resolver `last_valid_build_id` o version `APPROVED_FOR_SANDBOX`.
3. Obtener `bundle_id/build_hash`.
4. Obtener `composition_id` externo.
5. Obtener o generar `resolvedProps`.
6. Crear preview desde el bundle externo.
7. Aplicar cache busting por `build_hash + props_hash`.

Comparar entre preview y render:

- `template_id`
- `template_version_id`
- `bundle_id`
- `build_hash`
- `composition_id`
- `props_hash`
- `resolvedProps`

Con el codigo actual, el preview no puede validar si el bundle personalizado funciona.

---

## 7. Revision del render final

El render final puede ignorar el bundle por:

- No existe version `APPROVED_FOR_SANDBOX`.
- `EXTERNAL_TEMPLATE_SANDBOX_ENABLED` no es `true`.
- `EXTERNAL_TEMPLATE_SANDBOX_COMMAND` no esta configurado.
- Fallback interno activo.
- `composition_id` apunta a `full-slides`.
- El wrapper ignora compositions internas.
- Props adaptadas eliminan props custom.
- El job se reutiliza por idempotency.
- Cache de bundle usa build viejo.
- Assets no estan disponibles.
- El output `production-videos/completed/{componentId}.mp4` se sobrescribe.

Conexion correcta:

`production_jobs.input_snapshot` debe guardar `templateVersionId`, `bundleHash`, `compositionId`, `resolvedPropsHash`. El worker debe descargar ese bundle exacto, compilar o servir ese build exacto, seleccionar esa composition exacta y renderizar con esos props exactos.

---

## 8. Revision especifica de ngrok

Validaciones mientras se use ngrok:

- La URL actual de ngrok es la que usa el render externo.
- El renderer externo no apunta a otro servidor local.
- Assets publicos o firmados son accesibles desde ngrok.
- No hay rutas `C:\...`, `/tmp/...` ni `localhost` dentro de props.
- CORS permite cargar assets.
- El bundle no referencia archivos temporales no expuestos.
- URLs con cache busting por `build_hash`.
- Preview local y render externo imprimen el mismo `build_hash`.

No se debe acoplar a ngrok:

- `bundle_storage_path`
- URLs permanentes de assets
- `render job snapshot`
- `resolvedProps`

ngrok debe ser solo transporte temporal. Para Lambda, bundles y assets deben vivir en storage persistente publico firmado o bucket accesible por el renderer.

---

## 9. Plan de debugging paso a paso

### Prueba 1: bundle minimo distintivo

Crear una plantilla con:

- Fondo rojo solido.
- Texto grande `CUSTOM_BUNDLE_RENDERED`.
- Composition unica `CustomBundleSmokeTest`.
- Props internas hardcodeadas.
- Sin assets externos.

Objetivo: confirmar si el sistema ejecuta realmente el bundle cargado.

### Prueba 2: log de entry point

Agregar logs:

```ts
console.log("CUSTOM ENTRYPOINT LOADED");
console.log("COMPOSITION REGISTERED");
console.log("PROPS RECEIVED", props);
```

Objetivo: confirmar si el entrypoint se ejecuta.

### Prueba 3: verificacion de output del build

Comparar:

- Archivos extraidos.
- Archivos compilados.
- Bundle final generado.
- Ruta usada por preview.
- Ruta usada por render.

Objetivo: detectar si se compila una cosa pero se renderiza otra.

### Prueba 4: trazabilidad de `template_id`

Trazar el mismo `template_id` desde:

- Upload.
- DB.
- Sandbox.
- Build.
- Preview.
- Render.
- Output final.

Objetivo: detectar perdida de referencia o fallback.

### Prueba 5: desactivar fallback temporalmente

Configurar:

```env
EXTERNAL_TEMPLATE_SANDBOX_FALLBACK_INTERNAL=false
```

Objetivo: forzar errores explicitos si la plantilla personalizada no carga.

### Prueba 6: comparar preview vs render

Confirmar si ambos usan:

- Mismo bundle.
- Misma composition.
- Mismo `template_id`.
- Mismos props.
- Mismo `build_hash`.
- Misma version.

Objetivo: detectar divergencias.

### Prueba 7: validacion de assets

Confirmar que los assets:

- Existen.
- Se copian al directorio correcto.
- Son accesibles via URL publica o firmada.
- Son accesibles desde ngrok.
- No dependen de rutas locales privadas.

Objetivo: detectar degradacion visual por assets inaccesibles.

---

## 10. Instrumentacion y trazabilidad recomendada

Eventos minimos:

- `template.upload.started`
- `template.upload.completed`
- `template.zip.extracted`
- `template.structure.validated`
- `template.entrypoint.detected`
- `template.build.started`
- `template.build.completed`
- `template.build.failed`
- `template.bundle.persisted`
- `template.preview.requested`
- `template.preview.bundle.loaded`
- `template.render.started`
- `template.render.bundle.loaded`
- `template.render.completed`
- `template.render.failed`
- `template.fallback.used`

Metadata recomendada:

- `template_id`
- `template_version_id`
- `bundle_id`
- `build_id`
- `user_id`
- `organization_id`
- `build_hash`
- `bundle_hash`
- `bundle_path`
- `entrypoint_path`
- `composition_id`
- `props_hash`
- `render_job_id`
- `sandbox_id`
- `serve_url`
- `output_path`
- `error_message`
- `safe_stack_trace`

---

## 11. Modelo de datos recomendado

Agregar o formalizar:

- `remotion_templates.template_type`: `simple | custom_bundle`
- `remotion_template_versions.id`
- `remotion_template_versions.status`
- `remotion_template_versions.manifest`
- `remotion_template_versions.props_schema`
- `remotion_template_versions.default_props`
- `remotion_template_builds.id`
- `remotion_template_builds.template_version_id`
- `remotion_template_builds.build_hash`
- `remotion_template_builds.entrypoint_path`
- `remotion_template_builds.composition_ids`
- `remotion_template_builds.bundle_storage_path`
- `remotion_template_builds.build_output_path`
- `remotion_template_builds.status`
- `remotion_render_snapshots.resolved_props`
- `remotion_render_snapshots.props_hash`
- `remotion_render_snapshots.composition_id`
- `remotion_render_snapshots.fallback_allowed`
- `remotion_render_snapshots.fallback_reason`

Versionado:

- Nunca sobrescribir una version.
- `template_id` es estable.
- Cada ZIP crea nuevo `template_version_id`.
- Cada build crea nuevo `build_id`.
- Preview/render solo usan `last_valid_build_id`.
- Si cambia ZIP, schema, defaults o composition, cambia `build_hash`.

---

## 12. Estrategia para `resolvedProps`

Pseudocodigo:

```ts
import { z } from "zod";
import crypto from "crypto";

type BuildResolvedPropsInput = {
  templateType: "simple" | "custom_bundle";
  bundleSchema?: z.ZodTypeAny;
  bundleDefaultProps?: Record<string, unknown>;
  userProps?: Record<string, unknown>;
  courseProps: Record<string, unknown>;
  platformLimits: {
    maxDurationFrames: number;
    allowedAssetHosts: string[];
  };
};

function stableHash(value: unknown) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

export function buildResolvedProps(input: BuildResolvedPropsInput) {
  if (input.templateType === "simple") {
    return buildInternalAssemblyProps(input.courseProps, input.userProps);
  }

  const schema = input.bundleSchema ?? z.object({}).passthrough();

  const defaults = schema.parse(input.bundleDefaultProps ?? {});
  const user = schema.partial().parse(input.userProps ?? {});
  const derived = schema.partial().parse(mapCoursePropsForTemplate(input.courseProps));

  const merged = {
    ...defaults,
    ...derived,
    ...user,
  };

  const constrained = applyPlatformLimits(merged, input.platformLimits);
  const resolvedProps = schema.parse(constrained);

  return {
    resolvedProps,
    propsHash: stableHash(resolvedProps),
  };
}
```

Regla clave: `templateConfig` de la UI no debe entrar salvo que el schema custom lo acepte.

---

## 13. Arquitectura corregida del flujo actual

```text
Frontend SofLIA
  -> API templates
    -> Supabase DB: remotion_templates / remotion_template_versions
    -> Storage: template-bundles/{org}/{template}/{version}.zip

API render
  -> production_jobs input_snapshot
  -> Sandbox builder
    -> download ZIP
    -> extract
    -> validate runtime
    -> build Remotion bundle
    -> persist build metadata
  -> Preview service
    -> loads same build_hash + composition_id + resolvedProps
    -> serves preview through ngrok temporarily
  -> Render service
    -> loads same build_hash + composition_id + resolvedProps
    -> Remotion renderer
    -> output mp4
  -> Storage production-videos
  -> material_components.assets.final_video_url
```

Temporal:

- ngrok.
- Local sandbox output.
- Local Remotion renderer.

Debe evolucionar:

- Build artifacts a storage persistente.
- Render a Remotion Lambda.
- Preview desde bundle versionado, no desde app interna.

---

## 14. Migracion posterior a Remotion Lambda

Preparar desde ahora:

- No guardar URLs ngrok en DB como fuente de verdad.
- Guardar bundles y assets en storage persistente.
- Versionar `template_version_id` y `build_id`.
- Pasar a Lambda solo:
  - `serveUrl` de bundle persistido.
  - `compositionId`.
  - `resolvedProps`.
  - Config de codec/output.
- Outputs a bucket.
- Concurrencia por `render_job_id`.
- Logs por `template_version_id` y `build_hash`.
- Preview local y Lambda deben compartir `resolvedProps` y `build_hash`.

---

## 15. Senales claras de causa raiz

| Sintoma | Causa probable |
|---|---|
| Preview siempre igual | Preview usa `getAssemblyComposition` interno |
| Render siempre igual | Render cae a `INTERNAL_COMPOSITION` |
| Build exitoso pero render igual | Build no conectado al render o fallback activo |
| ZIP aprobado pero no usado | Falta `APPROVED_FOR_SANDBOX` o env flag |
| Logs del entrypoint no aparecen | Entry point del ZIP no se ejecuta |
| Composition custom no aparece | Wrapper reemplaza Root/compositions |
| Props internas no aplican | `props-adapter` elimina props custom |
| Defaults no aplican | No se persisten/leen `defaultProps` del bundle |
| Assets no aparecen | Rutas locales, assets no copiados o no accesibles por ngrok |
| Render local funciona, ngrok no | URL, CORS, rutas temporales o acceso externo |
| Output basico sin error | Fallback interno silencioso |
| Upload correcto pero bundle no cambia | Job/cache/templateVersion viejo |
| `build_hash` igual | Se esta reutilizando ZIP/cache anterior |

---

## 16. Recomendacion tecnica final

Orden recomendado:

1. Confirmar en DB que la version esta `APPROVED_FOR_SANDBOX`.
2. Confirmar envs: `EXTERNAL_TEMPLATE_SANDBOX_ENABLED=true`, `EXTERNAL_TEMPLATE_SANDBOX_COMMAND` configurado, fallback apagado.
3. Ejecutar smoke bundle rojo.
4. Revisar `production_jobs.input_snapshot` y `production_jobs.output_snapshot`.
5. Confirmar si `renderMode` es `EXTERNAL_SANDBOX`.
6. Ver si aparecen logs del entrypoint custom.
7. Confirmar si el wrapper esta anulando las compositions propias.

Logs inmediatos a agregar:

- `template_id`
- `template_version_id`
- `bundle_hash`
- `entrypoint_path`
- `composition_id`
- `renderMode`
- `serveUrl`
- `props_hash`
- `resolvedProps`
- `fallback_reason`
- `selectedComposition.id`

Cambio estructural mas importante:

Separar formalmente `simple` de `custom_bundle`. Las simples pueden seguir con `default_config + buildAssemblyProps + registry interno`. Las custom deben tener su propio flujo: manifest, schema, defaults, compositions, build, resolvedProps y versionado.

Durante debugging, el fallback debe estar apagado. Si el bundle custom falla, debe fallar de forma explicita y trazable. El sistema no debe producir un video interno "correcto" cuando la plantilla personalizada no se ejecuto.

