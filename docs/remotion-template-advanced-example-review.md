# Revisión: `remotion-template-advanced-example.zip`

> Stack: Remotion 4.0.474 · React 19 · compositionId: `advanced-avatar-subtitles`  
> Archivo analizado: `src/index.tsx` (único archivo de lógica del bundle)  
> Fecha: 2026-06-23

---

## 1. Entendimiento del objetivo

El template es una **plantilla de demo/QA** para el pipeline de producción de SofLIA Engine.
Demuestra cuatro escenas pedagógicas con avatar que cambia de posición, subtítulos sincrónicos,
un slide stage y un progress bar. No usa video real: el avatar es un placeholder CSS.

**Propósito del template en el contexto del proyecto**: validar que el sistema de carga, parseo
y renderizado de bundles externos funciona antes de usar templates con assets reales.

---

## 2. Diagnóstico técnico — Superposición de elementos

### 2.1 Canvas asumido

El template no declara `width/height` propios; los toma del `<Composition>` del host.
El proyecto usa **1920×1080** (ver `types.ts`: `ASSEMBLY_WIDTH/HEIGHT`). Todos los cálculos
de colisión abajo asumen ese canvas.

### 2.2 Mapa de capas (z-order, de atrás hacia adelante)

```
[1] AbsoluteFill fondo  — gradiente oscuro, inset: 0
[2] Panel de cristal    — position: absolute, inset: 46, z-index implícito
[3] Texto de escena     — position: absolute, left: 116, top: 96, width: 980
[4] Grid inferior       — position: absolute, left: 116, right: 116, top: 520, height: 270
     ├── TimelineMarkers (4 columnas)
     └── SlideStage (right column del grid)
[5] Avatar              — position: absolute, varía por escena (260×260 px)
[6] Subtitle            — position: absolute, left: 300, right: 300, bottom: 54
```

### 2.3 Colisiones identificadas

#### ⚠️ Colisión A — Avatar (bottom) vs SlideStage + Grid

| Atributo   | Grid (left=116, right=116, top=520, h=270) | Avatar bottom-right (right=82, bottom=86) | Avatar bottom-left (left=82, bottom=86) |
|------------|---------------------------------------------|-------------------------------------------|-----------------------------------------|
| X inicio   | 116 px                                      | 1578 px (= 1920-82-260)                   | 82 px                                   |
| X fin      | 1804 px (= 1920-116)                        | 1838 px (= 1920-82)                       | 342 px (= 82+260)                       |
| Y inicio   | 520 px                                      | 734 px (= 1080-86-260)                    | 734 px                                  |
| Y fin      | 790 px (= 520+270)                          | 994 px (= 1080-86)                        | 994 px                                  |
| Overlap Y  | —                                           | **734–790 px = 56 px**                    | **734–790 px = 56 px**                  |
| Overlap X  | —                                           | **1578–1804 px = 226 px**                 | **116–342 px = 226 px**                 |

**Resultado**: el avatar en posiciones `bottom-right` (Escena 1) y `bottom-left` (Escena 3)
**se superpone visualmente sobre el SlideStage** durante 56px verticales × 226px horizontales.
En la escena 1, cubre la mitad inferior derecha del SlideStage (donde aparecen las slides).
En la escena 3, cubre la mitad inferior izquierda del TimelineMarkers.

**¿Es intencional?** En una plantilla de demo de QA probablemente sí (el avatar como PiP
encima del contenido es un patrón válido), pero si el objetivo es que el slide sea legible
completo, esta superposición lo impide.

#### ⚠️ Colisión B — Avatar (top-left) vs Texto de escena

| Elemento            | X            | Y            |
|---------------------|--------------|--------------|
| Texto (left=116, w=980) | 116–1096 px | 96–~328 px |
| Avatar top-left (left=82, top=74) | 82–342 px | 74–334 px |
| **Overlap X**       | **116–342 px (226 px)** | —     |
| **Overlap Y**       | —            | **96–328 px (232 px)**  |

**Resultado**: en la Escena 2 (`avatarPosition: "top-left"`), el avatar **cubre el inicio del
bloque de texto**: eyebrow, primera línea del título h1 y parte del cuerpo. La lectura del
contenido textual de la escena queda parcialmente obstruida.

#### ⚠️ Colisión C — Avatar (bottom) vs Subtitle, esquina

