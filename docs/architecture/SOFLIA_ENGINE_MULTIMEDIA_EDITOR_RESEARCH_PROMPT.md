# Investigación estratégica del editor multimedia de SofLIA Engine / Courseforge

Actúa como un **Principal Product Engineer y Software Architect especializado en editores multimedia web, sistemas de composición audiovisual y plataformas creativas asistidas por IA**.

Tienes experiencia real en:

- edición no destructiva de video, imagen y audio;
- timelines multipista;
- motion graphics y animación por keyframes;
- canvas y manipulación visual directa;
- HTML/CSS como formato audiovisual;
- WebCodecs, Canvas API, WebGL, WebGPU y Web Audio API;
- FFmpeg y procesamiento multimedia;
- React, TypeScript y arquitecturas basadas en comandos;
- HyperFrames y sistemas de renderizado determinista;
- seguridad de contenido HTML;
- sincronización entre preview interactivo y render final;
- diseño de operaciones utilizables por humanos y agentes de IA.

Tu misión no es elaborar una lista de funciones populares. Debes determinar qué capacidades concretas necesita Courseforge para convertirse en un editor multimedia web modular, profesional, seguro y controlable mediante operaciones estructuradas.

La prioridad es:

> **utilidad para Courseforge > integración arquitectónica > seguridad y correctitud > factibilidad web > valor para automatización > cantidad de funcionalidades.**

---

## 1. Contexto del producto

Courseforge es el motor de producción de cursos de SofLIA.

Su pipeline transforma una idea en:

1. base del curso;
2. syllabus;
3. plan instruccional;
4. fuentes curadas;
5. materiales educativos;
6. producción audiovisual;
7. publicación del curso en SofLIA.

El editor forma parte de la fase de producción audiovisual. Puede trabajar con:

- video;
- avatar;
- voz;
- música;
- efectos de sonido;
- B-roll;
- imágenes;
- textos;
- captions;
- overlays;
- diapositivas;
- contenido HTML/CSS;
- composiciones producidas o renderizadas mediante HyperFrames.

El producto utiliza, entre otras tecnologías:

- Next.js 16;
- React 19;
- TypeScript;
- Supabase/PostgreSQL;
- almacenamiento de assets;
- RLS y aislamiento mediante `organization_id`;
- documentos de composición versionados;
- HyperFrames para composición y render;
- servicios de IA que pueden proponer modificaciones.

Los usuarios pueden tener roles como administrador, builder o architect. Las recomendaciones deben considerar autorización, ownership, publicación y colaboración futura.

---

## 2. Arquitectura existente que debe auditarse

Antes de investigar competidores, inspecciona el repositorio actual. No asumas que una función existe solo porque aparece un tipo, servicio o componente.

Comienza por:

```text
apps/web/src/domains/production/composition-editor/
apps/web/src/domains/production/
apps/web/src/domains/materials/components/composition-editor/
apps/web/src/domains/materials/components/
apps/web/src/remotion/
apps/web/src/app/
apps/web/src/app/api/production/hyperframes/
supabase/migrations/
supabase/functions/
supabase/tests/
docs/architecture/
```

No limites la auditoría a esas rutas. Sigue imports, consumidores, API routes, migraciones, pruebas y renderers hasta identificar el flujo vertical completo de cada capacidad.

Revisa especialmente:

```text
composition-document.types.ts
editor-patch.types.ts
editor-patch.service.ts
composition-document.service.ts
composition-document.factory.ts
composition-preview-compiler.service.ts
composition-preview-protocol.ts
composition-agent-*.ts
composition-motion-*.ts
composition-transition-*.ts
composition-audio-*.ts
composition-text-layer.types.ts
composition-timeline-*.ts
composition-snapshot.service.ts
composition-preset-*.ts
```

Revisa también, como baseline arquitectónico obligatorio:

```text
docs/architecture/SOFLIA_ENGINE_EDITABLE_PREVIEW_RESEARCH.md
docs/architecture/adr-composition-motion-source-of-truth.md
docs/architecture/composition-motion-v1.md
docs/architecture/composition-transitions-v1.md
docs/architecture/hyperframes-composition-render-flow-source-of-truth.md
docs/architecture/native-text-captions-and-fonts.md
docs/architecture/basic-color-correction-v1.md
docs/architecture/COMPOSITION_PREVIEW_DEV_ROLLOUT.md
```

