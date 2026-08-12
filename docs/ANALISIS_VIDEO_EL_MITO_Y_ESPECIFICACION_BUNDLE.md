# Análisis de referencia: `El mito v7`

**Referencia:** `C:\Users\Lordg\Downloads\El mito v7.mp4`  
**Duración medida:** 169.76 s · 4,244 frames · 25 FPS · 1920 × 1080 · H.264/AAC  
**Objetivo:** convertir el lenguaje visual de la referencia en un bundle Remotion dinámico, seguro y compatible con Courseforge y el Desktop Worker.

> Esta especificación describe patrones visuales y temporales observados; no debe copiar material protegido de la referencia. El resultado debe usar los assets, marca, voz y contenido autorizados de Courseforge.

## Método y límites de la observación

- Se leyó el contenedor con `ffprobe` y se extrajeron 170 fotogramas, uno por segundo, más una hoja de contacto cada cinco segundos.
- Se midió la diferencia visual entre fotogramas consecutivos para localizar cambios de escena; los límites se confirmaron visualmente. Por eso los cortes se reportan con precisión de aproximadamente un segundo, no como timecode editorial de frame exacto.
- El binario FFmpeg distribuido con Remotion en este entorno no incluye los filtros `fps` ni `tile`. Se corrigió el método de inspección extrayendo frames individuales con `-ss` y componiendo la hoja de contacto con Pillow. Esto no afecta el MP4 ni el código de producción.
- El contenido textual se registró solo cuando era legible en pantalla. Esta revisión no pretende ser una transcripción de la voz; las captions de la plantilla deben venir de un transcript temporizado autorizado.

## 1. Resultado del análisis

El video no usa una composición permanente. Su calidad percibida viene de un sistema editorial de cuatro layouts que se alternan según la función narrativa:

1. **Host / avatar a cámara** para explicar y generar cercanía.
2. **Tarjeta tipográfica a pantalla completa** para tesis, cambio de capítulo y conclusión.
3. **Split de host + slide** para introducir o comentar una idea concreta.
4. **Evidencia visual: B-roll + slide** para sostener una afirmación con una imagen o vídeo contextual.

La edición es sobria: cortes limpios, fundidos muy cortos al entrar/salir de tarjetas, composición estable durante cada beat y subtítulos persistentes sobre los segmentos de host. No usa transiciones decorativas, cards genéricas ni movimiento continuo de paneles.

La actual plantilla `avatar-left-slides-broll-right` solo representa una variante estable de host a la izquierda, slide arriba a la derecha y B-roll abajo a la derecha. Es compatible como punto de partida técnico, pero **no puede recrear fielmente esta referencia**: no puede seleccionar un layout por escena, no modela tarjetas de texto, no asigna clips de avatar por escena y reparte slides/B-roll proporcionalmente cuando faltan `timelineOverrides` explícitos.

## 2. Línea de tiempo observada

Los límites son aproximados a ±1 segundo; se obtuvieron con muestreo de frames por segundo y revisión de fotogramas. El bundle final debe usar beats explícitos en frames, no estos intervalos como constantes.

| Escena | Tiempo aprox. | Layout | Contenido visible | Uso narrativo |
|---|---:|---|---|---|
| S01 | 00:00–00:01 | Negro | Inicio en negro | Separación / respiración inicial. |
| S02 | 00:01–00:08 | `TITLE_CARD` | “El mito” y subtítulo breve sobre fondo blanco | Presentar tema. Entrada/salida por fundido corto. |
| S03 | 00:08–00:22 | `AVATAR_FULL` | Presentador en oficina, plano medio, subtítulo inferior | Hook y formulación de la creencia. |
| S04 | 00:22–00:27 | `STATEMENT_CARD` | Pregunta grande: “¿La amabilidad gana las ventas complejas?” | Convertir la creencia en una pregunta memorable. |
| S05 | 00:27–00:36 | `AVATAR_SLIDE_SPLIT` | Slide blanco tipográfico a la izquierda; avatar con micrófono a la derecha | Formular el mito mientras se mantiene al host visible. |
| S06 | 00:36–00:55 | `EVIDENCE_SPLIT` | B-roll vertical de conversación/empresa a la izquierda y slide con evidencia a la derecha | Mostrar evidencia y bullets. |
| S07 | 00:55–01:00 | `AVATAR_FULL` | Regreso al presentador | Pregunta puente: “¿Por qué?”. |
| S08 | 01:00–01:03 | `STATEMENT_CARD` | “La razón no está en el vendedor; está en el comprador.” | Giro argumental. |
| S09 | 01:03–01:08 | `AVATAR_FULL` | Presentador | Explicación del giro. |
| S10 | 01:08–01:23 | `EVIDENCE_SPLIT` | B-roll de persona frente a tablero + slide “El problema ya no es encontrar información” | Explicar el nuevo contexto del comprador. |
| S11 | 01:23–01:59 | `AVATAR_FULL` | Presentador, con cambios de toma/encuadre dentro del bloque | Desarrollo de la consecuencia y ejemplo. |
| S12 | 01:59–02:05 | `WARNING_CARD` | Símbolo de advertencia + “Confundir una buena relación con una razón para cambiar” | Señalar el error crítico. |
| S13 | 02:05–02:17 | `AVATAR_FULL` | Presentador | Contraste y nueva perspectiva. |
| S14 | 02:17–02:22 | `STATEMENT_CARD` | “La confianza no nace de la comodidad…” | Síntesis de la lección. |
| S15 | 02:22–02:39 | `AVATAR_FULL` | Presentador en plano más cerrado | Cierre argumental. |
| S16 | 02:39–02:45 | `CTA_CARD` | Pregunta de reflexión: “¿Qué cambiarías hoy en tu forma de vender?” | Llamado a la acción. |
| S17 | 02:45–02:49.76 | `OUTRO` | Fondo abstracto/desenfocado de marca | Cierre musical y espacio para identidad. |

