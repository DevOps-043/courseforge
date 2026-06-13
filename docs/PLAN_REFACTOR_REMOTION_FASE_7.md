# Plan de Refactor: Remotion Fase 7

> Objetivo: estabilizar la Fase 7 de postproduccion para que la preview y el render final de Remotion usen el mismo contrato, muestren correctamente slides, soporten multiples B-roll con orden definido y ensamblen uno o varios videos pendientes de forma predecible.

---

## 1. Entendimiento del objetivo

La implementacion actual de Remotion ya no esta en el estado descrito por los planes iniciales: existen dependencies de Remotion, compositions, preview con `@remotion/player`, worker server-side con `@remotion/renderer`, cola de jobs y `composition_id` en plantillas.

El problema real es que la integracion quedo a medio camino entre tres modelos:

- Assets legacy: `slides_url`, `video_url`, `screencast_url`.
- Assets estructurados: `slides.images`, `b_roll_clips`, `voice_audio`, `avatar_video`, `background_music`.
- Plantillas dinamicas: `remotion_templates`, `composition_id`, `storage_path`.

La Fase 7 debe quedar como un flujo consistente:

1. El usuario sube o genera assets en Fase 6.
2. El sistema normaliza esos assets a un contrato unico.
3. La preview usa ese contrato.
4. El render final usa el mismo contrato.
5. El resultado se guarda y sincroniza con publicacion.

---

## 2. Diagnostico tecnico actualizado

### 2.1. Slides subidas no siempre se renderizan

Remotion consume `assets.slides.images`, pero algunos flujos solo guardan `slides_url` o `slides.html_public_url`.

Impacto:

- El usuario puede haber subido slides y aun asi no verlas en preview/render.
- `hasPreviewableAssets` puede considerar el componente previsualizable aunque no haya slides renderizables para Remotion.

Archivos relacionados:

- `apps/web/src/remotion/buildAssemblyProps.ts`
- `apps/web/src/domains/materials/hooks/useProductionAssetState.ts`
- `apps/web/src/app/api/production/google-drive/import/route.ts`
- `apps/web/src/app/api/production/open-design/export/route.ts`

### 2.2. Multiples B-roll existen, pero no se integran correctamente con slides

El modelo soporta `b_roll_clips[]` con `order`, pero `PrimaryVisual` decide mostrar:

1. slides si existen;
2. B-roll solo si no hay slides;
3. fondo neutro.

Impacto:

- Si hay slides y B-roll, el B-roll queda ignorado visualmente.
- La promesa de "slides + B-roll" no se cumple.
- El orden de B-roll existe en datos, pero no tiene efecto cuando tambien hay slides.

Archivos relacionados:

- `apps/web/src/remotion/components/PrimaryVisual.tsx`
- `apps/web/src/remotion/components/BrollLayer.tsx`
- `apps/web/src/remotion/components/SlideShow.tsx`

### 2.3. El ensamblado dice procesar varios videos, pero solo procesa uno

La UI calcula `componentsToAssemble`, pero `handleAssemble` solo toma `componentsToAssemble[0]`.

Impacto:

- La interfaz comunica una operacion batch que no ocurre.
- El usuario puede creer que se ensamblaron todos los videos pendientes.
- La completitud de produccion puede quedar inconsistente.

Archivo relacionado:

- `apps/web/src/domains/materials/components/PostproductionAssemblyContainer.tsx`

### 2.4. Contrato duplicado entre web y API

El front usa `buildAssemblyProps`; el worker de API tiene una version propia de la misma traduccion.

Impacto:

- Preview y render final pueden divergir.
- Cambios en assets requieren actualizar dos lugares.
- Riesgo alto de regresiones silenciosas.

Archivos relacionados:

- `apps/web/src/remotion/buildAssemblyProps.ts`
- `apps/api/src/features/production/remotion-worker.service.ts`

### 2.5. Plantillas dinamicas no usan bundles externos

`remotion_templates.storage_path` existe, pero el worker siempre resuelve `apps/web/src/remotion/index.ts`.

Impacto:

- Las plantillas actuales funcionan como selector de `composition_id`, no como plantillas subidas reales.
- El campo `storage_path` puede generar expectativas falsas.
- Si se sube una plantilla externa, no queda claro que se vaya a renderizar.

Archivo relacionado:

- `apps/api/src/features/production/remotion-worker.service.ts`

---

## 3. Principios de refactor

1. Preview y render final deben usar el mismo contrato de props.
2. La Fase 7 no debe inferir assets desde campos legacy si no puede renderizarlos.
3. Slides deben existir en un formato renderizable por Remotion.
4. B-roll debe ser una timeline ordenada, no un fallback que desaparece ante slides.
5. Las operaciones batch deben ser explicitas y observables por job.
6. El alcance debe avanzar por entregas pequenas, verificables y reversibles.

