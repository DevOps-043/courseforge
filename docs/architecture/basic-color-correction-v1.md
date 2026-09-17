# ADR: corrección básica de color por clip

## Estado

Aceptado para implementación — 2026-09-17.

Alcance de este documento: fases 0 y 1. El contrato de composición, el
compilador de preview/render y el inspector se implementan en los siguientes
lotes.

## Problema

Courseforge necesita controles no destructivos de corrección de color por
clip. El alcance mínimo de Product exige brillo, contraste y saturación. El
preview interactivo es propiedad de Courseforge, mientras que el render final
usa HyperFrames; ejecutar matemáticas diferentes en cada superficie produciría
divergencias visibles.

## Decisión

### Fuente de verdad

`courseforge-composition-v2` continuará siendo la única fuente editable. Cada
clip visual podrá declarar un subconjunto estricto del contrato canónico de
HyperFrames:

```ts
colorGrading?: {
  adjust: {
    exposure: number;   // -2..2
    contrast: number;   // -1..1
    saturation: number; // -1..1
  };
};
```

El campo será opcional. Tres valores neutros equivalen a ausencia del campo y
no producirán `data-color-grading`. El cambio es aditivo y no requiere una
migración de base de datos ni `courseforge-composition-v3`.

### Semántica de Product

- La etiqueta visible será `Brillo (exposición)`; no se implementará un filtro
  CSS de brightness.
- La UI representará los tres controles de `-100` a `100` y convertirá brillo
  a `-2..2`, y contraste/saturación a `-1..1`.
- El MVP aplica a clips `VIDEO` e `IMAGE`.
- Dividir un clip copia su corrección a ambos fragmentos.
- Restablecer o sustituir el medio elimina la corrección.
- Insertar un medio nuevo comienza en estado neutro.
- Las pistas bloqueadas no aceptan cambios.
- Lia no modificará color en V1; sólo se aceptarán operaciones iniciadas por el
  usuario.

Presets, LUT, temperatura, tint, highlights, shadows, curves, wheels, detalles
y efectos quedan fuera del contrato. No basta con ocultarlos: el schema y las
operaciones deberán rechazarlos.

### Runtime compartido

HyperFrames publica `@hyperframes/core/runtime/color-grading`, un bootstrap
autónomo construido sobre el mismo shader del render. Courseforge lo usará en
su iframe de preview sin entregar a HyperFrames el control de playback,
timeline, audio o transporte.

El runtime:

- observa `<video>` e `<img>` con `data-color-grading`;
- expone `window.__hf.colorGrading` para cambios en vivo;
- reutiliza una instancia ya instalada;
- conserva visible el medio original cuando WebGL no puede activarse;
- reporta estado `missing`, `inactive`, `pending`, `active` o `unavailable`.

El compilador y el snapshot utilizarán las utilidades públicas de
`@hyperframes/core/color-grading` para normalizar y serializar el atributo.

### Compatibilidad

El soporte garantizado de V1 será SDR/Rec.709. HDR, HLG, PQ y LOG no se
considerarán una conversión de color correcta y deberán advertirse cuando
exista metadata suficiente para detectarlos.

Los medios remotos deberán incluir `crossorigin="anonymous"` y el origen debe
autorizar CORS. Si WebGL o CORS fallan, el preview mostrará el medio original y
una advertencia; la edición nunca debe producir un clip invisible.

## Consecuencias

Preview y render comparten shader y normalización, por lo que la paridad puede
verificarse con comparación perceptual de frames. El costo normal del MVP es
un pass de GPU por medio corregido; varios clips superpuestos incrementan el
uso de memoria y deberán medirse a 1080p.

Courseforge deberá depender directamente de la misma versión de
`@hyperframes/core` usada por el render, en vez de confiar en una dependencia
transitiva de Studio.

## Rollback

La edición podrá ocultarse mediante feature flag. El compilador deberá seguir
respetando correcciones ya persistidas para evitar que un rollback visual
cambie renders existentes.

## Condiciones de salida de fases 0 y 1

- Contrato, semántica, límites y comportamiento de edición documentados.
- Runtime de color público y separado del player/timeline.
- Bootstrap idempotente que reutiliza una API existente.
- Artefactos IIFE y ESM incluidos en el build y en el paquete publicado.
- Pruebas unitarias del bootstrap y verificación de exports del paquete.
- Documentación pública de integración y requisito de CORS.
