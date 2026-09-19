# Plan de implementación: atajos y pestaña de ayuda del editor

Fecha: 2026-09-17.
Estado: entregas A y B implementadas y verificadas localmente. Las secciones de planificación conservan las decisiones originales; el cierre siguiente registra el resultado real.

## Cierre de implementación y validación

- Catálogo único de acciones y ayuda, políticas puras de resolución/contexto y transporte, adaptadores separados para React e iframe. Sin dependencias nuevas, migraciones ni cambios al render de exportación.
- Espacio reproduce/pausa; Home/End y PageUp/PageDown navegan y pausan desde el timeline; G alterna rejilla desde el preview; S alterna snap; F alterna pantalla completa desde el marco del preview; ? abre ayuda. Se conservan las flechas de la regla temporal.
- La pestaña Atajos incluye búsqueda y contextos de uso. Propiedades y SofLIA permanecen montados al cambiar de pestaña. Escape restaura pestaña y foco; cerrar el inspector no deja bloqueados los atajos.
- El puente del iframe valida origen por `event.source`, esquema, sesión y foco. Las pulsaciones no sustituyen escritura, controles nativos, IME ni gestos en curso. El transporte reutiliza sus condiciones de disponibilidad y correlaciona intenciones rápidas con confirmaciones.
- Verificación automática aprobada: `test:composition-shortcuts` (8), `test:composition-preview-sync` (19), `test:composition-timeline` (8), suite del compilador (25), `qa:composition-preview-runtime`, TypeScript sin emisión, ESLint de módulos nuevos y `git diff --check`. Build de producción completado; el ajuste final del bloqueo al cerrar inspector fue validado después con TypeScript.
- Prueba interactiva local con el componente real, compilador real y API simulada en memoria: Espacio y ? con foco en iframe; Home + PageDown llevan a 5 segundos; S cambia snap; búsqueda de ayuda; Escape devuelve el foco a Propiedades; un valor sin guardar (00:06) se conserva al abrir/cerrar Atajos; ayuda superpuesta en el modo de pantalla completa. Sin errores de consola en esta sesión.
- Límites de validación: la prueba local no usa datos reales ni representa una matriz completa de navegadores, lectores de pantalla o teclados físicos. Safari/macOS y layouts físicos ES/US requieren QA de plataforma. F se documenta fuera del iframe porque la activación de usuario no se garantiza al cruzar `postMessage`.
- No se incorporaron J/K/L, edición destructiva, undo/redo ni reasignación persistente: siguen fuera del alcance definido.
Base: [análisis y catálogo propuesto](analisis-atajos-transporte-editor.md), siguiendo [prompt maestro](prompt_maestro.md).

## 1. Objetivo y alcance

Incorporar atajos contextuales al editor de composición y una pestaña «Atajos» que describa todos los accesos disponibles, sin interferir con escritura, controles nativos, edición del canvas o aislamiento del preview.

Se implementará en dos entregas funcionales:

- A: Espacio, acceso a ayuda mediante botón y `?`, pestaña consultable y documentación de los atajos existentes.
- B: Home/End, PageUp/PageDown, F, G y S, una vez validada la entrega A.

Quedan fuera: J/K/L, deshacer/rehacer global, eliminar/dividir por teclado, copiar/pegar/duplicar, rangos de reproducción, bucles, silencio, personalización y guardado por atajo. Son una evolución independiente con requisitos propios; no bloquean A ni B.

No habrá cambios en BD, dependencias externas ni endpoints. La generación del HTML del preview sí cambiará para incluir el adaptador de teclado. Su código debe ser inerte fuera del preview embebido y no alterar el contenido o timing del render final.

## 2. Diagnóstico que determina el diseño

