# Plan de implementación: búsqueda y extracción desde palabras y escenas

Fecha inicial: 2026-10-05. Estado: implementación completada, pendiente de QA y rollout autorizado; consultar cierre y handoff al final. QA no aprobado.

## 1. Objetivo y alcance

Ampliar «Guion y visuales» para encontrar una explicación, escuchar su intervalo y reutilizar un fragmento sin volver a localizarlo manualmente en el timeline. Mantener escenas, navegación por palabra, selección, transporte, documento, historial y guardado existentes.

Este plan complementa el [catálogo funcional](SOFLIA_EDITOR_FUNCTIONAL_TOOLS_RESEARCH.md) y su [auditoría de duplicación](SOFLIA_EDITOR_TOOL_DUPLICATION_AUDIT.md). No crea nuevas CAPs, modifica porcentajes ni reasigna trabajo del otro flujo.

### Entregas explícitas

1. Buscar literalmente en títulos/guion y palabras disponibles; resultados navegables y resaltados.
2. Seleccionar palabras consecutivas de una ocurrencia concreta, ajustar límites y preescuchar con el transporte actual.
3. Extraer una copia temporal no destructiva de esa toma al final de la composición, con fuente original intacta.
4. Ampliar a un fragmento audiovisual coherente, incluyendo captions compatibles, después de validar las restricciones de edición existentes.

«Extraer» significa crear nuevos clips que referencian assets existentes; no descargar/exportar un MP4, crear un asset procesado ni eliminar la frase original. La primera extracción puede ser de voz, etiquetada expresamente como tal; no se anunciará como extracción audiovisual completa.

Fuera de alcance: STT nuevo, búsqueda semántica/LLM, corrección del texto pronunciado, eliminar frases, ripple destructivo, acortar pausas, guardar fragmentos entre proyectos, montaje de rangos disjuntos, nuevo player y exportador independiente. Estos cambios necesitarían planes separados.

## 2. Diagnóstico basado en código

Prefijos: UI = `apps/web/src/domains/materials/components/composition-editor/`; dominio = `apps/web/src/domains/production/composition-editor/`.

| Evidencia actual | Qué se conserva | Qué falta para esta entrega |
|---|---|---|
| UI `CompositionNarrativePanel.tsx` | Listado de escenas, seek por palabra, selección de visuales y preensamble | Consulta, resultados, selección de rango y acciones de extracción |
| Dominio `composition-scene.service.ts` | Proyección con inicio de clip y source offset; escenas derivadas del documento | Identidad de ocurrencia/token/fuente y validación específica del intervalo |
| Dominio `composition-narrative.types.ts` | Guion, scriptHash y wordTimestamps | Vinculación inequívoca de timestamps al asset/revisión; integridad temporal para operaciones de extracción |
| Dominio `composition-narrative-source.service.ts` | Entrega timestamps cuando el hash de voz coincide con guion | No confundir esa coincidencia con prueba de transcripción exacta ni asumir identidad del asset a partir de ella |
| Dominio `editor-patch.types.ts`, `editor-patch.service.ts` | add/trim/split, validación del documento y restricciones | Componer un plan de extracción y comprobar todas sus precondiciones en servidor |
| Dominio `composition-selection-clipboard.ts`, servicios de placement | Identidad, límites y colocación ya existentes | Selección textual no es clipboard de clips enteros; adaptar solo el intervalo |
| UI `NativeCompositionPreview.tsx` | Integración, savePatch y transporte | Wiring del controlador nuevo, no incrustar búsqueda/planning en este archivo |

Riesgos concretos:

- `wordCues` expone palabra/inicio/fin, sin clipId ni índice original. Una frase repetida o clip duplicado puede apuntar a la ocurrencia equivocada.
- La proyección actual depende de voces de la escena y offset. No habilitar extracción solo porque un cue tiene dos números; verificar asset actual, origen, revisión y transformaciones.
- Las escenas sin media reciben tiempos estimados de planificación. Sirven para navegación aproximada, no para cortar una palabra pronunciada.
- Buscar texto del guion no acredita que ese texto esté en el audio. Caption corregido, guion y transcripción deben mantener etiquetas distintas.
- Extraer video exige conservar voz/avatar vinculados, captions, animaciones, fades y transiciones. Copiar geometría y cambiar duración no basta.
- El modelo permite hasta 250 escenas y 20 000 tokens por escena: no renderizar/indexar el máximo teórico sin presupuestos.

## 3. Coordinación con CAPs del otro flujo

Fuente de coordinación: [registro de requisitos](SOFLIA_ENGINE_MULTIMEDIA_EDITOR_ROADMAP_REQUIREMENTS_TRACKER.md), corte 2026-10-05. Los estados son los registrados, no recertificados por este plan.

| CAP/base | Relación | Regla para no duplicar ni bloquear innecesariamente |
|---|---|---|
| CAP-009 / CAP-010 | Historial, recuperación y OCC registrados completos; falta QA | Un lote editorial, undo/redo existentes, hash/revisión actuales. No segundo journal |
| CAP-004 / CAP-003 | Operaciones masivas/placement existentes, con restricciones | Reutilizar validadores y linked groups. Una restricción se rechaza con explicación; no relajarla para extraer |
| CAP-026 | Preview incremental registrado completo; falta QA | Reutilizar ACK/runtime y protocolo. La búsqueda es lectura; el apply es edición normal |
| CAP-027 | Conformidad parcial, 85% estimado en el registro | Añadir casos de offsets/duración/captions al corpus cuando corresponda. No crear otro gate ni afirmar paridad antes de evidencia; su cierre global no bloquea diseñar búsqueda |
| CAP-023 | Identidad/replace/relink existentes; falta QA | Resolver asset autorizado y revalidar tras replace. No duplicar media bin |
| CAP-015 / CAP-024 | Captions/presets parciales según requisitos | Consumir reglas de cues actuales; coordinar cambios de contrato de captions, no reimplementar segmentación |
| CAP-021 | Rate/freeze experimental acotado | V1 solo fuentes a velocidad 1 y sin freeze en el fragmento; otros casos se bloquean hasta disponer de mapping común validado |
| CAP-031 | Foco/atajos/accesibilidad parciales | Reusar convenciones de teclado/foco; no capturar atajos globales desde inputs ni declarar cierre de accesibilidad |
| CAP-029 | HTML editable en desarrollo | No mutar ni copiar overrides HTML sin un contrato de clonación/referencia acordado. Fragmentos que lo requieran se bloquean en V1; búsqueda sigue independiente |
| CAP-022 / CAP-017 | Derivados en desarrollo / waveform existente | Thumbnails opcionales; preescucha no depende de ellos. Waveform puede apoyar límites sin construir otra caché |
| CAP-025 | Operaciones IA seguras parciales | V1 determinista, no necesita IA. No acoplar a propuesta LLM ni utilizarla para eludir permisos |

Antes de implementar cada bloque, revisar el corte vigente del tracker: este documento no puede congelar el trabajo concurrente. Acordar interfaces y dueño de cambios en `NativeCompositionPreview`, contratos de documento/patch, captions y corpus. Si el otro flujo modifica esas interfaces, rebasar el plan sin sobrescribir sus cambios.

## 4. Comportamiento de producto

### Búsqueda

- Campo dentro del panel actual; ámbito composición o escena seleccionada. Consulta vacía restaura navegación actual.
- Búsqueda literal, sin regex proporcionada por usuario. Insensible a mayúsculas; opción de ignorar diacríticos con mapping a offsets originales. Preservar Unicode, signos y contenido original.
- Separar resultados «guion» de resultados «palabras temporizadas»; una coincidencia solo en el guion navega a la escena, no ofrece extracción precisa.
- Cada resultado muestra escena, texto contextual, ocurrencia/toma, intervalo cuando es fiable y etiqueta de procedencia. No prometer fuzzy/semántica en V1.
- Anterior/siguiente y activar por teclado; resaltado como texto React, sin HTML generado. Consultar no edita ni dispara autosave.
- Si no existen narrativeScenes, mostrar ausencia de guion compatible; no inventar texto a partir de escenas fallback.

### Selección y preescucha

- Seleccionar inicio/fin de un rango consecutivo mediante acciones de teclado y mouse explícitas; mantener el click simple actual para seek.
- La selección se identifica por escena, asset, clip/ocurrencia, tokens de origen y revisión del documento. No usar el texto o índice del array renderizado como única identidad.
- Rango V1 limitado a una ocurrencia contigua. Sin cruzar escenas, huecos, clips duplicados o assets diferentes; explicar por qué no está disponible.
- Inicio inclusivo y fin exclusivo. Tokens cortados en el borde del clip se identifican como parciales; no afirmar que contienen la palabra completa.
- Ajuste manual y márgenes siempre visibles y acotados a fuente/clip. No estimar precisión a partir de longitud de texto.
- Preescucha utiliza play/seek/pause existentes, se detiene al límite con tolerancia documentada y se cancela al cambiar selección, documento o cerrar panel. No crea audio elements paralelos.

### Extracción

- Acción distinta de buscar/seleccionar; muestra origen, límites, duración, destino, clips/captions afectados y avisos antes de confirmar.
- V1 destino APPEND al final del canvas, no overwrite/insert. Verificar primero que la colocación existente realmente permite extender canvas sin truncar el intervalo; no usar fallback con overlap silencioso.
- Voz: crear una copia del intervalo con nuevos IDs y referencia autorizada al asset. Si hay enlace obligatorio avatar/voz que no puede clonarse coherentemente, bloquear extracción de voz aislada.
- Audiovisual: incluir únicamente tracks seleccionados explícitamente y todos los enlaces obligatorios; intersecar cada clip con el rango y preservar desplazamientos relativos. No copiar todo lo que se superpone por defecto.
- Captions manuales se preservan y recortan/trasladan cuando el contrato lo permita; no regenerarlos desde texto. Señalar palabras/cues cortados y referencias incompletas.
- Animaciones, fades y transiciones requieren política compatible con reducers actuales. V1 rechaza casos sin recorte/clonación definidos, incluyendo transición cruzando el límite, HTML editable sin clonación segura y fuente sin duración acreditada.
- Original, assets, scene approvals y preensamble permanecen intactos. Los nuevos fragmentos no heredan una aprobación pedagógica ni asociación de escena de manera ciega; deben aparecer identificables en timeline sin alterar el guion original.
- Confirmar un lote atómico, historial único y selección del fragmento nuevo después del ACK. Cancelación/no-op no agrega entradas.

## 5. Arquitectura y contratos propuestos

Nombres orientativos, no archivos ya creados. Dividir módulos solo cuando exista responsabilidad real.

| Módulo propuesto en dominio | Responsabilidad |
|---|---|
| `composition-narrative-search.types.ts` | Schemas de ocurrencia, resultado, rango y plan; errores tipados |
| `composition-narrative-index.service.ts` | Derivar tokens/ocurrencias y conservar mapping texto-normalizado → original; no mutación ni red |
| `composition-narrative-search.service.ts` | Consulta acotada y paginación sobre índice, sin lógica UI |
| `composition-narrative-range.service.ts` | Resolver y validar tiempo fuente/timeline y procedencia del rango |
| `composition-narrative-extraction.service.ts` | Resolver dependencias y producir operaciones/diff/precondiciones; sin persistencia |
| Adaptador servidor junto al gateway actual | Resolver autoridad, reconstruir plan y aplicar el lote con OCC/idempotencia existentes |
| UI `useCompositionNarrativeSearchController.ts` | Estado efímero de consulta/selección/preescucha; invalidación y coordinación |
| UI controles/resultados/dialog de extracción | Presentación accesible dentro del panel actual; sin lógica de montaje |

Contratos mínimos:

- `NarrativeOccurrence`: sceneId, clipId, assetId, assetRevision/hash verificable, scriptHash, índices de token, tiempos fuente y timeline, clase de procedencia temporal.
- `NarrativeSearchResult`: resultId estable por revisión/ocurrencia, offsets originales de match y estado de navegación/extracción. Separar «no temporizado», «estimado», «temporizado vinculado», «obsoleto/no verificable».
- `NarrativeRangeSelection`: revisión/hash base, occurrenceId, índices extremos, límites ajustados y ámbito VOICE/AUDIOVISUAL.
- `NarrativeExtractionPlan`: versión de contrato, baseRevision/documentHash, fuentes/revisiones y clips afectados, destino, operaciones propuestas, cambios de duración, warnings/blockers e identidad de comando.

Estos son contratos propuestos. Revisar procedencia real de `voice.word_timestamps` antes de afirmar «transcripción verificada»: si son alineamiento de guion, nombrarlos así. Si no puede acreditarse binding al asset actual, búsqueda/seek siguen disponibles pero extracción precisa queda deshabilitada o exige intervalo manual explícitamente etiquetado.

Para rate 1 sin freeze: `sourceTime = sourceOffset + (timelineTime - clipStart)`. Aplicar intersección y validar duración. Para otros rates/freezes no extrapolar esta fórmula; consumir un mapper común validado o rechazar en V1.

El cliente no es autoridad de tiempos, assets ni operaciones. El servidor recibe intención e identidades, carga documento actual y assets autorizados, reconstruye el rango/plan y valida mediante el gateway existente. No aceptar un plan arbitrario ni un `document.restore` del cliente como sustituto de policy. Si el gateway aún no ofrece precondiciones completas, extender su adaptador compartido de manera acotada; no declarar seguridad por presencia de savePatch.

## 6. Persistencia, seguridad y performance