## 3. Inventario de elementos y reglas de presentación

| Elemento | Dónde aparece | Regla visual reutilizable |
|---|---|---|
| Avatar | S03, S05, S07, S09, S11, S13, S15 | Plano medio o medio-corto; ocupa el canvas completo en `AVATAR_FULL`; en split ocupa una columna sin máscara circular ni card. Usar `objectFit: cover` y un focal point por clip. |
| B-roll | S06, S10 | Una pieza de evidencia por beat. Predomina media vertical a la izquierda; se recorta a la zona asignada. Nunca compite con el copy. |
| Slide / evidencia | S05, S06, S10 | Fondo blanco, tipografía oscura de alta legibilidad y acento turquesa. Puede ser slide de imagen o HTML; debe mantener proporción y margen de seguridad. |
| Tarjeta tipográfica | S02, S04, S08, S12, S14, S16 | Canvas claro o oscuro según intención; una sola idea; texto centrado; acento de color limitado a palabras clave. |
| Subtítulos | Segmentos de avatar | Banda negra semitransparente con esquinas redondeadas, ancho contenido, alineada abajo y texto blanco. Deben proceder de transcript/timing, no estar incrustados en el vídeo de avatar. |
| Música / voz | Todo el vídeo | Voz como pista dominante; música de fondo opcional, atenuada. B-roll va silenciado salvo autorización explícita. |
| Outro | S17 | Asset visual de marca independiente, no un fallback automático de B-roll. |

## 4. Sistema de layouts propuesto (canvas 1920 × 1080)

Estas cajas son valores iniciales editables. Todos los layers deben ser hijos directos de `AbsoluteFill` y usar coordenadas globales `canvas`, conforme al contrato v2 existente.

| Layout | Zonas base | Reglas |
|---|---|---|
| `AVATAR_FULL` | `avatar`: x=0, y=0, w=1920, h=1080; `captions`: x=330, y=920, w=1260, h=96 | Avatar a pantalla completa. Activar subtítulo solo si hay cue activo. Admite focal point / crop por escena. |
| `TITLE_CARD` / `STATEMENT_CARD` | `background`: canvas; `headline`: x=210, y=330, w=1500, h=360; `eyebrow`: x=210, y=250, w=1500, h=50 | Una idea. Fondo sin ruido. No mostrar avatar, B-roll ni subtítulo. |
| `WARNING_CARD` | Igual a tarjeta + `icon`: x=910, y=230, w=100, h=100 | Igual que una tarjeta, con icono semántico opcional autorizado. |
| `AVATAR_SLIDE_SPLIT` | `slide`: x=0, y=0, w=1240, h=1080; `avatar`: x=1240, y=0, w=680, h=1080; `captions`: x=1320, y=920, w=520, h=96 | Slide dominante; host como apoyo. El borde de la división es limpio, sin marco de tarjeta. |
| `EVIDENCE_SPLIT` | `broll`: x=0, y=0, w=760, h=1080; `slide`: x=760, y=0, w=1160, h=1080 | B-roll como prueba contextual y slide como afirmación. Si el B-roll falta, la slide se expande a todo el canvas; no dejar una columna vacía. |
| `CTA_CARD` | `background`: canvas; `headline`: x=270, y=330, w=1380, h=340; `captions`: x=330, y=920, w=1260, h=96 | Fondo oscuro y pregunta clara. Puede conservar una única línea de subtitle. |
| `OUTRO` | `outroVisual`: canvas; `brandLockup`: x=720, y=410, w=480, h=260 | Duración finita, no se repite por defecto. Si falta, usar fondo de marca neutro, no un asset de contenido. |

