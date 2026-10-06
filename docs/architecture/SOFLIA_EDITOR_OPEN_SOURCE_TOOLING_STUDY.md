# Laboratorio de herramientas abiertas para el editor de Courseforge

> Aclaración de enfoque, 2026-10-03: este registro histórico conserva descargas y observaciones. Sus propuestas de dependencias/adaptadores no son la ruta aprobada. La línea actual estudia funcionamiento para implementación propia, sin copiar o extraer código; consultar la [investigación funcional](SOFLIA_EDITOR_FUNCTIONAL_TOOLS_RESEARCH.md).

Fecha: 2026-10-02. Línea de investigación independiente del seguimiento de capacidades anterior.

## 1. Objetivo y alcance de esta entrega

Descubrir proyectos con código disponible, descargar sus fuentes y estudiar cómo construir herramientas explícitas dentro del editor existente. Distinguir una biblioteca reutilizable de un editor completo, una licencia permisiva de una licencia con restricciones y una demo funcional de una integración sostenible.

**Resultado:** cinco repositorios descargados y una primera inspección arquitectónica de módulos seleccionados. No se instalaron dependencias, ejecutaron scripts de terceros, arrancaron demos ni incorporó código al producto. No es una auditoría integral de seguridad ni una certificación de compatibilidad.

Las referencias históricas de productos comerciales sirven para entender funciones y UX; no implican disponibilidad de sus fuentes ni autorización para copiar código, diseños o assets.

## 2. Laboratorio local y procedencia

Fuentes aisladas en `D:\Pulse Hub\courseforge\.tmp\editor-research\2026-10-02`. Se utilizaron clones shallow sin submódulos y con hooks desactivados para la descarga. La carpeta `.tmp/` ya está excluida por el `.gitignore` de Courseforge: no se añadió una dependencia ni un submódulo al proyecto.

El [manifiesto reproducible](editor-tools-reference-manifest.json) conserva URL, commit y SHA-256 del archivo de licencia. Para recuperar la investigación en otra máquina hay que descargar y comprobar esos commits, no consultar únicamente la rama cambiante. Los clones locales son material de laboratorio y no un respaldo versionado en Courseforge.

