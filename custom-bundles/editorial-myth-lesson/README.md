# Editorial Myth Lesson

Bundle Remotion fuente para el lenguaje editorial documentado en `docs/ANALISIS_VIDEO_EL_MITO_Y_ESPECIFICACION_BUNDLE.md`.

## Composición

- ID: `editorial-myth-lesson-v1`
- Canvas: 1920×1080, 25 FPS.
- Entrada: `src/index.tsx`, con `registerRoot()`.
- Assets por props; el ZIP no contiene vídeo, audio, fuentes ni secretos.

## Uso

La propiedad `scenes` es el timeline autoritativo. Cada escena declara un intervalo `[startFrame, endFrame)`, layout, assets opcionales, copy y transiciones. Los layouts admitidos son `AVATAR_FULL`, `TITLE_CARD`, `STATEMENT_CARD`, `WARNING_CARD`, `AVATAR_SLIDE_SPLIT`, `EVIDENCE_SPLIT`, `CTA_CARD` y `OUTRO`.

Si no se recibe un scene plan, se muestra el avatar disponible a pantalla completa como fallback seguro. No se intenta inferir una secuencia desde listas de assets.

`EVIDENCE_SPLIT` puede declarar `fallback: "slide_full"`; sólo entonces una slide sustituye el split si falta B-roll. El bundle no usa placeholders textuales para assets faltantes.

## Validación antes de publicar

1. Empaquetar el contenido de esta carpeta en un ZIP, con el manifest en la raíz.
2. Ejecutar el validador de bundles de Courseforge.
3. Compilar con el Desktop Worker y comprobar que existe `index.html` en la raíz del bundle compilado.
4. Renderizar un fixture con todos los layouts, transiciones, slides HTML/imagen, clips cortos y captions.

El contrato completo, criterios de QA y reglas de fallback viven en la especificación de análisis enlazada arriba.
