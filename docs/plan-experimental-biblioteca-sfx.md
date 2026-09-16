# Plan experimental: biblioteca de efectos de sonido (SFX)

## Objetivo

Validar de extremo a extremo que Courseforge puede cargar un SFX manualmente,
descubrirlo desde el editor, colocarlo en el timeline, previsualizarlo y
renderizarlo con sincronía; todo respetando el aislamiento por organización.

El experimento no busca todavía un DAW ni reemplazar el flujo de voz/música.
Su resultado debe decidir, con evidencia, si se continúa hacia una biblioteca
de producción.

## Hipótesis y límites

### Hipótesis a validar

1. HyperFrames puede reproducir y renderizar un SFX insertado desde el modelo
   de documento de Courseforge con igual inicio y duración.
2. Un usuario puede encontrar, preescuchar y colocar un efecto de transición
   en menos de tres interacciones tras abrir el panel.
3. Un catálogo por `organization_id` es suficiente para reutilizar assets sin
   filtrar información ni archivos entre empresas.
4. La mezcla de voz, música y un SFX corto se entiende sin introducir ducking
   adicional para SFX.

### Fuera de alcance del experimento

- Generación de SFX por IA o integración con catálogos de terceros.
- Pan, pitch, keyframes, buses/submixes, efectos DSP o limitador final.
- Reemplazo/versionado de un SFX listo para uso.
- Bibliotecas globales entre organizaciones.
- Carga masiva y edición completa del catálogo.

## Vertical slice a entregar

Un administrador carga un archivo MP3 o WAV de hasta 25 MB y 30 segundos.
Después de la inspección, queda disponible como `READY` sólo para su
organización. En una composición HyperFrames, un editor con permiso puede:

1. abrir la pestaña **Efectos de sonido**;
2. buscar por nombre, tag o categoría `TRANSITION`;
3. preescuchar el audio;
4. añadirlo al playhead o arrastrarlo a la pista `SFX`;
5. moverlo, recortarlo, silenciarlo/eliminarlo y ajustar volumen;
6. guardar, reabrir, previsualizar y renderizar la composición.

El documento guarda una referencia al asset y los parámetros de la instancia;
no guarda URL firmada ni duplica el binario.

## Diseño de experimento

### Datos iniciales

- Dos organizaciones de prueba: A y B.
- Tres SFX de A: `whoosh-short`, `click-confirm`, `impact-soft`.
- Un SFX de B para la prueba de aislamiento.
- Una composición con voz y música; ubicar `whoosh-short` exactamente en un
  corte visual conocido.

### Métricas de éxito

| Métrica | Objetivo |
| --- | --- |
| Tiempo desde abrir panel hasta insertar | <= 30 segundos en prueba moderada |
| Sincronía preview vs. render | diferencia <= 1 frame a 30 fps |
| Seguridad multi-tenant | 0 archivos/listados/resoluciones cruzadas |
| Integridad | 100% de clips guardados se reabren con la referencia correcta |
| Calidad de mezcla | Voz entendible y ningún pico audible o clipping detectado en el caso de prueba |

## Secuencia de implementación

### Fase 0 — Alinear contrato y preparar fixtures (0.5–1 día)

**Cambios**

- Crear tipos Zod/TypeScript en `domains/production/sound-effects/`:
  categorías, estado, metadata de carga y referencia de source.
- Extender el documento de composición con:

```ts
type CompositionTrackRole = /* existentes */ | "SFX";

{ type: "SOUND_EFFECT_ASSET", soundEffectAssetId: string }
```

- Definir la pista inicial: `{ id: "sfx", kind: "AUDIO", semanticRole: "SFX" }`.
- Crear fixtures de documento y tres audios de prueba libres de derechos.

**Criterio de salida**

- Los schemas aceptan clips SFX válidos y rechazan referencias UUID inválidas,
  duración fuera de fuente, o clips ubicados fuera del canvas.

### Fase 1 — Persistencia, almacenamiento y autorización (1–2 días)

**Cambios**

- Migración `sound_effect_assets` con los campos mínimos:
  `id`, `organization_id`, `status`, `name`, `category`, `tags`,
  `storage_bucket`, `storage_path`, `mime_type`, `file_size_bytes`,
  `duration_milliseconds`, `checksum_sha256`, auditoría y licencia.
- Crear bucket privado `sound-effect-assets` y políticas RLS basadas en
  organización. La ruta se genera sólo en servidor.
- Implementar servicio/repository de carga y listado paginado.
- Exponer tres endpoints internos:
  - `POST /api/production/sound-effects/upload-url`
  - `POST /api/production/sound-effects/complete-upload`
  - `GET /api/production/sound-effects?query=&category=&cursor=`
- Validar permisos separados: `production.sfx.manage` para carga y
  `production.sfx.use` para consulta/inserción.

**Reglas de seguridad**

- Allowlist: MP3, WAV, M4A/AAC y OGG; confirmar firma de archivo y no sólo
  `Content-Type`.
- Límite 25 MB / 30 segundos y checksum SHA-256.
- Estado inicial `PROCESSING`; sólo el proceso de inspección puede marcar
  `READY` o `REJECTED`.
- Nunca persistir URL firmada en la tabla ni en el documento.

**Criterio de salida**

- A puede cargar/listar su audio y B recibe 404/403 para el asset de A.
- Archivos con extensión falsa, tipo no permitido o exceso de límite terminan
  en `REJECTED` y no aparecen al editor.

### Fase 2 — Inspección de medios y catálogo administrativo (1–2 días)

**Cambios**

