# Contrato de Composition Motion V1

## Invariantes

1. Una operación modifica exclusivamente los campos declarados.
2. Layout base y motion viven en elementos DOM diferentes.
3. `.clip` conserva el lifecycle de HyperFrames.
4. Se construye un único timeline GSAP pausado y sincrónico.
5. No se usan relojes, red, aleatoriedad, timers ni loops infinitos para render.
6. Al eliminar un clip se eliminan sus animaciones en la misma versión.
7. El cálculo automático conserva layout, visibilidad y timing `USER_EDITED`.

## Persistencia

`document.motion` contiene `schemaVersion` y hasta 200 animaciones. Cada animación apunta a un `clipId`, declara un grupo de propiedades, timing anclado al inicio o final del clip y entre 2 y 50 keyframes. El documento completo continúa protegido mediante hash, `If-Match`, append inmutable y auditoría.

No se requiere una tabla o migración SQL para Motion V1 porque el contrato vive en el JSONB versionado existente. La evolución se identifica mediante `format: courseforge-composition-v2` y `motion.schemaVersion: 1`.

La escritura y los controles pueden deshabilitarse con `NEXT_PUBLIC_COMPOSITION_MOTION_ENABLED=false`. El lector y el compilador continúan procesando Motion V1 para que el rollback no elimine ni ignore animaciones guardadas.

## Propiedades permitidas

- `POSITION`: `x`, `y`
- `SCALE`: `scale`
- `ROTATION`: `rotation`
- `OPACITY`: `opacity`

No se animan `top`, `left`, `width`, `height`, `display` ni `visibility`. El lifecycle de clips pertenece a HyperFrames.

## Operaciones

- `animation.add-preset`
- `animation.update-timing`
- `animation.update-keyframe`
- `animation.remove`

Los presets iniciales son `FADE_IN`, `FADE_OUT`, `SLIDE_IN_LEFT`, `SLIDE_IN_RIGHT`, `ZOOM_IN` y `POP`.

## Estrategia DOM

```text
.clip
└── .clip-content       layout editable
    └── .motion-subject transformaciones GSAP
        └── media/deck
```

## Validación requerida

- Migración V1 → V2 sin pérdida.
- Preservación de propiedades entre operaciones sucesivas.
- Targets existentes e IDs únicos.
- Animaciones dentro de la duración del clip.
- Ausencia de solapamiento en el mismo grupo de propiedades.
- Paridad del compilador de preview y render.
- Pruebas visuales en inicio, poses intermedias y final.

## Extensión Motion V2: animación ambiental con repetición finita

Motion V2 conserva la lectura y el render de documentos `schemaVersion: 1`. Toda
edición que crea una nueva versión del documento escribe `schemaVersion: 2`.

Los presets ambientales `PULSE`, `FLOAT`, `SWAY` y `BREATHE` pueden declarar:

```json
{
  "loop": {
    "mode": "FINITE",
    "cycleDurationSeconds": 1.5
  }
}
```

La duración del intervalo de la animación sigue siendo la fuente de verdad. La
cadencia describe un ciclo completo de pose base → pico → pose base y debe estar
entre 0.5 y 8 segundos. El compilador construye un número finito de repeticiones
y un último tramo parcial que vuelve a la pose base exactamente al finalizar el
intervalo. No se usan `repeat: -1`, relojes ni keyframes expandidos por cada ciclo.

Los loops aceptan exactamente tres keyframes (0 %, 50 %, 100 %). Sus poses no se
editan individualmente; se ajustan mediante duración, cadencia e intensidad para
mantener una semántica estable entre preview y render.
