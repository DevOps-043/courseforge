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
