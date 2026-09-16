# Investigación: biblioteca de efectos de sonido para el editor de producción

## 1. Objetivo y decisión recomendada

Construir una biblioteca interna, por organización, de efectos de sonido (SFX)
subidos manualmente para usarlos en transiciones y momentos intermedios de una
composición de video.

**Decisión:** implementar los SFX como **assets de audio reutilizables** y cada
uso como una **instancia de clip de audio en el timeline**. No deben modelarse
como animaciones.

Una animación describe cómo cambia una propiedad visual a lo largo del tiempo;
un SFX es un medio con licencia, duración, forma de onda, ganancia y una o más
colocaciones temporales. Puede existir una asociación opcional con una
animación o transición (por ejemplo, `whoosh` para `swipe-left`), pero las dos
entidades deben conservar ciclos de vida, edición y permisos independientes.

## 2. Hallazgos

### HyperFrames

HyperFrames ya tiene la base necesaria:

- Su contrato de timeline admite `<audio>` como clip, con `data-start`,
  `data-duration`, `data-track-index` y `data-volume`. El inserto generado por
  Studio es exactamente esa estructura en
  `packages/studio/src/utils/timelineAssetDrop.ts`.
- Studio clasifica los audio assets, deja preescucharlos, arrastrarlos y
  soltarlos sobre el timeline. Su fila de audio muestra duración, tipo, estado
  de uso y una visualización durante la reproducción
  (`packages/studio/src/components/sidebar/AudioRow.tsx`).
