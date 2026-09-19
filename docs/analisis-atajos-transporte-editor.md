# Análisis de atajos de transporte del editor

Fecha: 2026-09-17. Estado: análisis de referencia; implementación y resultados de validación registrados en `plan-implementacion-atajos-editor.md`.

## 1. Entendimiento del objetivo

Habilitar operaciones frecuentes de reproducción mediante teclado, comenzando por Espacio para reproducir/pausar, como propone el SME. Este documento aplica los criterios de `prompt_maestro.md`: correctitud, separación de responsabilidades, seguridad, compatibilidad y validación antes de implementar.

El alcance analizado es el editor de composición que `HyperframesCompositionPanel` monta mediante `NativeCompositionPreview`. Las referencias históricas a Remotion no describen por sí solas este flujo actual. No se propone reemplazar el motor, modificar render, persistir atajos en Supabase ni incorporar una biblioteca para una sola tecla.

Método: inspección estática del repositorio, del paquete instalado `@hyperframes/studio` 0.7.106 y de fuentes oficiales públicas. No se ejecutó una sesión interactiva de los editores ni pruebas funcionales. Se distinguen comportamientos encontrados y decisiones propuestas.

## 2. Diagnóstico técnico y comparación

### Referencias externas

| Editor y evidencia | Reproducción | Navegación y funciones relacionadas | Aplicación a Courseforge |
| --- | --- | --- | --- |
| Hyperframes 0.7.106, código instalado | Espacio alterna reproducción; K pausa; J/L reproducen atrás/adelante con velocidades 1x, 2x y 4x | Flechas: un fotograma; Shift+flechas: diez; K+J/L: un fotograma; I/O: puntos de entrada/salida; Shift+L: bucle; M: silencio | Referencia directa para separar filtrado de eventos y acciones de transporte. No importar su hook: depende de sus stores, adaptadores y modos de edición. |
| Adobe Premiere, documentación oficial | Espacio reproduce/detiene; L inicia reproducción desde el cursor | La documentación de atajos contempla operaciones de navegación y edición, con contexto propio | Respalda la elección de Espacio, pero sus comandos no implican que nuestro motor soporte las mismas capacidades. |
| Final Cut Pro, documentación oficial | Espacio reproduce/detiene; J reversa, K pausa y L avanza | Pulsaciones J/L aumentan velocidad; K+J/L avanza por fotogramas; reproducción de selección y bucle | Distinguir alternar reproducción de pausar y de navegar a otra posición. |
| Clipchamp, documentación oficial del editor | Espacio reproduce/pausa | Flechas mueven el cursor; Ctrl/Cmd+flecha va al inicio/final; Ctrl/Cmd+/ muestra atajos | Referencia web útil para descubribilidad y navegación. La documentación consultada no especifica aquí la unidad temporal de las flechas. |

Fuentes oficiales consultadas:

