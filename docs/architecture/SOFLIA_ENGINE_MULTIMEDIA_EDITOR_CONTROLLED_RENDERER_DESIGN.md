# CAP-027 — propuesta de ejecución controlada de HyperFrames

Estado: diseño con prototipo local sintético; sin integración productiva. No activa proveedor, infraestructura, migraciones ni flags. El documento define la alternativa recomendada para satisfacer §6 del roadmap con evidencia recogida por Courseforge.

## Motivo y límites

### SDR con audio — obligación separada y verificación de mux, pendiente ejecución real

La ruta authored SDR acepta ahora source video/audio con `sdrAudioMuxPolicy = COPIED_H264_REC709_AAC_MUX_V1` separado del contrato video-only anterior. Mezcla/extracción siguen en SDK y el mux existente copia video; para M4A se solicita preservar priming/edit list, sin `make_zero`. La declaración no permite aceptar sin audio ni audio ajeno: comparador exige AAC 48 kHz estéreo, origen cero y duración dentro de un frame del timeline, además del video/SDR requeridos. Reuso/recibo/gate y SQL preparado conservan presencia exacta; SQL sin aplicar ni probar.

Después del mux se llama `verifySdrAudioMuxOutput`: perfil final contado, SHA de silent/final/probe, digest ordenado de packets video (tamaños y SHA-256) más extradata del codec, iguales entre entrada/salida. Buffer máximo 16 MiB y 36000 packets; presupuesto total decreciente y señal compartida, rechecks al terminar. El silent MP4 se revalida también tras cerrar recursos SDK, antes de publicar. No modifica/repara/re-etiqueta archivos para hacerlos pasar.

