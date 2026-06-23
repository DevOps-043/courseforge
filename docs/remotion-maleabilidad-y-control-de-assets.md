# Remotion — Maleabilidad y Control de Assets

> Contexto: SofLIA Engine, Fase 7 (Producción Visual). Versión Remotion en uso: `4.0.474`.  
> Propósito: guía de referencia para el equipo sobre hasta dónde puede configurarse Remotion,
> con énfasis en secuenciación de assets, cambio de posición/tamaño en tiempo de reproducción
> y cómo encajarlo en el pipeline actual.

---

## 1. ¿Qué es Remotion?

Remotion es un framework de renderizado de video basado en React. Cada frame del video se
obtiene tomando una "foto" del árbol React en ese instante. No hay un "reproductor" que decida
cuándo empieza o termina algo: **todo es determinista por el número de frame**.

```
frame 0 → React render → imagen PNG
frame 1 → React render → imagen PNG
...
frame N → React render → imagen PNG
→  ffmpeg ensambla todos los PNG en MP4
```

Esta arquitectura tiene una consecuencia clave: **cualquier cosa que puedas expresar como una
función del número de frame, Remotion puede renderizarlo.** Eso incluye posición, tamaño,
opacidad, color, contenido, audio, video, transiciones, etc.

---

## 2. Primitivas de tiempo disponibles

### 2.1 `useCurrentFrame()`

Retorna el frame actual (entero, empieza en 0). Es la única fuente de verdad temporal.

```tsx
const frame = useCurrentFrame(); // 0, 1, 2, ...
```

### 2.2 `useVideoConfig()`

Retorna la configuración de la composición: `fps`, `durationInFrames`, `width`, `height`.

```tsx
const { fps, durationInFrames } = useVideoConfig();
const segundoActual = frame / fps; // p.ej. frame 60 @ 30fps = segundo 2
```

### 2.3 `interpolate(frame, inputRange, outputRange, options?)`

La herramienta más importante para animar cualquier valor numérico.

```tsx
// Fade-in de 0 a 1 entre frames 0 y 30
const opacity = interpolate(frame, [0, 30], [0, 1], {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
});

// Mover un elemento de x=0 a x=400 entre frames 60 y 90
const x = interpolate(frame, [60, 90], [0, 400], {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
});
```

`extrapolateLeft/Right: "clamp"` evita valores fuera del rango de salida (esencial para no
tener efectos indeseados fuera del rango de animación).

También soporta `easing` personalizado:

```tsx
import { Easing } from "remotion";

const x = interpolate(frame, [0, 30], [0, 400], {
  extrapolateRight: "clamp",
  easing: Easing.bezier(0.25, 0.1, 0.25, 1), // cubic-bezier CSS equivalente
});
```

### 2.4 `spring({ frame, fps, config?, from?, to? })`

Animación con física de resorte. No necesita rango de salida manual.

```tsx
import { spring, useCurrentFrame, useVideoConfig } from "remotion";

const frame = useCurrentFrame();
const { fps } = useVideoConfig();

// Spring que va de 0 a 1 al inicio de este scope temporal
const progress = spring({
  frame,
  fps,
  config: {
    damping: 18,       // cuánto amortigua (más alto = menos rebote)
    stiffness: 130,    // rigidez del resorte (más alto = más rápido)
    mass: 1,           // inercia
  },
});
```

Para animar a partir de un frame específico (no desde frame 0):

```tsx
const localFrame = Math.max(0, frame - startFrame);
const progress = spring({ frame: localFrame, fps, config: { damping: 18, stiffness: 130 } });
```

---

## 3. Secuenciación de assets: uno termina, empieza otro

### 3.1 `<Sequence>` (control manual)

Coloca cualquier contenido en una ventana de tiempo específica. Fuera de esa ventana,
el componente no existe.

```tsx
import { Sequence } from "remotion";

// Video A: frames 0–89 (3 segundos @ 30fps)
// Video B: frames 90–179 (3 segundos después)

<>
  <Sequence from={0} durationInFrames={90}>
    <VideoA />
  </Sequence>
  <Sequence from={90} durationInFrames={90}>
    <VideoB />
  </Sequence>
</>
```

**Ventaja**: control total sobre cuándo empieza y dura cada asset.  
**Cuándo usarlo**: cuando los timings son dinámicos (calculados desde datos del servidor).

### 3.2 `<Series>` + `<Series.Sequence>` (secuenciación automática)