### Tokens de diseño inferidos

- Fondo claro: blanco roto `#F7F8F6` o equivalente de la marca.
- Texto principal: azul-negro profundo, aproximadamente `#10253B`.
- Acento: turquesa/menta, aproximadamente `#3DE1CF`; usarlo solo para énfasis semántico.
- Fondo oscuro / banda de subtítulos: negro con 65–75% de opacidad.
- Tipografía: sans geométrica de peso bold o semibold; usar una familia licenciada/propia que conserve el contraste, no depender de una fuente de la referencia.
- Márgenes internos de slides: mínimo 72 px; titulares con límite de 2–4 líneas.

## 5. Lenguaje de movimiento y edición

### Transiciones

- **Corte limpio:** predeterminado entre `AVATAR_FULL` y split/evidencia. Duración 0 frames o, como máximo, 4 frames de mezcla.
- **Fundido breve:** al entrar/salir de tarjetas y outro. Recomendación: 8–12 frames a 25 FPS.
- **Sin desplazamientos genéricos:** no usar `translateY` de cards, rebotes, zooms constantes ni wipes llamativos.
- **Cambio de toma de avatar:** hard cut entre `avatarClipId` distintos; mantener continuidad de audio usando la pista de voz externa.

### Animación interna

- Tarjeta: fondo y eyebrow aparecen primero; titular llega con opacidad 0→1 y desplazamiento máximo de 12 px, en 8–10 frames. El acento puede revelarse por palabra, pero sin animar cada letra.
- Slide: entrada mediante fundido de 6–8 frames. Para HTML animado, su propia animación debe iniciar en el frame local de la escena.
- B-roll: fade de 6 frames; nunca escalar continuamente salvo que el source lo requiera.
- Subtítulos: cambio discreto por cue; banda con opacity 0→1 en 4 frames y texto sin efecto cinético.

### Ritmo

- Un cambio visual relevante cada 5–20 s según función narrativa; el promedio de la referencia es cercano a 10–12 s, con la explicación de avatar más larga hacia la segunda mitad.
- Las tarjetas duran 3–7 s según longitud de copy.
- Una evidencia visual dura mientras el argumento la necesita; no se distribuye por igual entre todos los assets.

## 6. Contrato dinámico requerido

El contrato actual entrega listas paralelas (`slides[]`, `brollClips[]`, `avatarVideoUrl`) y permite `timelineOverrides`. No expresa qué layout debe vivir en cada intervalo. Para este patrón se requiere agregar un contrato versionado de **escenas**, preservando compatibilidad con bundles existentes.

```ts
type SceneLayout =
  | "AVATAR_FULL"
  | "TITLE_CARD"
  | "STATEMENT_CARD"
  | "WARNING_CARD"
  | "AVATAR_SLIDE_SPLIT"
  | "EVIDENCE_SPLIT"
  | "CTA_CARD"
  | "OUTRO";

type SceneSpec = {
  id: string;                 // estable y único: "scene-01-hook"
  layout: SceneLayout;
  startFrame: number;         // [startFrame, endFrame), obligatorio
  endFrame: number;
  transitionIn?: { type: "cut" | "fade"; durationFrames?: number };
  transitionOut?: { type: "cut" | "fade"; durationFrames?: number };
  avatar?: {
    clipOrder?: number;       // resuelve avatarClips[order - 1]
    sourceStartFrame?: number;
    sourceEndFrame?: number;
    focalPoint?: { x: number; y: number };
  };
  slide?: { index: number; variant?: "image" | "html" };
  broll?: {
    order: number;
    sourceStartFrame?: number;
    sourceEndFrame?: number;
    loopMode?: "loop" | "freeze" | "none";
  };
  copy?: {
    eyebrow?: string;
    headline?: string;
    highlightedPhrases?: string[];
    tone?: "light" | "dark";
    icon?: "warning";
  };
  captionsEnabled?: boolean;
  outroUrl?: string;
};

type VideoTemplateProps = {
  schemaVersion: 1;
  fps: number;
  totalDurationInFrames: number;
  voiceAudioUrl?: string;
  bgMusicUrl?: string;
  bgMusicVolume?: number;
  avatarClips: Array<{ order: number; url: string; durationInFrames: number }>;
  slides: Array<{ index: number; url?: string; kind: "image" | "html"; html?: string }>;
  brollClips: Array<{ order: number; url: string; durationInFrames: number }>;
  captionCues?: Array<{ startFrame: number; endFrame: number; text: string }>;
  scenes: SceneSpec[];
  layoutOverrides?: LayoutOverrideManifest[];
};
```