---

## 4. Plan de implementacion por fases

### Fase 0 - Baseline y pruebas de contrato

Objetivo: congelar el comportamiento actual con tests antes de modificar la arquitectura.

Cambios:

- Agregar tests unitarios para `buildAssemblyProps`.
- Agregar fixtures de assets:
  - solo slides con `images`;
  - solo `slides_url`/`html_public_url`;
  - slides + multiples B-roll;
  - solo B-roll;
  - voz + avatar + musica.
- Documentar casos donde el sistema actualmente no puede renderizar.

DoD:

- Hay tests que describen el comportamiento actual.
- Los casos rotos quedan explicitados como expected failures o assertions de limitacion.
- No cambia comportamiento productivo.

Validaciones:

- `npm run test --workspace=apps/web -- <tests de remotion>`

Riesgo:

- Bajo. Solo tests y documentacion tecnica.

---

### Fase 1 - Normalizador unico de assets de ensamblado

Objetivo: crear una capa clara entre `material_components.assets` y `AssemblyInputProps`.

Cambios:

- Crear un modulo de normalizacion en web:
  - `apps/web/src/remotion/assembly-assets.normalizer.ts`
- Responsabilidades:
  - ordenar slides por `slide_index`;
  - ordenar B-roll por `order` y fallback a orden de subida;
  - distinguir slides renderizables (`slides.images`) de referencias no renderizables (`slides_url`, `html_public_url`);
  - calcular duracion total;
  - producir warnings estructurados cuando falten assets renderizables.
- `buildAssemblyProps` debe consumir el normalizador.

DoD:

- `buildAssemblyProps` no contiene logica dispersa de seleccion/orden/duracion.
- Si solo hay HTML/URL de slides, el sistema reporta "slides no rasterizadas" en vez de fallar silenciosamente.
- B-roll multiple queda ordenado deterministicamente.

Validaciones:

- Tests unitarios del normalizador.
- Preview con varios clips mantiene el orden correcto.

Riesgo:

- Medio. Cambia la forma de interpretar assets, pero el impacto se limita a preview/render.

---

### Fase 2 - Slides renderizables

Objetivo: garantizar que toda fuente de slides produzca `slides.images[]` antes de llegar a Remotion.

Cambios:

- Definir el formato canonico:
  - `assets.slides.images[]` es la unica fuente renderizable para Remotion.
  - `slides_url` y `html_public_url` son referencias/editables, no suficientes para render.
- Agregar una accion/endpoint de rasterizacion cuando aplique:
  - HTML/Open Design/Gamma/ZIP -> PNG por slide -> Supabase Storage -> `slides.images`.
- En la UI de Fase 6, mostrar estado claro:
  - "Slides cargadas pero no listas para Remotion"
  - "Slides renderizables listas"

DoD:

- Una slide subida o generada termina con al menos una entrada en `slides.images`.
- Preview de Remotion muestra slides despues de la rasterizacion.
- Si no se puede rasterizar, el error es visible y accionable.

Validaciones:

- Subir HTML/ZIP de slides y confirmar `slides.images`.
- Exportar Open Design y confirmar imagenes resultantes.
- Render final con slides reales.

Riesgo:

- Alto. Requiere decidir o implementar estrategia de rasterizacion. Puede necesitar Playwright/Chromium server-side.

---

### Fase 3 - Timeline visual slides + B-roll

Objetivo: que B-roll no sea fallback, sino parte real de la composicion.

Cambios:

- Reemplazar la logica de `PrimaryVisual` por una timeline visual.
- Soportar al menos dos modos:
  - `overlay`: slides como base y B-roll como segmentos superpuestos o picture-in-picture.
  - `sequence`: slides y B-roll intercalados por orden.
- Mantener fallback si solo hay slides o solo hay B-roll.
- Agregar tipos al contrato:
  - `visualMode?: "slides-first" | "broll-sequence" | "overlay"`
  - o una estructura futura `timelineItems[]`.

DoD:

- Si hay slides y B-roll, ambos aparecen.
- Multiples B-roll se reproducen en orden estable.
- Las tres plantillas siguen renderizando sin crashear.

Validaciones:

- Preview: slides + 3 B-roll + voz.
- Render server-side: mismo resultado observable.
- Caso solo slides.
- Caso solo B-roll.

Riesgo:

- Medio-alto. Cambia comportamiento visual principal.

---

### Fase 4 - Ensamblado por componente y batch real

Objetivo: corregir la diferencia entre lo que la UI promete y lo que hace.

Cambios:

- Separar acciones:
  - "Ensamblar video seleccionado"
  - "Ensamblar todos los pendientes"