- Worker/acción de inspección: obtener duración real, codec, canales y tamaño;
  calcular checksum; opcionalmente medir peak/LUFS si la herramienta actual ya
  está disponible.
- Página mínima de administración: cargar, ver estado, nombre, categoría, tags,
  duración y licencia. Implementar archivo lógico, no borrado físico.
- Registrar auditoría de carga, rechazo y archivado sin guardar URLs firmadas.

**Criterio de salida**

- Sólo assets `READY` aparecen en búsquedas de editor; uno archivado deja de
  aparecer para nuevas inserciones.

### Fase 3 — Inserción y edición mínima en el editor (2–3 días)

**Cambios**

- Agregar panel **Efectos de sonido** al editor de composición, reutilizando el
  patrón de lista/preview de audio de HyperFrames.
- Búsqueda con debounce, filtro `TRANSITION` y play/stop con URL firmada corta.
- Añadir al playhead o drag/drop crea `CompositionClip` con
  `SOUND_EFFECT_ASSET` y duración medida.
- Crear/mostrar pista `SFX` y permitir mover, recortar, volumen, mute y delete.
- Mantener snapping con playhead, borde de clips y corte visual.

**Compatibilidad**

- No alterar tracks existentes ni el comportamiento de `VOICE`/`MUSIC`.
- `SFX` no participa como trigger en `composition-audio-mix.service.ts`.

**Criterio de salida**

- El clip persiste tras guardar/reabrir y su edición no afecta el asset de
  biblioteca ni ninguna otra composición.

### Fase 4 — Entrega de medios, preview y render (1–2 días)

**Cambios**

- Extender el resolvedor de assets de HyperFrames para resolver
  `SOUND_EFFECT_ASSET` con autorización y URL firmada generada al momento.
- Compilar la instancia hacia el contrato de HyperFrames:

```html
<audio class="clip" src="..." data-start="12.4" data-duration="0.72"
       data-track-index="<sfx-track>" data-volume="0.65"></audio>
```

- Usar exactamente el mismo resolvedor para preview y render. El adaptador de
  render genera URLs con TTL suficiente justo antes de encolar/entregar.
- Añadir telemetría segura: `sfx_count`, fallas de resolución y duración de
  preparación; nunca rutas ni URLs.

**Criterio de salida**

- Un SFX al inicio, en un corte y cerca del final aparece y queda sincronizado
  tanto en preview como en el MP4 final.

### Fase 5 — QA, evaluación y decisión (1 día)

**Automatización**

- Unit tests: schemas, deduplicación, estado, autorizaciones, cálculo de
  duración y compilación del `<audio>`.
- Integration tests: RLS A/B, assets archivados y expiración/no persistencia de
  URLs firmadas.
- Editor tests: añadir al playhead, drag/drop, snap, trim, volumen, undo/redo y
  reapertura de documento.
- Render test: fixture de voz + música + SFX, analizar que la pista exista y
  verificar onset contra la marca de tiempo esperada.

**Prueba moderada**

Pedir a 3–5 usuarios internos que añadan un whoosh en un corte indicado y
registrar tiempo, errores y si el volumen percibido resulta apropiado.

**Decisión**

Avanzar a producción si se cumplen todas las métricas de seguridad e
integridad, la sincronía es <= 1 frame y al menos 80% de participantes termina
sin asistencia. Si falla sincronía o seguridad, detener expansión funcional y
resolver primero la paridad preview/render o RLS.

## Orden técnico y dependencias

```text
Schema de documento ─┬─ Migración/RLS ── Carga/inspección ── Catálogo
                     │                                      │
                     └──────────────── Editor/SFX track ◄───┘
                                                        │
                                        Resolución HyperFrames
                                                        │
                                             Preview + render + QA
```

La Fase 3 puede iniciar con fixtures locales mientras Fases 1–2 terminan, pero
no debe conectarse a Storage real hasta tener autorización e inspección.

## Archivos y módulos previstos

**Nuevos**

- `supabase/migrations/<timestamp>_create_sound_effect_assets.sql`
- `apps/web/src/domains/production/sound-effects/*`
- Rutas bajo `apps/web/src/app/api/production/sound-effects/`
- Componentes de catálogo/panel SFX y sus pruebas.

**Extensiones acotadas**

- `composition-document.types.ts`
- `composition-clip-audio.service.ts`
- `composition-audio-mix.service.ts`
- Compilador/resolvedor de preview de composición.
- Adaptador de media/render HyperFrames.
- `domains/library/types.ts` y `library-catalog.ts`, sólo si se decide que la
  biblioteca general debe mostrar SFX; no es requisito para el panel del editor.

## Riesgos y mitigación

| Riesgo | Mitigación |
| --- | --- |
| URL expira durante render en cola | Crear URL justo antes de entrega y reintentar la resolución de forma idempotente. |
| Archivo malicioso o formato falso | Inspección server-side por firma/MIME real, allowlist y bucket privado. |
| Fuga entre organizaciones | RLS, path asignado por servidor, pruebas cruzadas A/B y no usar URLs públicas. |
| SFX tapa la narración | Ganancia inicial conservadora; SFX no activa ducking; revisión auditiva de fixture. |
| Cambio de asset rompe renders previos | Assets READY inmutables y archivado lógico; no sobrescribir binarios. |

## Post-experimento (no implementar aún)

Si la evaluación resulta positiva, el siguiente incremento debe ser waveforms
precalculados, fades y sugerencias configurables `transición → SFX`. Sólo tras
eso conviene evaluar keyframes, pan, automatización de buses o integración de
proveedores externos.