- Consulta, resaltados y selección son efímeros. No guardar transcript completo en logs/localStorage ni crear una tabla de búsqueda en V1.
- Clips extraídos usan el documento existente. Si falta binding de timestamps a asset/revisión, diseñar metadata aditiva y lectura legacy segura; no inventar una migración SQL obligatoria antes de evaluar dónde vive ese dato.
- Revalidar tenant, ownership, estado/revocación de assets, locks, groups/links, duración y revisión al apply. Cambio concurrente devuelve conflicto recuperable; conservar intención, no aplicar sobre una base distinta.
- Idempotencia y replay usan infraestructura existente: doble click/timeout no duplica clips; mismo commandId con payload distinto se rechaza. Timeout ambiguo requiere consultar resultado, no emitir comando nuevo automáticamente.
- Límites centralizados para consulta, resultados, tokens indexados, duración/rango y operaciones; compatibles con máximos actuales. Valores iniciales propuestos para medir: consulta 256 caracteres, debounce 150 ms, página 50 resultados. Son presupuestos de diseño, no SLO certificados.
- Índice memoizado por revisión de narrativa/assets/clips, no por cada tick del playhead. Aplicar presupuesto total: no truncar silenciosamente búsqueda; indicar alcance y permitir procesar escena seleccionada.
- Virtualizar resultados/escenas si mediciones lo requieren. Worker solo si una medición demuestra bloqueo; no incorporar servicio/indexador externo por defecto.
- Sin texto, audio, URL firmada o guion en telemetría. Registrar códigos, latencias, conteos, scope y correlation/command IDs con política de retención vigente.

## 7. Secuencia de implementación y cierre verificable

| Bloque | Entrega | Dependencia y criterio de cierre de implementación |
|---|---|---|
| 0 — Contratos y alcance | Fixture realista, auditoría de procedencia, decisiones de VOICE/AUDIOVISUAL y límites | Binding temporal acreditado o fallback documentado; adaptador de apply revisado. Sin esto no habilitar extracción |
| 1 — Búsqueda | Índice, consulta y resultados dentro del panel | Coincidencias Unicode/acentos/frases repetidas correctas; seek y selección existentes sin regresión; cero mutaciones |
| 2 — Rango | Identidad de ocurrencia, selección accesible y preescucha | Fuente/timeline/trim coherentes; cambio de revisión invalida selección; sin player extra |
| 3 — Extracción de toma elegible | Plan/diff, confirmación, append y apply autorizado | Asset intacto, lote atómico/idempotente, nuevos IDs, undo/redo/reload correctos. Restricciones visibles; etiqueta de voz si solo copia voz |
| 4 — Fragmento audiovisual | Enlaces, tracks elegidos y captions compatibles | Misma sincronía/duración, políticas de animación/transición y clonación definidas; unsupported bloqueado sin edición parcial |
| 5 — Integración y preparación de entrega | Casos de corpus, telemetría mínima, flag/rollback y documentación | Evidencia técnica dirigida y listado de QA pendiente; no activar por defecto ni cerrar CAPs ajenas |
| Gate posterior — QA/rollout | Tester valida navegadores, media real y regresión | Aceptación separada; no confundir implementación completa con producto aprobado |

Estado inicial: todos los bloques pendientes. Los incrementos posteriores se registran al final de este documento; las bases reutilizadas no cuentan como implementación nueva. No asignar porcentaje por cantidad de archivos. Llevar avance por bloque y criterios cumplidos. Entrega visible inicial: búsqueda útil; siguiente: extracción no destructiva elegible. No esperar al cierre global de CAP-027/029/025 para desarrollar estos bloques, pero conservar los gates relevantes antes de habilitar producto.

## 8. Matriz de pruebas y riesgos residuales

Pruebas técnicas durante desarrollo; QA formal diferido al tester.

| Área | Casos mínimos | Riesgo cubierto |
|---|---|---|
| Búsqueda | Vacío/sin resultados, repetición, acentos, ñ, puntuación, Unicode combinado, RTL, guion distinto de voz | Match/resaltado falso, identidad equivocada, corrupción de texto |
| Tiempo y origen | Clip movido/trim/split/duplicado, offset, token parcial, end <= start, orden/solapamiento inválido, asset replace/stale | Copiar un intervalo/fuente incorrectos |
| Selección | Una palabra, múltiples, cruce no permitido, sin timestamps, fallback estimado | Precisión fingida y rango inválido |
| Apply | Conflicto OCC, doble confirmación, timeout/ACK perdido, replay distinto, fuente revocada, tenant ajeno | Duplicado, bypass de permisos y sobrescritura |
| Montaje | Voz/avatar vinculado, lock/group, límite canvas, captions manuales, fades, transición de borde, HTML/rate/freeze no soportado | Desincronía y cambios parciales |
| Recuperación | Apply → undo → redo → recarga, selección invalidada, recuperación de draft | Historial o documento inconsistente |
| Preview/export | Mismo source offset/duración, audio/captions/visuales al inicio y final del fragmento | Divergencia; integrarlo al corpus existente sin reemplazar su gate |
| UI/performance | Teclado/lector/foco, query rápida/cancelación, miles de tokens y resultados, playhead activo | Panel bloqueado y regresiones de navegación |

No queda acreditado por tests puros: alineamiento real de palabra pronunciada, transiciones con media real, codec/browser timing, precisión perceptual, accesibilidad por lector real ni conformidad MP4. Registrar esas limitaciones y proporcionar fixtures al tester.

## 9. Rollout, rollback y recomendaciones

- Búsqueda puede habilitarse separadamente de extracción mediante configuración compartida existente; acordar nombres de flags al implementar. No cambiar flags de CAPs activas.
- Piloto opt-in por organización; extracción solo para medios elegibles. Sin aprobación, mantener flag apagada.
- Rollback deshabilita nuevas extracciones y conserva lectura/reproducción/undo de documentos ya escritos. No borrar clips ni assets derivados.
- Si se requiere metadata de procedencia nueva, desplegar lectores compatibles antes de escritores. Si el documento necesita versión nueva, coordinar con el dueño del contrato; no ocultar incompatibilidad tras una flag UI.
- Prioridad obligatoria: búsqueda, identidad temporal y apply seguro. Deseable posterior: varios rangos, favoritos reutilizables entre proyectos, thumbnails y búsqueda semántica; ninguno justifica expandir esta entrega inicial.

Decisión recomendada: implementar bloques 0–3 como primer incremento, con etiqueta de alcance inequívoca; completar bloque 4 para declarar extracción audiovisual. Mantener eliminación de frases y análisis de pausas fuera de este plan, aprovechando la futura base únicamente cuando sus políticas se diseñen aparte.

## 10. Incremento de búsqueda de guion — 2026-10-05

Fuente de prácticas: [prompt maestro](../prompt_maestro.md). Implementación propia, sin dependencias nuevas, acceso a servicios externos, migraciones ni cambios a CAPs/flags del otro flujo.

Entregado:

- Servicio puro `composition-narrative-search.service.ts`: índice de títulos/guion, consulta literal, mapping de graphemes normalizados a texto original, resultados por ocurrencia y límites centralizados. La ñ se conserva distinta de n; se puede exigir coincidencia de acentos de vocales.
- `CompositionNarrativeSearch.tsx`: consulta, ámbito por escena, resaltado como nodos React, resultados accionables por teclado y avisos de presupuesto. No usa HTML del usuario ni persiste consultas.
- Wiring pequeño en `CompositionNarrativePanel.tsx`; memoización de escenas por payload en `NativeCompositionPreview.tsx`, antes de retornos condicionales, para no reconstruir el índice por cada tick de reproducción.
- Presupuesto inicial de 200 000 caracteres indexados, consulta de 256 y 50 coincidencias. Entradas omitidas y resultados limitados se anuncian; buscar por escena reduce el ámbito. Son límites técnicos, no benchmark/SLO certificado.

Validación técnica reproducible desde `apps/web`: `npx tsc -p tsconfig.hyperframes-test.json`; después ejecutar `node .tmp/hyperframes-tests/domains/production/composition-editor/__tests__/composition-narrative-search.service.test.js` y la suite existente `composition-scene.service.test.js` en el mismo directorio. Ocho pruebas nuevas y tres regresiones de escenas pasan. Esto no es QA formal ni prueba de UI/browser.

Estado por bloque:

| Bloque | Estado actual |
|---|---|
| 0 | Parcial: alcance definido; binding fuente/timestamps y autoridad de extracción aún pendientes |
| 1 | Parcial: búsqueda de títulos/guion implementada; falta índice de ocurrencias temporizadas, recorrido anterior/siguiente y validación de UI |
| 2–5 | Pendientes; ninguna extracción o preescucha por rango habilitada |

Limitación deliberada: los resultados navegan al inicio de escena, no al tiempo de una palabra. El panel conserva sus botones de palabra existentes. El parser del proveedor inspeccionado acepta start/end numéricos sin acreditar por sí solo fin > inicio, orden ni vínculo inmutable al asset; no se utiliza como autoridad para cortar. La validación temporal y de procedencia se incorporará al resolver de rangos, sin relajar contratos compartidos ni corregir rutas ajenas indiscriminadamente.

Siguiente incremento obligatorio: enriquecer identidad de ocurrencia y procedencia con fixtures de move/trim/split/replace; después búsqueda de palabras temporizadas y selección. No agregar extracción audiovisual a partir de los tiempos aproximados de escena.

## 11. Incremento de palabras por ocurrencia — 2026-10-05

Entregado: `composition-narrative-occurrence.service.ts` deriva ocurrencias de navegación con sceneId/clipId/hfId/assetId/scriptHash e índices originales de token. Proyecta ventanas de fuente a timeline para rate 1, preserva offsets y marca palabras parcialmente recortadas. Secuencias con tiempos no finitos, invertidos o solapados se rechazan completas; clips ocultos, transformaciones no compatibles y ventanas de fuente inválidas no participan. El contrato de clips no contiene una propiedad `loop`; no se añade ni presupone ese campo.

La búsqueda indexa palabras por ocurrencia, sin unir texto entre clips o escenas, y expone sus límites de token para futura selección. Resultados temporizados navegan al hfId/tiempo de esa toma, no al inicio general de la escena. Se añadieron controles Anterior/Siguiente; un cambio de resultados invalida su posición activa sin efectos de sincronización de estado. La UI informa limitación temporal/presupuesto y vínculo al audio sin verificar. Presupuesto centralizado de 50 000 tokens para lectura/proyección; no truncamiento silencioso.

Alcance de autoridad: `SCENE_TIMESTAMPS_UNVERIFIED_ASSET_BINDING`. Cambiar asset modifica identidad de ocurrencia, pero no demuestra que los timestamps existentes pertenezcan a sus bytes. No se anuncia transcripción verificada, precisión perceptual ni autorización de extracción. Identidades y rangos de búsqueda son efímeros, no un comando de escritura ni un plan aprobado por servidor.

Validación: suite nueva de ocurrencias y regresiones de búsqueda/escenas; fixtures de duplicado, move/trim, split adyacente, replace, tokens parciales, timestamps inválidos, fuente fuera de límites y presupuesto. Ejecución desde `apps/web`: compilación del tsconfig hyperframes y `node --test .tmp/hyperframes-tests/domains/production/composition-editor/__tests__/composition-narrative-occurrence.service.test.js .tmp/hyperframes-tests/domains/production/composition-editor/__tests__/composition-narrative-search.service.test.js .tmp/hyperframes-tests/domains/production/composition-editor/__tests__/composition-scene.service.test.js`. Validación técnica, no browser/QA del tester ni conformidad audiovisual.

| Bloque | Estado tras este incremento |
|---|---|
| 0 | Parcial: identidad de navegación disponible; falta procedencia verificable y autoridad de extracción |
| 1 | Implementación de búsqueda/navegación completada en su alcance acotado; falta QA de interfaz, accesibilidad y performance real |
| 2 | Parcial: límites e identidad de tokens disponibles; selección de rango y preescucha aún pendientes |
| 3–5 | Pendientes; extracción no habilitada |

No cambios de contrato persistido, DB, assets, historial, flags ni estados de las CAPs del flujo paralelo. Siguiente incremento: selección explícita del rango en una ocurrencia, invalidación por revisión y preescucha con el transporte existente; la extracción seguirá exigiendo precondiciones de fuente y apply seguro.

## 12. Incremento de selección y preescucha — 2026-10-05

Implementado en el panel actual, sin segundo player:

- `composition-narrative-range.service.ts` reconstruye el rango desde el documento actual, exige hash base vigente, ocurrencia disponible e índices enteros/consecutivos; rechaza cruce de clip y rangos inexistentes. Una selección no se transforma en autoridad de escritura.
- `CompositionNarrativeRangeControls.tsx` permite escoger palabra inicial/final por ordinal de la fuente, ajustar inicio/fin dentro de la toma y restablecer los límites de palabras. Muestra selección, duración, palabras parciales y avisos de procedencia. Cambiar límites cancela una preescucha activa.
- La selección deriva de una coincidencia temporizada; guion/títulos sin tiempos no ofrecen este control. Cambio de revisión o conjunto de resultados invalida el control y libera la sesión. El rango puede añadir contexto o recortar palabras manualmente; el texto mostrado sigue etiquetado como selección de palabras, no como transcripción garantizada de ese intervalo ajustado.
- Integración acotada en `NativeCompositionPreview`: revalida documento/hash y preview guardado/listo antes de play; usa seek/play/pause existentes. Detiene la sesión ante mensaje temporal aceptado fuera del rango o fin exclusivo, cambio de revisión/clip, seek/scrub/selección manual, cierre de biblioteca, preview inválido, guardado/propuesta/comparación o desmontaje. Cancelar solo actúa cuando existe una sesión de rango propia; no pausa otra reproducción por desmontar un control inactivo.
- Preescucha de hasta 120 s y watchdog de duración seleccionada + 10 s para no mantener una sesión abandonada sin mensajes. No añade transporte, decoder, asset, índice persistido ni dependencia. Los callbacks de envío del transporte se estabilizaron para que cleanup no se ejecute por cada render del playhead.

Validación: 9 pruebas nuevas de rango y 20 regresiones de búsqueda/ocurrencia/escenas pasan (29 total), compilación de tests, typecheck de aplicación y lint dirigido. Fixture compartida de narrativa evita duplicar documentos sintéticos. Añadir `composition-narrative-range.service.test.js` a la ejecución `node --test` registrada arriba.