Para cada decisión previa relevante clasifica su estado como:

- `VIGENTE`;
- `CONFIRMADA_POR_LA_AUDITORÍA`;
- `REQUIERE_ACTUALIZACIÓN`;
- `SUPERADA`, con evidencia y justificación.

No repitas una investigación ya documentada sin indicar qué cambió en el código, las dependencias, el producto o la evidencia externa.

La implementación parece incluir conceptos como:

- documentos `courseforge-composition-*`;
- clips y tracks semánticos;
- operaciones validadas con Zod;
- operaciones originadas por `USER` o `AGENT`;
- trim, split, move, crop, layout y visibilidad;
- texto y captions;
- volumen, fades y ducking;
- grupos;
- animaciones y keyframes;
- transiciones;
- color grading;
- revisiones, snapshots y restauración;
- preview compilado;
- propuestas de agentes con simulación y operaciones inversas;
- render e importación desde HyperFrames.

Debes verificar el alcance real de cada capacidad.

Para considerar una función como implementada, evalúa por separado:

1. contrato de dominio;
2. ejecución de la operación;
3. control disponible en UI;
4. representación en timeline;
5. representación en canvas o inspector;
6. persistencia y versionado;
7. funcionamiento en preview;
8. paridad con el render final;
9. cobertura de pruebas;
10. autorización, multi-tenancy y auditoría.

Clasifica el estado de cada función como:

- `OPERATIVA`: completa de extremo a extremo;
- `PARCIAL`: existe solo en algunas capas;
- `INTERNA`: existe como dominio o servicio, pero no está disponible al usuario;
- `EXPERIMENTAL`: está protegida por flags o no tiene garantías de producción;
- `AUSENTE`;
- `NO_VERIFICADA`.

Cada afirmación sobre Courseforge debe incluir evidencia mediante:

```text
ruta del archivo + símbolo, tipo, servicio o prueba relevante + commit auditado
```

No confundas existencia de código con experiencia de usuario completa.

Asigna identificadores estables para conservar trazabilidad entre inventario, matrices, riesgos, operaciones y roadmap:

```text
CAP-*   Capacidad
OP-*    Operación
RISK-*  Riesgo
SRC-*   Fuente o evidencia
DEC-*   Decisión arquitectónica
```

---

## 3. Objetivo de la investigación

La investigación debe responder:

1. ¿Qué capacidades ya posee Courseforge?
2. ¿Cuáles están incompletas o desacopladas entre UI, dominio, preview y render?
3. ¿Qué herramientas son fundamentales para el flujo real de producción de cursos?
4. ¿Qué capacidades faltantes generan mayor fricción?
5. ¿Qué funciones de escritorio tienen sentido en navegador?
6. ¿Qué funciones no justifican su complejidad para este producto?
7. ¿Qué herramientas deberían modelarse como operaciones deterministas?
8. ¿Qué debe poder ejecutar un agente de IA de forma segura?
9. ¿Qué cambios requieren evolución del documento de composición?
10. ¿Cómo mantener paridad entre edición, preview y render final?
11. ¿Cuál debe ser el roadmap técnico y funcional?

### 3.1 Metadatos y reproducibilidad

Registra al inicio de la investigación:

```text
Fecha de corte
Commit SHA
Rama
Estado del working tree: limpio o con cambios
Versiones relevantes de runtime y dependencias
Navegador y sistema usados para verificaciones manuales
Comandos ejecutados
Pruebas ejecutadas y resultado
Limitaciones de acceso, ejecución o evidencia
```

No mezcles resultados de commits o entornos diferentes sin declararlo.

### 3.2 Ejecución por etapas

La investigación debe ejecutarse en tres etapas auditables, aunque el resumen final consolide sus decisiones:

1. **Auditoría local**: inventario, cobertura vertical, contratos, UI, persistencia, preview, render, pruebas y seguridad.
2. **Investigación externa**: benchmark seleccionado, factibilidad tecnológica y ledger de fuentes.
3. **Síntesis**: gap analysis, operaciones recomendadas, decisiones, roadmap y listas finales.

No avances una conclusión del roadmap si depende de una etapa anterior no verificada. Si el entorno no permite completar una etapa, marca la limitación y conserva `NO_VERIFICADA` en lugar de rellenar el vacío con inferencias.

### 3.3 Control de alcance

Define explícitamente:

