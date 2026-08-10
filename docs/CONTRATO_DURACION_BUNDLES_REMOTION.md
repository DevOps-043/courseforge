# Contrato de duracion para bundles Remotion

Esta guia es la referencia operativa para crear y mantener bundles Remotion que Courseforge ejecuta con SofLIA Engine Desktop Worker. Nacio de una correccion de produccion en `editorial-myth-lesson` y debe aplicarse a plantillas similares.

## Regla fundamental

El job define la duracion en frames y el FPS. El bundle debe renderizar exactamente ese contrato; un MP4 reproducible no es valido si su duracion no coincide.

Para `editorial-myth-lesson`, el contrato operativo es 1920x1080 a **30 FPS**. La referencia audiovisual analizada puede haber sido medida a 25 FPS, pero eso no autoriza copiar ese valor al manifest ni a la composicion si el job usa 30 FPS.

Ejemplo: 1,012 frames a 30 FPS equivalen a 33.733 segundos. A 25 FPS producirian 40.48 segundos y el resultado debe ser rechazado.

## Props y fuente unica de duracion

Durante la transicion de contratos, Courseforge entrega ambos nombres:

```ts
type DurationProps = {
  fps: 30;
  totalDurationFrames: number;   // nombre canonico
  totalDurationInFrames: number; // alias de compatibilidad
};
```

Ambos props deben representar el mismo numero de frames. No se permite inferir la duracion desde slides, B-roll, avatar, audio o layout mientras exista alguno de esos props.

`calculateMetadata` es la autoridad de Remotion:

```ts
export const calculateMetadata: CalculateMetadataFunction<TemplateProps> = async ({ props }) => ({
  durationInFrames: Math.max(1, Math.round(
    props.totalDurationFrames
    ?? props.totalDurationInFrames
    ?? fallbackDurationInFrames,
  )),
  fps: CANVAS.fps,
  props,
});
```

El mismo resolvedor debe utilizarse en los fallbacks de escena. El `fps` de `CANVAS`, el manifest, `defaultProps` y el snapshot del job deben coincidir.

## Caso de regresion obligatorio

| Entrada | Resultado esperado |
|---|---|
| `totalDurationFrames: 1012`, `fps: 30` | Metadata: `durationInFrames === 1012`; MP4: `33.733 s`. |
| Solo `totalDurationInFrames: 1012` | Compatibilidad: metadata de `1012` frames. |
| Ningun prop de duracion | Usar exclusivamente el fallback declarado. |

## Comportamiento de Engine ante desajustes

Antes de confirmar un upload, Courseforge compara la duracion reportada con el snapshot inmutable del job. Si la diferencia excede 2 segundos:

1. El job cambia a `FAILED`; nunca a `SUCCEEDED`.
2. Se persiste `provider_error.code = "OUTPUT_DURATION_MISMATCH"` con `expectedFrames`, `expectedFps`, `expectedDurationSeconds`, `receivedDurationSeconds` y `toleranceSeconds` dentro de `durationMismatch`.
3. El endpoint de completado devuelve `HTTP 422`, nunca `500`, con esos detalles.
4. La UI presenta un bloqueo explicito, no el ultimo progreso de upload (95%).
5. El worker conserva el archivo para revision y no vuelve a intentar confirmar ese MP4.

Un archivo subido a Storage no es un video final hasta que Engine confirma el job. Un MP4 rechazado por duracion es solo un artefacto de diagnostico.

## Correccion, publicacion y reencolado

1. Corregir de forma consistente `CANVAS.fps`, manifest, `defaultProps`, tipos y `calculateMetadata`.
2. Empaquetar y publicar una nueva version del ZIP fuente.
3. Construir y aprobar el nuevo bundle; preview y render deben consumir su nuevo hash.
4. Crear o reencolar un job nuevo con el snapshot corregido.
5. No reabrir, confirmar ni publicar el MP4 creado por el contrato anterior.
6. Verificar en telemetria los frames de composicion, FPS, duracion reportada, `propsHash`, `bundleHash` y `SUCCEEDED`.

## Checklist para autores

- [ ] Manifest, `CANVAS`, `calculateMetadata` y `defaultProps` usan el mismo FPS.
- [ ] Se prioriza `totalDurationFrames` y se soporta el alias durante compatibilidad.
- [ ] No se calculan duraciones desde assets o layout.
- [ ] Existe un fixture de 1,012 frames a 30 FPS o equivalente.
- [ ] Un MP4 fuera de tolerancia se rechaza con `OUTPUT_DURATION_MISMATCH`.
- [ ] Toda correccion de contrato crea nuevo build y nuevo job.