### Invariantes que se deben validar antes de renderizar

1. `scenes` está ordenado, no se solapa y cubre `[0, totalDurationInFrames)` sin huecos no intencionados.
2. Cada `startFrame < endFrame`; los IDs son únicos.
3. Una escena que referencia `slide.index`, `broll.order` o `avatar.clipOrder` referencia un asset existente.
4. Un layout solo puede requerir los assets que declara: tarjeta no requiere media; `EVIDENCE_SPLIT` sí requiere slide y B-roll, o aplica su fallback declarado.
5. Las cues de captions se recortan a su escena de avatar. Nunca se muestran sobre tarjetas/evidencia salvo que `captionsEnabled` sea explícito.
6. Los `layoutOverrides` se filtran con `editableLayers` y solo después se combinan con la caja de cada layout.
7. `fps`, tamaño de canvas y duración del props snapshot coinciden con los metadatos del job.

### Ejemplo de escenas

```json
[
  {
    "id": "scene-01-title",
    "layout": "TITLE_CARD",
    "startFrame": 25,
    "endFrame": 200,
    "transitionIn": { "type": "fade", "durationFrames": 10 },
    "transitionOut": { "type": "fade", "durationFrames": 10 },
    "copy": { "eyebrow": "LECCIÓN 01", "headline": "El mito", "tone": "light" }
  },
  {
    "id": "scene-02-hook",
    "layout": "AVATAR_FULL",
    "startFrame": 200,
    "endFrame": 550,
    "avatar": { "clipOrder": 1, "focalPoint": { "x": 0.5, "y": 0.42 } },
    "captionsEnabled": true,
    "transitionIn": { "type": "cut" }
  },
  {
    "id": "scene-03-evidence",
    "layout": "EVIDENCE_SPLIT",
    "startFrame": 900,
    "endFrame": 1375,
    "slide": { "index": 2 },
    "broll": { "order": 1, "loopMode": "freeze" },
    "transitionIn": { "type": "cut" }
  }
]
```

## 7. Estructura del bundle

El ZIP fuente debe permanecer pequeño, sin assets multimedia incrustados, y contener:

```txt
courseforge-remotion-template.json
package.json
README.md
src/
  index.tsx                 # registerRoot + Composition
  composition.tsx           # resuelve escena activa y audio
  scene-renderer.tsx        # switch exhaustivo por SceneLayout
  scene-timeline.ts         # validación y búsqueda de escena activa
  layout-registry.ts        # cajas por layout y editable layer mapping
  media.tsx                 # SafeRenderVideo, SlideRenderer, CaptionRenderer
  transitions.ts            # fade/cut deterministas
  schema.ts                 # Zod de props y tipos públicos
  tokens.ts                 # colores, tipografía, duraciones; sin magic numbers dispersos
```

Esta separación evita un `index.tsx` monolítico. `composition.tsx` recibe props validados y solo orquesta; cada renderer resuelve una responsabilidad; el registro de layouts es la fuente única de coordenadas.

### Manifest mínimo recomendado

- `exportMode: "root"`, con `entryPoint: "src/index.tsx"` y `registerRoot()`.
- `compositionId` estable, por ejemplo `editorial-myth-lesson-v1`.
- `layoutContractVersion: 2` y `layoutCoordinateSpace: "canvas"`.
- `propsSchema` declara como arrays: `scenes`, `slides`, `brollClips`, `avatarClips`, `captionCues`, `layoutOverrides` y `timelineOverrides` si se conserva interoperabilidad con el editor actual.
- `editableLayers` incluye `avatar`, `slides`, `broll`, `headline`, `captions`, `outro` y los patrones dinámicos `avatar:{order}`, `slide:{index}`, `broll:{order}` cuando aplique.
- Dependencias limitadas a la allowlist del validador; no usar `fs`, `path`, `process`, `fetch`, `eval` ni lifecycle scripts.

## 8. Integración con Courseforge y el Desktop Worker

### Courseforge (fuente de verdad)

