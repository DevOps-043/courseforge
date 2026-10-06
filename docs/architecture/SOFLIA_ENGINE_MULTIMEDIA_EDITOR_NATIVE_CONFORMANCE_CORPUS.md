# CAP-027 — corpus determinista nativo v1

## Extensión de audio crossfade (2026-10-02)

`audio-crossfade` incorpora dos WAV estéreo con hashes independientes: voz 0–4.5 s y música 3.5–8 s, un segundo de solapamiento con salida/entrada de volumen. La receta usa el modelo real de clips/fades, genera checkpoints en los bordes del solapamiento y pasa por el mezclador de referencia y ambos compiladores. En los cuatro FPS son cuatro documentos más: total estructural actual **392** (332 nativos + 40 medios + 20 decks), además de 28 recetas de video condicionadas a materialización. No prueba captura del navegador, encoder, escucha ni conformidad de un MP4 remoto.

## Auditoría RGB independiente de carta neutra (2026-10-02)

La receta `color-neutral` añade un plan hash-pinned con seis parches authored (gris, rojo, verde, azul, negro y blanco) y `sourceSvgSha256`. Los valores esperados están declarados fuera del SVG y no se aprenden del preview ni del MP4. El auditor toma el interior 32×32 de cada parche en un PNG opaco 1920×1080, con límite 8 MiB y delta RGB máximo de 8 por canal; dimensiones/alpha/documentHash/plan falsificado se rechazan. El resultado conserva SHA-256 del PNG y máximos por parche, sin rutas locales. Los casos `color-minimum` y `color-maximum` no reciben expectativas RGB fijas porque el grading modifica la carta.

Comando preparado para dos frames extraídos del mismo caso autorizado (no ejecutado sobre proveedor real):

```powershell
npm run qa:composition-color-chart-audit -- --fps 25 --case-sha256 <hash-del-caso> --preview-png <ruta-absoluta.png> --render-png <ruta-absoluta.png>
```

El comando rehace `color-neutral` y exige el `caseSha256`, pero el operador debe vincular por separado ambos PNG al paquete/MP4 autorizado; no acepta hashes de archivo como firma de procedencia. Scope `LOCAL_CORPUS_RGB_AUDIT_NOT_MP4_PROVENANCE_OR_SDR_ATTESTATION`: un PASS de la carta mide valores RGB decodificados en ese caso, **no** acredita conversión SDR Rec.709 general, perfil de display/browser, fuente/decoder del proveedor ni el release gate. `npm run test:composition-color-chart-audit` verifica SVG real con Sharp y alteraciones controladas; sin QA formal.

El comparador de MP4 también acepta `--color-chart-fps <24|25|30|60> --color-chart-case-sha256 <hash-del-caso>` juntos. Reconstruye la receta `color-neutral`, verifica el hash del caso, enlaza plan/documento/asset con el contrato congelado y mide todos los checkpoints sobre las capturas de preview y los PNG que extrae del MP4 cuyo SHA-256 coincide con el recibo. Guarda máximos RGB y hashes por fotograma en `colorChart`; un parche fuera de tolerancia hace fallar el reporte combinado. Omitir ambas opciones conserva el comportamiento genérico y **no** ejecuta esta obligación especial. El recibo local y los tags del MP4 no autentican el entorno del proveedor; ni siquiera un `colorChart: PASS` demuestra conversión SDR general.

## Extensión de decks HTML (2026-10-02)

Captura productiva de contenido/geometría preparada: plan incorpora ventanas del runtime de transiciones y exclusiones estáticas; lector CDP sigue childNodes sin IDs del texto y valida hashes exactos/bounds. Forward/reverse debe coincidir. Metadata deckText y receipt deckTextSha256 se verifican en paquete privado y consumidor de directorios; eliminación conjunta rechazada cuando contrato obliga. Scope no acredita pintura ni renderer/font; DECK_TEXT_EVIDENCE_INCOMPLETE permanece hasta comparar pintura estricta. Nodos extra/pseudo-elementos/CSS/oclusiones aún no están cubiertos por igualdad de rutas esperadas. `test:composition-deck-contract` ejecuta contrato y cinco pruebas de lectura/evidencia controladas; el capturador integrado incluye paquete privado y rechazo de reverse alterado.