1. `NativeCompositionPreview.tsx` controla reproducción, refresco, selección y paneles; evitar añadir ahí toda la lógica de teclado.
2. `togglePreviewPlayback` contiene reglas que deben conservarse: pausa durante transporte activo y refresco previo si el documento está desactualizado.
3. `CompositionPreviewViewport.tsx` define hoy el bloqueo del botón por guardado, preparación y disponibilidad. Convertir esa condición en política compartida.
4. El iframe tiene `sandbox="allow-scripts"`. Los eventos del canvas necesitan un puente explícito; no habilitar `allow-same-origin`.
5. `CompositionTimeline.tsx` ya maneja flechas y Shift+flechas. Registrarlas otra vez provocaría dobles movimientos.
6. El inspector alterna componentes mediante render condicional y guarda valores de formulario en estado local. Cambiar de tab no debe destruirlos.
7. `clearSelection` cierra el inspector y elimina la selección. Abrir/cerrar ayuda requiere una operación independiente.
8. La suite actual compila servicios `.ts` y ejecuta pruebas con Node. El smoke de preview lanza Chrome headless y verifica un marcador; no equivale a pruebas de teclado físico, foco o fullscreen.

## 3. Decisiones de comportamiento

| Situación | Decisión |
| --- | --- |
| Ámbito | Foco real en superficie del canvas o timeline. No activación por hover ni por «último editor utilizado». |
| Espacio | Sin modificadores; una transición por pulsación. Repeticiones se consumen en el ámbito reconocido sin ejecutar otra transición. |
| Campos y controles | Respetar input, textarea, select, contenido editable heredado, botones, enlaces y controles ARIA. Excepción declarada: Espacio en la regla temporal propia. |
| Botón de transporte enfocado | Activación nativa; el hook contextual no ejecuta una segunda acción. |
| Modificadores/IME | Ignorar combinaciones no registradas, composición de texto y eventos ya consumidos. |
| Buffering | Solicitar pausa/cancelación de intención usando la acción común cuando el transporte está habilitado. |
| Guardado/PREPARING/no listo | Conservar bloqueo actual del botón para play/pause; compartirlo con teclado. La ayuda permanece disponible. |
| Diálogo, menú o gesto de edición activo | El contexto local tiene prioridad; suspender atajos de fondo. |
| Final de reproducción | En A se conserva el comportamiento actual del botón y se registra la limitación. Reiniciar desde el comienzo queda como mejora separada para ambos accesos. |
| Estado visual | Procede del runtime; no mantener un segundo `isPlaying` exclusivo del hook. |
| Ayuda | Abrirla no pausa ni cambia selección/cursor. Cerrar restaura contexto y foco sin guardar formularios automáticamente. |
| Caracteres | Usar `key` para `?`, F, G y S; no asumir posiciones físicas del teclado. |

Revisar el alcance de overlays renderizados mediante portales: comprobar únicamente si el target pertenece al contenedor del editor no basta para detectar un diálogo abierto fuera de ese subárbol. Usar estados explícitos del editor para suspender comandos.

## 4. Arquitectura y archivos

Rutas base:

- UI: `apps/web/src/domains/materials/components/composition-editor/`.
- Servicios: `apps/web/src/domains/production/composition-editor/`.

Los nombres nuevos son propuestos; ajustar sólo si durante implementación existe un módulo equivalente reutilizable.

| Módulo | Responsabilidad |
| --- | --- |
| Nuevo `composition-shortcuts.ts` en servicios | Catálogo tipado, IDs, combinaciones, grupos, ámbitos y metadatos de ayuda. Marcar entradas como comandos registrados o comportamientos locales/nativos documentados. |
| Nuevo `composition-shortcut-policy.ts` en servicios | Resolver una entrada normalizada y contexto a acción/ignorar; sin React, persistencia ni consultas. |
| Nuevo `composition-transport-policy.ts` en servicios | Disponibilidad y resolución de play/pause a partir del estado actual; reutilizado por botón y teclado. Mantenerlo pequeño. |
| Nuevo `useCompositionKeyboardShortcuts.ts` en UI | Lectura de eventos DOM, resolución de foco/targets, registro y limpieza; invocación del controlador común. |
| Nuevo `composition-preview-keyboard-runtime.ts` en servicios | Adaptador que se incluye en HTML del iframe: filtro local, consumo del evento e intención semántica al padre. |
| Nuevo `CompositionShortcutsPanel.tsx` en UI | Buscador, grupos y filas del catálogo; no ejecuta edición ni define combinaciones por separado. |
| `NativeCompositionPreview.tsx` | Integrar hooks, política compartida, disponibilidad, recepción de intenciones y estado de paneles. |
| `CompositionPreviewViewport.tsx` | Botón accesible, indicación del atajo y disponibilidad compartida. |
| `CompositionPreviewToolbar.tsx` | Botón visible «Atajos de teclado». |
| `CompositionTimeline.tsx` | Ámbito explícito y foco; mantener handlers existentes sin duplicarlos. Incorporar navegación de B mediante controlador común. |
| `CompositionStudio.module.css` | Panel, teclas, foco, responsive y presentación en fullscreen. |
| `composition-preview-protocol.ts` | Evento limitado desde iframe y configuración de disponibilidad enviada al runtime. |
| `composition-preview-compiler.service.ts` | Integrar adaptador del runtime sin mezclar su lógica dentro del compilador. |
| `__tests__/` y `qa/` en servicios | Pruebas de política, catálogo, protocolo y contrato de runtime; ampliar fixtures cuando aporte cobertura. |

