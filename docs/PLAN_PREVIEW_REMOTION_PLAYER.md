# Plan de Implementación: Preview en Vivo del Ensamblado con `@remotion/player`

> **Objetivo:** Lograr que la Fase 7 (Postproducción / Ensamblado Remotion) muestre en el panel de
> **"Previsualización"** el *posible ensamblado* en vivo (slides + voz + avatar + B-roll + música)
> **antes** de renderizar, usando `@remotion/player` en el navegador.
>
> **Estado actual diagnosticado:** la preview no se ve porque esa pieza **nunca se implementó**.
> Este documento es el plan acordado para construirla.

---

## 0. Contexto y hallazgos del diagnóstico

Revisión del código real contra los planes previos
([`PLAN_DETALLADO_ENSAMBLADO_REMOTION.md`](./PLAN_DETALLADO_ENSAMBLADO_REMOTION.md) y
[`PLAN_IMPLEMENTACION_REMOTION_PRODUCTION.md`](./PLAN_IMPLEMENTACION_REMOTION_PRODUCTION.md)):

- **No existe Remotion en el proyecto.** No hay dependencias `remotion`, `@remotion/player`,
  `@remotion/cli`, `@remotion/bundler` ni `@remotion/renderer` en ningún `package.json`
  (`apps/web`, `apps/api`, raíz).
- **No existe ninguna composition.** No hay `registerRoot`, `<Composition>`, `Root.tsx` ni
  `MainComposition`. La única mención de `MainComposition` es un string hardcodeado en
  `apps/api/src/features/production/remotion-worker.service.ts:350`.
- **El panel "Previsualización" solo renderiza un `<video src={final_video_url}>` HTML5**
  (`apps/web/src/domains/materials/components/PostproductionAssemblyContainer.tsx:332-362`).
  Sin `final_video_url` muestra un placeholder. **No hay `<Player>` que componga en vivo.**
- **El render server-side es 100% simulado:** si `template.storage_path` es nulo, el worker
  descarga Big Buck Bunny como `output.mp4`
  (`remotion-worker.service.ts:325-345`). Las 3 plantillas globales sembradas tienen
  `storage_path = NULL` (`supabase/migrations/20260606090600_create_remotion_templates.sql:97-101`),
  por lo que **todo ensamblado actual cae al mock**.
- **Contradicción entre planes:** uno describe render real con `npx remotion render`; el otro
  describe explícitamente una "Mocked Remotion Integration". El código implementa el mock.

### Restricciones del entorno (verificadas)

| Aspecto | Valor |
|---|---|
| Monorepo `workspaces` | **solo `apps/*`** (no existe `packages/` en disco) |
| Next.js | `^16.1.3` |
| React / React-DOM | `^19.2.3` |
| TypeScript | `^5.9.3` |

### Decisiones tomadas

- **Tipo de preview:** Preview en vivo con `@remotion/player`.
- **Modo de trabajo:** Plan detallado primero (este documento). El render server-side real queda
  como fase posterior.

---

## 1. Principio rector de arquitectura

El error conceptual de los planes previos es tratar **preview** y **render final** como sistemas
separados (uno mock en el front, otro CLI en el back). Eso garantiza divergencia visual: lo que se
ve nunca es lo que se renderiza.

> **Single Source of Truth (DRY):** habrá **una sola definición visual** — las compositions React de
> Remotion. El `<Player>` del navegador y el renderer server-side (futuro) consumen **la misma
> composition y el mismo contrato de props**. Solo cambia el "host": Player en el browser vs. CLI en
> el servidor.

**Ubicación de las compositions:** `apps/web/src/remotion/`.
Razón: el `<Player>` corre en el browser (web) y los `workspaces` no incluyen `packages/*`, así que
un paquete compartido nuevo obligaría a tocar la config del monorepo sin beneficio inmediato. Cuando
se aborde el render real, `apps/api` importará estas compositions vía path relativo o un bundle; no
se duplica la lógica visual.

---

## 2. Fases de implementación

### Fase 0 — Verificación de compatibilidad (BLOQUEANTE, antes de instalar)

1. **Remotion ↔ React 19 ↔ Next 16.** Validar `remotion` y `@remotion/player` (última `4.x`)
   contra React 19.2 y el bundler de Next 16. Acción: instalar, montar un `<Player>` de prueba en una
   página aislada y confirmar que renderiza sin errores de runtime/SSR/hidratación.
2. **SSR.** `@remotion/player` es client-only. Todo componente que lo use lleva `"use client"` y, si
   hace falta, se importa con `next/dynamic` + `{ ssr: false }`.

> **Fallback si la 4.x estable no soporta React 19 en esta combinación:** aislar el Player en un punto
> de entrada cliente con `dynamic(..., { ssr:false })`, o en una ruta dedicada. Se confirma en esta
> fase, no después.

---