Límites de evidencia: las pruebas cubren resolver y clasificación de fin/cancelación, no una sesión de navegador real ni todos los eventos de integración. La pausa responde a mensajes de tiempo del transporte; puede existir overshoot por cadencia/latencia. No promete precisión sample-accurate, audio aislado, paridad MP4 ni timestamps ligados criptográficamente a la fuente. QA pendiente: buffering, seek→play, cambio de inspector/consulta, cierre/unmount y edición concurrente en navegador real; duración >120 s se rechaza, no se recorta silenciosamente.

| Bloque | Estado tras este incremento |
|---|---|
| 0 | Parcial: falta binding verificable de timestamps a fuente/revisión y autoridad de extracción |
| 1 | Búsqueda/navegación implementada; falta QA |
| 2 | Selección y preescucha implementadas en el alcance acotado descrito; falta QA de integración y precisión del transporte |
| 3–5 | Pendientes; no se escribe ni extrae ningún fragmento |

Siguiente paso: estudiar el binding real de voz/asset y el gateway actual para producir un plan no destructivo de extracción elegible, con precondiciones verificadas en servidor. No convertir un rango cliente válido para escuchar en un comando autorizado para copiar o cortar. Estados/flags/porcentajes de CAPs y cambios concurrentes del otro flujo permanecen intactos.

## 13. Planificador no destructivo de voz — 2026-10-05

Implementado y validado `composition-narrative-extraction.service.ts`: servicio puro de dominio que recibe documento y registro de asset que el futuro adaptador debe cargar desde servidor; no autentica esos parámetros ni acepta que un cliente los convierta en autoridad. Devuelve un plan `NARRATIVE_VOICE_EXTRACTION_PLAN_V1` o un motivo tipado de rechazo, sin red, storage ni persistencia.

Reglas entregadas:

- Parseo del documento y hash base, reconstrucción del rango contra revisión vigente, track VOICE y clip AUDIO elegibles.
- Asset VOICE_AUDIO con checksum SHA-256, duración precisa en milisegundos, MIME audio y estado QA admisible. Tenant, componente, ID y vínculo al borrador deben coincidir con el contexto proporcionado por el adaptador autorizado.
- Hash de guion y valores/orden de todos los timestamps iguales al registro. Comparación semántica de campos, independiente del orden de propiedades JSON.
- Rango de fuente calculado con offset actual y validado contra duración del registro; IDs nuevos válidos y sin colisión.
- Bloqueo de track locked, grupo, vínculo voz/avatar ambiguo o explícito, fades, animaciones y transiciones no soportados. No descartar dependencias silenciosamente.
- Dos operaciones nativas simuladas con el reducer: extender duración del canvas y añadir copia al final. El original/asset no cambia. La copia no hereda sceneId ni aprobación pedagógica; etiqueta inequívoca de fragmento de voz, no extracción audiovisual.
- Errores esperables de validación se convierten en rechazo; fallos inesperados se propagan para diagnóstico, no se ocultan como un intervalo inválido.

Evidencia de procedencia inspeccionada: `heygen-audio-import.service.ts` inserta checksum descargado, `script_hash` y `word_timestamps` como metadata del asset; `VoiceClip` también contiene `asset_id`. La narrativa vigente solo transporta hash/timestamps, no esa identidad completa. Por ello el plan declara **REGISTRY_METADATA_MATCH_ONLY**, no audio verificado o inmutable. Antes de apply se requieren lectura autorizada del registro actual y recheck de checksum/estado/vínculo; la función pura no hace esas consultas ni verifica bytes de Storage.

Auditoría de gateway: `document/route.ts` usa If-Match y `applyAndAppendCompositionDocumentPatches` revalida assets vinculados y hace append CAS. Su request no contiene commandId; OCC por hash no es equivalente a idempotencia durable de una extracción ante ACK perdido. El apply nuevo debe compartir autorización/gateway/historial sin aceptar operaciones cliente como plan autorizado, y definir consulta/reanudación del resultado antes de prometer reintentos seguros. No se modifica ni debilita el gateway genérico en este incremento.

Pruebas: diez casos nuevos de planificación y 30 regresiones pasan (40 total), incluida aplicación del lote con reducer real, offset/duración, conservación del original, IDs, tenant/componente/vínculo, estados QA, checksum ausente, timestamps/hash distintos, locks/grupos/fades/enlace avatar y determinismo. Fixture compartida ahora se construye mediante schema real, no assertion de tipo sobre documento incompleto. Compilación y lint dirigido ejecutados; no DB, Storage, navegador ni QA formal. Ejecutar `composition-narrative-extraction.service.test.js` junto a las suites anteriores.

| Bloque | Estado tras este incremento |
|---|---|
| 0 | Parcial: metadata de binding y restricciones definidas; falta verificación autorizada de fuente y apply |
| 1–2 | Implementados en alcance registrado; falta QA |
| 3 | Parcial: planificador de voz simulado con operaciones existentes; faltan adaptador/endpoint, confirmación UI, persistencia y recuperación idempotente |
| 4–5 | Pendientes; extracción audiovisual e integración final no entregadas |

Siguiente incremento: adaptador de planificación de solo lectura que cargue fuente/tenant/componente/vínculo desde servidor y entregue un resumen para revisión; después conectar apply con precondiciones/rechecks y tratamiento explícito de resultado ambiguo. No añadir botón de escritura hasta satisfacer ese contrato. Sin migraciones, flags, cambios a CAPs ni escritura de clips en este incremento.

## 14. Consulta de elegibilidad autorizada — 2026-10-05

Implementados contrato estricto, caso de uso con repositorio de lectura y adaptador Supabase separados. Nuevo endpoint `POST /api/production/hyperframes/drafts/{draftId}/narrative-extraction/plan`: POST mantiene la selección fuera de URLs; no crea planes persistidos ni escribe clips.

- Autenticación y permiso `canReviewContent` sobre tenant activo antes de usar service role. Organización y componente no proceden del body.
- Selección limitada a 8 KiB, hash de revisión, identidad de ocurrencia, índices y ajustes opcionales. No acepta assets, documentos, operaciones ni IDs nuevos del cliente.
- Lectura de borrador/composición filtrada por organización; documento vigente reutiliza el lector del editor. Asset obtenido por identidad reconstruida desde ese documento, tras comprobar vínculo al borrador, organización y componente. Campos seleccionados explícitamente, sin descargar Storage.
- Respuesta `NARRATIVE_VOICE_EXTRACTION_ELIGIBILITY_V1`: revisión, alcance de voz, intervalos y advertencia de revalidación. No devuelve operaciones, checksum, guion, IDs de copia, credenciales ni rutas de Storage. No representa un token de autorización ni un comando aplicable.
- Respuestas sin caché, correlation ID y errores seguros: 400 contrato, 401/403 acceso, 404 recurso, 409 revisión obsoleta, 413 tamaño, 422 inelegibilidad; fallos inesperados se registran y responden 500. Tenant no verificable responde 503.
- Consultas nuevas tienen señal de cancelación de solicitud/15 s. El lector compartido de documento todavía no cancela sus queries en vuelo; se comprueba aborto antes/después, sin prometer timeout duro de todo el caso de uso.

Validación técnica: seis pruebas nuevas del caso de uso y 40 regresiones (46 total) pasan. Cubren propagación del scope al repositorio, resumen mínimo, ausencia de mutación, rechazo temprano de revisión/ocurrencia, asset no disponible/ajeno, campos cliente prohibidos y propagación de fallo inesperado. Compilación, typecheck y lint dirigido sin errores ni warnings. Pruebas usan repositorio fake: **no verifican RLS, filtros PostgREST ejecutados, autenticación HTTP real ni Storage**; esas pruebas de integración y QA formal siguen pendientes. Antes de exposición en UI, definir limitación distribuida de abuso para esta consulta; no introducir un limitador en memoria que prometa cobertura multiinstancia.

Avance: bloques 1–2 implementados, falta QA; bloque 0 parcial (lectura contextual añadida, bytes no verificados); bloque 3 parcial (planificador, contrato, adaptador y endpoint de consulta entregados; faltan confirmación UI, apply con rechecks y recuperación idempotente); bloques 4–5 pendientes. Sin cambios a CAPs, migraciones, flags, gateway de escritura ni UI existente.

Siguiente: definir y conectar la confirmación de solo lectura en UI, con invalidación por revisión/cambio de selección. El guardado debe esperar un contrato de apply que reconstruya el plan en servidor y resuelva reintentos/ACK ambiguo; jamás aceptar este resumen como autoridad.

## 15. Revisión visible y protección distribuida — 2026-10-05

La selección de palabras ahora ofrece **Consultar extracción de voz**, acción manual de revisión, no confirmación de escritura. Muestra intervalos de fuente/destino al final, conservación del original y alcance solo voz; explica que los bytes del audio no se verificaron y que antes de guardar se requiere nueva validación. No existe botón de guardar/extract ni aceptación implícita de ese resumen como autorización.

Cambios y límites:

- Contrato compartido browser-safe separado del caso de uso Node; evita importar `node:crypto` al cliente. Valida el contrato de respuesta, revisión, alcance, intervalos finitos/positivos y duración coherente hasta 120 s. Rechaza respuestas con operaciones u otros campos no permitidos dentro del resumen.
- Loader cliente POST de solo selección, credenciales same-origin, sin caché, respuestas limitadas a 16 KiB, mensajes seguros y sin reintentos automáticos. Nunca refleja cuerpos de error del backend. UUID validado antes de construir URL.
- Sesión React keyed por borrador/selección exacta y estado elegible. Cambiar palabras, ajustes manuales, revisión o deshabilitar/remontar cancela solicitudes y descarta resultados; no resucitan al reactivar. Timeout de 15 s, reconsulta cancela solicitud anterior, comprobación de aborto aun cuando transporte ignore cancelación. No consulta al teclear ni al navegar: solo por botón.
- Reutiliza `consume_api_rate_limit`, ya definido en `20260908120000_create_api_rate_limits.sql` y usado por Lia. Política centralizada: 12 consultas/60 s por organización/usuario autenticados, no por draft manipulable; contador atómico PostgreSQL, no memoria local. RPC error/respuesta malformada bloquea el acceso, nunca fallback permisivo. 429 con Retry-After acotado y espera en UI; RPC no disponible responde 503. Sin nuevas migraciones ni dependencias. Única escritura de este flujo es el contador de seguridad; no documentos/assets.
- La ruta usa la política antes de leer body/documento/registry. Aborto aplicado al RPC y consultas nuevas. Permanece la limitación registrada del lector compartido en vuelo. No se afirma capacidad para 100000 usuarios concurrentes: el presupuesto inicial requiere medición y protección en gateway/edge antes de alta carga; la autenticación y un RPC por consulta siguen consumiendo recursos.

Validación técnica: 14 pruebas nuevas de cliente/contrato/limitador más 46 regresiones (60 total) pasan. Compilación de tests, typecheck completo y lint dirigido finalizan sin errores; lint sin warnings. Una ejecución inicial de typecheck encontró un error transitorio en una prueba HTML del flujo paralelo; no se modificó ese archivo y la ejecución final pasó. Cubren payload, respuesta, revisión, alcance, intervalos, identidad, aborto de respuesta tardía, tamaño/JSON, mensajes seguros, ausencia de retry, rate policy y fail-closed. Son pruebas Node con transporte/RPC fakes: no son QA de navegador, prueba de montaje React, prueba HTTP real, concurrencia PostgreSQL ni comprobación de migración aplicada. La UI queda cerrada a consultas si el RPC requerido no está disponible; no se ejecutaron migraciones ni servicios externos.

Avance: bloques 1–2 implementados, falta QA; bloque 0 parcial (binding de registro, no verificación de bytes); bloque 3 parcial (revisión UI y protección añadidas; faltan apply, persistencia y recuperación idempotente); bloques 4–5 pendientes. No se cambian CAPs ni flags del flujo paralelo. Cambios UI limitados al paso de draftId por el panel/búsqueda/rango y componente de revisión separado.

Siguiente incremento obligatorio: contrato de apply/idempotencia y recuperación de resultado ambiguo; reconstrucción del plan y rechecks de revisión/asset/estado/vínculo dentro del servidor antes de usar el gateway/historial existente. No aceptar operaciones del cliente ni habilitar guardar sin esos controles.

## 16. Contrato de guardado, deduplicación y recuperación — 2026-10-05

Implementados `composition-narrative-extraction-apply.service.ts` y contrato estricto `NARRATIVE_VOICE_EXTRACTION_APPLY_V1`, **sin endpoint de escritura ni adaptador persistente**. El coordinador solo puede operar con un repositorio que satisfaga la transacción especificada abajo; no se instancia en producción, no guarda documentos y no habilita UI de apply.

- Body futuro: commandId UUID, selección y reviewFingerprint. Nunca documento, operaciones, asset, tenant o actor del cliente. Scope de organización/borrador/actor debe proceder de autorización vigente en el futuro endpoint.
- Consulta de revisión pasa a `NARRATIVE_VOICE_EXTRACTION_ELIGIBILITY_V2` y añade huella opaca SHA-256 de revisión, asset/checksum/hash de guion, estado QA, duración precisa, intervalos y alcance. Cliente y servidor se actualizan juntos; V1 carece de ese binding y no es válido para apply. No contiene aprobación ni prueba de bytes inmutables.
- El planificador conserva estado QA/duración de fuente en el plan interno. Cambios incluso entre estados QA admisibles invalidan lo revisado, no se aceptan silenciosamente. Consulta y apply comparten carga contextual/reconstrucción, sin duplicar su lógica ni incluir Node crypto en módulos cliente.
- Digest canónico de intención por tupla explícita: identidad, huella revisada y selección, independiente del orden de propiedades. IDs del nuevo clip/hf se derivan de commandId; un reintento no genera otra copia aleatoria.
- Consulta primero el recibo bajo scope. Repetición idéntica devuelve el resultado original, incluso si después cambió la composición; **no restaura ni sobrescribe el documento actual**. Mismo commandId con intención distinta se rechaza. Recibos corruptos bloquean nueva escritura.
- Sin recibo: recarga contexto/documento/asset, verifica revisión y huella; luego delega a commit atómico. La comprobación de servicio no sustituye los rechecks dentro de la transacción.
- BUSY, CONFLICT, ASSET_CHANGED y COMMAND_REUSED no generan retry automático. Error de commit o acknowledgement malformado produce `NarrativeExtractionCommitUnconfirmedError`, conserva commandId/cause para diagnóstico y obliga a consultar el recibo. No se afirma “no guardado”. Recuperación sin recibo sigue UNCONFIRMED: podría haber transacción en vuelo.