| Elemento       | X            | Y (desde top) |
|----------------|--------------|---------------|
| Subtitle (l=300, r=300) | 300–1620 px | ~944–1026 px |
| Avatar bottom-right | 1578–1838 px | 734–994 px |
| **Overlap**    | **1578–1620 px (42 px)** | **944–994 px (50 px)** |

**Resultado**: superposición de 42×50 px en la esquina inferior-derecha del avatar y el
extremo derecho del subtítulo. Visualmente es pequeña pero puede cortar texto si el subtítulo
es largo y llega hasta el extremo.

Para `bottom-left` la superposición es simétrica: esquina inferior-izquierda.

#### ✅ Escena 4 (top-right) — sin colisiones críticas

- Avatar top-right: x=1578–1838, y=74–334
- Texto: x=116–1096, y=96–328 → **sin overlap X** (texto termina en 1096, avatar empieza en 1578)
- Grid: y=520–790 → **sin overlap Y** (avatar termina en 334, grid empieza en 520)

Escena 4 es la única composición sin colisiones.

---

## 3. Otros problemas encontrados

### 3.1 Progress bar con denominador hardcodeado a 600

```tsx
// ❌ Actual
width: `${Math.round((frame / 600) * 100)}%`

// ✅ Correcto
const { durationInFrames } = useVideoConfig();
width: `${Math.round((frame / durationInFrames) * 100)}%`
```

Si la composición se renderiza con `durationInFrames` diferente a 600, la barra mostrará
un progreso incorrecto (sobrefluyendo o quedándose corta).

### 3.2 Escenas y subtítulos hardcodeados a 600 frames totales

Las escenas cubren exactamente frames 0–600 y los subtítulos tienen timecodes fijos.
Si el host registra la composición con `durationInFrames ≠ 600`, habrá:
- Frames finales sin escena activa (el fallback devuelve `scenes[0]`, lo que es un estado incorrecto)
- Subtítulos desincronizados del contenido narrado

**Impacto en QA de bundles**: para validar templates externos, esto es aceptable porque
el bundle se renderiza con la duración que él mismo declara. El `courseforge-remotion-template.json`
no especifica `durationInFrames`, por lo que el host debe pasarlo como `inputProp` o via
`defaultProps` en la `<Composition>`.

### 3.3 `MyComposition` alias sin registro explícito

```tsx
export const MyComposition = AdvancedAvatarSubtitles;
```

El metadata del bundle declara `compositionId: "advanced-avatar-subtitles"`, pero el template
exporta `MyComposition`. El host que carga este bundle debe resolver esa discrepancia (mapear
`compositionId` → componente exportado). El sistema actual en
`apps/api/src/features/production/` necesita contemplar este alias.

### 3.4 `scenes.indexOf(scene)` en `TimelineMarkers`

```tsx
index === scenes.indexOf(scene) // comparación por referencia al objeto escena
```

Funciona porque `getActiveScene` retorna el mismo objeto del array `scenes`. Sin embargo, si
se reestructura el código y `getActiveScene` devuelve una copia, el índice sería siempre -1
y ningún marcador se resaltaría. Es frágil. Mejor usar un campo `index` en cada escena:

```tsx
// Más robusto
index === scene.index
```

---

## 4. Lo que funciona bien

| Aspecto | Evaluación |
|--------|-----------|
| Arquitectura de escenas con `getActiveScene(frame)` | ✅ Patrón correcto y mantenible |
| Spring de entrada por escena con `localFrame` | ✅ Implementación correcta |
| Fade in/out de subtítulos con `interpolate` | ✅ Correcto, con clamp |
| `getActiveSlide` usando `useVideoConfig().durationInFrames` | ✅ Dinámico, no hardcodeado |
| Guard en `getActiveScene` con fallback | ✅ Nunca retorna `undefined` |
| Separación visual de responsabilidades (Avatar, Subtitle, SlideStage, TimelineMarkers) | ✅ Clara |
| Props tipadas con TypeScript | ✅ Bien definidas |
| `sceneProgress` animado con `interpolate` para el texto | ✅ Entrada suave correcta |

---

## 5. Resumen ejecutivo de colisiones