Flujo de ejecución:

1. Página: evento → filtro de foco/tecla → política → acción existente.
2. Iframe: evento → filtro local → intención validable → padre → política → misma acción existente.
3. Runtime: confirma estado → UI actualiza reproducción y disponibilidad.

Un evento del iframe no ejecuta reproducción localmente y después en el padre. Sólo existe un propietario de la decisión. El catálogo describe comandos, pero no debe convertirse en un bus genérico o en un framework de plugins.

## 5. Secuencia de trabajo y entregables

### Paso 0 — Línea base y caracterización

- Comprobar cambios locales, instrucciones del repositorio y estados reales del preview.
- Capturar comportamiento actual del botón: play/pause, buffering, preview desactualizado, final de video y guardado.
- Identificar estados de menú, diálogos, drag, trim y scrub que deben suspender teclado; propagar sólo las señales faltantes.
- Verificar generación/caché del preview para que una composición ya creada reciba el runtime actualizado al cargar. Identificar si requiere invalidación por versión de compilador; no asumir que cambiar el archivo recompila HTML persistido.
- Registrar resultados y fallos preexistentes antes de modificar.

Salida: invariantes confirmadas y lista acotada de integración. No condicionar el desarrollo a reparar problemas ajenos.

### Paso 1 — Catálogo y políticas

- Definir IDs iniciales: alternar reproducción y abrir ayuda.
- Catalogar flechas, Shift+flechas, Tab/Shift+Tab, activación de botones y flechas del separador con sus ámbitos reales.
- Definir discriminación por combinación exacta, foco, editable, disponibilidad y repetición.
- Extraer el bloqueo de transporte para que UI y comandos consuman el mismo resultado.
- Añadir pruebas de combinaciones y contextos; no introducir registros por tecla ni peticiones de red.

Aceptación: entradas documentadas no crean listeners; ningún comando activo carece de descripción; combinaciones no soportadas permanecen sin consumir.

### Paso 2 — Espacio en el documento padre

- Crear hook contextual y conectarlo a la acción existente.
- Hacer enfocables las superficies pertinentes con foco visible; nunca robar foco a formularios al hacer clic.
- Compartir disponibilidad y tooltip del transporte; añadir `aria-label` y `aria-keyshortcuts`.
- Resolver pulsaciones rápidas con una intención pendiente mínima, conservando el estado confirmado del runtime. Reducir los toggles sobre la intención más reciente, no sobre un cierre React obsoleto.
- Durante recarga/no listo, conservar bloqueo y descartar nuevas acciones; no encolarlas para reproducir más tarde.
- Limpiar intención pendiente al confirmar, fallar, cambiar de composición o desmontar. Usar la recuperación existente y un plazo explícito si la confirmación puede faltar; evitar bloqueos permanentes.

Aceptación: teclado y botón usan el mismo controlador; mantener Espacio no alterna repetidamente; escribir no afecta playback; no hay doble activación en botones.

### Paso 3 — Cobertura del iframe

- Extender el protocolo con una intención de shortcut que sólo admita los IDs implementados. Incluir identificación de la sesión de preview para rechazar mensajes de una recarga anterior.
- Verificar ventana emisora, sesión, versión y esquema antes de resolver comandos. Un ID válido no salta las condiciones de disponibilidad.
- Enviar al iframe el estado mínimo necesario para consumir atajos coherentemente: sesión, ámbitos habilitados y bloqueo contextual. Revalidar siempre en el padre.
- Generar el filtro del runtime desde la misma definición serializable cuando sea práctico. Si el entorno obliga a adaptaciones, cubrir paridad con pruebas de contrato.
- No reenviar eventos DOM completos ni contenido escrito. Mantener el sandbox y los controles de `postMessage` existentes; tratar correctamente el origen opaco.
- Revisar todos los mensajes de configuración y fixtures que deban incorporar nuevos campos/defaults. Definir transición compatible si padre y HTML cacheado pertenecen a versiones distintas.