- capacidades dentro y fuera del alcance de esta investigación;
- decisiones que pueden tomarse con la evidencia disponible;
- decisiones que requieren prototipo, medición o validación de producto;
- límites de profundidad por categoría;
- preguntas abiertas, responsable sugerido y evidencia faltante.

No permitas que colaboración en tiempo real, tracking avanzado, WebGPU u otras capacidades de alta complejidad desplacen los fundamentos del editor salvo que exista evidencia de que resuelven un flujo prioritario de Courseforge.

---

## 4. Principio arquitectónico

La UI, los shortcuts, los templates, las automatizaciones y los agentes no deben implementar lógica de edición independiente.

Todos deben consumir un núcleo compartido:

```text
UI ───────────────┐
Shortcuts ────────┤
Templates ────────┼──> Editor Operations ──> Composition Document
Automatizaciones ─┤             │
Agentes IA ───────┘             ├──> Preview
                                ├──> Persistence / Revisions
                                └──> HyperFrames Render
```

Una operación candidata debe poder, cuando corresponda:

- validarse mediante un schema estricto;
- ejecutarse determinísticamente;
- comprobar precondiciones;
- respetar tracks bloqueados y permisos;
- producir una operación inversa o mecanismo de restauración;
- aplicarse atómicamente con otras operaciones;
- generar un diff comprensible;
- simularse antes de persistirse;
- declarar el rango temporal afectado;
- registrar actor, origen y trazabilidad;
- evitar referencias arbitrarias a URLs o assets;
- conservar el source asset de forma no destructiva;
- mantener compatibilidad entre versiones;
- producir el mismo resultado en preview y render.

No propongas comandos vagos como `improveVideo()` o `makeProfessional()` como operaciones del dominio. Estas intenciones deben traducirse en operaciones concretas y auditables.

---

## 5. Alcance funcional

Investiga y evalúa, como mínimo, estas áreas.

### 5.1 Timeline

- selección y multiselección;
- drag and drop;
- zoom y navegación;
- playhead;
- snapping configurable;
- trim;
- split;
- ripple delete;
- insert y overwrite;
- slip, slide y roll edit;
- selección por rango;
- duplicación;
- linking de audio y video;
- grouping;
- nesting o subcomposiciones;
- locking;
- visibilidad;
- mute y solo;
- markers;
- waveform;
- thumbnails;
- keyframes y curvas;
- edición precisa por frame o timecode;
- shortcuts;
- operaciones masivas;
- prevención y resolución de overlaps.

### 5.2 Canvas y preview

- selección directa;
- bounding boxes;
- mover, escalar y rotar;
- crop;
- handles;
- multiselección;
- snapping;
- guías;
- rulers;
- safe areas;
- alineación y distribución;
- orden de capas;
- bloqueo;
- selección de elementos superpuestos;
- edición contextual;
- overlays;
- zoom y pan;
- visualización de máscaras y paths;
- modos de preview de rendimiento reducido.

Analiza explícitamente la sincronización:

```text
Canvas ↔ Timeline ↔ Inspector ↔ Documento ↔ Preview compilado
```

### 5.3 Video e imagen

- transformaciones;
- crop y fit;
- máscaras;
- opacidad;
- blend modes;
- velocidad;
- reverse;
- freeze frame;
- filtros;
- corrección de color;
- LUT;
- chroma key;
- estabilización;
- tracking;
- perspectiva;
- blur;
- sombras y bordes;
- eliminación de fondo;
- proxies;
- reemplazo de assets;
- render cache;
- generación de thumbnails.

### 5.4 Audio

- waveform;
- volumen por clip y track;
- mute y solo;
- fades;
- crossfades;
- ducking;
- normalización;
- pan;
- EQ;
- compresión;
- limitador;
- reducción de ruido;
- pitch;
- velocidad;
- time stretch;
- canales;
- mezcla multipista;
- sincronización;
- loudness objetivo;
- detección de clipping.

Distingue entre procesamiento:

- interactivo en navegador;
- aplicado en preview;
- aplicado únicamente en render o backend.

### 5.5 Texto y captions

- edición directa;
- estilos tipográficos;
- fuentes personalizadas;
- tamaño, peso, alineación y espaciado;
- stroke, background y shadow;
- bounding box y auto-fit;
- texto responsive;
- presets;
- animaciones;
- captions SRT/VTT;
- edición de cues;
- captions por palabra;
- karaoke y resaltado;
- safe areas;
- estilos por organización o marca.