```
Escena 1 (bottom-right):  Avatar cubre ~56×226 px del SlideStage (parte inferior)
                           Avatar solapa ~50×42 px con el extremo del subtitle
Escena 2 (top-left):      Avatar cubre ~232×226 px del bloque de texto de escena
Escena 3 (bottom-left):   Avatar cubre ~56×226 px de TimelineMarkers (parte inferior)
                           Avatar solapa ~50×42 px con el extremo del subtitle
Escena 4 (top-right):     Sin colisiones relevantes ✅
```

---

## 6. Correcciones recomendadas

### Prioridad alta — corregir antes de usar como referencia de producción

**Fix 1: denominator del progress bar**

```diff
- width: `${Math.round((frame / 600) * 100)}%`
+ width: `${Math.round((frame / durationInFrames) * 100)}%`
```

Requires `const { durationInFrames } = useVideoConfig();` en el scope del componente.

**Fix 2: añadir `index` a cada escena y usarlo en `TimelineMarkers`**

```diff
type Scene = {
+ index: number;
  startFrame: number;
  ...
};

const scenes: Scene[] = [
- { startFrame: 0, ... }
+ { index: 0, startFrame: 0, ... }
  ...
];

// En TimelineMarkers:
- index === scenes.indexOf(scene)
+ index === scene.index
```

### Prioridad media — afecta legibilidad, no bloqueante en QA

**Fix 3: evitar colisión avatar top-left vs texto**

Opción A: cambiar `top-left` a `top-right` en Escena 2 (el texto ocupa left 116–1096, right
queda libre).

Opción B: reducir `width` del texto a `680` cuando `avatarPosition === "top-left"` para que
no colisionen.

Opción C: desplazar el bloque de texto hacia la derecha cuando el avatar está en top-left:

```diff
- left: 116,
+ left: scene.avatarPosition.endsWith("left") ? 380 : 116,
```

**Fix 4: evitar colisión avatar bottom vs SlideStage**

Reducir el grid a que no ocupe la zona de las posiciones bottom del avatar. La altura actual
del grid es 270px empezando en top=520 → termina en 790. El avatar empieza en y=734.

Cambiar el grid para que termine antes:

```diff
- top: 520, height: 270
+ top: 520, height: 200    // termina en 720, avatar empieza en 734 → 14px de margen
```

O bien mover el grid más arriba:

```diff
- top: 520
+ top: 460                 // con height 270, termina en 730 → 4px de margen
```

### Prioridad baja — cosmético

**Fix 5: subtítulo vs avatar en bottom**

Aumentar el `left/right` del subtítulo para que no alcance las esquinas del avatar:

```diff
- left: 300, right: 300
+ left: 380, right: 380
```

Con 380px de margen lateral, el subtítulo termina en x=1540 y el avatar bottom-right empieza
en x=1578 → 38px de separación.

---

## 7. Cómo probar las correcciones

1. Cargar el bundle en Remotion Studio: `npx remotion studio src/index.tsx`
2. Scrubear frame a frame en los límites de escena (150, 300, 450)
3. En cada escena, verificar que avatar, texto, grid y subtitle no se solapen
4. Cambiar la `durationInFrames` de la Composition a 450 y 900; confirmar que la barra
   de progreso sigue siendo correcta (solo aplicable con Fix 1)
5. Probar con `props.slides` cargado con 3 imágenes reales para confirmar que `SlideStage`
   muestra imágenes y no el placeholder

---

## 8. Relación con el sistema actual del proyecto

El sistema propio (`apps/web/src/remotion/`) **no tiene estas colisiones**:

- `FullSlides.tsx`: el avatar PiP tiene `width: avatarScale * 100%` (máx 36%) + posición
  anclada a una esquina; el contenido primario ocupa `AbsoluteFill` pero el PiP va encima
  deliberadamente con tamaño controlado.
- `SplitAvatar.tsx`: el avatar y el contenido visual están en columnas separadas (`flex: 1`)
  con `overflow: hidden`, imposible que se solapen.
- `AvatarFocus.tsx`: el avatar ocupa `contain` (centrado) y el visual de apoyo es una franja
  inferior con `height: supportStripHeight * 100%`, sin zona de colisión con el avatar.

El template ZIP es útil como referencia de **cómo animat el avatar entre posiciones por
escenas**. Los patrones de `getActiveScene`, `spring({ frame: localFrame })` y
`interpolate(sceneProgress, ...)` son directamente trasladables al sistema propio.