Encola hijos uno después del otro. No necesitas calcular `from` manualmente.

```tsx
import { Series } from "remotion";

<Series>
  <Series.Sequence durationInFrames={90}>
    <VideoA />
  </Series.Sequence>
  <Series.Sequence durationInFrames={60}>
    <VideoB />
  </Series.Sequence>
  <Series.Sequence durationInFrames={120}>
    <VideoC />
  </Series.Sequence>
</Series>
```

> Ya usamos `Series` en [BrollLayer.tsx](../apps/web/src/remotion/components/BrollLayer.tsx)
> para secuenciar B-roll clips. Es el patrón correcto.

### 3.3 `<TransitionSeries>` (secuenciación con transiciones)

Del paquete `@remotion/transitions`. Permite insertar transiciones entre segmentos.

```tsx
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";

const TRANSITION_FRAMES = 15;

<TransitionSeries>
  <TransitionSeries.Sequence durationInFrames={90 + TRANSITION_FRAMES}>
    <VideoA />
  </TransitionSeries.Sequence>
  <TransitionSeries.Transition
    presentation={fade()}
    timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
  />
  <TransitionSeries.Sequence durationInFrames={60 + TRANSITION_FRAMES}>
    <VideoB />
  </TransitionSeries.Sequence>
  <TransitionSeries.Transition
    presentation={slide({ direction: "from-right" })}
    timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
  />
  <TransitionSeries.Sequence durationInFrames={120}>
    <VideoC />
  </TransitionSeries.Sequence>
</TransitionSeries>
```

**Transiciones disponibles en `@remotion/transitions`:**

| Nombre     | Descripción                          |
|------------|--------------------------------------|
| `fade`     | Fundido de opacidad                  |
| `slide`    | Deslizamiento (from-left/right/top)  |
| `wipe`     | Barrido tipo cortina                 |
| `flip`     | Volteo 3D                            |
| `clockWipe`| Barrido circular tipo reloj          |
| `none`     | Corte seco (sin transición)          |

> Ya implementado en [SlideShow.tsx](../apps/web/src/remotion/components/SlideShow.tsx).

---

## 4. Cambiar posición y tamaño de un asset mientras se reproduce

### 4.1 Patrón base: posición animada con `interpolate`

```tsx
export function VideoConMovimiento({ url }: { url: string }) {
  const frame = useCurrentFrame();

  // Empieza en bottom-right (right: 48, bottom: 48, width: 320)
  // En frame 60, se mueve a top-left (left: 48, top: 48, width: 480)
  const left = interpolate(frame, [60, 90], [undefined, 48], { extrapolateRight: "clamp" });
  const right = interpolate(frame, [60, 90], [48, undefined], { extrapolateLeft: "clamp" });
  const top = interpolate(frame, [60, 90], [undefined, 48], { extrapolateRight: "clamp" });
  const bottom = interpolate(frame, [60, 90], [48, undefined], { extrapolateLeft: "clamp" });
  const width = interpolate(frame, [60, 90], [320, 480], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <div
      style={{
        position: "absolute",
        left: frame < 75 ? "auto" : left,
        right: frame < 75 ? right : "auto",
        top: frame < 75 ? "auto" : top,
        bottom: frame < 75 ? bottom : "auto",
        width,
        aspectRatio: "16 / 9",
        overflow: "hidden",
        borderRadius: 12,
      }}
    >
      <OffthreadVideo src={url} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    </div>
  );
}
```

**Patrón más limpio: usar `transform` en lugar de cambiar `left/top`.**
`transform: translate()` no triggerea reflow y es más predecible:

```tsx
const translateX = interpolate(frame, [0, 30], [0, -800], {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
  easing: Easing.out(Easing.cubic),
});
const translateY = interpolate(frame, [0, 30], [0, -400], {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
});
const scale = interpolate(frame, [0, 30], [0.24, 0.36], {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
});

style={{ transform: `translate(${translateX}px, ${translateY}px) scale(${scale})` }}
```

### 4.2 Cambio de posición driven por escenas (patrón del template ZIP)

El template `advanced-avatar-subtitles` ya demuestra este patrón:

```tsx
// Escena activa → determina posición fija
const scene = getActiveScene(frame); // { avatarPosition, startFrame, ... }

// Spring local al inicio de cada escena
const localFrame = Math.max(0, frame - scene.startFrame);
const entrance = spring({ frame: localFrame, fps, config: { damping: 18, stiffness: 130 } });

// CSS cambia según la posición de la escena
const style = avatarPositionStyle(scene.avatarPosition, entrance);
```