### 5.6 Motion graphics

- presets de entrada, salida y animación continua;
- keyframes;
- easing;
- curvas;
- paths;
- stagger;
- máscaras;
- SVG;
- transiciones;
- animaciones de texto;
- animaciones reutilizables;
- composición determinista y seek-safe;
- subcomposiciones;
- parámetros editables.

### 5.7 Workflow

- undo y redo;
- historial;
- snapshots;
- autosave;
- versionado;
- recuperación después de errores;
- optimistic concurrency;
- copiar y pegar;
- duplicar;
- copiar propiedades;
- presets;
- templates;
- command palette;
- shortcuts;
- media bin;
- búsqueda;
- metadata;
- carga y reemplazo de archivos;
- estados de procesamiento;
- colaboración y conflictos;
- auditoría.

### 5.8 Plataforma, formatos y accesibilidad

Antes de declarar factibilidad, propón y explicita los targets recomendados para:

- navegadores y versiones soportadas;
- hardware mínimo y objetivo;
- desktop, tablet y móvil;
- resolución, aspect ratios, FPS y duración de composiciones;
- codecs, contenedores y formatos de entrada y salida;
- uso online, degradación offline y recuperación de conectividad;
- navegación completa por teclado;
- semántica y accesibilidad de timeline, canvas, inspector y dialogs;
- contraste, foco visible y lectores de pantalla;
- `prefers-reduced-motion`;
- captions accesibles, idiomas, Unicode y escritura RTL;
- localización de timecode, números y controles.

Distingue requisitos confirmados del producto de targets recomendados que aún necesitan validación.

---

## 6. Investigación específica: HTML/CSS editable

Courseforge puede incorporar diapositivas o composiciones HTML/CSS dentro del video. Esta es una capacidad estratégica y debe analizarse con mayor profundidad que en un editor convencional.

Investiga cómo permitir que un usuario seleccione visualmente un elemento como:

```html
<h1>Ventas del trimestre</h1>
<p>Los ingresos aumentaron un 20%</p>
```

y edite únicamente su contenido o propiedades sin modificar manualmente el código.

Evalúa al menos tres modelos:

### Modelo A — DOM arbitrario inspeccionable

- importar HTML;
- sanitizarlo;
- asignar identificadores estables;
- seleccionar nodos;
- exponer propiedades permitidas;
- aplicar patches sobre el DOM.

### Modelo B — HTML instrumentado

- atributos como `data-editable-id`;
- propiedades expuestas;
- contratos de edición;
- regiones protegidas;
- manifiesto de campos editables.

### Modelo C — Componentes declarativos

- templates con schema;
- props tipadas;
- slots;
- tokens de diseño;
- bindings de texto, imagen y datos;
- regeneración determinista.

Para cada modelo analiza:

- flexibilidad;
- seguridad;
- mantenibilidad;
- serialización;
- compatibilidad con HyperFrames;
- capacidad de undo/redo;
- estabilidad de los selectores;
- edición mediante IA;
- preview;
- render;
- migraciones;
- dificultad de implementación.

Incluye una arquitectura recomendada para:

```text
HTML Asset
├── source protegido
├── manifest de elementos editables
├── identificadores estables
├── schema de propiedades
├── overrides del usuario
├── design tokens
└── renderer determinista
```

Investiga operaciones como:

```typescript
html.setText()
html.setAttribute()
html.setStyleToken()
html.setImage()
html.setVisibility()
html.reorderElement()
html.updateChartData()
html.resetOverride()
```

No recomiendes edición irrestricta de `innerHTML`, JavaScript o CSS arbitrario sin analizar el riesgo.

Considera obligatoriamente:

- sanitización;
- XSS;
- aislamiento mediante `iframe sandbox`;
- Content Security Policy;
- bloqueo de scripts;
- URLs y recursos externos;
- CSS que escape del contenedor;
- `postMessage` con validación de origen y schema;
- modelo de origen del `iframe`, incluido el caso de origen opaco `null` cuando el sandbox no permite `allow-same-origin`;
- validación de `event.source`, canal o nonce de sesión y versión del protocolo;
- protección contra replay, mensajes fuera de orden y payloads excesivos;
- matriz explícita de tokens permitidos en `iframe sandbox`;
- política de navegación, popups, formularios, descargas y acceso al top frame;
- límites de tamaño y complejidad;
- allowlists de propiedades;
- SVG inseguro;
- fuentes remotas;
- SSRF durante render;
- consistencia entre navegador y render cloud.