### Fase 1 — Contrato de props compartido (pieza más importante)

Un **único schema Zod** que describe todo lo que una composition necesita. Es el contrato que
desacopla front, compositions y futuro render.

**Archivo nuevo:** `apps/web/src/remotion/types.ts`

```ts
AssemblyInputProps = {
  template: 'split-avatar' | 'full-slides' | 'avatar-focus'
  fps: number                       // p.ej. 30
  voiceAudioUrl?: string            // public_url (NO ruta local)
  bgMusicUrl?: string
  bgMusicVolume: number             // default 0.15
  avatarVideoUrl?: string
  slides: { index: number; url: string }[]
  brollClips: { url: string; durationInFrames: number; order: number }[]
  transitionType: 'fade' | 'slide' | 'none'
  totalDurationInFrames: number     // derivado de voice/avatar duration * fps
}
```

Puntos críticos de diseño:

- **URLs públicas, no rutas locales.** El worker actual inyecta rutas tipo `./assets/voice.mp3`
  (`remotion-worker.service.ts:100`). El Player no puede leer rutas locales del servidor, por lo que
  **el contrato usa URLs públicas**; el día del render real, el worker mapeará URL→local solo para el
  CLI. Hoy el Player funciona directo con las `public_url` de Supabase.
- **Todo opcional excepto la duración.** La preview debe dibujar aunque falten assets (regla 1.3 del
  plan: voz opcional si hay avatar). Las compositions degradan con gracia.
- **Duración explícita en frames.** El Player exige `durationInFrames` + `fps`. Se deriva de
  `voice_audio.duration` o `avatar_video.duration` (segundos) × `fps`, con fallback (p.ej. 10s) si no
  hay audio.

---

### Fase 2 — Compositions Remotion (definición visual)

**Archivos nuevos en `apps/web/src/remotion/`:**

| Archivo | Responsabilidad |
|---|---|
| `Root.tsx` | `registerRoot` + 3 `<Composition>` (una por plantilla), cada una con `calculateMetadata` para resolver duración desde props |
| `compositions/SplitAvatar.tsx` | "Presentación + Avatar (Dividida)" — slides izq., avatar der. |
| `compositions/FullSlides.tsx` | "Presentación Completa" — slides a pantalla completa |
| `compositions/AvatarFocus.tsx` | "Avatar Enfocado" — avatar central, slides inferiores |
| `components/SlideShow.tsx` | secuencia de slides con transición (`@remotion/transitions`) sincronizada a la duración |
| `components/AudioTracks.tsx` | `<Audio>` de voz + `<Audio volume>` de música |
| `components/BrollLayer.tsx` | secuencia de `<OffthreadVideo>` para B-roll por orden |
| `components/AvatarLayer.tsx` | `<OffthreadVideo>` del avatar |

Cada composition lee `AssemblyInputProps` y nada más → testeable y reutilizable por el render
server-side sin cambios.

**Mapeo plantilla → composition.** Hoy las 3 plantillas sembradas no tienen un `composition_id`
estable (el worker hardcodea `'MainComposition'`, `remotion-worker.service.ts:350`). Acción: migración
que asigne un `composition_id` determinista por plantilla (`split-avatar`, `full-slides`,
`avatar-focus`) reutilizando los IDs ya sembrados en
`20260606090600_create_remotion_templates.sql:99-101`. Así el front sabe qué composition montar según
`selectedTemplate`.

---

### Fase 3 — Builder de props (mapea DB → contrato)

**Archivo nuevo:** `apps/web/src/remotion/buildAssemblyProps.ts`

Función pura `buildAssemblyProps(component.assets, templateId, fps) → AssemblyInputProps`:

- Lee `material_components.assets` (`voice_audio`, `background_music`, `avatar_video`,
  `slides.images`, `b_roll_clips`).
- Convierte segundos→frames, resuelve `template` desde el `composition_id` de la plantilla, calcula
  `totalDurationInFrames`.
- Valida con Zod y devuelve un objeto seguro (fail-fast con mensaje claro si algo es inconsistente).

Es el **único punto** donde el shape de `assets` se traduce al contrato visual → un solo lugar que
mantener cuando cambie el esquema de assets.

---

### Fase 4 — Integración del `<Player>` en la UI

**Modificar:** `apps/web/src/domains/materials/components/PostproductionAssemblyContainer.tsx:332-362`
(panel "Previsualización").

Lógica nueva del panel (en orden de prioridad):

1. Si el componente activo **ya tiene `final_video_url`** → mostrar el `<video>` actual (resultado
   final real).
2. Si **no** tiene final pero tiene assets suficientes → montar `<Player>` con la composition
   seleccionada y `buildAssemblyProps(...)`. **Esto es "ver el posible ensamblado":** reproduce en
   vivo slides + voz + avatar + B-roll sin renderizar nada.
3. Si no hay assets mínimos → placeholder explicando qué falta (mejor que el genérico actual).