Aceptación: seleccionar una capa y pulsar Espacio ejecuta exactamente una acción; ventanas ajenas y sesiones antiguas se ignoran; un HTML anterior no rompe el preview; el runtime sin configuración no instala atajos activos por defecto.

### Paso 4 — Pestaña «Atajos»

- Añadir tercer tab junto a Propiedades y SofLIA, botón de toolbar y apertura contextual mediante `?`.
- Mantener montado el formulario de Propiedades al cambiar de tab y ocultarlo sin dejar controles en el recorrido de foco. Conservar sincronización por clip; no preservar accidentalmente valores de otro clip.
- Separar cerrar ayuda de `clearSelection`. Recordar tab y foco anteriores; si el origen ya no existe, enfocar la superficie válida del editor.
- Renderizar el catálogo agrupado, combinaciones con `kbd`, descripción, contexto y búsqueda. Mostrar sólo accesos habilitados en esa versión.
- Aplicar patrón accesible de tabs; proteger las flechas propias de la barra de tabs frente a navegación temporal.
- Resolver ayuda en fullscreen dentro del elemento que ocupa la pantalla. Si se usa un portal, montarlo en ese contenedor y compartir el mismo componente y estado; evitar dos paneles activos y IDs duplicados.
- Incorporar el botón en vista estrecha con etiqueta accesible y tamaño utilizable.

Aceptación: ayuda accesible sin selección; volver a Propiedades conserva entradas no guardadas; búsqueda no dispara comandos; selección y reproducción permanecen iguales; cierre restaura foco; ayuda visible en fullscreen.

### Paso 5 — Validación y entrega A

- Ejecutar pruebas nuevas, regresiones relevantes y checks estáticos.
- Verificar en navegador real canvas/iframe, botones, chat, inspector, timeline, fullscreen y audio.
- Registrar qué entornos se probaron y cuáles quedan pendientes; corregir bloqueos antes de declarar A completa.
- Actualizar análisis/catálogo con las asignaciones efectivamente implementadas, sin listar candidatos futuros como disponibles.

### Paso 6 — Navegación y herramientas: entrega B

Dependencia: entrega A aceptada.

- Home/End: desde timeline, pausar y posicionar en cero/duración; preservar límites y FPS actuales.
- PageUp/PageDown: pausar y buscar inicio de escena estrictamente anterior/posterior, sin envolver; ordenar/deduplicar límites para resolver empates.
- F: alternar fullscreen desde preview. Probar la activación de usuario al cruzar el iframe; si el navegador no la permite, ejecutar la solicitud desde el contexto con activación mediante una integración explícita o limitar el ámbito mostrado. No simular compatibilidad universal.
- G: alternar rejilla desde canvas.
- S: alternar snap desde canvas/timeline.
- Reutilizar callbacks y condiciones existentes; actualizar catálogo y ayuda en el mismo cambio.
- Mantener fuera de alcance letras cuando un control, campo, diálogo o ayuda tenga el foco.

Aceptación: límites y escenas correctos; ninguna tecla modifica documentos o audio; no se interceptan atajos del navegador; estado de los botones coincide con el efecto del atajo.

## 6. Estrategia de pruebas

| Nivel | Casos | Evidencia requerida |
| --- | --- | --- |
| Unitario de política | Estados, contexto, modifiers, repeat, IME, combinaciones y entradas documentadas | Tests nuevos compilados con infraestructura existente. |
| Contrato | Mensajes válidos/ajenos, sesión anterior, versión incompatible y configuración | Tests de `composition-preview-protocol` y del adaptador. |
| Integración de transporte | Intención pendiente, ráfagas, pausa en buffering, recarga, desmontaje | Pruebas de transición con orden de eventos controlado. |
| Runtime | HTML generado y configuración coherente, scripts sin activar fuera de preview | Fixture y smoke existente ampliados. |
| UI/navegador real | Foco, keydown/keyup nativos, iframe, ayuda, estado del inspector, fullscreen, autoplay | Checklist reproducible y registro de entorno/resultados. |
| Regresión B | Navegación a límites/escenas y estado de herramientas | Pruebas de navegación pura y comprobaciones de interfaz. |