Contrato obligatorio del adaptador pendiente:

1. Namespace único durable `(organization_id, draft_id, actor_id, command_id)`, payload digest e immutable receipt con versión/hash/clip creado. Lectura filtrada por los cuatro campos; solo service role tras autorización. Sin TTL automático que habilite duplicados mientras el historial siga vivo.
2. Serializar por borrador usando el orden de locks del gateway existente. Dentro de una transacción: deduplicar intención, comprobar estado editable y hash base, organización/componente y vínculo de asset, checksum, QA, duración y metadatos/timestamps relevantes. Locks o precondiciones deben impedir cambios de fuente/vínculo entre check y append, no limitarse a SELECT previo fuera de transacción.
3. Simular/validar con reducer y contrato actual en servidor; preservar referencias HTML. Delegar append/audit a `append_video_composition_draft_document_v2` y guardar recibo en **la misma transacción**. Fallo de cualquiera revierte ambos. No crear `append()` seguido de `insertReceipt()` por HTTP ni modificar el gateway genérico para confiar en operaciones cliente.
4. Deduplicación concurrente devuelve recibo original o conflicto determinista. Consulta de recuperación no escribe, no rebasa sobre otra revisión ni toma la mera presencia de un clip como prueba de commit.
5. RPC ausente o respuesta inválida falla cerrado. Preparar SQL aditivo y pruebas de concurrencia/rollback antes de conectar endpoint; ejecución de migración y QA formal permanecen diferidos. No se crea ni ejecuta una migración en este incremento.

Validación: 14 casos nuevos y 60 regresiones (74 total) pasan. Compilación de tests y lint dirigido pasan sin errores ni warnings. Typecheck completo final pasa; una ejecución intermedia detectó fixtures HTML del flujo paralelo incompletos, que no se modificaron en este trabajo. Cubren reconstrucción, IDs estables, replay tras cambios posteriores, identidad reutilizada, cambios del registro/revisión/vínculo, rechazo del boundary sin retry, replay concurrente simulado, ACK perdido y recuperación, recibo ausente/corrupto, fallos de lectura y contrato/digest. El repositorio de comandos es fake: **no prueba atomicidad, locks o deduplicación reales de PostgreSQL**. Las operaciones del plan se aplican con reducer real dentro de la prueba; no existe persistencia real de ese fake.

Avance: búsqueda/selección/previsualización implementadas, falta QA; consulta y revisión UI implementadas, falta integración/QA; extracción continúa parcial con coordinador apply/recuperación entregado. Adaptador transaccional, endpoints de apply/receipt, UI de confirmación/escritura y recuperación cliente pendientes; extracción audiovisual/integración final pendientes. CAPs, gateway genérico, migraciones y botón de guardado sin cambios.

Siguiente: implementar el adaptador transaccional y pruebas de contrato/SQL sin ejecutarlo en producción; conectar endpoints solo cuando su persistencia haga cumplir los invariantes anteriores.

## 17. Adaptador RPC y migración atómica preparados — 2026-10-05

Implementado `composition-narrative-extraction-command.repository.ts`: consulta recibos bajo scope completo y envía un único RPC para commit. Relee la revisión, simula operaciones con reducer, preserva referencias HTML y calcula hash canónico compartido. Si otra instancia completó el mismo comando entre lookup inicial y relectura, vuelve a consultar recibo y retorna replay; una revisión obsoleta no causa nuevo append. Respuestas desconocidas/malformadas y RPC ausente fallan cerrado, sin fallback al append genérico. Transporte Supabase desactiva retries y pasa señal de cancelación tanto para lectura como para commit. **No instanciado en rutas de escritura.**

Preparada, no ejecutada, `supabase/migrations/20261006040000_narrative_extraction_atomic_receipts.sql`:

- Tabla de recibos con PK `(organization_id,draft_id,actor_id,command_id)`, RLS y sin acceso directo para anon/authenticated/service_role; RPCs service-only con search_path fijo y referencias calificadas. Namespace del actor es UUID histórico, sin bloquear borrado de profile. FK diferida al documento permite borrado coherente de todo el draft pero impide borrar su documento mientras se conserve el recibo. No TTL automático ni escritura directa de recibos para clientes.
- Lectura de recibo por los cuatro campos. Commit bloquea draft primero con NOWAIT, deduplica antes de exigir revisión actual, comprueba estado activo/hash y bloquea composición/vínculo/asset con SHARE NOWAIT. SHARE impide updates de QA/checksum/metadatos, no solo cambio de clave.
- Rechecks de organización/componente/vínculo, tipo/MIME, checksum, QA, duración y guion/timestamps contra narrativa vigente. Bloquea locks/hidden, rate/freeze, fades, grupos, animaciones, transiciones y avatar. Ventana de fuente dentro de toma y duración registrada, máximo 120 s.
- Delta SQL estricto: solo duración del canvas y copia de voz al final, IDs derivados de commandId, sin sceneId heredado; documento original y referencias HTML no se retargetean. Canonicalización/schema/hash completos siguen siendo responsabilidad del host service-only antes del RPC.
- Delegación al `append_video_composition_draft_document_v2` existente y receipt insert en la misma transacción. Resultado distinto de APPENDED aborta; locks ocupados devuelven BUSY con rollback del bloque. Nada de append + receipt por solicitudes separadas.
- Guard estricto puede rechazar documentos legacy que se normalizan al leer, formatos que necesitan reconciliación o excludedSources contradictorios que el reducer retire al añadir. No normaliza silenciosamente desde SQL: revisar/reconciliar explícitamente antes de habilitar escritura para esos casos. El SQL usa duración del reducer y tolerancia de 1 µs para diferencias entre decimal e IEEE-754, sin modificar ventanas de fuente.

Cambios compartidos mínimos: hash canónico movido a `composition-document-hash.ts` sin cambiar algoritmo; reexport desde el servicio conserva imports existentes. Binding de revisión incluye sourceClipId para distinguir tomas del mismo asset/ventana. Etiqueta derivada limita 90 code points Unicode para caber en 200 unidades UTF-16 con sufijo, evita partir emoji y coincide con `left(...,90)` SQL.

Validación: 13 casos adicionales y 74 regresiones (87 total) pasan; ocho de adaptador/hash/transporte, tres de inspección estática SQL y dos de etiqueta Unicode/binding de toma. Compilación de tests, typecheck completo y lint dirigido pasan sin errores ni warnings. Pruebas del adaptador usan transporte fake y reducer real. **Las tres inspecciones SQL no parsean ni ejecutan la migración: no prueban sintaxis PostgreSQL, RLS/grants efectivos, locks, atomicidad, rollback o concurrencia.** No se ejecutaron migraciones, servicios externos ni QA formal.

Pendiente obligatorio de integración antes del release: aplicar solo en entorno aislado autorizado; probar APPENDED+receipt, replay idéntico, payload cambiado, comandos concurrentes, fuente/vínculo modificados, borrado de profile/draft, conflictos/locks, error forzado al insertar recibo con rollback de documento/audit y ACK perdido. Verificar comparaciones de documento exacto con v2/v3/v4, Unicode, decimales, referencias HTML y exclusiones. Rollback de rollout: mantener UI/endpoint desconectados o revocar EXECUTE de RPCs, conservar recibos e historial; no borrar tablas con datos.

Avance: búsqueda/selección/previsualización implementadas, falta QA; consulta/revisión UI implementadas, falta integración/QA; coordinador y adaptador de escritura implementados pero no habilitados; persistencia SQL preparada, no ejecutada ni verificada en PostgreSQL. Extracción sigue parcial: endpoints de apply/receipt, confirmación y recuperación cliente pendientes; audiovisual e integración final pendientes. Sin cambios a CAPs ni habilitación del botón de guardar.

Siguiente: preparar handlers autorizados de apply/receipt con límites, CSRF/origin y estados de recuperación; mantener desconectada la escritura hasta verificación transaccional y aprobación de migración.

## 18. Handlers HTTP de guardado y recuperación preparados — 2026-10-05

Implementados factory HTTP, política de entrada y composición de dependencias de servidor en `composition-editor/http/`. **No se exportan rutas app/api ni se habilita escritura:** la factory de servidor tiene gate cerrado por defecto. Reutiliza coordinador, repositorios y autorización existentes, sin aceptar operaciones/documentos/assets del cliente ni modificar CAPs.

- Exige POST, JSON, UUID del borrador y ausencia de query params. Origen exacto contra URL configurada en servidor, nunca Host/X-Forwarded-Host; Fetch Metadata solo same-origin o ausente. Configuración ausente/inválida falla cerrado. HTTPS obligatorio salvo loopback local.
- Autenticación, tenant vigente asociado al mismo usuario y permiso canReviewContent antes del acceso privilegiado. Scope validado, borrador/componente filtrados por organización; recuperación vuelve a exigir permisos actuales.
- Lectura streaming con máximo real de 8 KiB aunque Content-Length falte o mienta; UTF-8 y body estrictos. Cancelación interrumpe lectura pendiente. Señal de solicitud y presupuesto de 15 s propagados a consultas nuevas; permanece la limitación del lector compartido documentada anteriormente.
- Rate limiting PostgreSQL fail-closed: buckets PLAN/APPLY/RECOVERY independientes por organización/actor, 12 solicitudes/60 s por propósito. Borradores y commandId no multiplican cuota; recuperación no consume el presupuesto de consulta/guardado. Retry-After acotado, sin retry automático.
- Contrato público estricto NARRATIVE_EXTRACTION_COMMAND_RESULT_V1: COMMITTED/REPLAYED/CONFIRMED solo confirman DATABASE_COMMIT_ONLY y exigen recargar documento vigente. Proyecta commandId, versión/hash e identidad de copia; no expone digest de intención, operaciones, metadata, rutas de Storage ni documento histórico. Nunca reemplaza el documento actual con el del recibo.
- Recuperación sin recibo devuelve 202 UNCONFIRMED, no «no guardado». ACK perdido/fallo tras comando identificado devuelve resultado seguro que requiere recuperación, sin recomendar reenvío ciego. Correlation ID, respuestas no-store y logging sin body; errores internos no se reflejan al cliente.

Validación técnica: 20 casos HTTP nuevos y uno de separación de cuotas, más 87 regresiones: **108 pruebas pasan**. Compilación de pruebas, typecheck completo y lint dirigido final pasan sin errores ni warnings. HTTP usa Request/Response y coordinador reales, con autorización/transporte/repositorios simulados. Cubre gate cerrado, origen/configuración, permisos, payload/UTF-8/tamaño real, cancelación de stream, límites, proyección pública, replay, recibo ausente, recurso inexistente, commandId reutilizado y ACK perdido con recuperación sin segundo commit. Una ejecución intermedia detectó errores en HTML del flujo paralelo; no se modificaron esos archivos y la validación final pasó.

No se verificaron autenticación Supabase real, RLS/grants, transacciones/concurrencia PostgreSQL, navegador ni QA formal. Migración preparada permanece sin ejecutar; no se llamaron servicios externos ni se desplegó. Los tests de handlers no sustituyen la verificación transaccional de la sección 17.

| Bloque | Estado actual |
|---|---|
| 0 | Parcial: binding contextual del registro; bytes de audio no verificados |
| 1–2 | Implementados en alcance registrado; falta QA |
| 3 | Parcial: consulta/revisión UI, coordinador, adaptador y handlers preparados; migración sin ejecutar/verificar, rutas de escritura desconectadas y confirmación/recuperación cliente pendientes |
| 4–5 | Pendientes: extracción audiovisual e integración final |

Siguiente: preparar contrato y sesión cliente de confirmación/recuperación, conservando commandId ante resultado ambiguo e invalidando la revisión al cambiar selección/documento. Mantener interfaz de escritura y rutas desconectadas hasta validar integración transaccional y autorizar migración; no presentar extracción completa antes de ello.

## 19. Transporte y sesión cliente de comando — 2026-10-06

Implementados módulos browser-safe de transporte y sesión editorial, aún sin conectar botón/rutas de escritura:

- Transporte APPLY/RECOVERY envía la misma intención estricta al endpoint correspondiente. Valida commandId, identidad de copia, contrato y estado compatible con la acción. No acepta receipt de otro comando ni confunde COMMITTED con confirmación de recuperación.
- Sin retry automático. Pérdida de respuesta, aborto después de dispatch, JSON/UTF-8 inválido, cuerpo excesivo, receipt desconocido y error HTTP permanecen UNCONFIRMED. Mensaje local seguro, sin reflejar detalles internos. Esta versión conserva también errores HTTP explícitos como inciertos de forma conservadora; falta clasificar rechazos definitivos para permitir corregir una solicitud sin abandonar comandos ambiguos.
- Sesión separada de React: IDLE → REVIEWED → APPLYING → UNCONFIRMED → RECOVERING → RELOAD_REQUIRED. Confirma solo la selección exactamente revisada, permite un apply, conserva commandId/intención ante cambio de selección y exige recarga autorizada del documento vigente antes de liberar el flujo. Nunca usa el recibo para restaurar una composición histórica. Copias defensivas evitan mutaciones de intención desde consumidores.
- La sesión debe residir en el dueño del editor/borrador, no en el panel keyed por rango. Todavía no se monta en UI: falta conectar propietario, confirmación accesible, recarga/historial/selección del fragmento y retención segura de comando pendiente ante desmontaje/recarga. No se guardan guion, audio ni selección en localStorage en este incremento.
- Lector de respuesta compartido con revisión de solo lectura: límite streaming de 16 KiB, UTF-8 estricto y cancelación activa de reader bloqueado. Mantiene contrato y comportamiento público de revisión.