Detalles:

- Componente nuevo `RemotionPreviewPlayer.tsx`, `"use client"`, envuelto en
  `dynamic(..., { ssr:false })`.
- El `<Player>` se re-monta al cambiar `selectedTemplate` o `activePreviewId` (key compuesta) → al
  elegir otra plantilla, la preview cambia al instante.
- Corregir `object-cover` → `object-contain` y dimensionar por `compositionWidth/Height`
  (16:9, 1920×1080).

**Modificar también:** el cleanup del `setInterval` de polling
(`PostproductionAssemblyContainer.tsx:112-154`) para limpiarse en unmount (fuga actual). Va incluido
porque se toca el mismo componente.

---

### Fase 5 — Coherencia del flujo de ensamblado (no romper lo existente)

- **No se toca el worker server-side en esta entrega** (sigue mock). Pero el contrato de la Fase 1
  queda listo para que, cuando se aborde el render real, el worker construya `input-props.json` desde
  el **mismo** `buildAssemblyProps` (mapeando URLs→locales) y ejecute
  `npx remotion render Root.tsx <composition_id>` contra un proyecto Remotion real instalado.
- Documentar que las 3 plantillas con `storage_path = NULL` hoy caen al mock
  (`remotion-worker.service.ts:325`), para que nadie crea que el MP4 del conejo es el ensamblado real.

---

## 3. Riesgos y validaciones

### Riesgos

1. **Remotion / React 19 / Next 16:** el mayor riesgo. Mitigado por la Fase 0 bloqueante. Si falla,
   el Player se aísla con `dynamic ssr:false` o en una ruta dedicada.
2. **CORS / URLs de Supabase:** el `<Player>` carga audio/video desde `public_url`. Si el bucket
   `production-assets` no es público o le falta CORS, los `<OffthreadVideo>` / `<Audio>` no cargan.
   Validar políticas del bucket.
3. **Peso del bundle web:** Remotion añade peso al cliente. Mitigar con `dynamic` import (solo carga
   en la Fase 7, no en toda la app).
4. **Duración mal derivada:** sin `voice_audio.duration`, la preview puede durar el fallback y
   desincronizar slides. Documentar el fallback y mostrarlo en UI.

### Validaciones (QA)

- **Caso feliz:** componente con voz + slides + avatar + música → Player reproduce sincronizado;
  cambiar plantilla cambia el layout en vivo.
- **Casos límite:** solo avatar (sin voz); solo slides (sin avatar); 0 B-roll; 1 sola slide; sin
  música.
- **Caso error:** URL de asset rota → la capa degrada sin tumbar el Player.
- **Regresión:** componente que ya tenía `final_video_url` (mock previo) → sigue mostrando el
  `<video>` final, no el Player.
- **Fuga:** navegar fuera durante polling → el intervalo se limpia (verificar en devtools).

---

## 4. Mejoras recomendadas (fuera del objetivo inmediato)

- **Obligatorio para el render real posterior:** convertir el worker de mock a Remotion real
  (instalar `remotion` + `@remotion/renderer`, proyecto compilable en el workspace temporal, subir
  bundles `storage_path` para plantillas). Hoy es imposible que el ensamblado produzca algo distinto
  al video de muestra.
- **Deseable:** mover compositions a un `packages/remotion` real (requiere añadir `packages/*` a
  `workspaces`) para que web y api compartan sin path relativo frágil.
- **Deseable:** columnas `composition_id`, `fps` y `resolution` configurables por plantilla en
  `remotion_templates`.

---

## 5. Resumen de archivos afectados

**Nuevos:**

- `apps/web/src/remotion/types.ts` — contrato Zod `AssemblyInputProps`
- `apps/web/src/remotion/Root.tsx` — registro de compositions
- `apps/web/src/remotion/compositions/{SplitAvatar,FullSlides,AvatarFocus}.tsx`
- `apps/web/src/remotion/components/{SlideShow,AudioTracks,BrollLayer,AvatarLayer}.tsx`
- `apps/web/src/remotion/buildAssemblyProps.ts` — DB `assets` → contrato
- `apps/web/src/domains/materials/components/RemotionPreviewPlayer.tsx` — wrapper del `<Player>`
- Migración SQL — `composition_id` por plantilla

**Modificados:**

- `apps/web/src/domains/materials/components/PostproductionAssemblyContainer.tsx` — panel de
  previsualización + cleanup de polling
- `apps/web/package.json` — dependencias `remotion`, `@remotion/player`, `@remotion/transitions`

---

## 6. Punto de arranque sugerido

Comenzar por la **Fase 0** (verificar Remotion + React 19 + Next 16 con un `<Player>` de prueba), por
ser bloqueante. Alternativa de menor alcance para validar el flujo end-to-end: implementar **una sola
composition (`FullSlides`)** completa antes de construir las tres.