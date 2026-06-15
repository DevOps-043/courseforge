# Guia interna: plantillas Remotion

## Objetivo

Las plantillas de Remotion definen como se ensambla un video de produccion a partir de assets ya generados por CourseGen: slides rasterizadas, avatar, voz, musica y B-roll. La fuente tecnica de verdad siguen siendo Supabase Storage y las tablas de materiales; la plantilla solo decide el layout/timeline visual.

## Estado actual

- Las plantillas se registran en `remotion_templates`.
- El campo critico para render es `composition_id`.
- Los `composition_id` soportados hoy son:
  - `full-slides`: visual principal a pantalla completa, avatar como apoyo si existe.
  - `split-avatar`: visual a un lado y avatar al otro.
  - `avatar-focus`: avatar como elemento principal, assets visuales como apoyo.
- El ZIP que se sube desde el modal se guarda como referencia/versionado en Storage, pero no se ejecuta como bundle dinamico de Remotion.
- Si una plantilla trae un ZIP pero su `composition_id` es soportado, CourseGen renderiza con la composicion interna y conserva el ZIP como referencia.
- Si una plantilla no trae un `composition_id` soportado, CourseGen hace fallback a `full-slides`.

## Flujo de creacion

1. El admin abre `/admin/templates`.
2. Selecciona "Subir Plantilla".
3. Captura nombre, descripcion, `composition_id`, punto de entrada, icono y visibilidad.
4. Opcionalmente sube un ZIP.
5. `createTemplateAction` registra la plantilla para la organizacion activa.
6. La vista decora la plantilla con un estado de render:
   - `SUPPORTED_INTERNAL`
   - `INTERNAL_WITH_EXTERNAL_REFERENCE`
   - `EXTERNAL_BUNDLE_PENDING`
   - `FALLBACK_INTERNAL`

## Contrato de render

La unica fuente de verdad para props de Remotion esta en:

- `apps/web/src/remotion/types.ts`
- `apps/web/src/remotion/buildAssemblyProps.ts`
- `apps/web/src/remotion/assembly-assets.normalizer.ts`

El contrato actual entrega a cada composicion:

- `template`
- `fps`
- `totalDurationInFrames`
- `voiceAudioUrl`
- `bgMusicUrl`
- `bgMusicVolume`
- `avatarVideoUrl`
- `slides[]`
- `brollClips[]`
- `transitionType`

Esto mantiene el render portable: todo llega como JSON serializable y URLs publicas.

## Animaciones intermitentes

Si, es viable alternar segmentos como:

1. slide + agente
2. B-roll a pantalla completa
3. slide + agente
4. B-roll a pantalla completa

La forma correcta no es ejecutar ZIPs arbitrarios, sino agregar una composicion interna nueva, por ejemplo `interleaved-agent-broll`, con un timeline declarativo.

Contrato recomendado para esa evolucion:

```ts
type VisualSegment =
  | {
      kind: "slide_agent";
      durationInFrames: number;
      slideIndex: number;
      avatarMode: "pip" | "split";
    }
  | {
      kind: "broll_full";
      durationInFrames: number;
      brollOrder: number;
    }
  | {
      kind: "slide_only";
      durationInFrames: number;
      slideIndex: number;
    };
```

La composicion renderizaria esos segmentos con `Series.Sequence`. Esa ruta conserva tipos, pruebas y control de seguridad, y evita que un ZIP subido desde UI pueda ejecutar codigo no revisado en el worker de render.

## Extension recomendada

Para soportar animacion intermitente sin deuda tecnica:

1. Agregar `INTERLEAVED_AGENT_BROLL` a `ASSEMBLY_TEMPLATES`.
2. Extender el schema de props con `visualSegments?: VisualSegment[]`.
3. Crear `buildInterleavedTimeline` como funcion pura, probada con unit tests.
4. Implementar `InterleavedAgentBroll.tsx` usando `Series.Sequence`.
5. Registrar la composicion en `compositions/registry.ts` y `Root.tsx`.
6. Sembrar o permitir `composition_id = 'interleaved-agent-broll'`.
7. Mantener el ZIP como referencia hasta tener un pipeline seguro de aprobacion/compilacion.

## Criterios de QA

- Una plantilla sin assets debe renderizar fondo neutro, no romper.
- Slides sin imagen rasterizada deben advertir que no son renderizables.
- B-roll debe ordenarse por `order`.
- La duracion final debe priorizar voz cuando exista.
- La preview de navegador y el render server-side deben consumir el mismo contrato.
- Ninguna plantilla externa debe ejecutar codigo sin revision, sandbox y pin de dependencias.