Validación: nueve casos nuevos más regresiones, **117 pruebas pasan**. Compilación de tests, typecheck completo y lint dirigido pasan sin errores ni warnings. Casos cubren selección cambiada, doble apply, comando preservado, recuperación manual, espera de recarga, aislamiento de intención, contrato público real con correlation IDs, comandos/estados ajenos, ACK perdido, errores seguros, aborto pre/post dispatch, tamaño y stream bloqueado. Pruebas Node/fetch simulado, no montaje React, Storage, autenticación real ni PostgreSQL.

Avance: bloques 1–2 implementados, falta QA; bloque 0 parcial; bloque 3 parcial con transporte/sesión añadidos, pendiente wiring UI/HTTP y despliegue/verificación de persistencia; bloques 4–5 pendientes. El objetivo completo sigue abierto: la extracción audiovisual exigida en la sección 1 no se sustituye por una entrega solo voz. No migraciones ejecutadas, servicios externos, CAPs modificadas ni activación de escritura.

Siguiente: completar integración cliente de confirmación/recuperación con retención de comando pendiente y clasificación segura de rechazos; después montar rutas bajo rollout cerrado y ampliar el planificador al fragmento audiovisual/captions compatible, preservando los gates de fuentes y transacción.

## 20. Registro de recuperación y controlador editorial — 2026-10-06

Añadidos `composition-narrative-extraction-pending.ts` y `composition-narrative-extraction-controller.ts`; sesión admite restaurar intención únicamente como UNCONFIRMED. No hay replay de apply desde almacenamiento.

- Registro mínimo versionado y acotado por bytes bajo organización/usuario/borrador: UUID de comando, hash/huella de revisión, identidad de ocurrencia, índices y límites. Sin guion/transcript, documento, operaciones, audio, URLs ni credenciales. No caduca automáticamente mientras el resultado sea ambiguo. Scope/cuerpo corruptos o almacenamiento inaccesible fallan cerrado, sin borrar evidencia ni sobrescribir otro comando.
- Controlador reserva y verifica registro antes de dispatch. Bloqueo exclusivo inyectado debe cubrir la reserva, HTTP y resolución entre pestañas cooperantes; **el montaje browser pendiente debe suministrar Web Locks, no un fallback permisivo**. El servidor sigue siendo autoridad para concurrencia entre dispositivos. Al encontrar otro comando pendiente, cambia a recuperación sin enviar uno nuevo.
- Apply/recovery con presupuesto de 15 s y señal de aborto. Doble apply bloqueado síncronamente incluso mientras espera el lock. ACK perdido conserva intención. Reload del editor reconstruye sesión pendiente como consultable, no aplicable; recuperación solo consulta receipt.
- Recibo confirmado mantiene registro hasta que callback recargue documento/historial vigentes y seleccione nuevo clip si aún existe; fallo de recarga/limpieza conserva bloqueo y registro. Limpieza compara intención completa, no solo UUID. El callback y selección todavía requieren wiring en el propietario del editor; no se afirma que ya se ejecuten en UI.
- Limitación: el registro local es un puntero de recuperación, no autoridad de autorización ni garantía frente a eliminación manual de almacenamiento. Un registro corrupto requiere resolución explícita; no se autoabandona para desbloquear escrituras. La clasificación de rechazos definitivos registrada en sección 19 sigue pendiente.

Validación técnica: nueve casos nuevos y regresiones, **126 pruebas pasan**. Compilación de tests, typecheck completo y lint dirigido pasan sin errores ni warnings. Cubren scope, corrupción/tamaño, ausencia de sobrescritura, quota error sin dispatch, reserva antes de fetch, respuesta perdida, restauración recovery-only, recarga fallida, comando de otra pestaña, doble apply, aborto antes de lock y recuperación sin fallback a apply. Locks/storage/fetch simulados: no prueba de Web Locks/localStorage en navegador ni transacción real. Sin migraciones ejecutadas, despliegue, llamadas externas o QA formal.

Estado: búsqueda/selección/preescucha implementadas, falta QA; extracción de voz parcial con controlador y registro preparados; aún falta montar UI/HTTP/rollout y recarga/historial. Audiovisual/captions e integración final pendientes. Objetivo activo, no terminado por llegar a tests unitarios.

Siguiente implementación: montar controlador bajo scope autenticado estable en el editor, confirmación accesible y panel de recuperación persistente independiente del rango; garantizar Web Locks y recarga editorial antes de habilitar rutas. Completar después audiovisual/captions compatibles y preparar entrega a QA.

## 21. Integración del host, confirmación y rutas bajo rollout cerrado — 2026-10-06

Montado `CompositionNarrativeExtractionHost` alrededor de la sesión del editor nativo. Scope reactivo de stores de autenticación/organización; cambiar actor, organización o borrador desmonta la sesión anterior y cancela transporte, conservando su registro scoped. Context evita prop drilling de comandos por búsqueda/rango. Confirmación explícita mediante checkbox en la revisión: copia solo voz, al final, sin captions/visuales y original intacto. Reconsultar invalida el consentimiento previo.

- Host exige Web Locks reales; sin locks no habilita escritura, sin fallback en memoria. Inicializa recuperación local y no envía comandos automáticamente. Panel de recuperación fuera del área inert permanece disponible al cerrar rango/library; mantiene commandId y permite consultar receipt o recargar documento vigente.
- Editor permanece inert mientras hay comando pendiente; savePatch consulta bloqueo vivo del host, no solo un valor React capturado. Lectura de documento reutilizada retorna éxito/fallo. Tras ACK, recarga y selecciona nuevo clip solo si aún existe. Receipt no restaura documento histórico.
- Historial de sesión captura checkpoint previo en memoria antes de apply y solo registra extracción si revisión recargada coincide con hash del ACK. Cambios posteriores obligan a conservar documento vigente y limpiar checkpoint incompatible, no agrupar esas ediciones como una extracción. Tras recarga de navegador no se inventa checkpoint previo desde el puntero local: historial de sesión sigue el comportamiento existente de reinicio; audit persistente queda en gateway. Falta validación técnica específica de undo/redo y montaje React.
- Rutas POST `.../narrative-extraction/apply` y `.../narrative-extraction/receipt` conectadas a handlers autorizados. **Siguen desactivadas por defecto**, no se ejecutó migración ni se activó entorno. Factory conserva default cerrado para otros consumidores.
- Rollout: `NARRATIVE_EXTRACTION_ATOMIC_RECEIPTS_READY=true` es reconocimiento operativo posterior a aplicar/verificar migración; no prueba automatizada de disponibilidad. `NARRATIVE_EXTRACTION_ENABLED=true` habilita nuevas escrituras solo para UUIDs de `NARRATIVE_EXTRACTION_ORGANIZATION_IDS` (CSV estricto, máximo 1000). `NEXT_PUBLIC_NARRATIVE_EXTRACTION_ENABLED=true` muestra confirmación en build cliente; nunca concede permiso servidor. Configurar origen confiable existente (`NEXT_PUBLIC_APP_URL`). No activar READY antes de verificación transaccional.
- Rollback: apagar ENABLED y UI; mantener READY mientras los RPCs de recibos estén disponibles para que recuperación continúe con permisos vigentes, incluso si organización sale del piloto. No eliminar recibos, clips ni historial. Revocar disponibilidad de persistencia bloquea ambos endpoints; jamás fallback a append genérico.

Validación técnica: dos casos nuevos de rollout más regresiones, **128 pruebas pasan**; compilación de tests, typecheck completo y lint de módulos nuevos/modificados de extracción y rutas pasan sin errores ni warnings. Lint del editor nativo finaliza con 0 errores y 52 warnings (refs/immutability y otras reglas de hooks en el módulo compartido); no se declara ese archivo libre de warnings ni se hace refactor ajeno para silenciarlos. Tests usan fakes, no verifican autenticación real, montaje/teclado/foco, Web Locks browser, transacción SQL ni media. Sin despliegue, flags activados, migraciones ejecutadas o QA formal.

Estado: búsqueda/selección/preescucha implementadas, falta QA. Extracción de voz ahora conectada de cliente a rutas bajo gate cerrado, todavía parcial por clasificación de rechazos definitivos, validación de historial y persistencia operativa pendiente. Fragmento audiovisual/captions e integración/corpus final siguen pendientes; objetivo no completado.

Siguiente: resolver rechazos definitivos sin abandonar ACK ambiguo, cerrar contrato de historial de extracción, ampliar planificador/autoridad/transacción a tracks y captions explícitos compatibles, y preparar checklist final para tester y migración autorizada.

## 22. Rechazos definitivos y recorte de captions — 2026-10-06

Resuelto el bloqueo permanente tras rechazo explícito de un apply nuevo. Handler distingue fase previa a posible commit y rechazo esperado del coordinador; añade `requestNotApplied` a error seguro. Marca true solo para APPLY sin recuperación requerida y sin posibilidad de commit. COMMAND_REUSED, recibo corrupto, fallo inesperado tras entrada al coordinador y ACK perdido permanecen inciertos; rechazo HTTP de RECOVERY jamás acredita el resultado de una transacción anterior.

- Cliente valida envelope completo de rechazo, tamaño real, marker literal, ausencia de retry y commandId coincidente cuando esté presente. Solo el apply recién generado puede devolver REJECTED; mensajes internos no se reflejan. No basta status 409/403/503 ni recoveryRequired=false por sí solos.
- Controller elimina exclusivamente el puntero de esa intención bajo lock. Fallo de limpieza mantiene bloqueo/registro; nunca lo sobrescribe. Sesión vuelve a IDLE solo después del rechazo validado y exige review antes de otro apply. UI descarta revisión local al fallar confirmación y explica consulta nueva frente a recuperación pendiente; sin retry automático.
- Rechazo en recuperación conserva comando aun si servidor deniega permisos actuales. Un recibo ausente sigue sin equivaler a «no guardado». El nuevo marker es reconocimiento negativo de esta solicitud fresca, no attestation histórica genérica.

Iniciada implementación audiovisual mediante `composition-narrative-caption-extraction.ts`: función pura de intersección en tiempos locales del clip. Preserva texto completo manual corregido, origen, lenguaje y estilo; no reconstruye caption desde palabras. Traslada cues/words al inicio del fragmento, excluye extremos sin intersección, asigna IDs deterministas nuevos y retorna avisos CUE_CUT/WORD_CUT con identidades originales. Fuente sin cues en la ventana retorna null explícito. El planner debe mostrar avisos antes de confirmar; esta función sola no agrega clips ni habilita extracción audiovisual.

Validación: diez casos nuevos más regresiones, **138 pruebas pasan**. Compilación de tests, typecheck completo y lint dirigido pasan sin errores ni warnings. Cubre negative ACK estricto, campo ausente/incorrecto, comando ajeno, rechazo de recovery, cleanup fallido, review posterior obligatoria, marker servidor ante permiso/conflicto/ACK/reuse, preservación de captions manuales, clipping, IDs, límites exclusivos y entradas inválidas. Tests Node/fakes; no sustituyen montaje React, medios reales ni SQL. Sin migraciones ejecutadas, QA formal, flags activados o cambios a CAPs.

Avance: búsqueda/selección/preescucha implementadas; voz conectada bajo rollout cerrado y rechazos definitivos resueltos, todavía falta validación técnica dirigida de historial/persistencia. Audiovisual parcial únicamente por recorte de captions; faltan planificación multitrack, dependencias obligatorias, registro autorizado de todas las fuentes, contrato UI/HTTP y commit atómico del conjunto. Integración/corpus final pendiente. Objetivo sigue activo.

Siguiente: implementar planificación multitrack sobre tracks elegidos explícitamente, incluyendo enlaces obligatorios o rechazo inequívoco, offsets relativos y captions recortados. Reutilizar reducers y binding autorizado; extender transacción existente para aplicar todo o nada, sin convertir el fragmento audiovisual en varios apply independientes.

## 23. Planificador audiovisual multitrack y binding de revisión — 2026-10-06

Implementados `composition-narrative-fragment.types.ts`, servicio puro de planificación, policy de registros de media y huella de revisión servidor. **No conectados todavía a consulta/apply HTTP audiovisual ni a SQL:** los endpoints actuales siguen siendo solo voz. Este incremento no habilita escritura audiovisual ni ejecuta migración.

