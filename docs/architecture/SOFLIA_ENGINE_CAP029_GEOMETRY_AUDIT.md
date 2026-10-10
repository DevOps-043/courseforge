# CAP-029 — auditoría de geometría y alcance de I02

Fecha: 2026-10-10. **I02 implementado/preparado; ambiente y QA pendientes**:
layout/geometría computados y guard autorizado de cuotas existentes conectados.
Métrica general100% de implementación necesaria, no de aceptación productiva.
Perfiles vigentes: `courseforge-html-static-geometry-v11-computed-paint` y
`courseforge-html-isolation-v2-contained-box`. No certifica browser, render ni
contención física reales. Los cortes inferiores conservan su evidencia histórica.

## Requisito y frontera

R21/Fase4 exigen admisión segura, source inmutable y aislamiento de HTML editable;
R22 exige la misma derivación para preview/render. El presupuesto de declaraciones
no demuestra el layout/pintura resultantes ni cuotas físicas. La fuente original,
los hashes y snapshots anteriores no se reescriben para aparentar conformidad.
El código compartido propio está permitido. El usuario autorizó posteriormente
integraciones HTML puntuales en el executor CAP027, previews de propuestas/presets
y catálogo UX; no libera el resto del worker/gates ni política/stores CAP025.
No se añaden operaciones editoriales nuevas.
La autorización puntual posterior permite únicamente el guard HTML de cuotas en
composition-windows-render-worker-host.ts, sin cambiar bridge/límites/gates/stores.

## Brecha corregida: viewport SVG sustituido por CSS

El recorrido anterior validaba tokens CSS y atributos SVG por separado y propagaba
solo el mapeo de atributos. Una fuente con `width=1`, `height=1`, `viewBox="0 0 1 1"`
y CSS `width:32px;height:32px` tenía dimensiones individualmente admitidas, pero
su escala efectiva32 no entraba en el envelope de atributos. Lo mismo ocurría con
CSS contextual, una hoja posterior al SVG, min-width/height y un SVG apagado con0
que CSS revivía. No era solamente falta de QA.

`html-editing-svg-css-viewport.server.ts` reúne las alternativas fijas relevantes
después de admitir todo DOM/CSS. Incluye atributos y CSS inline/hojas/contextual,
media/supports/layers/importancia sin crédito por un supuesto ganador de cascada.
Sujetos simples tag/id/class excluyen HTML no relacionado; wrappers `:is/:where`
reutilizan el análisis. Ancestros del selector pueden pertenecer al ensamblaje:
se considera el sujeto posible, no solo un match de selector completo en el fragmento.
Sujetos complejos se incluyen conservadoramente, sin usar una consulta DOM como grant.
Pseudo-elementos conocidos no dimensionan el viewport real del SVG.

Límites explícitos de trabajo:65.536 sujetos,2.000.000 caracteres de selector y
profundidad16. Se comprueban antes de trabajo ilimitado, no con un timeout que
pretenda interrumpir JavaScript síncrono. No dependencia nueva ni CSS evaluado.
El envelope usa desigualdad triangular por componente para origins/alignment y
evita recuperar presupuesto mediante cancelación o tamaños máximos que se alinean
exactamente entre sí. Un segundo recorrido preorder propaga la geometría CSS por
ancestros y transformaciones SVG; hermanos no se multiplican mutuamente.

`parseHtmlEditingStaticSource` reutiliza este lector antes de retornar el fragmento.
El compilador editorial vuelve a validar el output tras overrides; el compilador
compartido valida también deckStyles contextual. Ambos targets consumen estos
mismos mecanismos. No muta HTML/CSS/source/native y no reinterpreta geometry-v8.
Snapshots de perfiles previos pasan por diagnóstico/revisión histórica existentes,
o reconstrucción explícita cuando la fuente no supera la admisión actual.