La [documentación de ffprobe](https://ffmpeg.org/ffprobe.html) define hashes de payload y extradata mediante show_data_hash; implementación primaria n6.1 consultada para writer y campos. Igualdad de esos hashes locales no prueba timing/A-V, color efectivo, origen de captura o supervisor. El scope de diagnóstico permanece `LOCAL_PROBED_VIDEO_PAYLOADS_NOT_SYNC_OR_RENDER_ATTESTATION`. Pruebas dirigidas con probe simulado y placeholders; no ejecución FFmpeg/browser/SDK mux ni QA formal. Pendientes capacidades reales, priming/sync, cartas/corpus SDR AV, seguridad/aislamiento y procedencia completa. Las razones UNATTESTED siguen obligatorias.

### Transformación SDR conectada — opt-in local, todavía no atestada

`observe-neutral-render.mjs` admite `--sdr-conversion yes` para corpus authored neutral/nativo y, con la obligación AV adicional anterior, source video/audio. El flag no se activa por defecto ni habilita producto. Congela `renderExecution.sdrConversionPolicy = DECLARED_SRGB_PNG_TO_REC709_LIMITED_V1` junto con comparisonTools y colorTagPolicy antes de captura. Usa la política forward/inverse compartida isomórfica; contratos históricos sin política conservan encode SDK y decode originales.

`controlled-sdk-sdr.mjs` conecta el encoder probado por separado con el lifecycle real del driver. La factory posee encoder y copia exclusiva verificada antes de retornar: si aparece tarde se espera y cierra, no se abandona una escritura mientras se borra el staging. Errores cierran el recurso aunque la factory no lo haya retornado. Presupuesto restante/señal llegan al encoder; fallo SDR no recurre al encoder SDK. La salida staging se elimina al cerrar y se conserva la copia diagnóstica pinneada; se revalida toda secuencia de PNG tras el cierre SDK, antes de publicar. Esto no crea captura inmutable ni supervisor de procesos.

Comparador selecciona inversa solo con expectativa/observación/documento/video coincidentes y ejecutables reales fijados. Antes de extraer PNG exige un único stream H.264/YUV420P, BT.709 matrix/primaries/TRC, tv y chroma left. No interpreta tags aislados como autorización para modificar el decode. Audit neutral usa la misma inversa y decoder de comparación para esta ruta. El recibo transporta declaración, no evidencia autenticada del source profile; el gate conserva todas las razones UNATTESTED.

Pruebas dirigidas de contrato/perfil/adapter/lifecycle usan executor simulado, archivos reales locales y placeholders de MP4. Sin ejecución del driver/browser/FFmpeg ni QA formal. Faltan capacidades libzimg/codec reales, perfil efectivo de captura y validación de conversión en cartas/corpus, incluida ruta AV/mux ya conectada. SQL preparado no aplicado. Las autorizaciones nativas previas no se eluden; la integración por código no prueba píxeles.

### Identidad explícita del comparador — integración estructural, no atestación

El perfil de ejecución V1 incorpora campo opcional `comparisonTools` con política propia `EXPLICIT_PIXEL_DECODER_AND_PROBE_V1`: pixelDecoder y probe tienen hashes/tamaños separados. No redefine `files.decoder`, que históricamente fija ffprobe del SDK. El driver congela la identidad del FFmpeg de Remotion que usa el comparador, además del probe; su encoder SDK puede ser otro archivo. Ambos roles se reobservan en el recibo y snapshot/exportación/reutilización conservan la obligación. Falta de campos requeridos o cambio SHA/tamaño es mismatch, no evidencia suficiente.

`compareExportedVideoWithPreview` resuelve los ejecutables de configuración local, verifica los pins contra el contrato antes del primer subprocess y los revalida al terminar mediciones. No admite paths elegidos por cliente. Receipts anteriores siguen legibles: sin la expectativa nueva solo se comprueba estabilidad local de herramientas, no binding congelado. Gate Node y SQL preparado rechazan roles nuevos sin expectativa; la migración no se ha aplicado/probado. Rechecks no crean imagen ejecutable inmutable, no capturan librerías/transitivas y no detectan necesariamente cambio/restauración entre fronteras. `RENDER_EXECUTION_ATTESTATION_PENDING` permanece obligatorio.

Pruebas dirigidas usan archivos sintéticos y contratos puros; no se ejecuta renderer ni FFmpeg. La ruta SDR opt-in descrita arriba ya consume el adaptador y filtro inverso, sin reinterpretar MP4/contratos históricos. Corpus real y aislamiento/procedencia siguen pendientes.

### Fuentes custom de la sesión controlada (conectada, pendiente de render real)

El driver `observe-neutral-render.mjs` acepta `--native-recipe geometry-rotation` (o receta nativa del catálogo) y usa solo `node_modules/next/dist/next-devtools/server/font/geist-latin.woff2`, no un upload ni descarga. El preparador fija bytes/manifest/documento, compila @font-face con ruta content-addressed y el driver revalida original/copia. No combina este modo con video ni color chart. El SDK público crea la página antes de navegar al inicializar, de modo que el cliente CDP y suscripción de fuentes se instalan a tiempo. Carga FontFace explícitamente después de inicializar y antes de capturar, incluyendo recetas de captions inicialmente vacíos.

`controlled-sdk-text.mjs` se llama tras los buffers capturados por SDK en ambas direcciones; compara texto/geometría, verifica glyph usage nuevamente en reversa y devuelve `nativeEvidence` al diagnóstico y recibo del comparador. Comparador/job conservan ahora el testigo resumido; falta ejecución real y procedencia autenticada: no se elimina el pendiente de fuentes ni se aprueba el renderer. Pruebas del adaptador: `npm run test:composition-controlled-sdk-text`, con APIs simuladas. El modo nativo no garantiza cobertura del glifo RTL ni de todas las recetas; fallback/ausencia bloquean. Licencia para distribuir fonts/worker sigue fuera de esta comprobación local.

`startControlledFontCapture` se inicia antes de navegación/carga sobre un cliente CDP propiedad del llamador. Exige documento y contrato v4, font manifest/bindings y browser esperados, más callback de verificación de pins. Captura fuentes efectivamente usadas por nodos nativos contra eventos locales; bloquea fallback y ausencia no probada. Requiere testigo de geometría/texto de la captura al finalizar, no crea por sí mismo evidencia forward/reverse de texto. `validateControlledFontUsageEvidence` vuelve a verificar el resultado guardado contra contrato y testigo; el formato preview-only no se acepta.

Scope conservador `LOCAL_CDP_CUSTOM_NATIVE_GLYPHS_NOT_RENDERER_ATTESTATION`: metadatos CDP locales no prueban aislamiento ni procedencia del job. El driver SDK conecta captura nativa y consumo durable del resumen, pero la ejecución real sigue pendiente; el gate de fuentes mantiene INCOMPLETE. Las 9 pruebas del recolector/binding usan CDP/pins simulados (`npm run test:composition-controlled-font-capture`). La regla de cobertura/glifos es compartida con preview, sin reutilizar ni renombrar su evidencia.

### Repetibilidad de la sesión SDK

El perfil v4 puede congelar `renderExecution.seekRepeatabilityPolicy = EXACT_RGBA_FORWARD_REVERSE_V1`. El recibo del comparador transporta un resultado con hash canónico del contrato, documento y cobertura exacta. Exportación exige el resultado; comparador y gate final rechazan bindings/puntos incorrectos y mantienen incompletitud explícita si falta. El schema durable conserva la evidencia con scope local y no permite que conceda PASS global. El SQL preparado verifica revisión/cobertura/puntos; el hash canónico completo lo verifica Node (sin asumir equivalencia con JSONB). SQL aún sin aplicar/probar. El recibo editable no se convierte en procedencia autorizada.

Después de capturar la secuencia completa, el driver habilita revisitas en el adaptador de medios y llama al SDK público `captureFrameToBuffer` en orden creciente/decreciente para todos los checkpoints del contrato. El comparador decodifica PNG a RGBA, valida dimensiones/límites y exige el mismo hash de píxeles. Las capturas adicionales permanecen en memoria; los archivos del encoder y envelopes de audio originales no cambian. El resultado mantiene scope local y contrato/documento fijados; una diferencia aborta antes de encode. No prueba reloj/eventos, preview/MP4, fonts/color ni autorización del job.

Validación del módulo: `npm run test:composition-controlled-seek-repeatability`; casos de orden, terminal, distinta compresión PNG, mismatch, planes/buffers inválidos y cancelación. Binding/exportación: `npm run test:composition-render-execution-contract`. La obligación/resumen ya llegan al gate Node y schema durable; faltan ejecución SDK real, PostgreSQL y procedencia productiva. Los límites de número/bytes no sustituyen un presupuesto global de tiempo ni cancelación del árbol de procesos.

### Binding local de ejecución (2026-10-02)

El consumidor SDK exporta dos entradas separadas para `compareExportedVideoWithPreview`: `comparison-contract.json` y `comparison-receipt.json`. `buildControlledComparisonArtifacts` exige expectativa v4 y coincidencia del documento, archivo y observación; entrega copias validadas sin promover procedencia. El recibo diagnóstico conserva hashes/tamaños de ambas entradas; no es intercambiable con el recibo estricto del comparador. Aún se requieren preview/reference y sus metadatos independientes para ejecutar la comparación; no se reutilizan capturas del render como preview. El intento de repetir el SDK con este formato no se ejecutó por fallo de revisión automática de permisos/límite de uso, por lo que la cobertura actual es de contrato y no end-to-end.

El contrato v4 puede congelar `renderExecution` con siete identidades hash/tamaño y versión CDP esperada. El comparador de MP4 verifica documento/output, archivos y versión antes/después; el worker preserva el resumen y su razón pendiente. Snapshot reuse no puede omitir ni cambiar esa obligación. `MATCH` tiene alcance `FILE_AND_CDP_MATCH_NOT_ISOLATION_OR_JOB_ATTESTATION`: no demuestra aislamiento, autorización del job, cierre de dependencias cargadas ni fonts/SDR. Incluso MATCH mantiene INCOMPLETE; MISMATCH exige FAIL. No hay flag ni cambio de proveedor productivo.

El driver SDK está preparado para emitir este formato, pendiente de repetir el render real. La expectativa browser que construye es un baseline de la misma sesión antes de captura, no un perfil independiente firmado. Migración de finalización preparada, sin aplicar ni probar en PostgreSQL. Validación de contrato: `npm run test:composition-render-execution-contract`; la cobertura de SQL real y la integración productiva permanecen pendientes.

El roadmap exige identidad efectiva de renderer, compilador, browser, assets, fuentes y color, además de métricas del MP4. La integración actual con HyperFrames Cloud recibe estado, duración, formato y URLs; esos campos no acreditan el entorno que produjo el video. Una atestación verificable del proveedor podría cerrar la brecha conservando Cloud. Mientras ese contrato no esté disponible, el worker controlado permite implementar y observar esas obligaciones directamente.

Se conserva el documento Courseforge y el compilador compartido. Se ejecuta HyperFrames en un entorno administrado; no se desarrolla otro motor de animación ni se sustituye el documento por estado de Studio. La versión actual de `@hyperframes/core` en el repositorio es `0.7.106`; cualquier elección del paquete ejecutor y sus versiones debe comprobar compatibilidad con ese contrato antes de preparar la imagen. El diseño no presupone que un CLI actualizado produzca los mismos píxeles.

## Fronteras de módulos

### Prototipo local implementado

`composition-controlled-render-prototype.ts` ejecuta el CLI oficial `hyperframes@0.7.106`, no una implementación alternativa del renderer. Verifica versión del paquete y hashes/tamaños de Node, CLI, runtime, browser, FFmpeg, ffprobe y archivos explícitos del proyecto antes/después. Fija FPS, calidad, un worker, software GPU, SDR solicitado y rechazo de media no lista; verifica el perfil del MP4 y conserva hashes sin paths privados. La configuración del proceso usa una allowlist de entorno sin credenciales de Courseforge y desactiva telemetría. Timeout/salida están acotados; el prototipo retiene sus workspaces para diagnóstico.

El único consumidor CLI genera `color-neutral` con el compilador real y assets sintéticos locales. No añade el bootstrap de exportación ni otro runtime al HTML authored: el productor oficial normaliza/fusiona scripts inline y elimina los que contienen `__HF_EXPORT_RENDER_SEEK_CONFIG`; añadir ese marcador en el body elimina también la timeline fusionada y provoca `sub_timeline_readiness_timeout`. El CLI debe ser dueño de esa inyección. Las fixtures de captura standalone no se modifican, pues no atraviesan ese productor. Una regresión con el sanitizador oficial cubre la diferencia en 24/25/30/60 FPS.

El consumidor decodifica inicio/mitad/último frame del MP4, comprueba los seis parches authored y vincula resultados/hash del plan al SHA del MP4 y decoder, revalidados antes/después. Un error RGB impide emitir el recibo exitoso. No compara esas imágenes con preview ni acredita SDR general; la política neutra conserva su alcance limitado. El probe solicita explícitamente tags de color, sin tratarlos como prueba de conversión.

Exige `--trusted-local-synthetic yes`; no recibe documentos de usuarios. `apps/web/tools/controlled-hyperframes/package.json` fija la dependencia opt-in, separada del package de la aplicación. Instalar con `npm install --prefix apps/web/tools/controlled-hyperframes --ignore-scripts --no-audit --no-fund`. Desde la raíz:

```text
npm run test:composition-controlled-render
npm run qa:composition-controlled-render:prototype -- --executor-root apps/web/tools/controlled-hyperframes/node_modules/hyperframes --browser <ruta-absoluta-Chromium> --output-parent apps/web/.tmp --fps 25 --trusted-local-synthetic yes
```

La carpeta padre debe existir. Requiere Node >=22 y los binarios FFmpeg empaquetados ya existentes. No descarga browser ni activa servicios Cloud. El recibo declara `LOCAL_RENDER_NOT_PRODUCTION_ATTESTATION`: pin de archivos/argv y probe no prueban browser efectivo, fuentes de glifos, conversión SDR, cierre de dependencias, aislamiento, cancelación de árbol de procesos, jobs durables ni comparación preview/render. El CLI inspeccionado incluye `--no-sandbox`; por ello este consumidor es **solo sintético y confiable**, nunca un endpoint para HTML subido. La ruta productiva deberá ejecutar en aislamiento de contenedor/OS y verificar esas obligaciones antes de habilitarla. Un `--sdr` configurado no elimina `SDR_PIXEL_CONVERSION_UNATTESTED`.

| Frontera | Responsabilidad |
| --- | --- |
| Selección de backend | Congelar `MANAGED_CLOUD` o `CONTROLLED` en solicitud y snapshot; incluir la selección en identidad de reutilización/idempotencia. |
| Adaptador de submission | Resolver una revisión autorizada y registrar un job durable. Mantener la implementación Cloud existente como opción inicial. |
| Materializador | Descargar y verificar archive/medios/fuentes scoped al tenant con límites existentes; producir un workspace propio. |
| Supervisor de render | Adquirir lease, imponer presupuesto, iniciar proceso aislado, cancelar y recoger resultado/evidencia. |
| Ejecutor HyperFrames | Seek de la composición a FPS fijo, captura, uso de fuentes y codificación del MP4 en imagen fijada. Sin credenciales de DB ni acceso a red exterior. |
| Importador de resultado | Verificar hash, tamaño, pertenencia y lease; persistir video/evidencia inmutables e idempotentes. |
| Conformidad | Consumir la evidencia exacta y comparar preview/MP4 mediante el pipeline existente. |

La abstracción de submission se introduce al integrar la segunda implementación; no se crea un servicio vacío o una interfaz sin consumidor. Polling/importación y proyecciones que hoy identifican el resultado como `hyperframes_cloud` deben leer el backend persistido antes de habilitar la alternativa. No deben inferirlo de URLs o nombres de archivo.

## Contrato de entrada del supervisor

La solicitud autorizada incluye organización, revisión, solicitud y job; hash del documento y del archive; manifiesto de assets/fuentes; entry point validado; variables congeladas; perfil de render; política esperada de entorno/color y presupuesto. El supervisor revalida esos datos contra la revisión persistida y los pasa al ejecutor en un descriptor local sin secretos.

El backend y el perfil forman parte de la clave de reutilización. Un resultado Cloud no se reutiliza como resultado controlado por compartir documento. La ejecución usa lease y compare-and-swap para finish/cancel; una respuesta perdida no crea otro job ni otro objeto final.

## Evidencia recogida durante la ejecución

El contrato esperado se congela antes de ejecutar; la evidencia observada se recoge después y se coteja con aquel. No se acepta una copia de valores configurados como observación efectiva.

| Dato | Fuente observable y vinculación |
| --- | --- |
| Imagen de ejecución | Digest obtenido del despliegue confiable y asociado al worker; no un string aportado por el proyecto. |
| Browser | Hash/tamaño del ejecutable antes/después y `Browser.getVersion` del proceso usado para capturar. Reutilizar los verificadores actuales de identidad del browser. |
| Renderer | Versión y SHA-256 del runtime HyperFrames cargado, ejecutor y dependencias que afectan al render. |
| Compilador | Hash del output render, versión/identidad de build y hash del documento que lo generó. |
| Assets | SHA-256 de archivos materializados antes/después de uso; identidad/ruta ya derivadas del manifiesto autorizado. |
| Fuentes | SHA-256 del conjunto permitido y evidencia CDP de fuentes efectivamente usadas por los textos; rechazar ausencia o fallback fuera del conjunto permitido. |
| Encoder/decoder | Hash de ejecutables y build efectivo, argumentos normalizados, tipo de operación y perfil seleccionado. |
| Color | Perfil del browser y transformación de píxeles aplicada por el encoder; tags del stream como medición adicional. |
| Output | SHA-256/tamaño del MP4, conteo/timestamps, hash del descriptor de ejecución y de la evidencia. |

La evidencia de fuentes debe cubrir texto nativo, captions y decks HTML; una declaración `FontFace` cargada no basta para acreditar los glifos pintados. Se empaquetan fuentes permitidas, incluidas las de sistema necesarias, y se limita fallback explícitamente. Pseudo-elementos y regiones no medibles conservan incompletitud hasta disponer de un comprobador implementado.

La conversión SDR debe especificar la entrada de la captura y realizar una transformación real a Rec.709/rango declarado antes de etiquetar el MP4. La validación exige cartas authored decodificadas y fixtures separados para captura, decoder y evaluator. Etiquetas coincidentes o una carta aislada no acreditan la conversión de todas las fuentes.

La evidencia se registra desde el supervisor autenticado y se vincula a una ejecución autorizada mediante una operación transaccional. El proyecto y el cliente no pueden escribirla. Firma/verificación se añaden si cruza otra frontera de confianza; un recibo JSON editable no permite promover el gate. El gate vuelve a verificar que el MP4 medido corresponde al objeto importado y a la evidencia del job.

## Observación SDK local de la carta neutral

El tooling opcional incluye `@hyperframes/producer` y `@hyperframes/engine` 0.7.106, además del CLI existente, con lockfile independiente de la aplicación. El render completo del productor no ofrece hook público de sesión. Por ello `observe-neutral-render.mjs` usa las APIs públicas de servidor/captura/encoder y consulta CDP en la misma sesión que captura los frames del MP4, antes y después de capturarlos. No parchea vendor ni importa subpaths privados. No es reemplazo completo de `executeRenderJob`.

```powershell
npm run qa:composition-controlled-render:observe-neutral -- --browser <ruta-absoluta-browser> --fps 25 --trusted-local-synthetic yes
```

El comando genera únicamente la carta authored de 8 s, sin aceptar proyectos externos. La identidad autorreportada, pins antes/después, conteo de frames, hash del MP4 y auditoría de color quedan en un recibo `SDK_NEUTRAL_CHART_RENDER_SESSION_NOT_PRODUCTION_ATTESTATION`. Los archivos no pueden alterarse durante la ejecución; editar el driver invalida su recibo. Se limpia el entorno antes de importar SDK/crear hijos, sin pasar credenciales de la app.

Validación local real histórica: 200 frames a 25 FPS, identidad CDP estable, H.264/1920×1080/8 s y carta decodificada PASS. Esto no prueba CLI/Cloud ni la orquestación completa de extracción, audio, fuentes/variables/transiciones. El código posterior agrega contrato/resumen consumible y presupuesto lógico global con cierre de APIs, sin nuevo render real que los verifique. Faltan aislamiento, cancelación dura de árbol y cadena durable tenant/job. Es un prototipo exclusivamente sintético; no debe exponerse como endpoint ni habilitar rollout.

## Incremento SDK: video local y audio sincronizado

La ruta observada admite ahora una receta authored de video mediante `--source-receipt` y `--recipe`. El preparador limita/rehasea recibo y fuente y recompone el caso/documento registrado; el consumidor copia la fuente a un workspace propio y vuelve a comprobar sus pins. No acepta HTML externo ni interpreta un recibo editable como autenticación. El módulo `controlled-sdk-media.mjs` valida manifiestos y fuentes locales, usa extracción/lookup/inyección oficiales y mide volumen efectivo por frame en la misma sesión de captura. El mezclador público recibe esa envolvente, y el mux conserva audio AAC. Cualquier pista perdida impide emitir recibo.

El parser de audio requiere final explícito: el compilador añade `data-end` sin modificar los tiempos canónicos. El FFmpeg reducido de Remotion no tiene filtro `fps`; la ruta SDK usa ahora la distribución completa fijada `ffmpeg-static@5.3.0`, release `b6.1.1`. Instalar sus scripts automáticamente sigue deshabilitado; la descarga es una operación explícita con entorno restringido y caché en el tooling:

```powershell
npm install --prefix apps/web/tools/controlled-hyperframes --ignore-scripts --no-audit --no-fund
node apps/web/tools/controlled-hyperframes/install-local-ffmpeg.mjs
npm run qa:composition-controlled-render:observe-neutral -- --browser <ruta-absoluta-browser> --fps 25 --trusted-local-synthetic yes --source-receipt <recibo-local-absoluto> --recipe video-split
npm run test:composition-controlled-sdk-media
```

La distribución incluye licencia GPL v3, conservada y hash-pinned; su uso/distribución en una imagen productiva necesita revisión antes de rollout. No hay instalación global ni nueva dependencia productiva. El CLI prototipo anterior conserva su selección de herramientas; los pins de un render no se extrapolan a otro.

Evidencia real integrada para split/25 FPS: 200 frames extraídos/capturados, dos pistas mezcladas, H.264/AAC, seis marcadores exactos alrededor del corte/fin y 32 ventanas RMS frente a fuente offset 1 s/gain 0.8, máximo delta 0.087005409 dB. La auditoría se ejecuta antes de emitir recibo. Las otras recetas aún no tienen esta prueba de output ni métricas generales. El scope `SDK_VIDEO_CORPUS_RENDER_NOT_PRODUCTION_ATTESTATION` conserva pendientes de pipeline completo, fuentes, SDR, aislamiento, dependencias, tenant/job y preview/render. El scope de la auditoría también excluye comparación preview/render, sincronía fina y loudness.

## Ejecución y operación

### Deadline lógico del prototipo CLI (no containment)

`createControlledRenderDeadline` impone `SHARED_MONOTONIC_RENDER_DEADLINE_V1` (1–600 s) a la función de render/probe/pins. El comando CLI incluye además preparación y auditoría del output en un plazo global de 600 s. Render recibe solo saldo disponible; probe/decoder usan el mínimo de su timeout y saldo restante. Cancelación/plazo invalidan inmediatamente el resultado, propagan AbortSignal y no publican éxito de operaciones tardías. Timer/listeners se liberan al finalizar; motivos privados de cancelación no se registran. Entorno OS permitido se centraliza y aplica también a FFmpeg de la auditoría.

Esto no prueba terminación del proceso: adapters pueden confirmar abort después del rechazo; `execFile` no contiene descendants. Windows requiere Job Object o containment equivalente; no se emplea PID/taskkill como sustituto de esa garantía. Tampoco interrumpe CPU síncrona o I/O no cooperativo a nivel kernel. `ISOLATION_AND_PROCESS_TREE` sigue siendo limitación vigente y los recibos lógicos no se elevan a evidencia autenticada. Pruebas usan ejecutores simulados, no procesos reales ni enforcement de contenedor/OS.

### Deadline y ownership del driver SDK

`controlled-sdk-lifecycle.mjs` aplica el plazo global también al driver observado y reserva propiedad antes de adquirir server/browser/CDP/text. Rechaza tareas iniciadas sin await, nuevas operaciones fuera de su fase, éxitos tardíos y publicación si falla cleanup. Completa disposers en reversa con hasta 5 s de gracia total; si uno no termina, se intentan los restantes sin espera infinita. Recursos que aparecen después de abort permanecen ligados al disposer, sin permiso para continuar la captura. Error primario no queda reemplazado por errores secundarios de limpieza; solo se emiten códigos seguros.

Extracción/mix/encode/mux usan señal y timeout mínimo del saldo; FFmpeg externo de auditorías/probe usa además entorno sin credenciales. Servidor espera evento de cierre del Node Server retornado por la API oficial. Después de cierre se revalidan inputs/output/archivos de comparación antes de emitir recibo final. Scope `SDK_API_HANDLES_NOT_PROCESS_TREE_ATTESTATION`: API-close no equivale a containment kernel ni identidad productiva. SIGTERM y el closure del browser no certifican descendants o child FFmpeg. Presupuesto lógico + gracia no constituyen cuotas duras de CPU/RAM/I/O. No se aceptan proyectos externos, no se habilita worker ni se modifica vendor.

Validación: `npm run test:composition-controlled-sdk-lifecycle` (15 escenarios simulados, 7 de inventario filesystem y 6 del deadline). `npm run test:composition-controlled-sdk-media` verifica propagación de señal/saldo y contratos del parser. Publicación también contabiliza operaciones pendientes: callbacks que terminan dejando verificaciones en vuelo fallan y cancelan esas verificaciones; un fallo primario de publicación conserva su código. Falta probar el driver completo en un runtime aislado real y resolver cadena tenant/job; los outputs históricos anteriores a este cambio no certifican estos mecanismos.

### Inventario de instalación SDK local

`controlled-sdk-installation.mjs` inventaría el árbol completo de `tools/controlled-hyperframes/node_modules` antes del import dinámico del SDK y lo revalida después del cierre de APIs, antes del recibo final. Detecta archivos secundarios modificados, añadidos, eliminados o renombrados, incluyendo archivos/directorios vacíos. Rechaza symlinks/junctions y entradas especiales; limita profundidad a 32, entradas a 100000, archivo a 1 GiB y total a 4 GiB. Enumera incrementalmente, lee bytes por streaming, verifica identidad del handle/ruta antes/después y observa el plazo compartido. El resumen del recibo conserva hash, cuentas y bytes, nunca rutas locales.

Scope `LOCAL_SDK_TREE_NOT_FULL_DEPENDENCY_CLOSURE_OR_ATTESTATION`: **no elimina `DEPENDENCY_CLOSURE`**. No acredita dependencias resueltas desde el árbol de la aplicación, módulos ya cargados, librerías del sistema, recursos del browser, procedencia autenticada ni inmutabilidad durante todo el intervalo entre verificaciones. No implementa aislamiento OS ni cuotas duras. Instalaciones con symlinks, junctions o archivos con múltiples hard links (por ejemplo gestores que enlazan paquetes) fallan explícitamente; no se sigue el enlace ni se introduce fallback. Las comprobaciones consumen el mismo plazo del render: un árbol excesivo o lento debe fallar, no ampliar el presupuesto.

### Cancelación cooperativa ligada a la reserva del job

Actualización 2026-10-03: materialización autorizada recibe la señal del job. Un controller privado sanitiza el motivo externo y aplica un único timeout de 15 minutos a consulta, firma, descarga del ZIP, extracción y descarga de assets; no se reinicia por objeto. Timer/listener se liberan al terminar. ZIP/body pendiente se cancela incluso si fetch simulado ignora la señal. Extracción JSZip por streaming y pipeline media reciben la señal; postchecks impiden workspace listo después de cancelar y cleanup elimina solo archivos/directorios propios. La descarga del MP4 ya usa su propia señal de cancelación. Metadata RPCs, operaciones síncronas de hash/JSZip y escrituras en curso no quedan preemptadas por este controller; CPU/OS y deadline integral del job siguen siendo obligaciones distintas. No se confunde timeout lógico de materialización con cuotas duras.

Actualización 2026-10-03: materialización autorizada recibe la señal del job. Un controller privado sanitiza el motivo externo y aplica un único timeout de 15 minutos a consulta, firma, descarga del ZIP, extracción y descarga de assets; no se reinicia por objeto. Timer/listener se liberan al terminar. ZIP/body pendiente se cancela incluso si fetch simulado ignora la señal. Extracción JSZip por streaming y pipeline media reciben la señal; postchecks impiden workspace listo después de cancelar y cleanup elimina solo archivos/directorios propios. La descarga del MP4 ya usa su propia señal de cancelación. Metadata RPCs, operaciones síncronas de hash/JSZip y escrituras en curso no quedan preemptadas por este controller; CPU/OS y deadline integral del job siguen siendo obligaciones distintas. No se confunde timeout lógico de materialización con cuotas duras.

El worker de comparación usa `composition-conformance-job-lease.ts`: heartbeat por defecto/máximo 60 s, una renovación en vuelo y timeout por defecto 15 s/máximo 30 s. Ticks durante una renovación pendiente se coalescen, no forman una cola. Fallo, rechazo o timeout de renovación invalida ownership irrevocablemente y aborta la señal de ejecución; una respuesta tardía no restaura la reserva. La RPC real recibe AbortSignal y el drenaje lógico queda acotado aunque el adapter no lo observe. Nunca se llama al finalizador con una reserva perdida.

SIGINT/SIGTERM se propagan desde el comando del worker. Apagado previo no reclama jobs; apagado con ejecución activa invalida su resultado, incluso durante el drenaje posterior, y solicita reintento mediante el cierre CAS existente si la reserva sigue válida. La señal no incluye motivos privados. No se interrumpe la limpieza ni se elimina recursivamente contenido desconocido; errores de etapa/cleanup conservan su diagnóstico.

Se comprueba cancelación antes/después de etapas de job, preparación visual/audio, comparación y particiones. No se inicia persistencia de referencias si la cancelación ya se conoce. La descarga remota del MP4 recibe una señal compuesta con el timeout existente, interrumpe lectura streaming pendiente y no puede emitir hash exitoso tras abortar. RPCs de metadata, capturas y decoders que no aceptan señal pueden continuar su operación actual hasta regresar; los checks impiden la siguiente etapa/resultado exitoso. No se promete eliminación de descendientes, rollback de objetos ya escritos ni atestación tenant/job del renderer. El runtime aislado y el backend controlado productivo siguen pendientes. No se inicia el worker ni se aplican migraciones con estos cambios.

Validación dirigida: `npm run test:composition-conformance-job-lease`, tests de pipelines/eventos y tests del servicio de integridad. RPCs y capturas se simulan; streams y cleanup de archivos son locales. No sustituye PostgreSQL, red real, QA del tester o cierre de aislamiento.

### Prototipo nativo Windows: membresía y terminación, no sandbox

Actualización 2026-10-03: readback kernel confirma límite solicitado seis, pero pruebas previas observaron pico variable de 7–12 miembros vivos. Un snapshot de violación identificó `node.exe:4`, `conhost.exe:3`; no se filtra conhost del presupuesto ni se divide el conteo. Esta observación sugiere revisar consolas y nesting, pero no prueba causa raíz. El código primario de libuv describe flags de consola y asignación a su job propio: [libuv process.c](https://github.com/libuv/libuv/blob/v1.x/src/win/process.c). El runtime local reporta Node v24.19.0/libuv 1.52.1; la rama upstream consultada no se presume idéntica al binario.

El helper comprueba tamaños ABI x64 y coteja flags, límite de procesos, CPU y memoria obtenidos por `QueryInformationJobObject` **antes de crear el proceso**; cualquier diferencia impide arrancarlo. El lanzador exige ejecutar la prueba nativa completa antes de cargar el SDK, sin skip ni green cache ni fallback fuera del job. Probe negativo bloquea render; probe positivo no equivale a certificar todas las rutas productivas. El script de prueba restaura la variable sintética previa del caller en vez de eliminarla indiscriminadamente.

**Validación nueva pendiente:** el intento de repetir `npm run test:composition-windows-job` fue rechazado por AuthorizationManager/PSSecurityException después del cambio de fecha/contexto. No se cambió ExecutionPolicy ni se usó bypass o un lanzador alternativo. Sintaxis PowerShell/diff revisados; controles ABI/readback y preflight aún no ejecutados nativamente en este estado. Los resultados anteriores no se extrapolan al código nuevo. Resolver autorización y cuotas sigue pendiente; no iniciar el launcher SDK para sortear la revisión de permisos.

`windows/OwnedRenderJob.cs` se compila en memoria mediante Windows PowerShell `Add-Type`, sin instalar CLI .NET. Crea un Job Object sin nombre/handle heredable, configura límites solicitados de memoria/procesos/tiempo CPU de usuario y kill-on-close. Crea el proceso suspendido, asigna el job antes de resumirlo y no permite breakaway. Fallo de asignación termina únicamente el proceso suspendido mediante su handle propio, nunca PID/taskkill. Argumentos se escapan para CreateProcess directo, sin shell; entorno nuevo allowlisted excluye secretos/overrides. SafeHandles cierran recursos aun ante fallos. No ejecuta documentos subidos.

`StopAndConfirm` termina miembros del job y exige contador kernel cero con espera acotada, también después de salir normalmente el root; `Dispose` activa kill-on-close. El listado adicional adquiere handles de miembros, verifica pertenencia al mismo job y espera sin modificar procesos: IDs solo sirven para observación, no para cleanup. El listado de miembros es un snapshot y no una prueba continua de cuotas o procedencia. Job Objects y jobs anidados se describen en [Microsoft: Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects) y [Nested Jobs](https://learn.microsoft.com/en-us/windows/win32/procthread/nested-jobs).

**Evidencia local real:** fixture authored con root/child/grandchild; salida de root conserva dos descendientes, terminación explícita deja cero y held handles confirman salida. Cierre del handle mientras root y descendientes viven también los termina. Argumentos con espacios/comillas/backslash final/vacío/Unicode y exclusión de una variable secreta sintética pasan. CPU busy con presupuesto solicitado 1 s sale no-cero (`3221225540`). Asignación progresiva de memoria sale no-cero (`1`), pico agregado observado `259678208` bytes: es observación de salida/pico, no atribución exhaustiva de causa ni prueba general de todas las cuotas.

**Fallo vigente que no se oculta:** intento de crear diez workers con límite solicitado seis muestra pico de **12 miembros vivos**; contador y lista/handles coinciden. `npm run test:composition-windows-job` debe fallar con `NATIVE_JOB_PROCESS_LIMIT_EXCEEDED_12` en este entorno. No se divide el contador, amplía el límite ni elimina la aserción para conseguir green. Causa de cuota agregada/nesting aún no determinada. La ruta no está certificada para producción; límite de procesos/recursos sigue pendiente.

`windows/run-owned-sdk.ps1` es consumidor opt-in del corpus sintético, **no ejecutado con SDK/browser**. Espera root bajo deadline, observa membresía, termina el job y exige grupo vacío y exit code cero antes de emitir un diagnóstico local. Monitoreo posterior de exceso no sustituye enforcement kernel ni garantiza cero overshoot. Recibos del hijo siguen siendo locales, editables y no ligados a identidad durable del supervisor: todos los gates actuales permanecen pendientes. No captura stdout del hijo como evidencia autenticada. Falta probar el render real, logs/transporte acotados, cuotas agregadas, cancelación externa, token/ACL/red/filesystem, imagen y procedencia tenant/job. El fallo previo de revisión de permisos de render no se sortea con este lanzador. No usar con HTML no confiable ni activar endpoints/rollout.

- Imagen por digest, paquetes/binarios fijados y manifiesto de licencias; build reproducible y smoke de compatibilidad del renderer.
- Usuario sin privilegios, root filesystem de solo lectura, workspace temporal propio y cuotas explícitas de CPU, RAM, disco y duración.
- Ejecutor sin red exterior; solo loopback para servir HTML/medios hash-pinned. Descargas y uploads pertenecen al supervisor/materializador.
- HTML aislado del origen de la app y de sus cookies. Sin service role dentro del navegador o del proceso de render.
- Jobs con concurrencia acotada, prioridad y límites por organización, cancelación, heartbeat y backpressure. Render pesado fuera de handlers síncronos.
- Logs por job/correlation ID con códigos de etapa; conservar hashes/métricas, evitar URLs firmadas, contenido educativo privado o stderr arbitrario.
- Limpiar solo paths propios; conservar fallos secundarios de cleanup. Archivo inesperado impide una eliminación recursiva ciega.

La infraestructura concreta (worker de contenedores y cola) se elige según el entorno operativo disponible. El diseño no autoriza despliegues AWS/GCP ni compras de capacidad.

## Compatibilidad, activación y rollback

1. Implementar adaptador, descriptor/evidencia y simulación de jobs sin cambiar defaults.
2. Preparar migración aditiva para backend/evidencia y autorización tenant-first; probarla en DB aislada antes de aplicar.
3. Construir la imagen fijada y verificar identidad, cancelación, límites y rechazo de proyecto/asset/fuente alterados.
4. Ejecutar el corpus de §6 por ambas rutas, registrar divergencias y completar gates visuales, temporales, tipográficos, audio y color.
5. Activar para organizaciones seleccionadas solo después de QA; conservar Cloud para rollback de nuevas solicitudes.

Las solicitudes ya creadas conservan su backend. Apagar la flag dirige solicitudes nuevas a Cloud, sin convertir retrospectivamente la evidencia controlada ni mezclar resultados de jobs en curso. No existe fallback automático que transforme un fallo de conformidad en un render de otro backend.

## Criterios de cierre de implementación

Auditoría de atribución 2026-10-03: driver observado fija decoder como ffprobe, mientras comparación PNG usa FFmpeg resuelto desde Remotion. Las identidades actuales no fijan el decoder-pixel efectivo; se requiere evolución versionada diferenciando encoder/decoder/probe y binding/recheck del ejecutable seleccionado. No asumir que las builds coinciden ni reinterpretar decoder histórico silenciosamente. Adaptador SDR e inversa aún sin consumidores comunes: no aplicar inversa a todos los MP4 para simular integración. Priorizar contrato/consumidores/persistencia/reutilización antes de activar ruta SDR; ejecución real y supervisor siguen pendientes. Inspección de código demuestra brecha estructural, no mismatch de binarios ejecutados.

Actualización de output SDR 2026-10-03: helper exige probe hash-pinned, count_frames y perfil estricto: MP4/un video H.264/YUV420P, fps/geometría/count exactos, origen cero, duración ±1 frame, tags 709/TV/chroma-left y size pin. Recheck de video/probe/encoder/frames precede entrega. Encoder/probe reciben saldo compartido local y salida tardía se rechaza. Scope metadata/counts no certifica conversión, captura efectiva ni ejecución supervisor; sigues necesitando cartas/inversa/corpus/procedencia. Once tests pasan con probes simulados y placeholders, sin renderer/probe nativo. No activa consumidor productivo ni retira UNATTESTED.

Actualización de entrada SDR 2026-10-03: encoder usa `pinSdrFrameSequence` y recheck tras ejecución. Cobertura streaming exacta, PNG con dimensiones/8-bit/alpha opaco observados, sin ICC/orientación alternativa; pins de archivo y directorio locales, resumen frozen sin paths y pins privados por identidad de objeto. Límites 36000 frames/20 MiB PNG/4 GiB total/4096 px; procesamiento secuencial y lectura acotada ante crecimiento. Recheck de todos los miembros precede entrega. Estos checks no crean snapshot inmutable ni prueban color efectivo, origen/tenant/job o lectura correcta de FFmpeg. Los siete tests de encoder y cinco de secuencia pasan; hard link real bloqueado EPERM, suite no verde. No bypass, render ni integración productiva; no se retiran obligaciones UNATTESTED.

Actualización SDR 2026-10-03: adapter `composition-sdr-frame-encoder.ts`, fuera de la ruta productiva, usa conversión explícita zscale sRGB/GBR/full→BT.709/YUV/limited y define inversa para comparación sRGB. Encoder del SDK 0.7.106 instalado declara tags/range pero no esa transferencia en ruta CPU inspeccionada. Perfil opaco sRGB es precondición del caller, no testigo efectivo. Helper limita argv/env/tiempo, verifica binario y limpia output propio; no acredita codec, perfil de captura, input frames inmutables, kernel, tenant/job ni transformación real. Tests inyectan encoder y archivos placeholder; nunca se promueven a evidencia visual. Falta integrar pareja encode/decode en contrato versionado, verificar capabilities/probe/cartas/corpus real y procedencia antes de retirar incompleteness. No altera comparador/SDK ni habilita render. Referencias técnicas fijadas a FFmpeg n6.1, no al comportamiento supuesto de la build local.

Actualización del ejecutor 2026-10-03: `WHOLE_CONFORMANCE_EXECUTION_BUDGET_V1` inicia reloj monotónico antes del workspace y comparte señal en snapshot/referencias/comparación/particiones/recheck. Incluye limpieza y postcheck de entrega; 1–600 s internos, default 600 s, no reseteado por etapa. Timeout conserva etapa, es retryable y no finaliza reporte válido. No usa Promise.race para abandonar adapters que todavía pueden escribir: espera ownership antes de limpieza. Señal y postchecks son cooperativos; adapter no cooperativo puede superar duración física. Corpus largo no tiene presupuesto adicional implícito ni garantía de completar playback 600 s más pasadas. Claim/renovación/CAS/supervisor siguen fronteras separadas. 50 tests de job + 6 de deadline pasan con mocks/filesystem/timer locales, sin ejecución renderer/DB real.

Actualización de captura 2026-10-03: señal propagada a pipeline visual, launcher y canal CDP propio. El binding rechaza todas las esperas y cierra el canal ante abort, suprime eventos tardíos y elimina listener al terminar. Cliente WebSocket real drena/rechaza pendientes y limpia timers al cerrar/error; falla de envío síncrona no conserva entrada. Checks de startup y fetch DevTools cancelable reducen trabajo posterior. Postcheck después del cierre impide entregar paquete cancelado y elimina outputs propios. Esto no confirma terminación kernel/árbol ni sandbox: apertura WebSocket, cleanup de proceso y operaciones internas de playback conservan límites pendientes. Tests con browser/CDP simulados pasan; prueba de conexión HTTP local bloqueada EACCES, por lo que suite integral no verde. Ningún nuevo render real ni bypass.

Actualización 2026-10-03: la comparación persistida propaga AbortSignal a probes/extracción visual, loudness y PCM. ExecFile recibe señal y entorno restringido; PCM solicita SIGKILL al hijo, destruye stdout y resuelve cancelación sin esperar close ausente. Checks previos/posteriores impiden lanzamiento tras abort y éxito tardío; errores de aborto no se degradan a métricas fallidas. Esto no acredita terminación kernel, árbol de procesos, sandbox ni deadline global. Las pruebas usan procesos simulados; no sustituyen el preflight nativo ni habilitan render.

- El adaptador controlado tiene consumidores reales y respeta los mismos contratos de revisión, assets, permisos y job que el flujo de producción.
- La identidad esperada/observada forma parte de contratos versionados, reutilización, captura, comparación y finalización durable, con compatibilidad explícita para revisiones anteriores.
- El MP4 y su evidencia se importan con cadena tenant/revisión/job y revalidación de integridad después de mediciones.
- Renderer/fuentes/color efectivos pueden aprobar o rechazar el gate; ya no dependen de razones permanentes de `UNATTESTED` para la ruta controlada.
- Están implementados límites, cancelación, limpieza, errores seguros, métricas y pruebas de contrato/integración. Migración, despliegue y QA formal siguen siendo hitos separados.

La propuesta por sí sola no cumple esos criterios y no incrementa el porcentaje de CAP-027. Los avances se acreditan cuando el código y la evidencia prueben cada obligación.
## Consumo del testigo local de fuentes — 2026-10-02

El driver exporta `nativeEvidence` al recibo consumible del comparador, no solo al diagnóstico. El exportador exige el testigo para contratos controlados con fuentes custom. El comparador valida el testigo completo antes de decodificar; deriva un resumen `observedWitness` dentro de `fontUsage`, ligado a documento, hash canónico de contrato, manifest y MP4. El finalizador vuelve a comprobar identidad/cobertura; el esquema durable conserva el resumen sin texto ni rutas y rechaza promoción a PASS. La migración preparada incluye controles contra la revisión, sin asumir que JSONB produzca el hash canónico de Node; no se aplicó ni verificó en PostgreSQL.

Este resumen es diagnóstico local no autenticado (`OBSERVED_UNATTESTED`). No demuestra que el encoder consumió esos glifos, ni cumple aislamiento/procedencia del job. Se conserva la obligación pendiente de fuentes. Sigue pendiente ejecutar el corpus nativo en SDK real.

### Geometría medida independientemente

`composition-renderer-text-geometry.ts` intersecta paridad de píxeles con límites DOM Range decimales del preview y renderer, sin redondearlos al ROI de imagen. Compara cuatro bordes con presupuesto ≤1 px: posición/tamaño alterados fallan incluso si ambos PNGs son iguales; observaciones ausentes dejan INCOMPLETE. Un ROI expandido por paint delta conserva los límites originales. La ruta de archivos controlada consume el testigo renderer; contratos antiguos sin ejecución controlada mantienen su comportamiento previo, sin extenderles esta certificación. No constituye prueba de procedencia del MP4 ni geometría de decks.

El validador distingue rol `PREVIEW_PAINT` (obligaciones de máscara/supresión intactas) de `RENDERER_GEOMETRY` (no permite máscaras/seeds que simulen prueba de paint). Coincidencia no transforma fallos de píxeles o regiones no informativas en PASS; offcanvas con seeds sin prueba independiente continúa incompleto. Pruebas unitarias y de integración usan DOM/CDP simulados y PNGs sintéticos, no render SDK real.