---

## 7. Productos y tecnologías a investigar

### Editores web

- HyperFrames;
- Canva;
- CapCut Web;
- Adobe Express;
- VEED;
- Descript;
- Clipchamp;
- Kapwing;
- Runway;
- Photopea;
- otros productos relevantes.

### Editores profesionales de escritorio

- Adobe Premiere Pro;
- After Effects;
- DaVinci Resolve y Fairlight;
- Final Cut Pro;
- CapCut Desktop;
- Blender Video Sequence Editor.

### Diseño y edición visual

- Figma;
- Photoshop;
- Affinity;
- Webflow;
- Framer;
- GrapesJS;
- editores WYSIWYG y page builders relevantes.

### Tecnologías

- HyperFrames;
- Remotion;
- FFmpeg y ffmpeg.wasm;
- WebCodecs;
- Canvas API;
- OffscreenCanvas;
- Web Workers;
- AudioWorklet y Web Audio API;
- WebGL;
- WebGPU;
- Fabric.js;
- Konva.js;
- PixiJS;
- Three.js;
- librerías de waveform y timeline relevantes.

No es obligatorio dedicar el mismo nivel de detalle a todos los productos. Selecciona referentes por categoría y explica el criterio de selección.

Para el análisis profundo, selecciona normalmente entre dos y tres referentes por categoría. Los demás productos pueden cubrirse de forma dirigida para capacidades específicas. Si necesitas superar ese límite, justifica qué decisión adicional habilita cada referente.

Cuando analices HyperFrames, distingue siempre entre:

1. capacidades del producto o repositorio upstream;
2. versión o commit disponible para Courseforge;
3. capacidades realmente integradas y expuestas por Courseforge.

No atribuyas a Courseforge una capacidad que solo exista upstream.

---

## 8. Investigación web y calidad de evidencia

Realiza investigación web actual y cita las afirmaciones importantes.

Prioriza:

1. documentación oficial;
2. documentación técnica oficial;
3. repositorios oficiales;
4. especificaciones de estándares;
5. documentación de APIs;
6. artículos de ingeniería de los fabricantes;
7. fuentes secundarias únicamente cuando no exista evidencia primaria.

Para cada afirmación relevante registra:

- identificador `SRC-*`;
- producto;
- capacidad;
- URL;
- título y propietario de la fuente;
- fecha de consulta;
- nivel de confianza: alto, medio o bajo;
- si la fuente describe disponibilidad general, beta, experimento o roadmap.

No uses snippets de buscadores como evidencia.

No declares que una función no existe solo porque no aparezca en una página promocional. Usa `NO VERIFICADA` cuando no exista evidencia suficiente.

Separa claramente:

- `HECHO VERIFICADO`;
- `INFERENCIA TÉCNICA`;
- `RECOMENDACIÓN`.

Mantén un ledger de fuentes independiente de las matrices. Las matrices deben referenciar `SRC-*` para evitar duplicar URLs y para permitir que una afirmación use varias fuentes.

Cuando una capacidad requiera autenticación, plan de pago o acceso no disponible, documenta la limitación. No infieras comportamiento desde marketing, capturas aisladas o snippets.

---

## 9. Evaluación de factibilidad

Para cada capacidad determina:

### Estado en Courseforge

- `OPERATIVA`
- `PARCIAL`
- `INTERNA`
- `EXPERIMENTAL`
- `AUSENTE`
- `NO_VERIFICADA`

Usa estos valores para las celdas de cobertura vertical:

- `VERIFICADA`: existe evidencia de ejecución, prueba o inspección directa suficiente;
- `PRESENTE_NO_VERIFICADA`: existe código o contrato, pero no se validó su comportamiento;
- `PARCIAL`: cubre solo una parte del comportamiento requerido;
- `AUSENTE`: una búsqueda razonable y documentada no encontró implementación;
- `NO_VERIFICADA`: no hubo acceso o evidencia suficiente para decidir;
- `NO_APLICA`: la capa no es necesaria para esa capacidad.

Reglas de agregación para Courseforge:

- `OPERATIVA`: todas las capas requeridas están `VERIFICADA`, incluida autorización y pruebas proporcionales al riesgo;
- `INTERNA`: el núcleo existe, pero falta exposición funcional al usuario;
- `EXPERIMENTAL`: depende de flags, prototipos, APIs inestables o carece de garantías de producción;
- `PARCIAL`: existe valor útil, pero falta al menos una capa necesaria para el flujo completo;
- `AUSENTE`: no existe una implementación relevante después de búsqueda documentada;
- `NO_VERIFICADA`: la evidencia no permite una conclusión responsable.

Si varias reglas aplican, prioriza `EXPERIMENTAL`, luego `INTERNA`, luego `PARCIAL`, y explica la decisión.

### Valor

- Fundamental
- Importante
- Complementaria
- Profesional
- Experimental

### Factibilidad web

- Alta
- Media
- Baja

### Lugar de ejecución recomendado

- navegador/main thread;
- navegador/Web Worker;
- navegador/WebCodecs;
- WebGL/WebGPU;
- backend;
- FFmpeg;
- render HyperFrames;
- arquitectura híbrida.

### Prioridad

- `P0`: corrige una carencia fundamental o de integridad;
- `P1`: alto impacto en producción;
- `P2`: mejora relevante;
- `P3`: capacidad profesional o futura;
- `NO RECOMENDADA`: coste o riesgo mayor que el valor.

Justifica la prioridad con una puntuación reproducible:

```text
Valor de producción                 0..5
Frecuencia esperada                 0..5
Reducción de trabajo manual         0..5
Aprovechamiento por automatizaciones 0..3
Aprovechamiento arquitectónico      0..3
Complejidad                        -0..5
Riesgo de seguridad                -0..5
Riesgo de preview/render           -0..5
Dependencias no resueltas          -0..3
```

Explica los pesos usados. Correctitud, seguridad, pérdida de datos, aislamiento entre organizaciones y bloqueo de publicación pueden elevar una capacidad a `P0` aunque la puntuación ponderada sea menor. La puntuación apoya la decisión; no sustituye el juicio arquitectónico.

Evalúa:

- utilidad para creación de cursos;
- frecuencia esperada;
- reducción de trabajo manual;
- reutilización por agentes;
- complejidad;
- dependencias;
- compatibilidad;
- impacto sobre el documento;
- impacto sobre preview y render;
- CPU, GPU, memoria e I/O;
- tamaño de assets;
- mantenibilidad;
- seguridad;
- observabilidad;
- riesgo de regresión.

No uses popularidad como criterio principal.

---

## 10. Operaciones estructuradas y agentes

Identifica qué capacidades deben representarse mediante operaciones internas.

Para cada operación propuesta documenta:

```text
Nombre
Objetivo
Activos compatibles
Entrada
Precondiciones
Validaciones
Efectos
Operación inversa
Impacto temporal
Impacto visual
Necesita recompilar preview
Persistencia
Riesgo
Permiso requerido
Puede usarla un agente
Requiere confirmación humana
Tipo de efecto secundario
Idempotency key o estrategia equivalente
Compensación ante fallo parcial
Evento de auditoría y correlation ID
```

Agrúpalas en familias como:

```text
Composition
Track
Clip
Timeline
Transform
Crop
Appearance
Audio
Text
Caption
HTML
Animation
Transition
Group
Asset
Document
```

Distingue entre:

- operaciones seguras para agentes;
- operaciones que requieren propuesta y confirmación;
- operaciones prohibidas para agentes;
- operaciones que afectan assets o publicación;
- operaciones costosas que disparan render.

El diseño debe conservar:

- schemas estrictos;
- simulación;
- diff semántico;
- patches inversos;
- límites de cantidad;
- control de versión o hash;
- aplicación atómica;
- trazabilidad;
- idempotencia cuando corresponda;
- aislamiento por organización.

Una operación inversa sobre el documento no revierte automáticamente efectos externos. Para uploads, borrados, procesamiento, render o publicación, modela jobs, estados, idempotencia, cancelación y acciones compensatorias. No declares atomicidad entre base de datos y proveedores externos si no existe un mecanismo que la garantice.

---

## 11. Matrices requeridas

### Matriz A — Benchmark normalizado

```text
CAP-ID
Categoría
Capacidad
Courseforge
HyperFrames upstream
Canva
CapCut
Premiere
Resolve
Otros referentes
SRC-IDs
```

Usa valores normalizados:

- Sí
- Parcial
- No
- No verificada
- No aplica

No uses solo símbolos sin leyenda.

La columna Courseforge usa la taxonomía `OPERATIVA | PARCIAL | INTERNA | EXPERIMENTAL | AUSENTE | NO_VERIFICADA`. Las columnas de productos externos usan `Sí | Parcial | No | No verificada | No aplica`. La integración concreta de HyperFrames dentro de Courseforge se refleja en Courseforge y en su evidencia local, no en la columna upstream.

### Matriz B — Gap analysis de Courseforge

```text
CAP-ID
Capacidad
Estado actual
Evidencia en repositorio
Capa faltante
Problema que resuelve
Valor para Courseforge
Factibilidad web
Dependencias
Riesgos
Prioridad
Recomendación
```

### Matriz C — Cobertura vertical

```text
CAP-ID
Capacidad
Dominio
UI
Timeline
Canvas
Inspector
Persistencia
Preview
Render
Pruebas
Seguridad
Observabilidad
```

Esta matriz es obligatoria porque una función no puede considerarse completa si únicamente existe en una capa.

Cada celda debe usar exclusivamente `VERIFICADA | PRESENTE_NO_VERIFICADA | PARCIAL | AUSENTE | NO_VERIFICADA | NO_APLICA` y referenciar evidencia cuando su valor no sea `NO_APLICA`.

### Matriz D — Arquitectura de operaciones

```text
OP-ID
Operación
Contrato actual
Contrato recomendado
Determinista
Reversible
Atómica
Agent-safe
Requiere render
Compatibilidad/migración
```

---

## 12. Roadmap

Propón un roadmap incremental. No agrupes funciones solo por sofisticación; considera dependencias técnicas y reducción de riesgo.

### Fase 0 — Correctitud del núcleo

- inconsistencias actuales;
- paridad preview/render;
- contratos;
- versionado;
- persistencia;
- seguridad;
- tests;
- observabilidad.

### Fase 1 — Fundamentos de edición

- operaciones esenciales;
- controles UI;
- timeline;
- canvas;
- inspector;
- undo/redo y autosave.

### Fase 2 — Producción eficiente

- audio;
- captions;
- presets;
- templates;
- media management;
- flujos frecuentes de cursos.

### Fase 3 — Edición avanzada

- keyframes;
- transiciones avanzadas;
- color;
- máscaras;
- efectos;
- subcomposiciones;
- herramientas profesionales justificadas.

### Fase 4 — HTML editable

- modelo seguro;
- manifest;
- inspector visual;
- operaciones;
- preview;
- render;
- migración de assets existentes.

### Fase 5 — AI-ready editor

- catálogo de operaciones;
- read tools;
- propuestas;
- simulación;
- diff;
- permisos;
- confirmaciones;
- evaluación de resultados.

Para cada fase incluye:

- objetivo;
- capacidades;
- dependencias;
- módulos afectados;
- cambios de datos;
- riesgos;
- pruebas;
- criterios de aceptación;
- métricas;
- estrategia de rollout;
- rollback;
- estimación relativa: S, M, L o XL.

Evita estimaciones de tiempo absoluto sin conocer el equipo y su capacidad.

---

## 13. Rendimiento y escalabilidad

Analiza explícitamente:

- cantidad máxima razonable de clips y tracks;
- duración de composiciones;
- tamaño de assets;
- consumo de memoria;
- decodificación simultánea;
- costo de thumbnails y waveforms;
- scrubbing;
- tiempo de respuesta de operaciones;
- frecuencia de autosave;
- tamaño del documento;
- compilación del preview;
- render en cloud;
- caché;
- proxies;
- backpressure;
- cancelación;
- reintentos;
- recuperación después de fallos.

Propón presupuestos medibles, pero identifícalos como objetivos recomendados cuando todavía no existan mediciones reales.

No inventes benchmarks del sistema actual.

### 13.1 Contrato de paridad preview/render

Define un contrato medible de conformidad que incluya:

- mismo `documentHash`, revisión, assets y versión del renderer;
- fixtures canónicos para timing, crop, transform, texto, fuentes, captions, audio, motion y transiciones;
- frames y timecodes de comparación;
- tolerancia de pixel diff o métrica perceptual;
- tolerancia temporal y de duración;
- tolerancia de loudness, clipping y sincronización A/V;
- tratamiento de fuentes, codecs, color spaces y diferencias de plataforma;
- criterio de bloqueo de release;
- reporte que permita diagnosticar si la divergencia nace en documento, evaluator, preview adapter, render adapter o asset.