Para integrar con el pipeline actual (donde `templateConfig.avatarPosition` es estático),
se puede evolucionar a un array de `AvatarKeyframe`:

```tsx
type AvatarKeyframe = {
  fromFrame: number;
  position: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  scale?: number; // proporción de pantalla (0.16–0.36)
};
```

### 4.3 Escala del avatar en tiempo de reproducción (PiP dinámico)

```tsx
// En FullSlides.tsx: el avatar empieza pequeño y crece cuando se activa un punto clave
const pipScale = interpolate(frame, [keyFrame, keyFrame + 20], [0.24, 0.32], {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
});

style={{
  width: `${pipScale * 100}%`,
  aspectRatio: "16 / 9",
  position: "absolute",
  ...getAvatarPositionStyle(templateConfig.avatarPosition),
}}
```

---

## 5. Video dentro de Sequence: lo que debe saberse

### 5.1 `<OffthreadVideo>` con `startFrom`

Cuando colocas un video dentro de una `<Sequence>`, el video **siempre empieza desde su
propio segundo 0** al inicio de la secuencia. Si quieres que empiece desde un punto específico
del video fuente, usa `startFrom`:

```tsx
<Sequence from={60} durationInFrames={90}>
  {/* El video fuente empieza a reproducirse desde su segundo 2 (60 frames @ 30fps) */}
  <OffthreadVideo src={url} startFrom={60} muted style={{ ... }} />
</Sequence>
```

### 5.2 `<OffthreadVideo>` vs `<Video>`

| Aspecto          | `<Video>`                          | `<OffthreadVideo>`                        |
|------------------|------------------------------------|-------------------------------------------|
| Thread           | Main thread                        | Off-thread (separado)                     |
| Performance      | Puede bloquear UI                  | Más fluido                                |
| Preview          | OK en navegador                    | OK en navegador                           |
| Render server    | No funciona bien en CLI            | Recomendado para CLI/render               |
| Errores          | Puede romper el frame              | `onError` para degradar con gracia        |

**Recomendación**: siempre usar `<OffthreadVideo>` en producción. Ya está correctamente
implementado en el proyecto.

---

## 6. Audio: secuenciación y control de volumen

### 6.1 Audio con timing controlado

```tsx
import { Audio, Sequence } from "remotion";

// Voz: comienza en frame 0, sin loop
<Audio src={voiceUrl} />

// Música de fondo: desde frame 0, en loop, volumen atenuado
<Audio src={musicUrl} volume={0.15} loop />

// Efecto de sonido solo en la escena 2 (frames 150-300)
<Sequence from={150} durationInFrames={150}>
  <Audio src={sfxUrl} volume={0.6} />
</Sequence>
```

### 6.2 Volumen dinámico (duck under)

Se puede hacer que la música baje cuando hay locución:

```tsx
const hasVoiceActive = frame >= 0 && voiceAudioUrl;
const musicVolume = hasVoiceActive
  ? interpolate(frame, [0, 10], [0.15, 0.05], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
  : 0.15;

<Audio src={bgMusicUrl} volume={musicVolume} loop />
```

---

## 7. Limitaciones reales a tener en cuenta

| Limitación                            | Impacto                                                        | Mitigación                                          |
|---------------------------------------|----------------------------------------------------------------|-----------------------------------------------------|
| No hay estado mutable en tiempo real  | No puedes pausar/reanudar mid-render                           | Todo debe expresarse como f(frame)                  |
| `<Video>` no funciona en CLI render   | El render server-side necesita `OffthreadVideo`                | Ya usamos `OffthreadVideo` en el proyecto            |
| URLs deben ser públicas en preview    | El Player en el browser no puede leer rutas locales del server | Ya resuelto: normalizer produce URLs públicas        |
| Transiciones con `TransitionSeries` requieren overlap de frames | La suma de duración de sequencias + transiciones debe ser correcta | Guard en `SlideShow.tsx` con `MAX_TRANSITION_FRAMES`|
| `durationInFrames` de Sequence no puede ser 0 | Remotion lanza error                                  | Usar `Math.max(1, ...)` siempre                     |
| Fonts: deben cargarse asincrónamente  | Si el font no carga, el frame renderiza con fallback           | Usar `delayRender`/`continueRender` para fonts      |
| Videos externos en CLI render         | El renderizador necesita acceso de red o cache local           | En producción Remotion Cloud resuelve esto          |