- Tracks elegidos explícitamente, sin copiar todo lo superpuesto: 2–20 tracks distintos, ancla de voz obligatoria y algún visual. Máximo 48 clips para conservar margen bajo límite nativo de 100 operaciones. Rechazo completo de tracks inexistentes/locked/hidden, rango inválido o falta de ancla; no truncamiento silencioso.
- Intersección temporal por clip, destino APPEND y preservación de desplazamientos relativos. AUDIO/VIDEO reutilizan asset y ajustan sourceOffset con duración registrada; IMAGE reutiliza fuente sin fingir recorte temporal de pixels. Layout, crop, color, ganancia y flags de fuente se conservan. TEXT y CAPTION nativos conservan contenidos/estilos; captions consumen recortador de sección 22 y avisos sobre identidades originales.
- Enlaces voz/avatar ambiguos bloqueados; vínculo inequívoco exige ambos clips incluidos y ventanas originales alineadas en inicio/duración/offset. Copias reciben sceneId temporal nuevo, sin duplicar narrativeScene ni aprobación pedagógica. Colisión con identidad de escena existente se rechaza. Grupos se copian con IDs nuevos solo si todos sus miembros tienen copia retenida; no desagrupar silenciosamente.
- Rate distinto de 1, freeze, fades, animaciones y transiciones en clips elegidos bloqueados. Fuentes DECK_SLIDE (incluyendo HTML), branding y sound-effect asset requieren política de clonación/registro propia y retornan SOURCE_KIND_UNSUPPORTED; no se clonan referencias HTML a ciegas. Las fuentes ajenas al intervalo no bloquean ni se copian.
- Policy por registro: tenant/componente/vínculo, asset ID, checksum, QA admisible y MIME/tipo compatibles. AUDIO/VIDEO exigen duración precisa y ventana fuente dentro del registro. IMAGE admite duración ausente porque no es toma temporal. Esto es validación de metadata suministrada, **no consulta autorizada ni comprobación de bytes**. Adaptador futuro debe cargar y recheck todos estos registros dentro de transacción.
- Planner recoge fontAssetIds de texto/captions para autorización futura: no afirma que dichas fuentes estén autorizadas por mera presencia del UUID. No habilitar apply que omita ese control.
- Reutilización acotada: planificador de voz admite contexto interno de clips dependientes incluidos para validar el ancla de un lote audiovisual. Sin ese contexto conserva rechazo anterior de enlaces/grupos; endpoint VOICE_ONLY no recibe ni pasa esa ampliación desde cliente. Plan final usa sus operaciones multitrack, nunca guarda las operaciones del ancla como sustituto del conjunto.
- Operaciones completas simuladas con reducer/schema reales antes de retornar plan. Original, assets, referencias narrativas y grupos originales permanecen intactos. Huella opaca liga hash actual, tracks/intervalo, clips originales, ancla y todos los checksums/QA/duraciones; no depende de IDs aleatorios de copias entre review y apply. La huella no es autorización.

Validación: ocho pruebas nuevas y regresiones, **146 pruebas pasan**. Compilación de tests, typecheck completo y lint dirigido pasan sin errores ni warnings. Casos de intersección/offset, tracks no elegidos, registro ajeno/revocado/MIME/checksum/duración/vínculo, par obligatorio con nueva identidad, grupo completo, captions manuales, restricciones/collisiones y huella de todas las fuentes. Test usa registros en memoria y reducer real; no prueba HTTP audiovisual, consulta DB, commit multitrack, preview/MP4 ni QA formal. Sin CAPs modificadas, nuevas dependencias, flags activados o servicios externos.

Estado: búsqueda/selección/preescucha implementadas; voz integrada bajo gate cerrado, validaciones de historial/persistencia pendientes. Audiovisual ahora parcial con planner multitrack y captions implementados; todavía faltan repositorio/caso de uso autorizado para todas las fuentes/fonts, contrato y selección de tracks UI, revisión pública, coordinador y extensión SQL del lote atómico. Integración/corpus final pendiente; objetivo activo.

Siguiente: reconstrucción autorizada del plan audiovisual desde selección/track IDs y documento vigente, con lecturas acotadas y binding de fuentes; luego ampliar contrato público/confirmación y el commit atómico del conjunto. Mantener unsupported explícito para HTML y fuentes sin política aprobada, sin relajar CAPs paralelas.

## 24. Consulta audiovisual y repositorio de registros acotados — 2026-10-06

Implementados contrato público estricto, caso de uso de reconstrucción y adaptador Supabase de lectura. **No conectados todavía a HTTP/UI audiovisual:** el caller debe autorizar organización, actor y borrador antes de invocar el caso de uso. No sustituye autorización real ni revalidación transaccional.

- Consulta recibe únicamente selección y tracks explícitos; rechaza assets, operaciones y tenant enviados por cliente. Comprueba documento vigente, rango y tracks antes de consultar registros. Selección de clips compartida con el planner evita divergencia de membresía.
- Assets se consultan en batch bajo organización/borrador/componente, exigiendo todos los vínculos. Solo el ancla carga metadata completa de timestamps; las otras fuentes cargan campos mínimos. Número fijo de consultas, sin N+1 por clip. UUIDs, cantidad de filas, aborto y tamaño de respuesta se validan. El límite de 2 MiB se comprueba tras recibir PostgREST: no constituye un límite de memoria de transporte previo al buffering.
- Fuentes tipográficas consultadas por organización con máximo existente de 32. Se exige registro uploaded/READY, familia compatible con clips retenidos, checksum, MIME y tamaño válidos; ausencias, duplicados o familias incompatibles bloquean. Reutiliza contratos y reglas existentes de conformance, sin descargar fuentes ni copiar código externo. Huella de revisión incorpora manifiesto validado completo, no solo IDs.
- Resumen público versionado solo expone hashes opacos, intervalos de timeline/destino, conteos y advertencias de cortes. No expone documento, operaciones, IDs de fuentes, rutas Storage ni URLs. Declara REGISTRY_METADATA_MATCH_ONLY y revalidación obligatoria antes de aplicar: no verifica bytes ni garantiza snapshot consistente entre lecturas.
- DECK_SLIDE/HTML, branding y sound-effect siguen unsupported; no se amplía su política implícitamente. Sin nuevas dependencias, escrituras Storage, migraciones, flags activados ni cambios a CAPs paralelas.

Validación técnica: once pruebas nuevas más regresiones, **157 pruebas pasan**; compilación de tests, typecheck completo y lint dirigido pasan. Casos cubren filtros exactos con cliente Supabase simulado, batch sin N+1, vínculos ausentes, scope ajeno, respuesta excesiva, cancelación, contrato público, fuentes revocadas/ajenas/incompatibles y variación de fingerprint por checksum. No prueba consultas Supabase reales, autenticación/RLS, montaje React, bytes de media ni SQL. QA formal continúa reservada al tester.

Estado: búsqueda/selección/preescucha implementadas, falta QA; voz integrada bajo gate cerrado con persistencia/historial pendientes de validación. Audiovisual parcial: planner/captions y lectura de registros/fuentes implementados; pendientes integración HTTP, selección/revisión/confirmación UI, coordinador y commit SQL atómico del conjunto. Integración/corpus final pendiente. Objetivo no completado.

Siguiente: conectar consulta pública audiovisual con autorización y límites existentes, añadir selección explícita de tracks y revisión en UI; después ampliar coordinador/recuperación y SQL para un único commit multitrack. No habilitar apply audiovisual con la transacción de solo voz.

## 25. Ruta HTTP de revisión audiovisual — 2026-10-06

Conectado POST `.../drafts/[draftId]/narrative-fragment/plan` al caso de uso y repositorio de sección 24. Es consulta de elegibilidad, no apply ni recuperación; no depende de habilitar flags de escritura. Exige origen confiable configurado existente para funcionar.

- Autorización compartida con comandos de extracción: usuario autenticado, tenant activo del mismo usuario y permiso canReviewContent. Scope validado antes de cualquier operación service-role. El caso de uso verifica borrador por organización antes de documento/assets/fonts; no confía en tenant ni registros del cliente.
- Reutiliza bucket PLAN distribuido por organización/actor (12 consultas/60 s), compartido con revisión de voz; no nuevo contador local ni límite controlado por draftId. Falta de limiter bloquea lecturas. Retry-After acotado, sin retry automático.
- POST con selección fuera de URL, UUID válido, sin query string, JSON UTF-8 estricto y origen/Fetch Metadata same-origin. Lector de request compartido parametrizado por schema conserva contrato y comportamiento anterior de comandos: cap streaming real 8 KiB, cancelación y presupuesto 15 s propagado a consultas.
- Respuesta privada no-store, Vary y correlation ID; solo resumen validado. Draft ausente 404, revisión obsoleta 409, plan no elegible 422. Dependencia inesperada/aborto 503 sin reflejar error interno. IDs aleatorios de planificación se generan exclusivamente en servidor y no retornan como recibos ni autorización.
- No hay ruta apply audiovisual ni fallback a la transacción de voz. UI/selección/revisión audiovisual aún pendientes; no se afirma flujo completo. Sin migraciones ejecutadas, activación de flags, llamadas externas ni cambios a CAPs.

Validación técnica: siete casos HTTP nuevos más regresiones, **164 pruebas pasan**. Compilación de tests, typecheck completo y lint dirigido pasan sin errores ni warnings. Cubren éxito con reducer real y repositorio fake, origen/MIME/método/UUID/query, autenticación/scope/roles denegados, limiter caído/excedido, body/UTF-8/tamaño, revisión obsoleta, borrador ausente, aborto y error interno seguro. No prueba autenticación real, Supabase/RLS, infraestructura rate limit ni navegador.

Estado: búsqueda/selección/preescucha implementadas, falta QA; voz integrada bajo gate cerrado con persistencia/historial pendientes de validación. Audiovisual parcial con planner/captions, registros/fonts y consulta HTTP implementados; faltan transporte/UI, coordinador/recuperación y extensión SQL del conjunto atómico. Integración/corpus final pendiente; objetivo activo.

Siguiente: transporte y selección explícita de tracks/revisión audiovisual en UI, invalidando review y consentimiento ante cualquier cambio. Después coordinador idempotente y SQL multitrack, preservando recuperación de ACK ambiguo y revalidación transaccional de todas las fuentes.

## 26. Transporte y revisión audiovisual en la interfaz — 2026-10-06

Montado `CompositionNarrativeFragmentReview` dentro de los controles de rango existentes. No agrega player, exportador ni navegación alternativa. Revisión audiovisual separada de la confirmación solo voz: no presenta una escritura de voz como fragmento completo.

- Selección explícita de pistas, voz ancla obligatoria, mínimo contractual de dos y máximo 20. Pistas locked/hidden no disponibles. Ninguna pista superpuesta se incluye automáticamente; el servidor determina pertenencia y dependencias, no el checkbox. UI explica grupos/enlaces obligatorios y restricciones.
- Transporte browser-safe envía solamente selección/tracks por POST same-origin/no-store al endpoint de sección 25. Valida resumen estricto, revisión vigente y cantidad de pistas. Usa lector compartido de respuesta streaming 16 KiB y UTF-8 estricto. Sin retry automático, reflejo de errores internos ni fallback de escritura.
- Identidad local incorpora rango/borrador/hash y conjunto ordenado de pistas. Cambio de rango/disponibilidad remonta sesión, aborta petición anterior y elimina resultado visible; cambio de pistas aborta y borra revisión antes de reconsultar. Respuesta cancelada o de controller sustituido no recupera una elegibilidad antigua. Solo consulta por acción explícita; timeout 15 s y cooldown ante 429.
- Resultado muestra intervalo de timeline, destino APPEND, conteos de clips/pistas y cortes de captions/palabras. Texto manual se conservaría; registros no prueban bytes. Mensaje inequívoco de guardado audiovisual aún no habilitado. No hay consentimiento/botón apply audiovisual hasta integrar su coordinador y transacción.

Validación técnica: seis casos de cliente nuevos más regresiones, **170 pruebas pasan**; compilación de tests, typecheck completo y lint dirigido pasan sin errores ni warnings. Casos cubren payload/URL, contrato, scope/hash/tracks/intervalos ajenos, datos con operaciones, identidad de selección, no retry, errores seguros, abortos y respuesta excesiva/UTF-8. No montaje React, teclado/foco, HTTP desplegado ni Supabase real; QA continúa reservada al tester.

Estado: búsqueda/selección/preescucha implementadas, falta QA; voz integrada bajo gate cerrado con persistencia/historial pendientes de validación. Audiovisual parcial con revisión de punta a punta UI→HTTP→planner/registro implementada; faltan coordinador/recuperación, SQL atómico y confirmación del conjunto. Integración/corpus final pendiente; objetivo activo. Sin migraciones ejecutadas, flags activados, servicios externos ni cambios a CAPs.

Siguiente: contrato de intención/recibo multitrack y coordinador idempotente, revalidación de fuentes/fonts y un único commit SQL; integrar después confirmación y recuperación con el host editorial existente.

## 27. Intención, recibo y coordinador audiovisual — 2026-10-06

Implementados contrato de intención/recibo audiovisual y coordinador apply/recovery servidor. **Todavía sin adaptador RPC, SQL ni rutas de escritura:** el repositorio de comandos define una frontera transaccional obligatoria, no demuestra que exista. UI permanece solo revisión audiovisual.

- Intención estricta versionada: commandId, query de rango/pistas y reviewFingerprint. No acepta operaciones, fuentes ni scope del cliente. Huella canonical incorpora contrato, comando, revisión, todos los límites y conjunto de pistas; reordenar pistas no cambia intención. Scope organización/actor/borrador/comando validado antes de consultar recibo.
- Recibo versionado registra todos los IDs nuevos, ancla, hash final y versión. Valida cantidad, unicidad, ancla determinista y pertenencia al namespace del comando. ACK COMMITTED también exige exactamente el conjunto de copias del plan; no admite confirmar un lote parcial. Recibo no representa documento vigente, bytes de media ni permiso futuro.
- Apply consulta recibo primero: replay de la intención original precede a lectura de documento/fuentes, incluso tras ediciones posteriores. Intención diferente devuelve COMMAND_REUSED; recibo corrupto bloquea. Si no hay recibo, reconstruye desde registros actuales y compara huella revisada antes de solicitar **un solo commit completo**. La transacción deberá revalidar nuevamente fuentes/fonts/vínculos/hash, deduplicar y guardar documento/audit/recibo juntos.
- CONFLICT/ASSET_CHANGED/FONT_CHANGED/BUSY/COMMAND_REUSED del writer son explícitos, sin retry. Fallo, aborto post-dispatch o ACK inválido se consideran inciertos mediante error de recuperación compartido con voz. No dividir el lote ni usar RPC de voz como fallback.
- Recovery solo consulta recibo scoped y compara intención; nunca carga media ni invoca commit. Ausencia sigue COMMIT_UNCONFIRMED, no prueba rollback. No restaurar un documento histórico desde el recibo.