Comandos existentes, desde `apps/web`:

- `npm run test:composition-preview-sync`
- `npm run test:composition-timeline`
- `npm run qa:composition-preview-runtime`

Añadir `test:composition-shortcuts` a `apps/web/package.json` para compilar mediante `tsconfig.hyperframes-test.json` y ejecutar los nuevos tests de servicios. Ese tsconfig no cubre por sí solo los hooks/componentes TSX: ejecutar además comprobación de tipos del frontend y ESLint de archivos modificados. Ejecutar build de producción al cerrar la integración completa; distinguir fallos preexistentes o ambientales.

No añadir un runner E2E de forma automática. El smoke actual usa `--dump-dom` y un marcador, por lo que no prueba por sí mismo eventos de teclado confiables ni activación de fullscreen. Usar pruebas manuales reproducibles o la herramienta de navegador disponible para esos casos; si se necesita automatización permanente adicional, justificarla como trabajo separado.

Matriz objetivo: Chrome/Edge en Windows; Chrome/Safari en macOS; teclados español/inglés; sólo teclado y lector de pantalla. Si un entorno no está disponible, consignarlo como pendiente, no como aprobado.

## 7. Criterios de terminado y despliegue

### Entrega A

- [ ] Espacio funciona en superficies elegibles de página e iframe.
- [ ] Botón y teclado comparten acción, disponibilidad y recuperación.
- [ ] No hay scroll accidental, repetición de toggles ni dobles activaciones.
- [ ] Campos, botones, menús, gestos, diálogos y teclados IME conservan su comportamiento.
- [ ] Buffering, recarga y pulsaciones rápidas no reactivan una intención cancelada.
- [ ] Pestaña visible, consultable, accesible y coherente con comandos existentes.
- [ ] Cambios no guardados de Propiedades sobreviven al cambio de tab.
- [ ] Ayuda no deselecta clips y funciona en fullscreen.
- [ ] Se conserva el sandbox; mensajes antiguos/ajenos se rechazan.
- [ ] Fixtures, checks y validación de navegador documentados.

### Entrega B

- [ ] Navegación temporal cumple límites y pausa definida.
- [ ] F, G y S operan sólo en el ámbito anunciado.
- [ ] Catálogo, tooltip y handler coinciden.
- [ ] Las regresiones de A siguen cubiertas.

Despliegue: cambios pequeños por pasos, entregas funcionales completas A y B. Comprobar disponibilidad de runtime actualizado en previews existentes. Si el entorno usa rollout gradual, ocultar y desactivar juntos entradas y handlers; no añadir una bandera sin necesidad de despliegue real.

Rollback: revertir integración de comandos y adaptador, conservando controles por botón. Mantener tolerancia de mensajes durante transición de cachés. No requiere migraciones ni restauración de datos.

Observabilidad: reutilizar errores y métricas existentes del preview; opcionalmente diferenciar origen botón/teclado en eventos ya emitidos. No recolectar teclas ni texto del usuario. Ningún evento de navegación ordinaria debe crear tráfico o registros de servidor nuevos.

## 8. Riesgos residuales y evolución

- El comportamiento de reproducir desde el final permanece igual en A. Mejorarlo después mediante una acción común y pruebas para ambos accesos.
- La activación de fullscreen desde iframe depende del navegador y debe validarse antes de anunciar F en ese ámbito.
- Deshacer/rehacer general debe diseñarse antes de ofrecer atajos de eliminación o edición intensiva. Historial de versiones y deshacer de propuestas no se presentarán como sustitutos de esa función.
- Persistir preferencias, remapear teclas y añadir modos avanzados sólo cuando exista demanda; el catálogo pequeño permite extender sin acoplar lógica de negocio a la UI.

Orden ejecutable: caracterización → catálogo/políticas → transporte padre → puente iframe → pestaña → QA de A → navegación/herramientas → QA de B. No se requiere nueva decisión del usuario para concretar los detalles rutinarios descritos cuando autorice la implementación.