Integración productiva preparada: snapshot v4 puede congelar `deckTextPlan` con flag server-only `COMPOSITION_CONFORMANCE_DECK_TEXT_V1=true` (no activada). Reutilización discrimina ausencia/presencia y plan exacto; construcción/lectura de referencia y particiones recomputan frente a fuente autorizada. Obligación con clips mantiene INCOMPLETE/DECK_TEXT_EVIDENCE_INCOMPLETE hasta implementar captura/comparación; worker rechaza PASS que conserve ese motivo. Contratos anteriores sin obligación no se reinterpretan. `npm run test:composition-deck-contract` valida cinco casos controlados de este contrato.

El corpus incluye ahora `sourceTextPlan`/`sourceTextPlanSha256` del módulo de dominio `composition-deck-text-plan.ts`. Deriva hashes exactos de nodos de texto y rutas childNodes desde HTML fuente; no necesita IDs. Hash del caso vincula tanto ledger authored independiente como plan derivado. `validateDeckTextPlan` recomputa frente al documento autorizado: no acepta texto/rutas inventados u omisión de clips por tener hash propio consistente. Cuotas agregadas acotan HTML/nodos/profundidad/texto/regiones; scripts/template/noscript dejan limitaciones. Plan de fuente no prueba visibilidad, layout, fuentes, pseudo-elementos ni pintura. Integración con contrato/captura/gate sigue pendiente. Comando de corpus ejecuta también seis pruebas de este plan (11 pruebas en total).

`buildDeckConformanceCorpusCase` incorpora cinco recetas × cuatro FPS (24/25/30/60): texto con acentos, caja con wrapping, texto RTL, corte entre dos slides y rotación/opacidad. Usa la factory real de decks y ventanas authored de 8 s. HTML/CSS estático local, sin scripts, recursos externos ni font URLs; font-family Arial/sans-serif es una expectativa, no procedencia efectiva de fuente. La guía HyperFrames mantiene fondo en un hijo full-bleed y evita clocks/red/animaciones autónomas; el compilador existente sigue siendo propietario del runtime/timing.

Cada caso retorna un ledger de texto authored separado de la captura, vinculado por documentHash y SHA256 del ledger; incluye clipId, elementId, texto exacto, dirección y ventana temporal semiabierta. caseSha256 incluye esa identidad. El ledger no es una máscara medida ni un contrato productivo de texto de decks: integración con captura estricta, evidencia de fuentes y medición real siguen pendientes. No convierte una ausencia de mediciones en PASS.

`npm run test:composition-deck-corpus` ejecuta cinco pruebas controladas sobre 20 documentos: reproducibilidad/aislamiento, hashes, ventanas y checkpoints antes/en/después del corte, RTL/wrapping/transform, rechazo de receta/FPS desconocidos y compilación de las cinco recetas en ambos targets conservando IDs/textos. No ejecuta navegador/proveedor/FFmpeg. Total preparado estructuralmente al corte actual: 392 casos (332 nativos + 40 medios + 20 decks); 28 recetas de video siguen condicionadas a materialización real.

Estado: recetas implementadas; comparación real preview/MP4 y QA pendientes. No es prueba de conformidad ni aprobación de publicación.

Implementación: `apps/web/src/domains/production/composition-editor/qa/composition-native-conformance-corpus.ts`.

## Cobertura preparada

| Familia | Recetas | Qué varía |
| --- | ---: | --- |
| Motion | 38 | Los 19 presets registrados, default/extremo; ambient incluye ciclos parciales. |
| Transiciones | 33 | Los 5 tipos, 3 alineaciones y las 4 direcciones de push/wipe. Audio CUT; no sustituye crossfade de audio real. |
| Captions | 5 | Parser real SRT/VTT, karaoke por palabra, RTL árabe/números y 30 cues que requieren múltiples lotes. |
| Geometría | 4 | Rotación, opacidad, fuera de canvas y clipping parcial. No prueba todavía máscaras por glifo/blur/oclusiones. |
| Color | 3 | Carta SVG local real: neutro y extremos legales de grading sobre imagen. No prueba conversión SDR/decoder. |

83 recetas × FPS 24/25/30/60 = 332 documentos deterministas. Canvas 1920×1080, duración 8 s. Son recetas de escenario; no una matriz factorial de todas las combinaciones posibles.

## Identidad y consumo

`listNativeConformanceCorpusRecipes()` devuelve catálogo nuevo en cada llamada. `buildNativeConformanceCorpusCase(recipeId, fps)` valida ID/FPS y devuelve documento independiente validado, receta/version/FPS, `documentHash`, assets locales con bytes y SHA-256, lista `assetHashes` y `caseSha256`. El hash del caso vincula versión, receta, FPS, documento y hashes de assets. No incluye timestamps aleatorios ni signed URLs.