- El timeline permite mover, recortar y alinear clips mediante snapping; los
  beats pueden ser marcadores de alineación. [Guía oficial de timeline](https://hyperframes.dev/studio/timeline).
- El render mezcla los elementos de audio y HyperFrames separa adquisición de
  medios de reproducción. Su Media OS resuelve SFX a archivos locales,
  inventaría activos y conserva procedencia; incluye una biblioteca incluida de
  19 SFX y catálogo externo opcional. Esto no sustituye el catálogo de negocio
  de Courseforge, pero confirma el patrón técnico.
- El principio de mezcla es correcto para este caso: SFX en eventos
  significativos, música por debajo de voz y revisión de la mezcla completa.
  [Guía oficial de audio](https://hyperframes.dev/guides/voice-and-audio).

### Editores de referencia

| Editor | Patrón observado | Decisión aplicable a Courseforge |
| --- | --- | --- |
| CapCut | Biblioteca separada de `Sound effects`, búsqueda/categorías, preescucha y arrastre o “+” al timeline; después se ajusta posición, duración, volumen, pitch y fades. [Referencia oficial](https://www.capcut.com/tools/sound-effects) | UX simple para MVP: búsqueda, filtros, play, botón “Añadir al cabezal” y drag & drop. |
| iMovie | Mantiene una biblioteca de efectos propia y los coloca como clips diferenciados en el timeline. [Soporte Apple](https://support.apple.com/guide/imovie/add-music-and-sound-clips-mov91a895a64/mac) | El usuario debe distinguir visualmente SFX, voz, música y ambiente. |
| Adobe Premiere | Distingue audio por tipo (Dialogue, Music, SFX, Ambience), maneja clips individuales en tracks y controles de mezcla por track; volumen/pan pueden automatizarse con keyframes. [Tipos y mezcla](https://helpx.adobe.com/premiere/desktop/add-audio-effects/basic-audio-editing/audio-editing-concepts.html), [automatización de tracks](https://helpx.adobe.com/premiere/desktop/add-audio-effects/advanced-audio-techniques/about-audio-track-mixer.html) | Adoptar roles de pista desde el inicio; dejar automatización detallada para una fase posterior. |

## 3. Encaje con Courseforge

El editor actual ya persiste `CompositionClip` de tipo `AUDIO`, con duración,
offset de origen y volumen por clip; además posee tracks `AUDIO` y mezcla con
ducking. Sin embargo, sus roles semánticos no incluyen `SFX`, y las fuentes de
un clip sólo aceptan `PRODUCTION_ASSET`, `ASSEMBLY_BRAND_ASSET` y `DECK_SLIDE`.
La biblioteca actual (`domains/library`) clasifica voz y música, pero no SFX,
y los assets de HyperFrames se enumeran por `material_component_id`. Eso impide
una biblioteca realmente reutilizable por organización.

La ampliación mínima, aislada y compatible es:

1. Añadir el rol de timeline `SFX` y una pista inicial `sfx` (`kind: AUDIO`),
   independiente de `VOICE` y `MUSIC`.
2. Añadir una fuente de clip `SOUND_EFFECT_ASSET` que referencia un asset de
   biblioteca por UUID, en vez de copiar el binario al documento de cada video.
3. Crear un catálogo de SFX por organización fuera de `production_assets`, que
   es un registro de assets de un componente/material específico.
4. En la preparación de preview/render, resolver la instancia hacia un URL
   firmado de Supabase Storage y entregar el archivo a HyperFrames como audio.

## 4. Modelo de datos propuesto

### `sound_effect_assets`

| Campo | Tipo / regla | Propósito |
| --- | --- | --- |
| `id` | UUID PK | Identidad estable del asset. |
| `organization_id` | UUID FK, indexado | Aislamiento multi-tenant obligatorio. |
| `status` | `PROCESSING \| READY \| REJECTED \| ARCHIVED` | Nunca publicar un archivo sin validar. |
| `name`, `description` | texto acotado | Descubrimiento humano. |
| `category` | `TRANSITION \| EMPHASIS \| UI \| IMPACT \| AMBIENCE \| OTHER` | Filtro principal; no usar sólo tags libres. |
| `tags` | `text[]` normalizado | Búsqueda adicional: `whoosh`, `swipe`, `click`. |
| `storage_bucket`, `storage_path` | texto | Referencia privada al objeto, no URL pública persistida. |
| `mime_type`, `file_size_bytes`, `duration_milliseconds` | metadatos medidos en servidor | Validación, duración real y UI. |
| `sample_rate_hz`, `channels`, `integrated_lufs`, `true_peak_dbtp` | opcional inicialmente | QA de mezcla y normalización futura. |
| `checksum_sha256` | único por organización | Dedupe y auditoría. |
| `license_type`, `license_reference`, `attribution_text` | requeridos según licencia | Derecho de uso verificable. |
| `created_by`, `created_at`, `updated_at`, `archived_at` | auditoría | Trazabilidad operativa. |

Índices: `(organization_id, status, category)`, GIN sobre `tags`, e índice de
búsqueda de texto sobre `name`, `description` y `tags`. La unicidad recomendada
es `(organization_id, checksum_sha256)` para evitar subir el mismo binario dos
veces. Borrado lógico: un asset referenciado no se elimina; se archiva y las
composiciones existentes permanecen reproducibles.

### Instancia en composición

Extender el discriminated union existente:

```ts
{ type: "SOUND_EFFECT_ASSET", soundEffectAssetId: string }
```

Una instancia sigue usando el contrato actual de clip:

```ts
{
  id: "sfx-whoosh-01",
  kind: "AUDIO",
  trackId: "sfx",
  startSeconds: 12.4,
  durationSeconds: 0.72,
  sourceOffsetSeconds: 0,
  sourceDurationSeconds: 0.72,
  volume: 0.65,
  source: { type: "SOUND_EFFECT_ASSET", soundEffectAssetId: "<uuid>" }
}
```

El documento persiste el UUID, duración y parámetros de la **instancia**. La
resolución al archivo se hace al previsualizar/renderizar. Para garantizar
reproducibilidad cuando se reemplace el binario, el asset debe ser inmutable:
una sustitución crea nueva fila/versión y no cambia `storage_path` del activo
listo. El clip puede guardar opcionalmente `sourceChecksum` para detectar una
referencia rota de forma explícita.

## 5. Flujo funcional

```text
Administrador
  └─ solicita URL firmada de carga
       └─ Storage privado: sound-effect-assets/<org>/<uuid>/<archivo>
            └─ job de inspección (MIME real, tamaño, ffprobe, SHA-256, licencia)
                 └─ sound_effect_assets = READY

Editor
  └─ panel “Efectos de sonido” → buscar / filtrar / preescuchar
       └─ arrastra o añade al cabezal
            └─ crea CompositionClip(AUDIO, source=SOUND_EFFECT_ASSET)
                 └─ preview y render resuelven URL firmada y mezclan el clip
```

### Carga y seguridad

- Autorizar `admin` o el permiso explícito `production.sfx.manage`; el editor
  ordinario sólo requiere `production.sfx.use`.
- Usar URL firmada de carga de un solo objeto con path generado en servidor.
  No aceptar bucket, ruta ni `organization_id` desde el cliente.
- Allowlist inicial: `audio/mpeg`, `audio/wav`, `audio/mp4` (M4A/AAC) y
  `audio/ogg`; confirmar por firma/binario, no por extensión ni header enviado.
- Límite inicial: 25 MB y 30 s. Los SFX de transición deben ser cortos; los
  efectos largos pertenecen a música/ambiente, no a esta biblioteca.
- El proceso de inspección debe calcular duración, codec, canales y checksum;
  rechazar archivos corruptos, duración mayor, formatos no soportados o MIME
  ambiguo. El archivo sólo pasa a `READY` tras dicha inspección.
- Bucket privado, RLS por `organization_id`, URLs firmadas cortas para preview
  y TTL suficientemente amplio, pero no persistido, para renders. No registrar
  URLs firmadas en logs.
- Exigir licencia/términos y fuente antes de `READY`; mostrar atribución cuando
  corresponda. No asumir que un archivo subido es libre de derechos.

## 6. UX recomendada (MVP)

En el panel lateral del editor agregar una pestaña **Efectos de sonido**:

1. Buscador con debounce y filtros `Transición`, `Énfasis`, `UI`, `Impacto` y
   `Ambiente`.
2. Cada fila muestra play/stop, nombre, categoría, duración, waveform ligera,
   tags y estado de “en uso”.
3. Acciones: arrastrar a la pista SFX, `+ Añadir al cabezal`, y “duplicar en
   siguiente corte”. Al añadir, usar la duración medida y aplicar snapping al
   playhead, borde de clips y marcadores de transición.
4. Inspector contextual del clip: volumen, gain en dB (UI derivada de la escala
   interna 0–1), fade in/out corto, offset y recorte. En MVP el pan, pitch y
   automatización por keyframes quedan fuera.
5. Pista SFX con color propio y waveform. Permitir solapamiento: dos efectos
   simultáneos son válidos, aunque la validación debe advertir de clipping.

No asociar automáticamente cada transición visual con un audio: presentarlo
como sugerencia configurable. Una tabla de compatibilidad editable
(`transitionPresetId → soundEffectAssetId + offsetMs + defaultGainDb`) puede
acelerar la creación sin ocultar el control del editor.

## 7. Mezcla y render

Para no afectar la inteligibilidad del curso:

- Mantener `VOICE` como trigger de ducking sobre `MUSIC`; **SFX no debe activar
  ducking de música** por defecto.
- El volumen se calcula como `track.volume × clip.volume`; no modificar el
  archivo original para normalizarlo en cada uso.
- Aplicar normalización offline al ingresar, o al menos almacenar LUFS/true
  peak y establecer ganancia sugerida. Como política inicial, fijar un techo de
  true peak de -1 dBTP y advertir si la mezcla estimada puede clippear.
- Render y preview deben consumir exactamente el mismo documento y las mismas
  curvas de volumen. Los efectos no deben desaparecer si están fuera de vista:
  HyperFrames ya trata los audio como clips de timeline, lo que permite esta
  paridad.

## 8. Plan de implementación por fases

### Fase 1 — Biblioteca segura y uso básico

- Migración `sound_effect_assets`, bucket privado y políticas RLS.
- Dominio `production/sound-effects`: schemas Zod, repositorio, servicio de
  upload/inspección, servicio de búsqueda paginada y servicio de autorización.
- Pantalla administrativa de carga, estado y archivo lógico; panel de lectura
  para el editor.
- Extensión de `CompositionTrackRole`, `CompositionClip.source` y compilador de
  preview/render para `SOUND_EFFECT_ASSET`.
- Timeline: pista SFX, preview, drag/drop, move, trim, delete, volumen y
  guardado no destructivo.

### Fase 2 — Calidad de edición

- Waveforms precalculados y cacheados por checksum.
- Fades, ganancia en dB, análisis de loudness y aviso de clipping.
- Sugerencias por transición, sin inserción automática; analítica agregada de
  uso por asset para depurar catálogo, sin almacenar contenido sensible.

### Fase 3 — Mezcla avanzada

- Keyframes de clip/track, pan, bus de SFX y limitador final.
- Versionado visual del catálogo, auditoría de licencias y reporte de assets
  usados por render/publicación.

## 9. Pruebas y criterios de aceptación

### Pruebas automáticas

- Unitarias: validación de MIME/tamaño/duración, transición de estados,
  deduplicación por checksum, RBAC, cálculo de duración y compilación del clip
  a `<audio>`.
- Integración: RLS entre dos organizaciones; URL firmada no puede apuntar a
  otra organización; asset archivado no aparece en nuevas inserciones pero se
  puede renderizar en composiciones existentes.
- Editor: añadir al cabezal, drag/drop, snap a corte, recorte dentro de
  duración, volumen, deshacer/rehacer y persistencia/reapertura.
- Render: un SFX al inicio, en un corte, solapado con música/voz y cercano al
  final conserva sincronía y aparece en el video final.

### Aceptación manual

- Se suben MP3 y WAV válidos, se rechaza un binario con extensión falsa.
- El editor puede preescuchar, buscar y colocar un efecto en menos de tres
  interacciones después de abrir el panel.
- Voz comprensible en altavoces de laptop y audífonos con SFX y música activos.
- Un usuario de otra organización no puede listar, preescuchar, cargar ni
  resolver el archivo.

## 10. Riesgos residuales

- El uso de URLs firmadas en render requiere renovar el TTL si el render entra
  en cola más tiempo que la vida del URL; el adaptador ya debe generar la URL
  justo antes de la entrega y no persistirla.
- La detección de clipping en una mezcla con muchos SFX es una advertencia,
  no una garantía, hasta que se incorpore un analizador/limitador de mezcla
  completo.
- Licenciamiento no se resuelve técnicamente: se necesita política operativa
  que defina licencias aceptadas y responsable de aprobación.

## 11. Archivos del proyecto con impacto esperado

- `apps/web/src/domains/production/composition-editor/composition-document.types.ts`
- `apps/web/src/domains/production/composition-editor/composition-clip-audio.service.ts`
- `apps/web/src/domains/production/composition-editor/composition-audio-mix.service.ts`
- `apps/web/src/domains/production/hyperframes/hyperframes-source-asset.service.ts`
- `apps/web/src/app/api/production/hyperframes/assets/route.ts`
- `apps/web/src/domains/library/types.ts` y `library-catalog.ts`
- Nueva migración en `supabase/migrations/` y nuevo dominio
  `apps/web/src/domains/production/sound-effects/`.

La propuesta no modifica el comportamiento de voz, música, B-roll, avatar ni
las composiciones existentes: sólo amplía el union de fuentes y añade una pista
semántica nueva.