---

## 8. Patrones avanzados disponibles (para fases futuras)

### 8.1 `delayRender` / `continueRender` — esperar assets asíncronos

```tsx
import { delayRender, continueRender, useEffect, useState } from "remotion";

export function ComponenteConAsyncData({ url }: { url: string }) {
  const [handle] = useState(() => delayRender("cargando datos"));
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch(url)
      .then((r) => r.json())
      .then((d) => { setData(d); continueRender(handle); });
  }, [url, handle]);

  if (!data) return null;
  return <div>{/* render con data */}</div>;
}
```

### 8.2 `Freeze` — congelar un componente en un frame específico

```tsx
import { Freeze } from "remotion";

// Congela el video en el frame 30 (útil para pausa dramática)
<Sequence from={30} durationInFrames={60}>
  <Freeze frame={30}>
    <OffthreadVideo src={url} />
  </Freeze>
</Sequence>
```

### 8.3 `Loop` — repetir contenido

```tsx
import { Loop } from "remotion";

// El contenido se repite cada 30 frames
<Loop durationInFrames={30} times={5}>
  <AnimacionCiclica />
</Loop>
```

### 8.4 `@remotion/noise` — movimiento orgánico

```tsx
import { noise2D } from "@remotion/noise";

const frame = useCurrentFrame();

// x oscila de forma orgánica (no lineal) basado en Perlin noise
const x = noise2D("seed-x", frame / 50, 0) * 20; // ±20px
```

### 8.5 `measureSpring` — saber cuándo termina un spring

```tsx
import { measureSpring, spring } from "remotion";

const config = { damping: 18, stiffness: 130 };
const springDuration = measureSpring({ fps: 30, config }); // frames que dura
```

---

## 9. Arquitectura recomendada para assets con posición y tamaño dinámicos

Para evolucionar el sistema actual hacia soporte de cambios de posición/tamaño por segmento,
la forma más mantenible es:

```tsx
// En types.ts — extender AssemblyInputProps
type AvatarKeyframe = {
  fromFrame: number;    // frame absoluto en que aplica este estado
  position: AvatarPosition;
  scale: number;        // 0.16–0.36 (proporción de pantalla)
};

// En AssemblyInputProps
avatarKeyframes?: AvatarKeyframe[];  // opcional; fallback a templateConfig.avatarPosition
```

```tsx
// Lógica de resolución (en el componente)
function resolveAvatarState(
  frame: number,
  keyframes: AvatarKeyframe[],
  fallback: { position: AvatarPosition; scale: number },
) {
  if (!keyframes || keyframes.length === 0) return fallback;

  const sorted = [...keyframes].sort((a, b) => a.fromFrame - b.fromFrame);
  const active = sorted.filter((kf) => kf.fromFrame <= frame).at(-1);
  return active ?? fallback;
}
```

Esto permite:
- Posición/tamaño estáticos: no pasar `avatarKeyframes` → usa `templateConfig`
- Posición/tamaño dinámicos: pasar `avatarKeyframes` con los cambios deseados
- Spring de entrada en cada keyframe: `localFrame = Math.max(0, frame - keyframe.fromFrame)`

---

## 10. Referencias rápidas

| Necesidad                                 | Solución Remotion                              |
|-------------------------------------------|------------------------------------------------|
| Un asset termina → empieza otro           | `<Series>` o `<Sequence from={X}>`             |
| Transición visual entre assets             | `<TransitionSeries>` + `fade/slide/wipe`       |
| Mover avatar en el tiempo                 | `interpolate(frame, [...], [...])` sobre CSS   |
| Mover avatar con física                   | `spring({ frame: localFrame, fps, config })`   |
| Cambiar tamaño de un video en ejecución   | `interpolate` → `width/height` o `transform: scale()` |
| Video desde segundo específico             | `<OffthreadVideo startFrom={frames}>`          |
| Audio en loop con volumen                 | `<Audio loop volume={0.15}>`                   |
| Audio solo en cierto rango                | `<Sequence from={X} durationInFrames={Y}><Audio /></Sequence>` |
| Congelar frame                            | `<Freeze frame={N}>`                           |
| Repetición cíclica                        | `<Loop durationInFrames={N}>`                  |
| Esperar datos asíncronos                  | `delayRender` / `continueRender`               |
| Movimiento orgánico                       | `@remotion/noise` → `noise2D`                  |