Consumir el documento y assets mediante los entrypoints reales de compilación/snapshot. Para la carta de color, verificar bytes contra checksum y resolver el ID al medio local; no registrar un asset de otro tenant ni asumir que el UUID de fixture ya existe en producción. Los tests del compilador usan data URI local de esos bytes; no descargan ni suben assets.

Construir el plan completo con `buildCompositionEventCheckpointPlan`, no solo el primer lote de 48. Para medición durable usar la revisión/manifest autorizado y coordinador de eventos. Los IDs/hash de este catálogo no autorizan por sí solos una revisión o un paquete de evidencia.

Un nuevo preset registrado aparece en la enumeración y cambia las identidades de sus casos; cambios intencionales de semántica del corpus deben incrementar `NATIVE_CONFORMANCE_CORPUS_VERSION` y conservar el corte anterior cuando existan baselines aprobados. No regenerar/reaprobar un baseline para ocultar una regresión.

## Validación de implementación

`npm run test:composition-native-corpus`

Cuatro tests controlados verifican catálogo completo, documentos/hashes/aislamiento/checkpoints en los 332 casos, elegibilidad de transiciones, rechazo de IDs/FPS desconocidos y compilación de 83 recetas en preview y render a 25 FPS. No ejecutan Chromium, FFmpeg ni proveedor: HTML compilado no demuestra paridad de frames, fuentes o codecs. La campaña real está postergada para el tester.

## Pendientes obligatorios

### Recetas de video v1 y preparación de encoding

`composition-video-conformance-corpus.ts` prepara siete recetas: split, trim, crop contain/cover y crossfade audiovisual en las tres alineaciones. Son 28 combinaciones estructurales a 24/25/30/60 FPS, vinculadas a metadata explícita de un medio 1920×1080 de 10 s con audio. **No se suman a las 368 combinaciones con assets reales preparados** hasta generar/verificar el MP4. El test usa metadata controlada, no bytes de video ficticios.

`buildVideoCorpusEncodingArguments` prepara argv para FFmpeg: secuencia local de PNG 1920×1080 con marcador temporal/binario por frame, WAV estéreo del corpus, H.264/AAC, duración de 10 s, `-n` (sin overwrite), sin shell ni input remoto. Sustituye `testsrc2` porque el FFmpeg empaquetado no incluye ese filtro. Paths absolutos y FPS aprobados son obligatorios. Usar el runner existente o un executor de archivos con timeout y salida acotados; no concatenar argv en una shell. El plan declara etiquetas bt709, **no certifica conversión/decoder/perfil de display ni reproducibilidad binaria entre versiones de encoder**.

Flujo pendiente para el tester: escribir el WAV local hash-pinned → ejecutar encoding en un directorio propio → comprobar tamaño/MP4, SHA-256 y ffprobe real (dimensiones/FPS/duración/audio) → suministrar metadata correspondiente a `buildVideoConformanceCorpusCase` → materializar revisión/assets autorizados → comparar preview y MP4 con todos sus lotes. Los hashes de source/documento/caso deben conservarse en resultados; si cambia el medio, cambia el caso. No reutilizar el checksum de la fixture de test ni confiar en metadata de caller como autorización.

Los clips crossfade tienen fuente de 10 s, offsets 1/5 s, ventanas adyacentes de 4 s y handles disponibles en las tres alineaciones. Split/trim pasan por el servicio de patches real; el plan de mezcla deriva audio windows/offsets del runtime compartido. El scope es `VIDEO_RECIPE_BOUND_TO_SUPPLIED_SOURCE_NOT_DECODE_OR_RENDER_EVIDENCE`.

`npm run test:composition-video-corpus` verifica recetas/offsets/handles en 28 combinaciones, encoding argv y rechazo de source inválido. No ejecuta FFmpeg, captura, decode ni QA. La conformidad real preview/MP4 de audio/crossfade y calibración del encoder siguen pendientes.

#### Generador local implementado; una ejecución real verificada