Validación técnica: ocho casos nuevos más regresiones, **178 pruebas pasan**; compilación de tests, typecheck completo y lint dirigido pasan sin errores ni warnings. Casos cubren reconstrucción real de dos clips, un commit, scope, replay previo, intención cambiada, fuente/revisión obsoleta, conflictos, ACK perdido, recibo corrupto/parcial/con conjunto ajeno, aborto tras dispatch, recovery sin escritura y huella canonical. Writer simulado: no demuestra atomicidad, idempotencia concurrente real, permisos/RLS ni PostgreSQL. QA formal sigue pendiente del tester.

Estado: búsqueda/selección/preescucha implementadas, falta QA; voz integrada bajo gate cerrado con validaciones operativas pendientes. Audiovisual parcial: revisión UI/HTTP y coordinador implementados; faltan adaptador RPC, migración del commit multitrack, rutas apply/recovery y conexión de confirmación/recuperación al host. Integración/corpus final pendiente. Sin migraciones ejecutadas, flags activados, llamadas externas ni cambios a CAPs. Objetivo activo.

Siguiente: adaptador de persistencia y SQL audiovisual con guardas completas de fuentes/fonts y lote no destructivo; después rutas bajo gate cerrado y reutilización del host para confirmación/recuperación.

## 28. Adaptador de persistencia audiovisual — 2026-10-06

Implementado `composition-narrative-fragment-command.repository.ts`, sin conexión a rutas de escritura. **RPCs audiovisuales todavía no implementados en SQL:** este adaptador no acredita atomicidad ni habilita guardado por sí solo.

- Recibos consultados con organización/borrador/actor/comando completos. Resultado validado contra contrato multitrack. Transporte Supabase deshabilita retries y propaga señal de cancelación tanto a lectura como commit.
- Commit recarga documento vigente y comprueba base hash. Si difiere, consulta recibo nuevamente para reconocer un comando completado concurrentemente, sin escribir. Intención ajena devuelve COMMAND_REUSED; ausencia devuelve CONFLICT.
- Lote restringido a una extensión de canvas, altas de clips y grupos; IDs añadidos deben corresponder exactamente a las copias del plan. Simula con reducer/schema nativos y preserva referencias HTML existentes. Envía documento calculado, hash canonical, plan completo de assets/fonts y fingerprint a **un RPC** `commit_narrative_fragment`.
- Resultados del RPC son estrictos; error, ausencia de migración, estado desconocido o recibo inválido no activan fallback a voz, append genérico ni escritura por clip. La transacción pendiente debe validar todos los registros/vínculos/fonts y conservar documento/audit/recibo de forma indivisible.

Validación técnica: cinco casos nuevos más regresiones, **183 pruebas pasan**; compilación de tests, typecheck completo y lint dirigido pasan sin errores ni warnings. Casos cubren reducer real/hash, un único RPC, scope, revisión obsoleta y recibo concurrente, intención diferente, fallos/contrato inválido/lote inválido y retry/cancelación. Transporte y RPC simulados; no prueba PostgreSQL, atomicidad real, locks, RLS o infraestructura desplegada. Sin migraciones ejecutadas, flags activados, llamadas externas ni modificaciones a CAPs.

Estado: audiovisual todavía parcial: lectura/revisión UI y coordinador/adaptador implementados; faltan SQL multitrack, rutas apply/recovery y confirmación/recuperación de UI. Búsqueda/selección/preescucha implementadas, falta QA; voz permanece bajo gate cerrado. Integración/corpus final pendiente; objetivo activo.

Siguiente obligatorio: implementar migración aditiva de receipts y commit audiovisual, revalidar todo el lote bajo locks de orden estable, sin relajar protección de HTML ni restricciones de edición; conectar luego rutas y host bajo rollout cerrado.

## 29. Guardas SQL de recursos audiovisuales — 2026-10-06

Preparada, **no ejecutada**, migración `20261006100000_narrative_fragment_resource_guards.sql`. Separa validación de recursos del futuro commit para mantener responsabilidades revisables. **No crea todavía receipts ni implementa `commit_narrative_fragment`: el guardado continúa incompleto y cerrado.**

- Función privada SECURITY DEFINER con search_path pg_catalog y sin EXECUTE para PUBLIC/anon/authenticated/service_role. Solo el futuro commit autorizado debe invocarla bajo lock previo del borrador, suministrando clips originales retenidos tras validar el delta completo. Esta función sola no autoriza selección ni operaciones.
- Manifiestos únicos y acotados, conjunto exacto de production assets usados por clips retenidos, tenant/componente/vínculo de borrador. Adquisición ordenada por UUID con SHARE NOWAIT para impedir cambios no-key/deleciones de assets/vínculos durante transacción. Locks conflictivos se propagan al caller para rollback de todo el lote; no se convierten aquí en éxito parcial.
- Revalidación de checksum, QA admisible, duración y compatibilidad tipo/MIME por AUDIO/VIDEO/IMAGE. Ventana fuente debe caber en asset temporal. Ancla exige asset de voz, metadata/scriptHash y timestamps iguales al documento actual; valores nulos no acreditan identidad.
- Fuentes exactas de texto/captions retenidos: tenant, uploaded/READY, familia, hash, MIME y tamaño hasta 50 MiB, locks ordenados. Ausencia/revocación o binding incompatible produce FONT_CHANGED; assets incompatibles producen ASSET_CHANGED. Sin downloads, Storage paths ni servicios externos.
- Limitación explícita: falta validar/reconstruir delta de copias/captions/grupos/enlaces, deduplicar comando y persistir documento/audit/recibo. No usar este helper como sustituto del commit, no activar flags ni relajar fuentes HTML unsupported.

Validación técnica: tres inspecciones estáticas nuevas más regresiones, **186 pruebas pasan**; compilación de tests y lint dirigido pasan. Inspecciones cubren scope/manifiestos/privilegios, locks ordenados, bindings y ausencia de escritura/fallback. **No parsing/ejecución SQL, RLS real, locks concurrentes ni atomicidad:** la migración requiere validación en entorno de prueba antes de rollout. Sin migraciones ejecutadas, flags activados ni cambios a CAPs.

Estado: guardas SQL de recursos preparadas; extracción audiovisual sigue parcial por commit SQL, rutas y confirmación/recuperación UI. Búsqueda/selección/preescucha implementadas, falta QA; integración/corpus final pendiente. Objetivo activo.

Siguiente obligatorio: validación SQL del delta exacto no destructivo y commit con receipts en una sola transacción, invocando estas guardas; después conectar rutas y host bajo gate cerrado.

## 30. Guardas SQL de captions y copias individuales — 2026-10-06

Preparadas, **no ejecutadas**, migraciones `20261006110000_narrative_fragment_caption_guard.sql` y `20261006120000_narrative_fragment_clip_guard.sql`. Helpers privados puros, sin escrituras ni permiso de ejecución para roles API. **No implementan aún el delta global ni `commit_narrative_fragment`.**

- Caption guard valida todas las cues/words retenidas en orden, IDs deterministas de comando/ordinal y cantidades exactas. Preserva texto manual y cada campo no temporal, estilo/origen/lenguaje de la fuente. Intersección de extremo exclusivo y tiempos locales; fuente sin cues dentro del rango solo admite omisión, no contenido inventado. Tipos JSON numéricos estrictos y tolerancia temporal de 1 μs para cálculo decimal frente a IEEE-754. Presencia/ausencia de words original se conserva; máximo 2000 cues y 20 words por cue, alineado con schema nativo.
- Clip guard valida copia individual desde original, ventana y destino: IDs/hfId/label, timingSource, sceneId suministrado por futuro validador de enlaces, intersección/posición relativa/duración, sourceOffset y duración registrada. Campos fuera del delta permitido deben permanecer iguales. Source de production/text intacto; captions delegan al guard anterior. IMAGE/capas nativas conservan campos offset originales.
- No permite fuentes no soportadas, clip hidden, rate diferente de 1, freeze o fades. Motion/transiciones, permisos de pista, membresía exacta, enlace voz/avatar y grupos requieren todavía la guarda global; los parámetros del helper no prueban esas condiciones ni autorizan copiar una escena. No activar guardado con helpers aislados.

Validación técnica: cinco inspecciones estáticas nuevas más regresiones, **191 pruebas pasan**; compilación de tests y lint dirigido pasan. Inspecciones cubren límites, restricciones, preservación de campos/texto, IDs, conteos, extremos/tolerancia y ausencia de escrituras/permisos públicos. No parsing/ejecución SQL ni prueba de equivalencia runtime entre PostgreSQL y reducer; esa validación sigue pendiente antes de rollout. Sin migraciones ejecutadas, flags activados o cambios a CAPs.

Estado: guardas SQL de recursos/captions/copias individuales preparadas. Audiovisual todavía parcial por delta global, commit/receipts, rutas y confirmación/recuperación UI. Búsqueda/selección/preescucha implementadas, falta QA; objetivo activo.

Siguiente obligatorio: validar conjunto exacto de pistas/clips y enlaces/grupos desde documento vigente, reconstruir documento append-only completo y conectar el commit transaccional con recibo multitrack. Mantener gating cerrado hasta disponer del flujo íntegro.

## 31. Delta global y commit SQL audiovisual preparados — 2026-10-06

Preparadas, **no ejecutadas**, migraciones `20261006130000_narrative_fragment_selection_guard.sql`, `20261006140000_narrative_fragment_document_delta.sql` y `20261006150000_narrative_fragment_atomic_receipts.sql`. Completan código SQL del RPC esperado por el adaptador; **no prueban que funcione en PostgreSQL ni habilitan escritura**.

- Membership: pistas explícitas únicas/disponibles, conjunto exacto de clips visibles que intersectan intervalo, voz ancla dentro de su toma y visual obligatorio. Bloquea efectos/motion/transiciones, links ambiguos/incompletos o no alineados y grupos parciales. Los clips fuera del rango no se incluyen implícitamente.
- Plan interno añade `candidateClipIds` ordenados, ligados a huella de review. SQL valida igualdad de conjuntos antes de consumir ese orden para IDs/captions: no depende de que collation PostgreSQL coincida con Intl.localeCompare. Incluye candidatos de captions que puedan omitirse por ausencia de cues; no cambia payload público de consulta.
- Delta global: valida cada copia con guardas de sección 30, omite captions solo si no hay cues retenidas, exige mappings exactos, IDs nuevos sin colisiones y orden completo. Clona vínculo temporal bajo sceneId nuevo y grupos completos bajo IDs nuevos. Construye documento esperado solo ampliando canvas y agregando clips/grupos; igualdad completa impide modificar originales, contenido ajeno o referencias HTML/narrativas. Documentos legacy que exijan normalización distinta fallan cerrado, no se reconcilian automáticamente.
- Commit service-only: lock draft-first NOWAIT, recibo deduplicado por organización/borrador/actor/comando antes de revision/assets, hash base vigente y composición scoped. Valida delta completo y luego recursos/fonts con SHARE locks de sección 29. Un único append nativo agrega documento/audit; inserta recibo multitrack en la misma función/transacción. Recibo confirma commit histórico, no render/Storage ni documento actualmente visible.
- Tabla de recibos con PK de scope completo y RLS, sin acceso directo incluso service_role; solo RPCs de lectura/commit concedidos a service_role. Intento diferente devuelve COMMAND_REUSED; revisión nueva inválida CONFLICT; recurso/font cambiado bloquea. Exception boundary de lock_not_available revierte escrituras antes de BUSY. No fallback a voz ni append/receipt en transacciones separadas.
- Rollback previsto: desactivar nuevas escrituras, mantener recibos y recuperación; no borrar historia. Rutas/apply audiovisual y host aún sin conectar, flags sin activar; migraciones aditivas requieren aplicación y validación autorizadas aparte.

Validación técnica: seis inspecciones SQL estáticas nuevas y ampliación de prueba real de planner/huella más regresiones, **197 pruebas pasan**; compilación de tests, typecheck completo y lint dirigido pasan sin errores ni warnings. Evidencia cubre declaraciones de membership/privilegios/locks, delta completo, orden dedup→fuentes→append→receipt y huella sensible a orden de candidatos. **No parsing/ejecución PostgreSQL, permisos/RLS reales, carreras, rollback real ni equivalencia SQL/reducer:** obligatorio comprobar en entorno de prueba antes de rollout. No se ejecutó ninguna migración ni servicio externo ni se modificaron CAPs.

Estado: búsqueda/selección/preescucha implementadas, falta QA; voz permanece bajo gate cerrado. Audiovisual parcial con revisión UI/HTTP, coordinador/adaptador y todas las piezas SQL preparadas; faltan rutas de escritura/recuperación, confirmación/recuperación de cliente y validación operativa. Integración/corpus final pendiente; objetivo activo.

Siguiente obligatorio: conectar handlers apply/recovery audiovisuales autorizados bajo gate separado cerrado, proyectar recibo público estricto y reutilizar bloqueo/journal/recarga del host para confirmar el lote completo. Mantener la activación condicionada a validar migraciones y transacción real.

## 32. Resultado público y transporte de comando audiovisual — 2026-10-06

Implementados contrato de resultado público, proyección servidor de recibo y transporte browser-safe apply/recovery. **Endpoints y host audiovisual aún pendientes de conexión:** el transporte no se invoca desde UI ni habilita escritura.