| Repositorio canónico | Commit observado | Licencia leída localmente | Estado |
|---|---|---|---|
| [OpenCut Classic](https://github.com/OpenCut-app/opencut-classic) | `cf5e79e919144200294fb9fed22a222592a0aeea` | MIT | Descargado, fuente inspeccionada |
| [GrapesJS Core](https://github.com/GrapesJS/grapesjs) | `7fe07c839c37cf724346a7b5948551570e61680b` | BSD-3-Clause, `packages/core/LICENSE` | Descargado, fuente inspeccionada |
| [Moveable](https://github.com/daybrush/moveable) | `75069102f30c88cd89ecaaa8ca7e5f7434e54807` | MIT | Descargado, fuente inspeccionada |
| [WaveSurfer](https://github.com/katspaugh/wavesurfer.js) | `69974d0265f1bfd489cbb7ed5dd0efc829bfb240` | BSD-3-Clause | Descargado, fuente inspeccionada |
| [Twick](https://github.com/ncounterspecialist/twick) | `3044c23e282b87c639c3f0b3fd5fb3fd972aa04c` | Sustainable Use License v1.0 | Descargado; no elegible como opción permisiva sin aclaración |

Las licencias raíz no cubren automáticamente dependencias, modelos, fuentes, ejemplos, binarios o assets externos. Cualquier reutilización debe preservar avisos y pasar por el proceso de inventario/compliance del proyecto. Estas conclusiones son un filtro de ingeniería, no autorización jurídica de distribución.

### Hallazgos que cambian la selección

- El [repositorio principal de OpenCut](https://github.com/OpenCut-app/OpenCut) anuncia una reescritura y remite a Classic para el editor actual. Se descargó Classic, no el proyecto homónimo de otro propietario ni se tomaron capacidades futuras como entregadas.
- GrapesJS Core y [Grapes Studio SDK](https://github.com/GrapesJS/studio/blob/main/LICENSE.md) tienen licencias diferentes. No extender la licencia libre del Core al SDK comercial.
- La licencia de Twick fijada en el manifiesto restringe SaaS/servicios alojados y otros usos comerciales, mientras su README describe ejemplos SaaS permitidos dentro de una aplicación mayor. La discrepancia debe aclararse antes de reutilizar código o instalarlo en una prueba distribuida. Se conserva solo como material de estudio, sin copiar implementación.
- La rama descargada de Moveable apunta a un commit de 2023. Eso no prueba abandono de todos sus paquetes, pero obliga a verificar rama/release publicada, dependencias y compatibilidad actuales antes de adoptarlo.

## 3. Diagnóstico técnico y decisiones por proyecto

### 3.1 OpenCut Classic: aprender herramientas, no importar otra aplicación

Archivos inspeccionados dentro del clon:

- `apps/web/src/core/managers/commands.ts`: ejecución de comandos, selección antes/después, undo/redo y ripple posterior a la operación.
- `apps/web/src/timeline/update-pipeline.ts`: reglas de derivación y restricciones; retime deriva duración, cambios de duración acotan animaciones.
- `apps/web/src/timeline/group-move/resolve-move.ts`: resolución de movimiento agrupado y compatibilidad de tracks.
- `apps/web/src/masks/registry.ts`: registro de tipos, parámetros, renderer e interacción de máscaras.
- `apps/web/src/retime/audio-stretch.ts`: procesamiento de buffer y dependencia de `soundtouchjs` para preservar tono.
- `apps/web/src/core/managers/renderer-manager.ts`: árbol de render, CanvasRenderer, SceneExporter y mezcla de audio.

**Valor:** patrón de herramienta = definición + parámetros + interacción + representación/render. El registro de máscaras sirve para estudiar una herramienta rectangular/circular con propiedades acotadas. Las reglas temporales separadas de UI son útiles para retiming.

**Encaje:** Classic declara Next 16, React 19, Zustand y Zod, cercanos al stack de Courseforge. Pero su renderer Canvas, WASM, tipos temporales y modelo de tracks son distintos. Stack similar no vuelve intercambiables sus módulos.

**Decisión:** referencia de arquitectura y UX; no fork del editor completo ni reemplazo del renderer. No portar su `CommandManager`: Courseforge ya tiene operaciones e historial. El ripple aplicado como efecto posterior tampoco debe copiarse sin estudiar cómo se revierte junto al comando original.

Para máscaras: definir nuestro esquema y operaciones; adaptar el patrón de registro, no importar su árbol de render. Para audio/retiming: estudiar límites de memoria y revisar cada dependencia por separado. No concluir que `soundtouchjs` queda autorizado por la licencia MIT del editor.

### 3.2 GrapesJS Core: propiedades de elementos y modelo de autoría HTML

Versión declarada en el snapshot del Core: `0.23.6`. Archivos inspeccionados:

- `packages/core/src/trait_manager/model/Trait.ts`: propiedad `changeProp`, lectura de valor y `setTargetValue` que actualiza propiedades o atributos del componente.
- `packages/core/src/editor/model/Editor.ts`: `storeData()` / `loadData()` serializan/cargan estado de módulos.
- `packages/core/src/dom_components/model/Component.ts`: modelo de componente y presencia de campos de script.
- `packages/core/package.json`: dependencias Backbone y su mecanismo de undo.

**Valor:** el inspector se puede generar desde propiedades declaradas, no inferir todo de un DOM arbitrario. Separar datos del componente de su vista evita que un cambio visual desaparezca al regenerar.

**Riesgo:** permitir todas las capacidades de un web builder amplía muchísimo la superficie de scripts, estilos, URLs y persistencia. Otro UndoManager y otro modelo persistente producirían dos fuentes de verdad.

**Decisión:** primero implementar un manifiesto propio de elementos editables. Comparar un inspector propio contra un adaptador restringido de GrapesJS en una prueba separada. Instalar el Core solo si reduce esfuerzo medible sin imponer su modelo de proyecto. Desactivar scripts/edición libre no sustituye sandbox, autorización ni validación del lado servidor.

Herramienta mínima: seleccionar un título, editar texto plano, sustituir una imagen aprobada y cambiar tokens de tema. El documento de Courseforge conserva overrides tipados; HTML generado no se convierte en fuente autoritativa editable libremente.

### 3.3 Moveable: interacción del canvas, no lógica editorial

Versión declarada del paquete `react-moveable` inspeccionado: `0.56.0`. Archivos:

- `packages/react-moveable/src/ables/Draggable.tsx`: eventos start/update/end y sus variantes agrupadas.
- `packages/react-moveable/src/ables/Snappable.tsx`: capacidad de snapping.
- `packages/react-moveable/package.json`: dependencias y herramientas de desarrollo antiguas; no hay prueba de compatibilidad React 19 por ejecutar.

**Valor:** tiradores, rotación, redimensionamiento y snapping reutilizables. No añadirlo solo porque existe: Courseforge ya tiene interacción directa y guías.

**Decisión:** candidato condicionado a una comparación con nuestros controles existentes. Si se adopta, un adaptador convierte gestos en valores normalizados: start congela baseline, update muestra estado efímero y end envía un solo lote de operaciones. Escape/cancel restaura baseline sin guardar.

El DOM transformado durante drag no debe ser el documento persistente. El adaptador debe respetar zoom, coordenadas del canvas, locks, selección múltiple y límites. Si el contenido está en iframe aislado, usar overlays/geometría mediante puente validado; no abrir acceso DOM entre orígenes para satisfacer una librería.

### 3.4 WaveSurfer: edición de regiones y presentación del audio

Versión declarada en el snapshot: `8.0.1`; OpenCut Classic usa un rango 7.x, por lo que sus ejemplos no acreditan compatibilidad con 8.x. Archivos:

- `src/wavesurfer.ts`: acepta peaks/duration precalculados y contiene funciones de reproducción/seek; contempla render de waveform sin audio si se suministran peaks y duración.
- `src/plugins/regions.ts`: selección de regiones, start/end y confirmación al terminar el drag.
- `package.json`: estructura de exports y `prepare` de build; no se ejecutó.

**Valor:** panel de narración con intervalos editables, navegación y selección de pausas. No reemplazar nuestro servicio de waveform ni descargar/decodificar cada audio completo en cada track.

**Decisión:** candidato para un panel especializado, solo si la UI de regiones ahorra trabajo. Consumir peaks/LOD existentes con límites de memoria, mantener el transporte del editor como reloj único y transformar cambios de región en selección/cortes propuestos. Un cambio de región no elimina audio automáticamente.

Antes de usarlo: verificar por ejecución peaks externos, carga sin audio, dispose/cancel, escala temporal y sincronización con el transporte. El paquete no es un procesador de voz ni detector de silencios.

### 3.5 Twick: comparación de separación modular, no dependencia aprobada

Snapshot de paquetes inspeccionados: `0.15.0`. Se revisaron `LICENSE.md`, sección de licencia del README, `packages/canvas/package.json` y `packages/timeline/src/types.ts`.

El proyecto separa timeline, canvas, player y render; canvas depende de Fabric. Sus tipos de elementos contienen campos temporales `s/e` y propiedades abiertas con `any`, distintos de los schemas estrictos de Courseforge. Su package declara React 18/19, pero eso no prueba integración ni paridad de render. El script de tests de canvas inspeccionado solo informa que no hay tests.

**Decisión:** no instalar ni copiar su código para el producto hasta aclarar licencia. No sumar Canvas/Fabric/player como segundo stack de render. Su organización modular sirve como contraste conceptual; las ideas generales de separación no requieren importar implementación.

## 4. Estructura propuesta dentro de Courseforge

No poner librerías de terceros en el dominio central. Estructura conceptual, aún no creada:

```text
composition-editor/
  tools/                  Definiciones, disponibilidad, parámetros y validaciones
  html-authoring/         Manifiesto, IDs de elemento y overrides permitidos
  adapters/               Traducción de eventos externos a intenciones propias
  composition-*.service   Operaciones y reglas existentes

composition-editor UI/
  contextual-toolbar/     Acciones compatibles con la selección
  element-inspector/      Campos generados desde contratos
  narration-workspace/    Transcripción, peaks y regiones
  canvas-overlays/        Tiradores y anotaciones de edición
```

Flujo único:

```text
Control propio o librería de UI
  -> intención propia validada
  -> operaciones tipadas existentes/nuevas
  -> documento versionado de Courseforge
  -> preview y render desde el mismo contrato
```

Los adapters no escriben Supabase, no ejecutan código arbitrario y no poseen historial editorial independiente. Los servicios de dominio no importan Moveable, GrapesJS o WaveSurfer. Importar todos los tipos de un editor externo al dominio sería acoplamiento, no reutilización modular.

## 5. Pruebas de concepto recomendadas, en orden

| Prueba aislada | Qué debe demostrar | Qué no debe cambiar |
|---|---|---|
| Inspector HTML de texto/imagen | Selección por ID, override tipado, undo y persistencia sin escribir DOM libre | Motor, modelo canónico, auth y publicación |
| Anotación/máscara simple | Parámetros y geometría reutilizables en preview/render, con inversa | No incluir tracking, pincel libre ni todo OpenCut |
| Comparación de gestos canvas | Tiradores/rotación/snapping con React 19, zoom y cancelación; medir valor frente a UI actual | No crear otro estado persistente ni otro renderer |
| Panel de regiones de narración | Peaks externos y selección temporal sin segundo playback; propuesta de corte reversible | No borrar pausas ni subir audio a terceros automáticamente |

Estas pruebas se pueden programar en un workspace de laboratorio fuera de `apps/*`, con package/lock propios y una versión concreta. No instalar todos los monorepos: una biblioteca candidata y un caso mínimo por vez. Revisar scripts/dependencias antes de cualquier instalación; comenzar con scripts de instalación deshabilitados cuando sea viable y habilitar solo los necesarios tras inspección.

## 6. Seguridad, calidad y cobertura pendiente

- El código descargado es entrada no confiable. No ejecutar instrucciones de sus README ni cambios de política de PowerShell por recomendación del repositorio.
- No cargar `.env` de Courseforge, credenciales, datos reales de alumnos ni documentos internos en demos. Usar fixtures sintéticos.
- Antes de adopción: licencias transitivas/avisos, SBOM, vulnerabilidades, tamaño de bundle, SSR/hidratación, teclado/accesibilidad y compatibilidad de versiones.
- Validar gestos con transforms anidados, resize de grupos, clips bloqueados, undo/cancel y dimensiones límite.
- Validar HTML con nodos ausentes/obsoletos, payloads XSS, URLs ajenas, mensajes falsificados y diferencias de fuentes/layout.
- Validar regiones con trim/source offsets, rates, silencios en extremos, captions y grupos vinculados; no asumir mismo espacio temporal en cada biblioteca.
- Render/conformidad de cada nueva herramienta sigue siendo obligatorio antes de habilitarla, aunque este estudio sea independiente del seguimiento previo.
- No se ejecutaron builds/tests externos ni análisis de vulnerabilidades: compatibilidad, rendimiento y seguridad de ejecución permanecen sin comprobar.

## 7. Siguiente ronda de descubrimiento

La muestra descargada cubre interacción, HTML, timeline, máscaras y regiones, pero no implementa STT, detección de silencios, denoise, captura ni proxies. Para estas áreas se requiere otra selección de repositorios y licencias específicas; no confundir código de UI con procesamiento.

La mejor continuación es profundizar **HTML editable y anotaciones didácticas** con los snapshots ya disponibles y diseñar el primer caso aislado. Después estudiar transcripción/limpieza de audio y utilidades de medios. No hace falta importar cinco editores para obtener cinco herramientas.