`composition-video-corpus-generator.ts` ejecuta el plan con argv/execFile sin shell, timeout 5 min (encoding), 30 s (probe de streams) / 60 s (frames), salida limitada a 128 KiB y AbortSignal. Crea un subdirectorio único dentro de un padre existente; genera PNGs deterministas con Sharp, escribe WAV/recibo con `wx`, y FFmpeg usa `-n`. Los PNGs propios se retiran tras el encoding; MP4 máximo 100 MiB, ejecutables máximo 1 GiB; rechaza archivos no regulares/symlink. Verifica hash/size del MP4 antes/después de probes y decodificación, WAV original y SHA de ejecutables antes/después. Probe exige H.264/AAC, 1920×1080, FPS solicitado, duración 10 s ±1 frame y estéreo 48 kHz. La inspección de frames exige exactamente 10×FPS timestamps crecientes y deriva ≤0.5 frame; el recibo conserva el conteo y máximo observado. Además decodifica automáticamente dos PNGs a 0 y 5 s, valida 1920×1080, registra tanto hashes de PNG como de píxeles RGBA y exige píxeles distintos. Los hashes de PNG no sustituyen la comparación visual: compresiones diferentes pueden codificar los mismos píxeles.

El FFmpeg empaquetado no ofrece muxer `s16le`; el generador decodifica AAC a WAV por pipe con salida máxima 3 MiB y analiza chunks WAV acotados (`fmt `/`data`, incluido tamaño desconocido de pipe). Valida PCM16 estéreo/48 kHz y duración 10 s + hasta 1024 muestras de padding, compara la envolvente RMS de ambos canales con el WAV authored en 20 ventanas de 0.5 s (umbral 1.5 dB), y conserva hash del PCM y máximo delta en el recibo. Rechaza silencio, truncamiento o nivel divergente. Esta comprobación local no acredita identidad de audio, sync A/V, loudness/true peak del export, contenido semántico completo ni paridad del render remoto.

El recibo conserva source/checksum, hash del WAV, hashes de ejecutables y las identidades de siete casos, sin paths de binarios ni URLs. Scope: `LOCAL_ENCODING_AND_PROBE_NOT_RENDER_PARITY`. Esto verifica generación/probe local; no demuestra la equivalencia preview/render, el entorno Cloud o conversión SDR. Cambiar encoder puede cambiar bytes/checksum/caseSha256: no sobrescribir baseline aprobado.

Para reproducir en un directorio padre local ya existente (usar ruta sin espacios al pasarla por `npm run` en Windows):

```powershell
npm run qa:composition-video-corpus:generate -- --output-parent apps/web/.tmp --fps 25
```

Repetir explícitamente para los demás FPS del corpus. El comando resuelve binarios empaquetados de Remotion y entrega paths del directorio único/MP4/recibo. No registra assets en Supabase ni despliega/migra nada. Consumir el recibo/source en las recetas y entrar al pipeline autorizado; no aceptar automáticamente PASS de conformidad.

Ejecuciones locales del 2026-10-02, todas con 20 ventanas RMS de audio y dos frames visuales decodificados distintos:

| FPS | Frames | SHA-256 MP4 | Recibo local ignorado |
| --- | ---: | --- | --- |
| 24 | 240 | `3432d73e8473c50146123391f336196d81338f13aa52e22492b110f6dcc01c02` | `apps/web/.tmp/composition-video-corpus-z6CYri/source-receipt.json` |
| 25 | 250 | `2b9a8bb531a5e01c748eee771886a4f6cc36137dfe895161c1926e399bf83ff1` | `apps/web/.tmp/composition-video-corpus-hyWZwe/source-receipt.json` |
| 30 | 300 | `0247fdd0e15b629ed700f731db73693ed82c8272f5f07333648befbdedcdc6b6` | `apps/web/.tmp/composition-video-corpus-LOCRaS/source-receipt.json` |
| 60 | 600 | `c87db782b05f6636ef549bd3129f0ff348d47323246cf0610aea61c453021ee9` | `apps/web/.tmp/composition-video-corpus-6PYgYY/source-receipt.json` |

Estos paths no son durables: si se limpian archivos temporales, regenerar y revalidar hashes. No se han ejecutado los 28 documentos de recetas en browser/renderer ni comparado sus salidas con preview.