Semántica contrastada con [SVG2, coordenadas/viewport](https://www.w3.org/TR/SVG2/coords.html)
y [CSS Sizing3](https://www.w3.org/TR/css-sizing-3/): el viewport depende de sizing y
su relación con viewBox/preserveAspectRatio, no solo de un número de atributo.

## Matriz histórica del corte inicial de geometría

| Elemento | Evidencia actual | Estado / siguiente obligación |
| --- | --- | --- |
| Complejidad DOM/CSS y clocks autónomos | Parser estático, límites compartidos, pruebas negativas de CSS/HTML | Implementado/preparado; ejecución real aparte |
| Path SVG absoluto/relativo, controles/arc correction, transforms acumulados | Gramática/path/viewport/geometry y pruebas existentes | Implementado a nivel de admisión; no prueba de rasterización |
| Atributos SVG y alternativas CSS fijas de viewport | Lector nuevo, segundo recorrido y targets compartidos | Brecha local corregida; scoping/cascade reales en QA |
| Tamaños relativos/intrínsecos, font/rem/% y viewport sin base determinada | `requiresComputedAuthority=true`, `fixedBudget=null` si no hay alternativa fija comprobable; los controles previos no se relajan | **Pendiente de implementación** de autoridad de sizing computado. No aceptar el flag como prueba ni completar I02 por este módulo |
| Cascada efectiva, flex/grid implícito, overflow/fragmentación/multicolumn | Hay gramática/expansión explícita limitada, no medición ni bound del layout completo | **Pendiente** política/contrato del layout completo. Resolver en una frontera común, no con más listas de strings |
| Paint/sampling, dimensiones de recursos/fuentes y cuotas independientes | Identidades/MIME/hashes/fonts autorizados; ejecutor/CAP027 reservado | Integración de autoridad/contención necesaria. No inventar otro renderer/gate ni declarar instalación física por metadata |
| Mismo output preview/render | Una nueva prueba usa los dos compiladores concretos, rechazo de CSS32px y fragmentos iguales para CSS2px | Evidencia estructural, no píxeles ni ejecución física |

La implementación actual **no rechaza automáticamente todo sizing relativo** ni
elimina funcionalidad para poder cerrar I02. Comprueba las alternativas fijas
conocidas incluso si otras requieren sizing computado; la incertidumbre restante
no es identidad, aprobación ni una afirmación de seguridad integral. No habilitar
una entrega final apoyándose solo en este presupuesto parcial.

## Verificación y riesgos residuales

Siete pruebas nuevas del lector y una prueba de los targets compartidos. Selección
dirigida final conjunta:32/32 geometry/viewport/presentation/estilos contextuales;
regresión1020/1020 sin fallos/skipped/cancelled. Compilación de tests, tipado web y
lint dirigidos aprobados. No aumentar métrica general por estos conteos.
Casos: CSS inline/posterior/contextual/conditional/layers, selector con ancestros
externos o unión, min sizes/origins/cero revivido, ancestros/siblings, CSS-only,
alternativas mixtas relativas, alineación/cancelación y límites de trabajo.
No fixtures de authority se convierten en permisos reales; no SQL, Storage,
renderer físico, decode, browser ni QA manual ejecutados.

Riesgo residual: el análisis conservador de sujetos/cascada puede rechazar una
plantilla cuyo layout real no excedería cuotas. No compensar ignorando selectors,
strippeando CSS o cambiando perfiles/hashes antiguos. La autoridad computada futura
debe acreditar el documento/viewport/recursos exactos bajo el ejecutor existente.
[Expediente](SOFLIA_ENGINE_CAP029_QA_HANDOFF.md),
[métrica](SOFLIA_ENGINE_CAP029_IMPLEMENTATION_METRIC.md).

## Corte siguiente: layout usado y readiness común

`html-editing-computed-layout-policy.ts` valida mediciones finitas de dimensiones,
font/line-height, scroll/overflow, fragmentación y tracks/celdas grid usados.
`composition-html-editing-layout-runtime.ts` es incluido por el compilador común
solo cuando existen revisiones HTML verificadas, con los scopes exactos derivados
del binding. No es otro renderer, una autoridad de recursos ni un permiso.

La promesa `window.__courseforgeHtmlLayout.ready` espera las fuentes usadas y decode
de imágenes; tiene plazo30s de espera, no una cuota de CPU/native layout/decoder.
`assert()` exige READY y mide nuevamente el layout actual: no reutiliza un veredicto
basado en observadores asíncronos, que podrían omitir una edición seguida por seek.
Límites agregados:16.384 elementos y65.536 fragmentos; máximo512 fragmentos/nodo,
128 tracks/eje y4096 celdas. Se rechaza, no se trunca ni modifica contenido.
Porcentajes que CSSOM no resuelve a px no se reinterpretan ni se prohíben en bloque.
Grid solo se mide cuando el elemento realmente tiene display grid/inline-grid.

El controlador de preview ya consume ese estado antes de READY/play/seek/reanudación.
Runtime ausente, fallo de recursos o layout inadmisible retiran readiness y generan
un solo error correlacionado, sin fallback a HTML legacy. Cierre de página rechaza
una espera pendiente y libera el timer. Native sin HTML conserva su recorrido.
El mismo script está en HYPERFRAMES_RENDER. El corte inicial solo lo emitía;
el siguiente bloque conecta su consumo al executor original (detalle abajo).

Pruebas nuevas: nueve del validador/runtime (incluye VM del script emitido, imágenes,
fuentes, cierre durante espera, layout cambiado, flex con grid inactivo); una del
helper de readiness realmente emitido por el compilador (pending/ready/failed/missing).
Los dos targets se inspeccionan y los tests nativos del compilador se conservan.
Esta evidencia usa DOM/mediciones simulados: no es un layout browser real observado.

Pendientes de I02: matriz SVG completa normalizada respecto al viewport nativo,
fragmentos inline/off-canvas/pseudo paint y sampling, y cuotas independientes.
La ejecución física de ready/assert en la sesión original sigue sin observarse. CSSOM observado no
atestigua fuentes físicas ni píxeles, y un timeout posterior no preempta layout.
Medir por assert añade costo proporcional al DOM; debe verificarse sobre corpus
real, sin usar tiempos de fixtures como benchmark. No aumentar≈85% ni cerrar I02
por este subbloque. Fuente normativa: [CSSOM View](https://www.w3.org/TR/cssom-view-1/).

## Conexión HTML autorizada al executor original

Archivos delimitados: nuevo `qa/composition-html-layout-capture.ts`, dos llamadas
en `qa/composition-conformance-visual-capture.ts`, reader en
`tools/controlled-hyperframes/original-session-native-observer.mjs` y entrada de
compilación propia en `tsconfig.composition-worker.json`. No cambios a stores/
política CAP025, CAP022, ABI del SDK, receta de extensión, instalación ni gates.

El reader usa el CDP prestado de esa misma sesión, espera ready y exige resultado
booleano exacto tras assert fresco. Runtime ausente/fallido, excepciones y respuestas
incompletas rechazan. Vida independiente del lector de checkpoints de texto:
continúa antes de todos los frames aunque ese lector ya haya terminado. Abort/
cierre/concurrencia invalidan resultados pendientes; close nunca detach al SDK.

Forward: onBeforeFrame comprueba después de preparación original y antes de
screenshot; onAfterFrame comprueba antes de consumir bytes. Repetición geométrica:
wrapper verifica después de prepareFrame. Repetición PNG: preparación verificada,
lease original de screenshot (que prepara otra vez), y comprobación posterior;
bytes inválidos nunca llegan al consumidor. No se añade otro renderer ni se cambia
el lease/ABI. El costo de la preparación repetida afecta solo HTML; requiere
medición real, no se presenta como optimización. Preview físico comprueba otra vez
tras cada seek, antes de screenshot. Native sin HTML no envía comandos nuevos.

Seis pruebas nuevas del reader y del observer real cargado desde su fuente con
puertos simulados. Cubren espera, fallos/missing/DTO falso, drift latched, abort/
cierre/concurrencia, no detach, camino nativo y frames posteriores/repetición.
No son SDK/browser real, no acreditan CPU containment ni paridad de píxeles.

Evidencia de este corte: regresión1036/1036; dirigidas62/62 (reader/runtime/CSS
contextual y compilador nativo), sin fallos/skipped/cancelled. Compilación de tests,
tipado web/worker y lint dirigidos aprobados. No SQL nuevo ni aplicado, deploy,
flags, decode/browser/SDK físico ni QA manual. Métrica≈85% conservada.
Sintaxis del observer `.mjs` verificada; cuatro pruebas existentes del observer
original general aprobadas4/4. No sustituyen el recorrido SDK físico pendiente.

## Corte vigente: geometría usada, matriz SVG y contención de pintura

El runtime compartido ahora recorre elementos y nodos de texto, midiendo los
fragmentos reales de Element/Range. Presupuestos agregados:16.384 elementos,
32.768 nodos y65.536 fragmentos;512 fragmentos por nodo antes de iterarlos.
Coordenadas y extensiones usadas finitas quedan dentro del envelope8192px.
No se truncan ni se sustituyen cajas para obtener aceptación.

Una referencia SVG vacía propia, fuera del source aislado y dentro del mismo
parent nativo, proporciona la matriz de normalización. No se usa un SVG de la
fuente, cuyo propio viewBox podría ocultar su amplificación. Se divide la matriz
de pantalla por la referencia nativa para conservar rotación/zoom/crop legítimos
y comprobar escala/shear/traslación introducidos por la fuente. getBBox de los
gráficos renderizados y una expansión conservadora por stroke/miter cubren la
caja; escala máxima16, miter máximo16. Mediciones ausentes/no finitas/singulares/
3D fallan explícitamente. Tolerancia numérica1e-6 solo para medidas flotantes,
no para conteos. Clips inactivos no inventan una matriz identidad; su activación
exige assert fresco. Referencias propias se eliminan al cerrar o fallar su creación.

El wrapper derivado es block, con contain layout/paint/style, aislamiento y
overflow hidden!important; overflow-clip-margin:0px!important impide ampliar el
borde de clipping. El runtime vuelve a comprobar esa contención. Imágenes deben
tener dimensiones intrínsecas decodificadas positivas y<=8192px. Filtros usados
solo admiten none/blur<=128px en este perfil; un valor desconocido falla, no se
elimina CSS silenciosamente. Estilos de pseudo-elementos siguen pasando los
límites de dimensiones/font/filter; no se afirma medir su ink box anónima.
La contención de pintura y las cuotas independientes son capas distintas.

El estilo exacto de la referencia se emite en un template inerte, fuera del source,
para que el constructor CSP existente lo incluya en style-src-attr por SHA-256.
El runtime asigna exactamente esos bytes. No unsafe-inline, nueva autoridad de
scripts/red ni mutación de fuente/documento. Una prueba con el constructor CSP
real acredita el hash; otra ejecuta el script generado en VM sin imports.

La geometría declarada y computada comparten política pura, conservando las
exportaciones anteriores. El cambio de geometría/aislamiento se versiona, sin
reescribir snapshots ni hashes originales. Los perfiles anteriores siguen su
diagnóstico/revisión/reconstrucción existente, no una reinterpretación automática.

### Guard HTML autorizado y conectado

El bridge Windows existente valida límites de CPU/procesos/memoria, y el helper
OwnedRenderJob aplica y verifica Job limits antes de reanudar el proceso suspendido.
El guard autorizado en composition-windows-render-worker-host.ts exige su presencia
cuando el documento del measurementPlan materializado tiene pointers HTML editables.
El materializador autorizado lee ese plan después de verificar inputs/pins; no es
un permiso derivado del DTO del cliente. El guard corre antes del prepareLaunch del
operador y del spawn del bridge. Native sin pointers HTML mantiene el recorrido V1.

La presencia se captura al construir el host; el bridge inmediatamente valida y
clona los valores existentes. Añadir cuotas tardíamente no autoriza un host creado
sin ellas; mutar/eliminar el objeto original no borra cuotas ya capturadas. Límites
inválidos se rechazan por la política existente. No se cambian valores, bridge,
gates generales, stores CAP025 ni el resto del worker. Un timer/readiness/medición
no se presenta como preemption: esa responsabilidad sigue en Job limits existentes.

El ciclo owned existente adquiere fence antes de start. Si el guard rechaza sin
handle, conserva cuarentena/fence y comunica terminación no confirmada; no se
fabrica STOPPED ni se intenta fallback nativo. Instalar cuotas antes de habilitar
jobs y seguir reconciliación/intervención existente si se alcanza ese rechazo.
No se amplía aquí la máquina de ownership para liberar automáticamente el fence.

### Evidencia y límites del corte

Selección previa63/63: runtime/paint14, CSP4, aislamiento6 y compilador nativo39.
Última selección24/24: seis casos nuevos guard/host/owned y18 existentes del bridge.
Cubren ausencia y adición tardía de cuotas sin prepare/spawn, cuarentena sin liberar
fence, límites V2 capturados, cierre confirmado antes de recoger artefactos,
native V1, configuración inválida y conservación del inventario de driver.
Factory/bridge/protocolo reales con proceso y materialización exterior simulados;
no se lanzó un proceso Windows real. Regresión1074/1074, cero fallos/skipped/cancelled; compilación de tests, tipos
web/worker y lint dirigidos aprobados. DOM/CTM/fonts/
decode simulados y VM prueban los contratos, no Chromium/SDK/raster físico.
Los AABB de pantalla normalizados son conservadores y pueden rechazar cajas
rotadas cercanas al límite. Medir layout tiene costo proporcional al DOM y puede
requerir trabajo nativo antes de obtener un resultado: el guard ahora exige las
cuotas independientes, no convierte la medición en contención física comprobada.
La instalación física de límites, agotamiento CPU/memoria, paridad de píxeles y
compatibilidad de templates reales pertenecen a A02/Q01, no están certificados.
No SQL nuevo/aplicado, habilitación, despliegue ni QA manual.

Semántica consultada en [SVG2, interfaces geométricas](https://www.w3.org/TR/SVG2/types.html),
[CSSOM View, rectángulos Element/Range](https://www.w3.org/TR/cssom-view-1/)
y [CSS Containment2, paint containment](https://www.w3.org/TR/css-contain-2/).