- Para batch:
  - crear un job por componente;
  - mostrar progreso por componente;
  - mantener cola secuencial en API.
- Ajustar textos de UI para no prometer procesamiento multiple cuando solo se procesa uno.

DoD:

- El usuario puede ensamblar un video especifico.
- El usuario puede ensamblar todos los pendientes.
- La UI muestra el estado de cada job.
- No queda polling infinito ante fallos.

Validaciones:

- 1 componente pendiente.
- 3 componentes pendientes.
- 1 job falla y los demas siguen o quedan claramente reportados segun politica definida.

Riesgo:

- Medio. Toca UI, server actions, polling y estado de jobs.

---

### Fase 5 - Unificacion web/API del contrato

Objetivo: evitar divergencia entre preview y render final.

Opciones:

1. Corto plazo: crear tests contractuales duplicados en web y API con los mismos fixtures.
2. Mediano plazo: mover contrato y normalizador a un paquete compartido.

Decision recomendada:

- Corto plazo: tests contractuales para reducir riesgo inmediato.
- Mediano plazo: agregar `packages/remotion-contract` y ampliar workspaces a `apps/*` + `packages/*`.

DoD:

- Web y API producen `AssemblyInputProps` equivalentes para los mismos fixtures.
- Cualquier cambio en el contrato falla en tests si no se actualizan ambas capas.

Validaciones:

- Tests en `apps/web`.
- Tests en `apps/api` si existe runner configurado.

Riesgo:

- Medio. La opcion de paquete compartido toca config de monorepo.

---

### Fase 6 - Clarificar plantillas dinamicas

Objetivo: hacer explicito que las plantillas actuales son compositions internas y definir el futuro de bundles externos.

Cambios:

- Renombrar/documentar semanticamente:
  - `composition_id`: selector real usado por Remotion.
  - `storage_path`: reservado para plantillas externas, no activo aun.
- En admin/templates, indicar si la plantilla es:
  - `internal_composition`;
  - `external_bundle` pendiente/no soportado.
- Evitar que el usuario suba una plantilla esperando que se renderice si el worker no la usa.

DoD:

- No hay ambiguedad funcional para usuarios/admins.
- Las plantillas internas siguen funcionando.
- Las externas quedan bloqueadas o marcadas como no soportadas hasta implementar bundle loading.

Validaciones:

- Crear/editar template.
- Seleccionar template en Fase 7.
- Confirmar que `composition_id` valido renderiza.

Riesgo:

- Bajo-medio. Mas de producto/UX que de render.

---

## 5. Orden recomendado de ejecucion

1. Fase 0: tests baseline.
2. Fase 1: normalizador.
3. Fase 2: slides renderizables.
4. Fase 3: timeline slides + B-roll.
5. Fase 4: batch real.
6. Fase 5: contrato compartido.
7. Fase 6: plantillas dinamicas externas.

Razon:

- Primero se asegura el contrato.
- Despues se corrige la causa de "slides no aparecen".
- Luego se corrige la causa de "B-roll multiple no se acopla".
- Despues se arregla el flujo operativo de multiples videos.
- Al final se reduce deuda estructural y se aclara el modelo de plantillas.

---

## 6. Criterios de aceptacion globales

La refactorizacion se considera exitosa cuando:

- Un componente con voz, slides, avatar, musica y multiples B-roll se previsualiza correctamente.
- El render final coincide funcionalmente con la preview.
- Las slides subidas o generadas aparecen en Remotion.
- Los B-roll se reproducen en orden deterministico.
- La UI no promete ensamblar multiples videos si solo lanza uno.
- El sistema reporta claramente assets faltantes o no renderizables.
- Hay pruebas unitarias para normalizacion y contrato.
- Hay al menos una validacion manual end-to-end documentada.

---

## 7. Riesgos residuales

- Rasterizar slides HTML/ZIP puede requerir Chromium/Playwright server-side y manejo cuidadoso de seguridad.
- URLs publicas de Supabase pueden fallar por CORS o permisos.
- Remotion server-side puede consumir CPU/memoria de forma significativa; la cola secuencial debe mantenerse.
- El paquete compartido puede requerir ajustes en workspaces y build.
- Plantillas externas reales son un proyecto aparte si se quiere cargar bundles desde Storage.

---

## 8. Proxima accion sugerida

Empezar por Fase 0 y Fase 1:

1. Crear fixtures de assets de ensamblado.
2. Agregar tests para `buildAssemblyProps`.
3. Extraer `assembly-assets.normalizer.ts`.
4. Ajustar preview para mostrar warnings claros cuando haya slides no rasterizadas.

Esto mejora eficiencia porque ataca el punto de mayor incertidumbre sin tocar aun render server-side, batch jobs ni plantillas externas.