`npm run qa:composition-video-corpus:compile -- --receipt <recibo-24> --receipt <recibo-25> --receipt <recibo-30> --receipt <recibo-60>` consume cuatro recibos locales absolutos o relativos (una opción por FPS), rehashea `source.mp4` adyacente y recompone las identidades de las 28 recetas antes de compilar ambos targets con los servicios de producción. No escribe archivos ni publica; el resultado JSON incluye hashes de los HTML y declara `LOCAL_RECEIPT_AND_COMPILATION_NOT_RENDER_EVIDENCE`. En el corte del 2026-10-02, los cuatro recibos de la tabla pasaron 28/28 compilaciones. El comando prueba enlace/compilación, **no** decodifica de nuevo los MP4, ejecuta Chromium, renderiza los documentos ni compara pixels/audio de preview y exportación. Los recibos son editables y no constituyen firma del proveedor.

En fallo/cancelación retira solo los PNGs numerados propios, `source.wav`, `source.mp4` y `source-receipt.json` del directorio propio; no hace eliminación recursiva. Archivo inesperado se conserva y produce `CONFORMANCE_CORPUS_CLEANUP_FAILED` para inspección. Errores de proceso muestran solo un código de etapa, no stderr ni paths. En éxito conserva WAV, MP4 y recibo.

`npm run test:composition-video-corpus-generator` usa executor controlado y archivos locales de test para coordinación, hash/mutación, probe/decodificación inválidos, video estático, audio silencioso/truncado/desnivelado, WAV inválido, cancelación y cleanup; también comprueba que dos PNG con distinta compresión y píxeles idénticos se rechazan. Esas pruebas no se presentan como MP4 real. La ejecución local del 2026-10-02 a 25 FPS sí produjo un MP4 H.264/AAC de 311459 bytes con SHA-256 `2b9a8bb531a5e01c748eee771886a4f6cc36137dfe895161c1926e399bf83ff1`, 250 frames y deriva máxima `2.842170943040401e-14` frames; su recibo conserva hashes distintos de PNG/píxeles a 0 y 5 s, además de 480256 muestras PCM decodificadas por canal y un máximo delta RMS de 0.490 dB. El artefacto más reciente quedó en `apps/web/.tmp/composition-video-corpus-hyWZwe/` (ignorado, local y no durable). No se ejecutó comparación preview/MP4 ni QA formal.

### Extensión de medios locales v1

`composition-media-conformance-corpus.ts` agrega 10 recetas a los mismos 4 FPS (40 documentos adicionales): crop/fit contain/cover sobre carta SVG real; split/trim de audio mediante los patches públicos del editor; gain de clip/pista, fades, ducking voice/music y crossfade entre WAV distintos. Son **372 combinaciones nativo+medios** en total, no renders aprobados.

`composition-conformance-corpus-assets.ts` centraliza la carta y WAV estéreo float de 10 s/8 kHz con envolvente variable y canales distintos. Assets retornan bytes nuevos, checksum real y MIME correcto. No se etiqueta audio como video ni se asigna grading a una fuente no soportada. Los niveles sintéticos no constituyen certificación LUFS/true peak: calibración/decoder/encoder siguen pendientes.

`buildMediaConformanceCorpusCase` devuelve documento/hash/caseSha256 y bytes hash-pinned. Resolver esos IDs a los assets locales al compilar o materializar un snapshot autorizado. Los tests controlados verifican mezclas del modelo fuente sin decoder externo; source PCM se toma del WAV float compatible con el formato canónico existente. Split conserva muestras/offsets; trim conserva silencios fuera de la ventana; gain/fades/ducking usan servicios reales.

`npm run test:composition-media-corpus` valida 40 documentos, hash/RIFF/aislamiento, mezclas deterministas y 20 compilaciones (10 recetas × 2 targets a 25 FPS). No realiza captura de audio del navegador, escucha ni render. La extensión no sustituye split/trim/handles ni crossfade renderizado de video: requieren MP4 real y su decoder. `MEDIA_CORPUS_REMAINING_REQUIREMENTS` deja esos límites explícitos.

`NATIVE_CORPUS_REMAINING_REQUIREMENTS` mantiene visibles: timing/split/trim de medios, crop/fit, audio editorial (gain/fades/ducking/crossfade), fuentes custom/sistema y procedencia efectiva, conversión SDR, texto de decks HTML y entorno/renderer efectivo. También falta ejecutar y auditar estas recetas con máscaras/blur/oclusiones, materializar baselines y cubrir decode/encoder/render remoto. Los ajustes de color y RTL presentes aquí no cierran esas obligaciones adicionales.

El scope de cada caso es `DETERMINISTIC_NATIVE_DOCUMENT_RECIPE_NOT_RENDER_EVIDENCE`. No aceptar PASS de QA/publicación a partir de schema válido, HTML compilado o una receta que carezca de mediciones.