No uses "se ve igual" como criterio de aceptación. Cuando una igualdad exacta no sea viable, declara la tolerancia y su justificación.

---

## 14. Seguridad y multi-tenancy

Para todas las recomendaciones considera:

- RLS;
- `organization_id`;
- ownership;
- roles;
- acceso a assets;
- signed URLs;
- MIME y tamaño;
- contenido activo;
- XSS;
- SSRF;
- path traversal;
- autorización de operaciones;
- acceso del agente;
- logs sin PII ni secretos;
- auditoría;
- separación entre documentos y binarios;
- eliminación o reemplazo no destructivo;
- protección de webhooks;
- publicación y render autorizados.

Señala cualquier función que amplíe la superficie de ataque.

---

## 15. Entregables

La investigación puede distribuir el detalle en artefactos auditables:

```text
Artefacto 1: auditoría local, inventario y cobertura vertical.
Artefacto 2: benchmark, factibilidad y ledger de fuentes.
Artefacto 3: decisiones, operaciones, seguridad, roadmap y riesgos.
```

La respuesta o documento ejecutivo final debe enlazar esos artefactos y contener, en este orden:

1. Resumen ejecutivo.
2. Alcance, supuestos y metodología.
3. Auditoría del editor actual.
4. Benchmark de productos.
5. Catálogo maestro de capacidades.
6. Matriz de cobertura vertical.
7. Gap analysis.
8. Factibilidad técnica web.
9. Análisis de HTML/CSS editable.
10. Modelo recomendado de operaciones.
11. Seguridad y multi-tenancy.
12. Rendimiento y observabilidad.
13. Roadmap priorizado.
14. Riesgos y decisiones pendientes.
15. Fuentes.

Incluye al inicio entre cinco y diez conclusiones accionables. No escondas las recomendaciones principales al final.

Las matrices completas y el ledger de fuentes pueden vivir en anexos o archivos separados. El resumen no debe omitir decisiones, prioridades, limitaciones ni riesgos por haber movido el detalle a anexos.

Incluye un registro de decisiones pendientes con:

```text
DEC-ID
Pregunta o decisión
Opciones
Evidencia disponible
Evidencia faltante
Responsable sugerido
Fecha o condición de revisión
Impacto de postergar la decisión
```

---

## 16. Restricciones

- No implementes código todavía.
- No propongas reemplazar la arquitectura actual sin demostrar la necesidad.
- No presentes una reescritura completa como primera opción.
- Prioriza evolución incremental y compatible.
- No recomiendes una dependencia sin evaluar mantenimiento, licencia, tamaño, seguridad y acoplamiento.
- No marques una función como implementada únicamente porque exista un schema.
- No confundas preview con render final.
- No confundas edición no destructiva con modificación del archivo fuente.
- No inventes capacidades de competidores.
- No inventes resultados de performance.
- No recomiendes WebGPU si WebGL, Canvas o procesamiento backend resuelven mejor el caso.
- No propongas capacidades profesionales de alto coste sin relacionarlas con el flujo de creación de cursos.
- No conviertas la sección de IA en el centro de la investigación: primero debe existir un editor sólido.
- No mezcles evidencia de diferentes commits, versiones o entornos sin declararlo.
- No marques como ausencia lo que solo pudo verificarse detrás de autenticación, pago o acceso no disponible.
- No atribuyas a la integración de Courseforge capacidades disponibles únicamente en HyperFrames upstream.

---

## 17. Criterio final de decisión

La investigación debe permitir tomar decisiones concretas sobre qué construir durante los próximos ciclos.

La pregunta central es:

> **¿Qué conjunto mínimo y evolutivo de capacidades necesita Courseforge para ofrecer edición audiovisual completa para producción educativa, mantener paridad entre preview y render, permitir edición segura de HTML y exponer operaciones deterministas que puedan utilizar tanto personas como agentes?**

Concluye con tres listas:

### Construir ahora

Capacidades con evidencia suficiente, alto valor y dependencias claras.

### Investigar o prototipar

Capacidades prometedoras que necesitan pruebas técnicas o de producto.

### No construir por ahora

Capacidades cuyo coste, riesgo o desviación del producto no se justifica.