- [Adobe: reproducción de la secuencia activa](https://helpx.adobe.com/premiere/desktop/render-and-export/render-sequences-for-playback/play-active-sequence-in-program-monitor.html).
- [Apple: reproducción y J/K/L](https://support.apple.com/en-nz/guide/final-cut-pro/ver90ba4ef0/mac).
- [Microsoft: atajos del editor Clipchamp](https://support.microsoft.com/en-us/clipchamp/keyboard-shortcuts-for-clipchamp).
- Hyperframes: `node_modules/@hyperframes/studio/src/player/hooks/usePlaybackKeyboard.ts` y `src/player/lib/playbackShortcuts.ts`, versión confirmada en su `package.json`. La guía pública apareció en búsquedas, pero su apertura falló; las afirmaciones detalladas de esta tabla proceden del código local, no de una prueba del sitio actual.

Hallazgos específicos de Hyperframes:

- Descarta eventos ya consumidos y protege inputs, textarea, select, botones, enlaces, contenido editable y diversos controles ARIA.
- Da prioridad al movimiento de elementos del canvas frente al avance por fotogramas con flechas.
- Intenta conectar listeners al documento y ventana del iframe cuando tiene acceso.
- En la versión inspeccionada, el filtro `repeat` aparece después de la rama de Espacio: esa rama no impide por sí misma alternancias por repetición. Conviene prevenirlo explícitamente en Courseforge.
- Usa `key` para letras y `code` para Espacio/flechas. No conviene ligar futuras letras a posiciones físicas del teclado sin una decisión de producto.

Conclusión comparativa: Espacio tiene amplio respaldo; el foco determina cuándo debe actuar. J/K/L, bucles y rangos requieren capacidades y estados adicionales, por lo que no deben entrar automáticamente en la primera entrega.

### Estado real de Courseforge

| Hallazgo | Evidencia | Consecuencia |
| --- | --- | --- |
| Existe una acción común de reproducción | `NativeCompositionPreview.tsx`, `togglePreviewPlayback` | Reutilizarla y centralizar sus condiciones; no invertir un booleano desde un listener independiente. |
| El transporte considera reproducción y buffering | `transportActive = playing || previewMediaState === "BUFFERING"` | Durante buffering, Espacio debe solicitar pausa y cancelar la intención de continuar. |
| Reproducir puede refrescar un preview desactualizado | `togglePreviewPlayback` llama a `refreshPreviewDocument(true, "DIRTY_PLAYBACK")` | Enviar `play` directamente desde teclado omitiría esta lógica. |
| El botón tiene restricciones | `CompositionPreviewViewport.tsx`: `saving`, `!previewReady`, `PREPARING` | La política debe ser compartida por botón y teclado, no duplicada en condiciones que puedan divergir. |
| El preview usa iframe aislado | `sandbox="allow-scripts"` | El teclado dentro del canvas no llega al documento padre; no se puede adoptar el acceso directo al DOM usado por Hyperframes. |
| Ya existe mensajería validada | `composition-preview-protocol.ts`; comprobación de `event.source` en ambos lados | Extender este contrato con una intención de transporte limitada, conservando el aislamiento. |
| Hay atajos locales existentes | `CompositionTimeline.tsx`, regla temporal con `role="slider"` | Flechas desplazan un fotograma; Shift+flechas usa `stepCompositionFrame` para aproximadamente un segundo. Conservarlos. |
| Otros controles ya usan teclado | Separador de paneles con flechas verticales; menú con Escape | Prioridad del control enfocado; evitar un capturador global que los intercepte. |
| Final de composición se pausa en la duración | Runtime en `composition-preview-compiler.service.ts` | `play()` no rebobina explícitamente. La lectura sugiere que reproducir al final vuelve a detenerse enseguida; requiere comprobación de navegador. |

El componente principal ya concentra muchas responsabilidades. Añadir la política completa de atajos dentro de él aumentaría el acoplamiento. Conviene extraer únicamente las piezas de transporte necesarias, sin una refactorización general.

## 3. Plan de implementación propuesto

Primera entrega: Espacio en preview y timeline, con foco, estados y mensajería definidos. Preservar la navegación existente. No añadir en esta entrega J/K/L, silencio, bucles, personalización ni marcadores.

Separación mínima:

1. Política pura de transporte: decide si se acepta la acción según disponibilidad, bloqueo y estado actual. Compartida por botón y atajo.
2. Hook de teclado del editor: maneja alcance, foco, modificadores, composición de texto, repetición y limpieza de listeners.
3. Controlador existente: sigue decidiendo entre pausa, reproducción y actualización previa del preview.
4. Adaptador dentro del iframe: reconoce exclusivamente el atajo permitido y transmite una intención semántica al padre. No ejecuta simultáneamente play/pause ni transmite texto escrito.
5. Presentación: indica el atajo y mantiene el estado accesible del botón.

Archivos previsiblemente afectados al implementar:

- Nuevos módulos pequeños de política de transporte y hook de teclado, junto a los servicios/componentes de composición correspondientes.
- `NativeCompositionPreview.tsx`: integración y acción compartida.
- `CompositionPreviewViewport.tsx`: disponibilidad, etiqueta y ayuda del botón.
- `CompositionTimeline.tsx`: alcance enfocable y excepción explícita de Espacio en la regla temporal.
- `composition-preview-protocol.ts`: evento tipado de intención desde el iframe.
- `composition-preview-compiler.service.ts`: inclusión del adaptador de teclado del runtime; preferiblemente generado desde un módulo separado.
- Tests del protocolo/política y pruebas reales de navegador del iframe.

No se necesitan nuevas tablas, endpoints, dependencias, permisos ni modificaciones de exportación. Play/pause no debería crear versiones del documento ni entradas de historial de deshacer. El refresco de un preview desactualizado mantiene su flujo actual y su coste existente.

## 4. Contrato de comportamiento propuesto

### Asignaciones y alcance

| Entrada o contexto | Resultado esperado |
| --- | --- |
| Espacio sin modificadores, editor enfocado y preview listo/pausado | Reproducir desde el cursor usando la misma acción del botón. |
| Espacio durante reproducción | Pausar sin modificar el cursor ni la selección. |
| Espacio durante buffering, transporte habilitado | Cancelar la intención de reproducción; permanecer pausado al terminar la carga. |
| Espacio con preview desactualizado | Seguir el refresco y reproducción que ya aplica el botón. |
| Tecla mantenida | Una transición por pulsación física; consumir repeticiones del atajo aceptado para evitar scroll, sin volver a alternar. |
| Shift/Ctrl/Alt/Meta+Espacio, IME o evento consumido | No tratarlo como atajo de transporte. |
| Chat, campo editable, selector, botón o control interactivo | Conservar la operación propia del control. |
| Botón de reproducción enfocado | Espacio activa el botón mediante su comportamiento nativo; el hook no añade una segunda ejecución. |
| Regla temporal del timeline enfocada | Excepción explícita: Espacio controla transporte; las flechas mantienen la navegación actual. Otros sliders conservan su semántica. |
| Modal o menú abierto, arrastre/recorte/scrub activo | Suspender el atajo contextual; no iniciar reproducción accidentalmente. |
| Preview preparando, no listo o guardando | Mantener la indisponibilidad actual del botón. Una futura excepción para permitir pausa durante guardado debe cambiar ambos accesos a la vez. |
| Foco fuera del editor | No ejecutar transporte ni impedir el comportamiento de la página. |
| Foco dentro del canvas del iframe | Aplicar la misma política a través del puente, con una sola ejecución. |
| Pantalla completa | Mantener transporte; Escape conserva su función de salir. |

La selección de un clip no equivale a foco de transporte. Los contenedores de canvas/timeline deben poder recibir foco por teclado y mostrarlo. Un clic en una superficie no interactiva puede enfocar esa superficie; no debe robarse el foco del inspector o del chat.

Detección: `code === "Space"`, con fallback acotado a `key === " "` si hiciera falta por compatibilidad. Registrar en `keydown`; bloquear repetición; respetar `defaultPrevented` e `isComposing`. Evitar cancelar eventos de controles excluidos. `preventDefault()` sólo corresponde a eventos que el ámbito de transporte reconoce y consume.

Accesibilidad: etiqueta dinámica «Reproducir»/«Pausar», `aria-keyshortcuts="Space"`, ayuda visible «Espacio: reproducir/pausar» y tooltip. Mantener Tab/Shift+Tab y la activación nativa. El patrón de botones de [W3C APG](https://www.w3.org/WAI/ARIA/apg/patterns/button/) respalda conservar Espacio/Enter en botones enfocados. No anunciar el tiempo a lectores de pantalla en cada fotograma.

### Iframe, estados y eventos asíncronos

Un listener sólo en el padre dejaría incompleto el requisito al seleccionar una capa. Agregar `allow-same-origin` para facilitarlo relajaría innecesariamente el aislamiento; tampoco conviene una capa transparente que impida la edición del canvas.

Propuesta: el iframe emite un evento limitado, por ejemplo una intención `TOGGLE_PLAYBACK`. El padre valida esquema, versión, ventana emisora, instancia activa y política de disponibilidad antes de usar el controlador común. El iframe necesita conocer cuándo el ámbito está habilitado para consumir el atajo coherentemente; puede extenderse la configuración existente del editor. El padre debe revalidar aunque esa configuración esté desactualizada.

Los eventos de teclado no se transportan completos. No registrar texto, ni comandos arbitrarios, ni usar la mensajería como mecanismo de autorización. Mantener `event.source === frameRef.current?.contentWindow`; descartar eventos de previews antiguos. El sandbox produce un origen opaco: validar sólo una cadena de origen no identifica al iframe. Revisar dirección y origen de cada mensaje sin sustituir mecánicamente `"*"` por el dominio de la aplicación. Referencia: [MDN sobre postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage).

El estado confirmado del runtime debe seguir siendo la referencia visual. Para pulsaciones rápidas antes de que llegue la confirmación, serializar la transición o mantener una intención pendiente mínima: no usar un cierre React obsoleto para producir dos órdenes de reproducción. Resolver la espera al confirmar estado, fallar o desmontar; cualquier timeout debe ser explícito y permitir recuperación. No introducir un bus genérico de comandos.

Un play que fuerza recarga requiere el mismo cuidado: evitar recargas duplicadas y no dejar que una intención antigua reactive el preview tras cambiar de composición. La cancelación durante recarga debe definirse junto con la disponibilidad del botón; el MVP conserva su bloqueo actual.

Al final del video, recomiendo que una acción futura compartida por botón y teclado vuelva al inicio y reproduzca. Esto es un ajuste adicional de semántica, no un efecto implícito del atajo. Si no entra en alcance, conservar y documentar el comportamiento actual, validándolo manualmente antes de cerrar la entrega.

## 5. Riesgos y validaciones

| Validación | Nivel | Riesgo cubierto |
| --- | --- | --- |
| Pausado → reproducción → pausa; cursor conservado | Integración y navegador | Acción incorrecta o pérdida de posición. |
| Tecla mantenida y pulsaciones rápidas | Unitario + navegador | Repetición, scroll y estado asíncrono obsoleto. |
| Chat, input numérico, textarea, contenido editable anidado, select y roles ARIA | Unitario + navegador | Interferencia con escritura/edición/accesibilidad. |
| Botón de transporte enfocado y otros botones | Navegador | Doble activación o pérdida de semántica nativa. |
| Regla temporal, otros sliders y separador | Navegador | Conflictos con atajos existentes. |
| Clic y foco en capa del iframe; modo pantalla completa | Navegador real | Cobertura incompleta por aislamiento del iframe. |
| PREPARING, BUFFERING, error, guardado y preview desactualizado | Integración | Reproducción inesperada, bloqueo permanente o contenido antiguo. |
| Recarga, cambio de lección, desmontaje y remontaje en Strict Mode | Integración | Listeners duplicados y mensajes de instancias viejas. |
| Mensajes inválidos, versión incorrecta y ventana emisora ajena | Unitario/protocolo | Ampliación insegura de la frontera iframe. |
| Final de video, duración mínima y sin medios activos | Integración + navegador | Semántica ambigua en límites temporales. |
| Medios con audio y bloqueo de autoplay | Navegador real | El mensaje al iframe no garantiza por sí solo permiso de reproducción audible. Conservar el flujo de desbloqueo existente. |
| Preview, cursor y audio tras pausar durante buffering | Navegador real | Reanudación tardía o desincronización. |

Plataformas: Chrome/Edge en Windows y Safari/Chrome en macOS; teclados español e inglés; navegación sólo con teclado y una comprobación con lector de pantalla. Una prueba DOM simulada no sustituye la verificación del sandbox, audio, fullscreen o acciones nativas.

Al implementar: añadir pruebas específicas, ejecutar `test:composition-preview-sync` y `test:composition-timeline` desde `apps/web`, y las comprobaciones de tipos/lint acordes a los archivos modificados. Revisar el smoke de runtime existente para ampliarlo con teclado real si su infraestructura lo permite. No afirmar cobertura de navegador únicamente por aprobar suites de servicios.

Criterio de aceptación: una pulsación elegible produce exactamente una transición; funciona en canvas y timeline; respeta los controles enfocados; comparte disponibilidad y acción con el botón; conserva el sandbox y los comportamientos actuales de actualización/guardado.

Performance: filtrado barato por evento, sin polling ni nuevas peticiones por tecla. No hacen falta pruebas de carga de backend para este cambio local. Usar la telemetría existente de reproducción para errores y latencia cuando aplique; no enviar registros por cada tecla.

Reversibilidad: revertir la integración del hook y del adaptador deja disponibles los botones; no hay migraciones ni datos que restaurar. Una bandera específica sólo se justifica si el despliegue exige habilitación gradual.

## 6. Mejoras adicionales recomendadas

Después del MVP, en orden de utilidad:

1. Resolver explícitamente la reproducción al llegar al final y aplicarla de forma común a botón/teclado.
2. Pestaña de atajos contextual y pruebas de accesibilidad del transporte completo. Por solicitud posterior, la pestaña pasa al alcance inicial descrito en la ampliación siguiente.
3. Inicio/final y escena anterior/siguiente, definiendo si pausan o conservan reproducción y evitando conflictos con controles enfocados.
4. Evaluar J/K/L sólo con soporte validado de reversa, velocidad y sincronización de audio. No ofrecer J como salto fijo si se presenta como transporte profesional.
5. Personalización de atajos cuando exista demanda; no requiere persistencia ni configuración de usuario en la primera versión.

Decisión recomendada: adoptar Espacio con alcance contextual, reutilizar el transporte existente y cubrir el iframe desde el principio. El esfuerzo principal es garantizar foco y coherencia de estados, no reconocer una tecla.

## 7. Ampliación: otros atajos útiles y pestaña de consulta

Solicitud adicional: evaluar más accesos rápidos e incorporar al diseño una pestaña que muestre todos los disponibles. Esta sección amplía la propuesta inicial; sigue siendo análisis previo a codificación. La pestaña se incluye desde la primera entrega, sin esperar a disponer de todos los atajos candidatos.

### 7.1 Selección por utilidad y madurez de la función

Las asignaciones siguientes son propuestas propias para Courseforge, no una afirmación de que todos los editores las utilicen. "Existente" significa encontrado en el código actual; "propuesto" aún requiere implementación y validación.

| Acción | Tecla propuesta | Estado y prioridad | Alcance y comportamiento |
| --- | --- | --- | --- |
| Reproducir/pausar | Espacio | Propuesto, primera entrega | Canvas/timeline; política descrita arriba. |
| Fotograma anterior/siguiente | ← / → | Existente | Regla temporal enfocada; conservar un fotograma según los FPS del documento. No ampliar al canvas sin resolver conflictos con movimiento de capas. |
| Retroceder/avanzar aproximadamente un segundo | Shift+← / Shift+→ | Existente | Regla temporal enfocada; conservar el cálculo actual, alineado a fotogramas. |
| Inicio/final de composición | Home / End | Propuesto, siguiente prioridad | Timeline enfocado; pausar y posicionar en el límite. En el final se debe documentar si el cursor indica duración total o último fotograma visible. Mantener inicialmente el límite de duración que ya usa el editor. |
| Escena anterior/siguiente | PageUp / PageDown | Propuesto, siguiente prioridad | Timeline enfocado; pausar y buscar el inicio de escena estrictamente anterior/posterior al cursor; no envolver al llegar a extremos. Resolver empates de forma determinista. |
| Pantalla completa del preview | F | Propuesto, siguiente prioridad | Superficie del preview enfocada; alternar la función existente. Verificar activación del navegador cuando la tecla nace dentro del iframe. Mantener botón como acceso alternativo. |
| Mostrar/ocultar rejilla | G | Propuesto, siguiente prioridad | Canvas enfocado; reutilizar estado actual de rejilla. |
| Activar/desactivar snap | S | Propuesto, siguiente prioridad | Canvas/timeline enfocado; misma configuración del botón Snap. Reservar S para snap y evitar asignarla también a dividir. |
| Abrir pestaña Atajos | ? | Propuesto, primera entrega | Superficie canvas/timeline enfocada; reconocer el carácter con `key`, no Shift+/ físico. Siempre disponible también mediante un botón visible. |
| Cerrar interfaz contextual | Escape | Parcialmente existente; ampliar con cuidado | Menú o ayuda primero; fullscreen nativo conserva su salida. Una pulsación no debe cerrar varios niveles ni borrar la selección incidentalmente. |
| Navegar controles | Tab / Shift+Tab | Comportamiento nativo | Documentarlo, preservando recorrido de foco y evitando trampas. |
| Activar botón | Enter / Espacio | Comportamiento nativo | Botón enfocado; no disparar además un atajo global. |
| Redimensionar paneles | ↑ / ↓ | Existente | Separador preview/timeline enfocado; no son comandos de navegación temporal. |
| Dividir clip en el cursor | D | Candidato posterior | Sólo clip seleccionado, desbloqueado, cursor dentro de sus límites y edición habilitada. Reutilizar `splitSelectedClipAtPlayhead`; no repetir al mantener tecla. |
| Quitar clip de la timeline | Supr; equivalente Mac por validar | Candidato posterior | Requiere selección inequívoca, protecciones y recuperación verificable. No asignar Backspace globalmente. |

Inicio/final, escenas, F, G y S añaden valor con funciones ya próximas al flujo actual. Se pueden entregar después de estabilizar Espacio y su alcance. D y Supr alteran el documento: deben evaluarse en una entrega de edición, no activarse sólo porque exista una función invocable.

No se propone un atajo de teclado para cada botón. Acciones poco frecuentes o de alto impacto como publicar, renderizar, restaurar una versión o eliminar un intervalo completo seguirían usando controles explícitos.

### 7.2 Accesos que conviene posponer o evitar

| Candidato | Motivo y requisito previo |
| --- | --- |
| Ctrl/Cmd+Z y rehacer | Se encontraron `undoLastAgentProposal` y `undoLastCompositionPreset`, además de historial de versiones; no constituyen una pila general de deshacer/rehacer para todas las ediciones. Definir transacciones, granularidad, guardado y recuperación antes de prometer estos atajos. En campos de texto debe seguir funcionando el deshacer nativo. |
| Copiar/pegar/duplicar clips | Requiere contrato para identidades, referencias, animaciones, pistas y posición de pegado. No interceptar Ctrl/Cmd+C/V/D sin esa capacidad; Cmd/Ctrl+D además puede pertenecer al navegador. |
| Ctrl/Cmd+S | El editor mezcla guardado de parches y formularios con botón de guardar. Primero definir qué guardaría este comando y cómo maneja validación y cambios pendientes. |
| M para silencio | Distinguir silencio local del monitor de `muted`/volumen de pista, que modifica el documento. No usar una tecla aparentemente de reproducción para cambiar el audio exportado. |
| I/O y bucle | El intervalo de eliminación existente tiene efecto de edición; no es un rango de reproducción. Crear estados separados antes de ofrecer estos comandos. |
| J/K/L | Posponer el conjunto hasta validar reversa, velocidades y audio. K podría añadirse antes como pausa idempotente si hay demanda, pero aporta menos que navegación temporal al inicio. |
| + / − y 0 para zoom/encajar | El zoom actual inspeccionado corresponde al preview, no necesariamente al timeline. Definir destino y semántica de encajar; no interceptar Ctrl/Cmd+± del navegador. |
| Flechas para mover capas | Pueden resultar útiles, pero requieren reglas de foco, distancia, snap, repetición y agrupación del historial; deben coexistir con las flechas temporales. |

### 7.3 Pestaña «Atajos de teclado»

Ubicación propuesta: tercera pestaña del panel lateral, junto a «Propiedades» y «SofLIA». Etiqueta corta «Atajos» y título interno «Atajos de teclado». Un botón con icono de teclado y nombre accesible en la barra abre directamente la pestaña, incluso sin clip seleccionado ni inspector abierto. `?` realiza la misma acción desde las superficies de edición.

Contenido:

1. Explicación breve: «Los atajos funcionan cuando el área indicada tiene el foco. Mientras escribes, se conservan los controles del campo».
2. Buscador por acción o tecla, útil al crecer el catálogo.
3. Grupos: reproducción, navegación temporal, vista y herramientas, edición y navegación de la interfaz.
4. Cada fila muestra acción, combinación con elementos `kbd`, ámbito y condición cuando aplique. Ejemplo: «Avanzar un fotograma — → — Regla temporal enfocada».
5. Las acciones implementadas pero temporalmente indisponibles permanecen documentadas con el requisito correspondiente: «Requiere un clip seleccionado», por ejemplo. El motivo actual de bloqueo se puede mostrar adicionalmente.
6. El catálogo del producto sólo contiene accesos implementados. Las propuestas futuras de este documento no deben aparecer como si funcionaran. Al inicio incluirá Espacio, apertura de ayuda y los controles de teclado existentes verificados.

No presentar una tecla genérica sin su contexto: las flechas del separador, las del timeline y las de las pestañas hacen cosas distintas. Los futuros modificadores se muestran según plataforma y con una alternativa consultable Windows/macOS cuando difieran.

Interacción y accesibilidad:

- Abrir la pestaña no pausa automáticamente ni cambia clip, cursor, herramienta o selección.
- Llevar el foco al panel o a su encabezado/buscador de forma predecible; conservar el foco de origen para volver al cerrar ayuda.
- Mientras se escribe en el buscador, letras, Espacio, Home/End y flechas siguen perteneciendo al buscador.
- Escape desde la ayuda vuelve a la pestaña anterior o cierra el panel si se abrió sólo para ayuda; no deselecta el clip. El cierre actual del inspector llama a `clearSelection`, por lo que necesita separarse de esta operación de consulta.
- Mantener los valores no guardados del inspector al cambiar a Atajos. Actualmente el render alterna componentes: desmontar `CompositionInspector` puede perder su estado de formulario local. Mantenerlo montado e inactivo u organizar su estado por clip; no guardar automáticamente al abrir la ayuda.
- Aplicar `tablist`, `tab`, `tabpanel`, `aria-selected` y asociación de paneles, con navegación de pestañas mediante flechas y foco visible. Los paneles ocultos no deben quedar en el recorrido de Tab. Referencia: [W3C APG, patrón de pestañas](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/).
- En vista estrecha, usar el comportamiento adaptable del panel existente; comprobar que el tercer tab no se corte ni oculte su acceso.
- En fullscreen, el acceso a ayuda debe estar dentro del elemento fullscreen o seguir un comportamiento explícito de salida. No basta con abrir un panel fuera del subárbol visible.

Para F, G, S, D y `?`, exigir foco real en el componente correspondiente, no sólo una bandera de «último editor usado». Los atajos de caracteres deben poder desactivarse, reasignarse o limitarse al componente enfocado según [WCAG 2.1.4](https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html). La propuesta inicial utiliza la limitación por foco; no exige construir un editor de preferencias.

### 7.4 Arquitectura adicional justificada por el catálogo

Con varios atajos y una pestaña, un registro declarativo pequeño evita que la ayuda y el comportamiento diverjan. Cada entrada describe ID de acción, etiqueta, grupo, combinación, ámbito, repetición permitida y condición de disponibilidad. La ejecución permanece en los controladores existentes; el registro no concentra guardado ni lógica de edición.

Usar ese registro para el hook, textos de ayuda, tooltips y `aria-keyshortcuts` de los comandos nuevos. Los comportamientos nativos y handlers locales existentes se pueden catalogar como documentación sin volver a registrarlos: listar Tab o las flechas actuales no debe crear un segundo listener. Una prueba verifica correspondencia entre comandos habilitados y entradas visibles.

Para teclado de caracteres usar `key`; para controles físicos como flechas/Espacio puede usarse `code`. La representación visual de una combinación no debe reutilizarse como parser. El puente del iframe sólo admite IDs autorizados y revalida sus condiciones en el padre. Al añadir una acción de edición, su autorización no puede derivarse únicamente de haber recibido una tecla desde el iframe.

La prioridad debe ser explícita: control enfocado o diálogo → handler local de timeline/canvas → comando contextual aplicable. El foco manda, no la posición del mouse. Respetar `defaultPrevented` y no usar `stopPropagation` indiscriminadamente.

Cambios de módulos previstos, además de los ya indicados:

- Registro pequeño del catálogo de accesos y sus metadatos.
- Componente `CompositionShortcutsPanel` para búsqueda y agrupación.
- Integración del tercer tab y estado de apertura/cierre en el contenedor del editor.
- Conservación del estado del inspector al cambiar de pestaña.
- Acceso desde toolbar y solución de ubicación de ayuda en fullscreen.

### 7.5 Validación de esta ampliación y orden de entrega

Primera entrega recomendada: Espacio, puente iframe, pestaña Atajos, botón visible y `?`, con documentación de navegación existente. Segunda: Home/End, PageUp/PageDown, F, G y S. Tercera: D, borrado y otras mutaciones cuando haya recuperación definida. Esto amplía la hoja de ruta sin convertir todos los candidatos en requisitos inmediatos.

Casos de aceptación adicionales:

- Abrir ayuda sin selección y desde iframe, toolbar y teclado; cerrar restaura foco y mantiene selección/cursor.
- Escribir cambios aún no guardados en Propiedades, abrir Atajos y volver: se conservan los valores.
- Buscar «espacio», «fotograma», «snap» y símbolos; distinguir ausencia de coincidencias de ausencia de atajos.
- Ningún atajo futuro figura activo; cada acceso implementado aparece con su contexto.
- Una tecla con varios contextos ejecuta sólo el propietario enfocado; flechas navegan tabs cuando el foco está en tabs.
- `?` funciona según carácter en teclados español e inglés, sin asumir una ubicación física fija.
- Home/End en un campo no mueve el playhead; F/G/S al escribir no cambian el editor.
- Navegación por escenas resuelve extremos, huecos y límites compartidos sin saltos circulares inesperados.
- Repetición: permitida de forma deliberada para navegación; ignorada para toggles, ayuda y mutaciones.
- Fullscreen mantiene ayuda visible y foco recuperable; verificar por navegador las restricciones de activación de F desde iframe.
- Tab/Shift+Tab recorren sólo el panel visible; lector de pantalla identifica la pestaña activa y las combinaciones.

La entrega actual actualiza exclusivamente este análisis. No habilita atajos ni añade todavía la pestaña a la aplicación.