1. El pipeline de materiales genera assets y un `scenePlan` estructurado; el plan debe pasar Zod antes de persistirlo.
2. El ensamblador normaliza `avatarClips`, slides, B-roll, voz y música desde `material_components.assets`.
3. El template seleccionado recibe un snapshot inmutable de props: assets resueltos, escenas, hashes, duración, versión de template y overrides filtrados.
4. La API valida permisos, organización, versión aprobada y compatibilidad del manifest antes de crear `production_jobs`.

### Desktop Worker (ejecutor, no fuente de verdad)

1. Reclama un job autorizado y recibe `compositionId`, `resolvedProps`, `propsHash`, URL firmada del bundle y URL firmada de upload.
2. Descarga/compila el ZIP solo si la versión está aprobada y su hash coincide con el snapshot.
3. Renderiza a 1920×1080 y 25 FPS cuando el job lo exige; reporta progreso por hitos: descarga, bundle, validación, render, upload, verificación.
4. Reporta duración y checksum. Courseforge ya rechaza desvíos de duración superiores a dos segundos; debe sumarse validación de hash y de vídeo reproducible antes de marcar `SUCCEEDED`.
5. Los logs no deben incluir URLs firmadas, tokens ni texto completo de datos sensibles.

## 9. Fallos previsibles y recuperación

| Riesgo | Prevención | Fallback seguro |
|---|---|---|
| Faltan escenas o se solapan | Zod + validador de timeline antes de crear job | Rechazar el job con código `SCENE_PLAN_INVALID`; no inventar tiempos. |
| Falta B-roll en `EVIDENCE_SPLIT` | Validar referencia y asset | Expandir la slide a canvas completo solo si `fallback: "slide_full"` está declarado; si no, fallar de forma explícita. |
| Falta avatar | Validar por layout | Convertir a tarjeta/slide solo con fallback declarado; nunca mostrar placeholder textual accidental. |
| Clip menor que escena | Usar `loopMode` explícito y `sourceEndFrame` | `freeze` para evidencia estática, `loop` solo para loops que no distraigan. |
| El texto desborda | Límite de caracteres/líneas en generación y medición previa | Reducir a variante de copy aprobada; no escalar tipografía por debajo del mínimo legible. |
| HTML slide no renderizable | Usar capability del manifest y prueba de preview | Usar la imagen de slide asociada; registrar `SLIDE_HTML_FALLBACK_IMAGE`. |
| Diferencia Preview/Worker | Snapshot de props + hash + misma versión de bundle | Rechazar si hash/composition no coincide; no recompilar una fuente diferente. |
| Source ZIP inseguro | Validador estático actual + allowlist | Rechazar antes del build. |

## 10. QA y criterios de aceptación

### Pruebas unitarias

- Validación de `SceneSpec`: orden, cobertura, no solapes, referencias existentes y fallbacks.
- Selección de escena activa en límites exactos de frame.
- Renderer exhaustivo: cada `SceneLayout` resuelve sus capas esperadas y ninguna capa ajena.
- Aplicación de group override seguida de item override.
- Cálculo de transición, clamping y source-range de vídeo.

### Pruebas de integración

- El manifest pasa `validateRemotionBundle` y admite arrays de `scenes` / `captionCues`.
- Un ZIP aprobado compila con `@remotion/bundler`, deja `index.html` en la raíz y el worker puede renderizarlo.
- Un job de ejemplo llega a `SUCCEEDED`, con duración esperada y checksum registrado.
- Un bundle con dependencia/script/ruta no permitida es rechazado.

### Revisión visual manual

- Render de referencia sintética de 170 s / 25 FPS con los ocho layouts.
- Revisar frames de entrada, centro y salida de cada escena; validar cortes, fade de tarjeta, crop de avatar/B-roll y subtítulos.
- Revisar contraste AA, safe areas y ausencia de texto cortado a 1920×1080.
- Comparar preview y MP4 del worker en los mismos frames de corte.

## 11. Decisiones y próximos pasos

**Decisión principal:** construir una familia `editorial-myth-lesson` basada en un `scenePlan` explícito, no extender la plantilla actual con condicionales ad hoc.

**Primero:** definir schema Zod compartido, normalizador de escenas y tests.  
**Después:** crear el bundle fuente con los renderers modulares y un fixture sintético.  
**Luego:** exponer el `scenePlan` en el ensamblador/preview y ejecutar un render real por Desktop Worker.  
**Finalmente:** habilitar al Bundle Agent para que genere solo layouts permitidos y un plan validable, no TypeScript arbitrario ni timelines inferidos.

Este orden conserva a Courseforge como fuente de verdad, mantiene el worker como ejecutor de mínima confianza y cumple el criterio de Prompt Maestro: contratos explícitos, responsabilidades separadas, validación previa, trazabilidad y documentación operable.