- Resultado versionado distingue COMMITTED/REPLAYED/CONFIRMED de UNCONFIRMED. Confirmación incluye hash/version, ancla y IDs de todos los clips nuevos; scope DATABASE_COMMIT_ONLY y recarga obligatoria del documento vigente. No expone fingerprint interno de intención, documento, operaciones ni registros de recursos. Resultado incierto no admite campos de recibo.
- Reglas de identidad compartidas entre recibo interno y resultado público: ancla determinista, conjunto único de 2–48 clips, namespace del mismo comando y ordinal canonical 0–47. Datos parciales, duplicados, IDs ajenos o campos adicionales no confirman el lote.
- Transporte envía la misma intención strict a `/narrative-fragment/apply` o `/narrative-fragment/receipt`; no voice fallback ni retry automático. Usa lector compartido streaming 16 KiB/UTF-8 estricto, señal de aborto, credenciales same-origin y no-store. Solo acepta estados compatibles con acción y commandId actual.
- Reutiliza contrato de negative ACK existente: solo un rechazo explícito de APPLY fresco puede ser REJECTED. Error de RECOVERY jamás acredita rollback de un guardado anterior. Fallo, aborto tras dispatch, ACK malformado, respuesta excesiva, receipt inválido y estado incompatible permanecen UNCONFIRMED. Mensajes del backend no se reflejan al usuario.

Validación técnica: seis casos nuevos más regresiones, **203 pruebas pasan**; compilación de tests, typecheck completo y lint dirigido pasan sin errores ni warnings. Pruebas cubren proyección opaca, mismo payload/endpoints, resultados parciales/ajenos/duplicados/estado erróneo, datos internos, límites/UTF-8, abortos, negative ACK y recovery incierta. Fetch simulado: no HTTP desplegado, navegador, permisos reales ni SQL. Sin migraciones ejecutadas, flags activados o CAPs modificadas.

Estado: audiovisual parcial con contratos/transporte de comandos preparados; faltan handlers/rutas apply/recovery, sesión/journal/confirmación del host y validación operativa. Búsqueda/selección/preescucha implementadas, falta QA. Objetivo activo.

Siguiente obligatorio: handlers autorizados y rutas bajo gate audiovisual separado, usando proyección estricta y negative ACK correcto; luego integrar sesión de comandos audiovisual sin duplicar bloqueo/journal ni perder recuperación entre voz y multitrack.

## 33. Rutas de aplicación y recuperación audiovisual — 2026-10-06

Conectados handlers, composition root y endpoints POST `/narrative-fragment/apply` y `/narrative-fragment/receipt`. La UI aún no envía comandos audiovisuales; activación cerrada por defecto.

- Controlador HTTP común para voz y audiovisual: misma política de origen explícito, autenticación/tenant/rol vigente, UUID, JSON estricto con límite streaming, timeout, rate limit distribuido, no-store, correlation ID y semántica de rechazo/guardado incierto. Adaptadores separados conservan contratos, coordinadores y recibos propios. No fallback a escritura de voz.
- Root audiovisual verifica acceso actual al borrador antes de construir repositorios. Apply revalida plan/recursos y usa únicamente RPC multitrack; receipt consulta el recibo sin reconstruir fuentes ni repetir append. Confirmación pública incluye todos los clips, no fingerprint interno ni operaciones.
- Gates independientes: `NARRATIVE_FRAGMENT_ATOMIC_RECEIPTS_READY=true` es reconocimiento operativo tras validar migraciones audiovisuales; `NARRATIVE_FRAGMENT_ENABLED=true` habilita apply únicamente con READY; `NARRATIVE_FRAGMENT_ORGANIZATION_IDS` exige allowlist UUID válida. Ninguna variable fue activada. Flags de voz no habilitan audiovisual.
- Rollback: desactivar ENABLED impide nuevas escrituras. Con READY y permisos vigentes, recovery permanece disponible sin exigir allowlist actual; no borra recibos ni documento histórico. READY no detecta ni certifica migraciones.
- Recibo ausente devuelve 202 UNCONFIRMED. Comando reutilizado, recibo corrupto o consulta fallida no acreditan que nunca se guardó; no se autoriza retry automático. FONT_CHANGED se informa como conflicto, sin detalles internos de recursos.

Validación técnica: seis casos nuevos más regresiones, **209 pruebas pasan**; compilación de tests, typecheck completo y lint dirigido pasan sin errores ni warnings. Pruebas nuevas verifican replay/recuperación sin append ni lectura de fuentes, proyección opaca, gates/origen/body/ruta, autorización, rate limiting, receipt ausente, reutilización/corrupción/fallo y rollout separado. Dependencias HTTP/DB simuladas: no evidencia de SQL ejecutado, RLS/locks reales, navegador ni infraestructura desplegada. QA formal sigue reservado al tester; ninguna migración, despliegue o servicio externo fue ejecutado.

Estado: búsqueda/selección/preescucha implementadas, pendientes de QA. Voz implementada bajo gate. Audiovisual sigue parcial por integración de confirmación y recuperación con sesión/journal/bloqueo/recarga/historia del host; corpus y checklist final pendientes. Objetivo activo.

Siguiente obligatorio: extender la sesión y journal existentes para discriminar voz/audiovisual y conservar un único bloqueo por borrador; integrar botón de confirmación multitrack, recuperación tras recarga y verificación del conjunto completo de clips antes de cerrar el comando.

## 34. Ciclo de comandos y journal compartidos — 2026-10-06

Implementado ciclo común browser-safe para voz y audiovisual. **El host React aún monta únicamente el controlador de voz:** faltan selección del controlador según el comando pendiente, confirmación audiovisual y callback de recarga multitrack.

- `NarrativeCommandSession` concentra estados de revisión, aplicación, incertidumbre, recuperación y recarga requerida. Políticas de voz/audiovisual conservan schemas, claves de revisión y proyección de recibos propias; API de sesión de voz compatible. Estado e intención se entregan detached, sin permitir mutación del comando en curso.
- `NarrativeCommandController` comparte reserva previa a dispatch, Web Lock por scope, no retry, recuperación solo por recibo, conservación tras errores y limpieza solo tras rechazo probado o recarga autorizada. Adaptadores de voz y audiovisual usan transportes separados y el mismo mecanismo; callback audiovisual recibe todos los IDs, ancla y hash, no solo ancla.
- El journal mantiene **la misma clave y envelope por organización/actor/borrador**; contrato del comando discrimina voz/audiovisual. No hay segunda cola ni TTL ni migración de datos locales. Pointers de voz previos siguen legibles. Lectores antiguos/de voz fallan cerrados ante audiovisual en lugar de sobrescribirlo.
- Lectura común permite recuperar el tipo correcto al remontar el futuro host. Corrupción, tamaño excesivo, scope ajeno y quota fallan cerrados sin eliminar evidencia; un comando de cualquier tipo impide reservar otro en el mismo scope.
- Recibo debe corresponder al commandId y acción actual; recuperación no acepta rechazo como prueba de rollback ni COMMITTED como respuesta de receipt. Revisión vincula rango y conjunto de pistas; count/hash incoherentes no habilitan apply.

Validación técnica: siete casos nuevos más regresiones, **216 pruebas pasan**; compilación de tests, typecheck completo y lint dirigido pasan sin errores ni warnings. Casos verifican journal compartido/compatibilidad, rango+pistas/intención immutable, reserva previa a dispatch, batch completo en callback, reload fallido, ACK perdido, remount recovery-only, exclusión entre tipos y quota/corrupción. Locks, Storage, fetch y reload simulados: no prueba navegador/React, SQL real ni aislamiento entre dispositivos. Gate sin activar, migraciones sin ejecutar, CAPs sin modificar.

Estado: búsqueda/selección/preescucha y voz implementadas, pendientes QA. Audiovisual parcial: controlador y persistencia local listos, falta conectar host/UI/recarga/historial y cerrar corpus/checklist. Objetivo activo.

Siguiente obligatorio: host con un único controlador activo elegido desde el journal o la confirmación explícita; montar audiovisual bajo flag público independiente, añadir confirmación no destructiva y verificar recarga de todo el lote sin restaurar documentos históricos.

## 35. Integración audiovisual en host y editor — 2026-10-06

Conectados host, confirmación audiovisual y recarga/historial existentes. Un único `NarrativeEditorController` elige la política de voz/audiovisual desde el pointer al remontar o al revisar una intención nueva. No se reemplaza un comando en curso para cambiar de tipo; espera de Web Lock ya se considera trabajo bloqueante.

- Recuperación identifica el contrato del pointer y usa su endpoint de recibo, nunca apply automático. Sigue disponible con flags de nueva extracción apagados, sujeto a autorización y READY del servidor. Ambos tipos comparten panel de recuperación, bloqueo y journal.
- `NEXT_PUBLIC_NARRATIVE_FRAGMENT_ENABLED=true` habilita la confirmación audiovisual UI únicamente cuando Storage/Web Locks/scope están disponibles y no hay comando pendiente. Flag independiente de voz, cerrado por defecto; no se activó. Servidor sigue exigiendo READY, ENABLED y organización piloto propia.
- Revisión muestra pistas explícitas, número de clips/pistas, origen/destino y recortes de captions/palabras. Checkbox inequívoco confirma copia no destructiva al final. Cambiar pistas/rango o pedir revisión nueva invalida intención; fallo no repite guardado.
- Recarga del hash confirmado exige todos los clip IDs del recibo antes de adoptar documento e historial. Revisión autorizada posterior se conserva, incluso si eliminó clips: recibo histórico no restaura contenido antiguo. Selección enfoca ancla disponible; mismo checkpoint de historial registra todo el lote como un comando USER si hash recargado corresponde al commit. Tras remount no inventa checkpoint de undo.
- Conflictos con save queue, guardado activo, presets y trabajo HTML bloquean confirmación. Guardas compartidas de payload/save queue/bypass/HTML impiden nuevas mutaciones durante extracción pendiente; inert y panel externo permanecen únicos. No cambia contratos ni porcentajes de CAPs.

Validación técnica: cuatro casos nuevos más regresiones, **220 pruebas pasan**. Casos cubren cambio de política solo en revisión, remount recovery-only de ambos tipos, callback multitrack/voz, bloqueo inmediato durante espera de lock, doble confirmación y reload de lote completo/revisión posterior. Typecheck completo pasa; módulos nuevos/host/revisión pasan lint dirigido. React/browser, preview/MP4, undo/redo real y transacción SQL quedan para QA. No se ejecutaron migraciones ni servicios externos.

Estado: búsqueda/selección/preescucha, voz y audiovisual tienen implementación conectada bajo gates cerrados. Sigue pendiente cierre técnico del bloque 5: casos de corpus integrables al mecanismo de conformidad existente, checklist operativo/QA y auditoría final de requisitos. Objetivo activo; todavía no se declara finalizado.

Siguiente obligatorio: preparar corpus reproducible de extracción con fuentes locales del corpus existente (sin otro gate ni aprobación ficticia), documentar ejecución por tester y verificar cobertura del plan completo.

## 36. Corpus, auditoría final y entrega a QA — 2026-10-06

Completado el bloque 5 de implementación. La instrucción del usuario permite cerrar este objetivo al llegar a QA; **no se declara aprobación de producción, ejecución SQL ni conformidad audiovisual medida**.

- Integradas `narrative-voice-extraction` y `narrative-audiovisual-captions` en el catálogo de corpus de medios existente. Usan WAV locales con bytes/checksum reproducibles, planner/reducer reales, source offset, append no destructivo y captions manuales recortados. No hay segundo gate ni exportador; metadata temporal del fixture es sintética sobre tonos y no acredita habla.
- Las recetas participan en validación/schema/hash/checkpoints/compilación del corpus anterior. Casos narrativos dedicados verifican originales, offset/duración de copia, recorte exacto de cues/words y ambos targets preview/render a 24/25/30/60 FPS. No se capturó ni renderizó MP4.
- Preparado [handoff de QA](SOFLIA_EDITOR_NARRATIVE_SEARCH_EXTRACTION_QA_HANDOFF.md): matriz requisito/evidencia/aceptación, comandos, recetas, siete migraciones/dependencias, permisos/atomicidad/concurrencia, flags y rollback, checklist de browser/media/historial/seguridad/performance. No solicita instalar herramientas adicionales ni aprobar CAPs ajenas.
- Auditoría de cierre usa alcance original y código actual: búsqueda/ocurrencias/rango montados en panel; preescucha integrada en transporte; voz y audiovisual conectados UI→host→controller→HTTP→coordinador→RPC; receipts/journal/recarga/historial; guardas explícitas unsupported y rollout cerrado. Los únicos puntos no acreditados corresponden a QA/validación operativa, cuya ejecución queda al tester según instrucción.

Validación final: **226 pruebas dirigidas pasan** (narrativas y corpus de medios); compilación de tests, TypeScript completo y lint dirigido de nuevos cambios pasan sin errores. Componente NativeCompositionPreview conserva 52 warnings previos, documentados en el incremento anterior; no se afirma lint global limpio. Tests SQL son estáticos y adaptadores simulados: no prueba PostgreSQL real, permisos, rollback/locks, browser, accesibilidad perceptual ni paridad MP4.

| Bloque | Estado final de implementación |
|---|---|
| 0 — Contratos/procedencia/restricciones | Completado; exactitud temporal de audio real pendiente QA |
| 1 — Búsqueda | Completado; navegador/accesibilidad/performance pendiente QA |
| 2 — Rango/preescucha | Completado; timing perceptual y transporte real pendiente QA |
| 3 — Copia de voz | Completado bajo gates; SQL/historial/recuperación real pendiente QA |
| 4 — Fragmento audiovisual | Completado para fuentes elegibles V1; SQL/reducer/media/fonts/concurrencia real pendiente QA |
| 5 — Corpus/observabilidad/rollout/handoff | Completado; capturas/render/aceptación y activación autorizada pendientes |

No quedan implementaciones parciales identificadas dentro del alcance V1 definido en este plan. Restricciones V1 (HTML editable, effects/rate/freeze incompatibles, no búsqueda semántica/ripple/exportador) permanecen explícitas, no se contabilizan como funcionalidad implementada ni se relajan para cerrar.
Siguiente fase: el tester ejecuta el handoff y autoriza o rechaza rollout. No se ejecutaron migraciones, se activaron flags, desplegaron servicios ni modificaron CAPs.
