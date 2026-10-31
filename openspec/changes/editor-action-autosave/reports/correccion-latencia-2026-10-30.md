# Corrección de latencia del editor — 2026-10-30

Estado: implementación local en `codex/editor-latency-investigation-20261030`,
base `13774405`. No se integró en staging ni se desplegó.
Contexto y alcance: [contexto de corrección](contexto-correccion-latencia.md).
Diagnóstico anterior: [informe](informe-latencia-editor-2026-10-30.md).

## Resultado y diseño

Se puede seguir editando propiedades nativas mientras se confirma un PUT. La
admisión conserva primero la copia recuperable y aplica el cambio al documento
local; no espera su turno de persistencia para actualizar el preview. Se reutiliza
`CompositionSaveQueue`, con un único PUT activo y If-Match sobre el último hash
confirmado. No se añadieron paquetes, tablas, migraciones ni servicios externos.

`composition-local-edits.ts` separa confirmado, comandos pendientes y proyección.
Cada respuesta confirma sólo la cabeza de la cola y conserva las intenciones
posteriores. Si el servidor normaliza el documento, se recomponen sobre esa
respuesta; en el caso normal se reutiliza la proyección en vez de aplicar toda la
cola de nuevo. Los callbacks en cola conservan operaciones, no un nuevo snapshot
por comando. El historial recibe anterior/después confirmados, sin incluir la
edición futura en el undo del comando anterior.

El coordinador admite otra intención de la misma herramienta aunque su commit
siga pendiente. Cada snapshot tiene identidad propia: volver A→B→A no reutiliza
la confirmación del primer A. La recuperación y el descarte comprueban el token
de la interacción exacta y no limpian un borrador posterior del mismo formulario.
Los campos HTML conservan coordinación serial y el host editorial exclusivo.

Los controles distinguen persistencia de bloqueo de edición. Inspector/timeline
nativos siguen disponibles durante guardados ordinarios. Deshacer, propuestas,
presets, revisiones HTML y efectos externos mantienen sus barreras de documento
confirmado. Los bypass externos esperan la cola nativa y vuelven a consultar el
estado de error/recuperación vigente antes de continuar.

## Patches y preview

- `composition-inspector-patches.ts` conserva sólo propiedades modificadas. X no
  arrastra inicio, duración, opacidad, volumen ni fades iguales. El redondeo a
  milisegundos del timecode tampoco convierte un cambio de posición en timing.
- El texto sin fuente personalizada vuelve a validar: el schema persistido usa
  ausencia de `fontAssetId`, mientras el patch admite `null` para quitar la fuente.
- `clip.text-content` utiliza DOM y texto literal sobre `.composition-native-text`.
  No reconstruye el timeline ni inserta markup del usuario. Rechaza destinos que
  contengan o estén dentro de raíces HTML controladas. Funciona para una capa
  nativa independiente aunque el documento tenga otra revisión HTML vinculada.
- Las aplicaciones visuales se serializan por generación, independientemente de
  los PUT. Un ACK anterior no marca actualizado un cambio posterior; cambiar de
  iframe invalida la cadena anterior. El hash visual sólo avanza cuando corresponde.
- El fallback por ACK fallido espera a vaciar la cola y compila la última versión
  confirmada, evitando navegar por cada comando ya admitido.

## Errores y recuperación

500, 409, timeout, rechazo de preparación y fallo del almacenamiento cancelan el
envío restante. Los comandos admitidos siguen en la copia local (límites heredados:
50, 2 MiB, 24 h). No se repite automáticamente una escritura incierta en esa misma
sesión. La recarga explícita vuelve a comprobar el journal incluso si el hash no
cambió: confirma, recupera con CAS o muestra conflicto según el documento leído.
Un error de admisión no pierde el formulario ni concede autoridad al navegador.

## Observabilidad

`admission_to_visual_update_ms` termina al recibir el ACK y empieza antes de copiar
y proyectar la admisión. Incluye espera visual/resolución de medios; **no mide la
pausa de escritura de 600 ms ni entrada física→canvas**. La métrica anterior no se
reutiliza para presentar sólo la duración del ACK como experiencia completa.

`save_roundtrip_ms` termina al leer el cuerpo HTTP, antes de reconciliar ACK e
historial. `preview_fallback` registra motivos acotados (HTML, dependencia,
operación, readiness, base, flag y patch fallido). La cuota se renueva cada minuto:
100 eventos por instancia, batches de 25, payload y contexto validados. Vaciar un
batch no evade la cuota; no se registra texto, HTML, URLs ni credenciales.

## Evidencia ejecutada

Los comandos se ejecutaron sobre las fuentes del worktree. Sus dependencias son
junctions al checkout principal con el mismo lockfile, sin copiar `.env`. OpenSpec
1.8.0 se ejecutó temporalmente con `npm exec --package`, sin cambiar dependencias.
Logs extensos en `apps/web/.tmp/`, salidas de QA también bajo `.tmp/`.
Se conservaron los resultados JSON de ambos fixtures y hashes de las fuentes en
[evidencia de corrección](correccion-latencia-evidencia.json).

| Verificación | Resultado |
| --- | --- |
| `test:composition-autosave -w apps/web` | 31/31, salida 0: ráfagas, identidad, normalización, error, límites y exclusividad HTML |
| `test:composition-preview-sync -w apps/web` | 69 pruebas contabilizadas, salida 0 |
| Telemetría compilada, `node --test` | 8/8, incluida cuota por ventana, salida 0 |
| `qa:composition-preview-scene -w apps/web` | salida 0, Edge headless; runtime real y persistencia simulada |
| `test:remotion -w apps/web` | 232 pruebas contabilizadas, salida 0 |
| `typecheck` | salida 0 |
| `lint` del workspace y ESLint de archivos modificados | salida 0 |
| `test:security-boundaries` | 30/30, salida 0 |
| `db:migrations:check` | salida 0, 211 archivos, sin aplicar SQL |
| `test:harness` | 20/20, salida 0 |
| `docs:audit` | salida 0; README/contexto/contrato contrastados y actualizados |
| `docs:check` y `git diff HEAD --check` | salida 0; 152 documentos y diff sin whitespace inválido |
| `openspec validate editor-action-autosave --type change --strict --no-interactive` | salida 0 |

La QA retiene el primer PUT, añade una capa y realiza dos cambios del mismo
textarea antes de confirmarlo. Comprueba los tres resultados en orden, que sólo
haya un PUT activo, que la respuesta anterior conserve el último texto y que no
navegue el iframe. Comprueba también 500, nueva escritura bloqueada hasta revisar
recuperación y 409 tras recargar. Otro fixture conserva el elemento video y sus
solicitudes al editar, verifica texto literal y rechaza un destino con marca de
raíz protegida. Esta marca sintética no equivale a una sesión editorial autorizada.

## Comprobaciones globales que siguen fallando

No se presenta una compuerta global verde ni se alteraron sus reglas:

- `verify:pr`: adaptadores, arnés y enlaces pasan; OpenSpec global devuelve 19/20
  y rechaza el cambio ajeno `diagnose-font-catalog`. El cambio de este trabajo
  valida por separado. El diagnóstico individual confirma que el cambio ajeno
  no contiene deltas OpenSpec.
- `verify`: lint y tipos pasan; `architecture:cycles` encuentra 11 ciclos entre
  archivos que no tienen modificaciones en este diff. No se añadieron ciclos
  enumerados por esa comprobación. Las fases posteriores no se ejecutan dentro
  de esa invocación; seguridad y migraciones se ejecutaron por separado.
- `test:hyperframes`: 159 pruebas contabilizadas pasan antes de detenerse por
  `Cannot find module '@/lib/server/outbound-http'` desde el proveedor del agente.
  Ese import y su configuración ya están en HEAD y no se modificaron.
- Al ejecutar por separado compilador/patches/standalone: 132/133 pasan; falla la
  expectativa antigua `SofLIA - Engine remote asset` frente a `SofLIA Architect`.
  Se compiló y ejecutó esa misma prueba sobre staging limpio `13774405`, donde
  también falla. No es una regresión del patch de texto.

Se corrigieron los errores encontrados durante esta implementación antes de
cerrar: validación de fuente vacía, recuperación con hash invariable, referencias
al propietario tras introducir tokens y preservación de serialización HTML. Los
fallos intermedios de QA no se sustituyen por afirmaciones de éxito de producción.

## Revisión adversarial y límites

Revisión realizada por el mismo agente, sin independencia. Se contrastaron bases
de PUT/historial, orden, callbacks viejos, generaciones, A→B→A, recuperación de
otra interacción, normalización, fallo local, cuotas y frontera DOM editorial.
Se conservaron CAS, autorización de servidor, referencias HTML e inventario.

**Las revisiones de campos HTML aún recompilan al adoptarse.** Captions/timing
que necesiten escena dentro de un documento con HTML, fuentes/dependencias nuevas,
restore/reconcile y runtime inválido conservan fallback autorizado. No se quitó
la barrera global de escenas HTML ni se introdujo un segundo protocolo de revisión
para ocultar esa latencia. El informe original pedía evaluar ese contrato; aquí
se reduce la ruta de texto nativo independiente y se mantiene la autoridad actual.

No se midieron p50/p95 del despliegue, sesión autenticada, Storage real, render
cloud ni dispositivos del usuario. Para establecer un SLO faltan trazas de entrada
y perfiles representativos; la QA local no garantiza latencia de producción.
La proyección completa de escena sigue existiendo para operaciones que la requieren.

Reversión: revertir juntos UI/modelo/compilador/telemetría de esta corrección. No
hay migración, reescritura de historial ni cambio del formato persistido. El cambio
OpenSpec queda abierto hasta su integración en la rama objetivo.
