# Factibilidad de Herk Edit Kit en SofLIA Architect

14 de noviembre de 2026 · Courseforge `3683f20f` · Herk Edit Kit 2.0.0, `10511e5`

## 1. Entendimiento del objetivo

Que un editor autorizado pueda partir de una grabación, detectar pausas y tomas repetidas, revisar cortes, añadir subtítulos y aplicar estilos en el Ensamble de SofLIA. La ejecución debe continuar cuando se cierre el navegador o se apague el equipo. El análisis distingue dos decisiones que pueden tomarse por separado. Una es dónde procesar la grabación y la otra es dónde renderizar la composición.

El escenario inicial es una grabación educativa de presentador único, con una pista de audio. Los reels verticales, el B-roll generado y la conversión de sitios a video son extensiones. Su alcance, calidad y costos se deben medir por separado.

## 2. Diagnóstico técnico

### Qué hace realmente Herk

Herk es un workspace 2.0.0. Codex lee `.agents/skills` y Claude Code lee `.claude/skills`. El entorno aporta Node 22+, archivos por proyecto, FFmpeg/ffprobe y, para render, Chromium y HyperFrames. El operador provee los originales, selecciona resultados y aprueba los cortes. El script de transcripción implementa ElevenLabs, actualmente con un default histórico `scribe_v1`. Para otro proveedor hay que normalizar su salida a palabras con inicio y fin. Kie.ai y otros generadores son opcionales.

Los scripts proponen omitir pausas a partir del transcript, vuelven a calcular los tiempos, encuentran candidatos a errores y aplican cortes revisados. Un mapa de segmentos vincula tiempos de fuente y salida. El kit incluye una interfaz de revisión HTML, reglas para sincronizar overlays, validadores de reels y una biblioteca de plantillas y tarjetas. La revisión visual y auditiva del MP4 sigue siendo parte del flujo.

Evidencia consultada en el repositorio externo Herk Edit Kit, commit `10511e5`:
workflow en `docs/WORKFLOW.md`, scripts y dependencias en `package.json`,
proveedores en `docs/TOOLS-AND-API-KEYS.md` y permiso de uso en
`licenses/PIPELINE-USE-PERMISSION.txt`. Esos archivos pertenecen a Herk, no a
Courseforge; su consulta requiere disponer de ese repositorio y esa revisión.

### Encaje con Courseforge

| Capacidad | Evidencia en SofLIA | Brecha |
| --- | --- | --- |
| Grabación privada y derivados | El editor tiene biblioteca y autorización por borrador y organización. La exportación manual existente opera sobre intervalos seleccionados. | Ingesta y análisis asíncrono de una grabación, con límites propios de tamaño, duración y formatos. |
| Cortes no destructivos | `clip.trim`, `clip.split` y `clip.remove-range` operan sobre el documento. `remove-range` cuantiza a frames, conserva el offset y puede juntar los fragmentos del clip. | Aplicación en lote con simulación, IDs estables y sincronización explícita de captions y otras pistas. El ripple del clip por sí solo no resuelve un desplazamiento global. |
| Asistencia de edición | Gemini/OpenAI generan propuestas estructuradas. El servicio valida, simula, muestra diff y confirma contra la versión base. | Los recortes están fuera de la lista del agente. Conviene una propuesta de cortes específica que el usuario aplique explícitamente. |
| Subtítulos | Hay importación y proyección de captions, presets y timestamps de voz HeyGen. | ASR para grabaciones arbitrarias, normalización y retiming después de cada corte. |
| Movimiento y estilos | `courseforge-composition-v2` conserva la versión editable. HyperFrames se compila para preview y render. | Mapear tarjetas y estilos seleccionados a capas, tokens y presets nativos. Revisar fuentes y assets. Herk fija HyperFrames 0.7.109 y Courseforge 0.7.106 en los puntos revisados. Probar compatibilidad por composición. |
| Render final | El flujo implementado entrega un ZIP derivado a HeyGen. Hay seguimiento, webhook, reconciliación e importación del MP4. | Certificar las nuevas composiciones desde SofLIA hasta MP4. El worker de conformidad sirve como precedente de QA y no acredita un renderer general desplegado. |
| Cómputo remoto | `process-audio-queue.yml` instala FFmpeg en Ubuntu y procesa lotes acotados de análisis de forma de onda. CI incluye conformidad visual. | Worker de edición con permisos por job. El workflow de audio usa service role y la ejecución depende de configuración. El código no acredita activación en producción. |

Evidencia en [ADR de motion](../docs/architecture/adr-composition-motion-source-of-truth.md), [flujo canónico](../docs/architecture/hyperframes-composition-render-flow-source-of-truth.md), [operaciones del editor](../apps/web/src/domains/production/composition-editor/editor-patch.types.ts), [política del agente](../apps/web/src/domains/production/composition-editor/composition-agent-policy.service.ts), [operación de render](../docs/heygen_hyperframes_durable_operations.md) y [workflow de audio](../.github/workflows/process-audio-queue.yml).

## 3. Plan de implementación

| Opción | Uso viable | Decisión |
| --- | --- | --- |
| Netlify + Supabase + Actions | Netlify acepta y despacha. Supabase lleva estado y almacenamiento privado. Un runner Linux procesa jobs cortos y pasa resultados por HTTPS. El runner estándar Linux privado documenta 2 vCPU, 8 GB y 14 GB de SSD. El job puede durar hasta 6 horas, pero el arranque y el cron pueden demorarse. | Piloto controlado sin incorporar una plataforma de cómputo. Disparo manual al inicio. Si se automatiza, usar GitHub App de alcance acotado, ref protegida y un ID opaco de job. PostgreSQL conserva la cola y el estado. |
| Netlify Functions o Supabase Edge para todo | Sirven para control y llamadas cortas a APIs. Netlify Background tiene hasta 15 minutos. Supabase Edge documenta 256 MB y 2 s de CPU activa por request. | Usarlos para control, ingesta de eventos y reconciliación. Procesar y codificar medios en el runner o contenedor. |
| AWS Batch en Fargate | Contenedor por tarea, cola de capacidad y disco temporal de 20 GiB por defecto y hasta 200 GiB configurable. Requiere IAM, ECR, red, logs y configuración de Batch. Sin GPU en Fargate. | Primera opción productiva si el equipo administra el AWS ya presente en Courseforge y los archivos son pesados. Mantener el estado de negocio en Supabase. |
| Cloud Run Jobs | Contenedor por ejecución, timeout configurable de hasta 168 h para tareas sin GPU. IAM, Artifact Registry, logs y región. El filesystem escribible predeterminado consume RAM. | Alternativa para análisis y preprocesamiento acotados. Medir scratch y pipeline de archivos antes de adoptar para ingestiones largas o render por frames. |
| HeyGen HyperFrames Cloud | El proveedor renderiza el snapshot compilado e integra con el flujo de importación existente. | Mantener para el primer piloto integrado. El preprocesamiento de Herk requiere su propio worker. |
| HyperFrames CLI en contenedor propio | Permite controlar el entorno de render y los datos. Requiere Chrome headless, FFmpeg, fuentes, perfiles de CPU, memoria, scratch y evidencia de paridad. | Evaluar si residencia, formatos o costo total justifican operar el renderer. Un piloto para cortes no requiere poner esto en producción. |
| Codex Cloud, Codex SDK o Claude Agent SDK | Codex Cloud permite sesiones remotas con workspace y dependencias. Los SDK/CLI permiten ejecutar el harness programáticamente en un entorno aprovisionado. | Usarlos para replicar el flujo creativo con fixtures y probar prompts. En el producto, preferir el contrato estructurado y controles de herramientas existentes. |

Fuentes de plataforma: [runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [límites](https://docs.github.com/en/actions/reference/limits), [eventos](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows), [dispatch](https://docs.github.com/en/rest/actions/workflows?apiVersion=2022-11-28), [Netlify](https://docs.netlify.com/build/functions/background-functions/), [Supabase Edge](https://supabase.com/docs/guides/functions/limits), [Fargate](https://docs.aws.amazon.com/batch/latest/userguide/when-to-use-fargate.html), [disco Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-storage.html), [Cloud Run Jobs](https://docs.cloud.google.com/run/docs/create-jobs), [filesystem Cloud Run](https://docs.cloud.google.com/run/docs/container-contract), [HyperFrames CLI](https://hyperframes.heygen.com/guides/rendering), [Codex Cloud](https://learn.chatgpt.com/docs/environments/cloud-environments), [Codex programático](https://developers.openai.com/blog/codex-as-a-platform) y [Claude SDK](https://code.claude.com/docs/en/agent-sdk/overview).

### Secuencia y criterios de avance

1. **Prueba portátil.** Construir una imagen Linux reproducible con Node 22, FFmpeg/ffprobe y helpers seleccionados en una revisión fija. Procesar una fixture y una grabación representativa autorizada mediante `workflow_dispatch`. Pasar primero un transcript de prueba, luego comparar dos proveedores ASR en español con un corpus etiquetado. Medir tiempo de cola, latencia, RAM, temporales, desfase y falsos positivos.
2. **Piloto en Ensamble.** Habilitar por organización. Incorporar carga privada, estado y revisión de cortes sobre una sola grabación. Aplicar contra versión base y generar captions desde la proyección del transcript. Certificar preview y MP4 con la ruta HeyGen existente. El presupuesto de trabajo se divide en dos entregables verificables, portabilidad y producto.
3. **Operación.** Pasar el mismo contrato de ejecución a Fargate o Cloud Run cuando el volumen, los tamaños o los objetivos de espera lo requieran. Medir valores p50/p95 en staging con clips cortos, típicos y del máximo admitido. Acordar objetivos de latencia, costo y tasa de éxito con el negocio antes de fijar cuotas comerciales.
4. **Estilos.** Portar primero dos o tres tarjetas educativas y preservar la edición nativa. Añadir reels, audio multicapa y B-roll cuando exista un caso de negocio y se haya medido el impacto.

## 4. Implementación propuesta

```text
Ensamble → Next.js en Netlify → job durable en Supabase
   ↑                          ↓ lease e identidad por tarea
   │                        Runner Linux o contenedor administrado
   │                          ↳ ffprobe → extraer audio → ASR
   │                          ↳ proponer cortes → mapa de tiempos
   └─ revisar propuesta ← evidencia y artefactos privados
      → aplicar sobre versión confirmada → preview → render HeyGen → MP4
```

- **Solicitud y estado.** Un endpoint de producción verifica actor, organización, recurso y pertenencia al borrador. Registra el trabajo con una clave de idempotencia ligada a organización, versión base, checksum del original y perfil de análisis. Responde `202` con ID y ofrece estado/cancelación. El job lleva etapa, intento, vencimiento de lease, versión de la herramienta, referencias de objetos y error seguro. La propuesta conserva el hash base y su decisión editorial. Revisar constraints y autorización de `production_jobs` antes de decidir entre un tipo nuevo o persistencia separada.
- **Consumo durable.** Reclamo atómico desde el backend con lease renovable y token de intento. Escritura condicional de resultados al confirmar. Dispatcher recuperable con outbox o reconciliador de pendientes para cubrir la caída entre persistir y disparar. Reintentar fallos transitorios con backoff y límite. Resolver un envío incierto a un proveedor por ID de operación o reconciliación antes de repetir un efecto pagado. Cancelación observable desde el estado de negocio y terminación cooperativa de los subprocesses.
- **Worker.** Accede por HTTPS a objetos específicos con permisos temporales y escribe en un destino preasignado del mismo trabajo. Recibe parámetros tipados y límites. FFmpeg se invoca con argumentos fijos en un workspace aislado. Para la ruta nativa devuelve segmentos retenidos, timestamps de palabras, candidatos, métricas y hashes. El MP4 intermedio es opcional si se requiere evidencia de paridad con el kit o un derivado físico. Usar una imagen multimedia separada del análisis por modelo si sus necesidades de red difieren.
- **IA.** El modelo recibe el fragmento mínimo de transcript y el contexto editorial autorizado. Propone rangos y razones mediante esquema. La aplicación resuelve autorización, rangos fuera de fuente, solapes, duración mínima y protección de contenido pedagógico. Reutilizar el patrón de validación y revisión que usa el agente de composición. El worker ejecuta herramientas propias y deterministas. La decisión de qué se omite pertenece al editor. ASR puede comenzar con un JSON existente, ElevenLabs Scribe o Whisper con timestamps por palabra. Para restricciones de salida de datos, evaluar Whisper autohospedado con medición de calidad y costo.
- **Proyección temporal.** Persistir intervalos semiabiertos con unidades explícitas y correspondencia fuente/salida. Cuantizar una vez al generar la edición y proyectar captions y overlays usando el mapa final. Confirmar versión y hash mediante el mecanismo optimista del editor. Un cambio concurrente obliga a simular y revisar nuevamente contra la base vigente.
- **Assets e integridad.** Separar original, transcript, propuestas, proxies y derivados privados. Subir directo al almacenamiento elegido, registrar tamaño y checksum y servir video con Range para scrubbing. Planificar expiración de derivados y limpieza de temporales por intento. Fijar versiones de códecs, fuentes y renderer durante las pruebas de paridad. Registrar licencias de cada recurso incluido.

Fuentes ASR y render: [ElevenLabs Scribe](https://elevenlabs.io/docs/help-center/product/core-capabilities/speech-to-text/what-is-speech-to-text), [timestamps de OpenAI](https://developers.openai.com/api/docs/libraries/openai-cli) y [motor HyperFrames](https://hyperframes.heygen.com/packages/engine).

## 5. Riesgos, costo y validaciones

| Riesgo | Condición de aceptación |
| --- | --- |
| Cruce de organizaciones o fuga de medios | Dos organizaciones de prueba con acceso cruzado denegado en solicitud, estado, aplicación y descarga. Identidad de job de alcance mínimo, sin service role general en el runner de edición. URLs y transcripts ausentes de logs y artefactos de CI. |
| Datos no confiables y ejecución | Transcripts tratados como datos. AST/esquema para las propuestas. Assets privados autorizados, MIME y códec comprobados mediante probe, límites de bytes, duración y recursos. Considerar red restringida, binarios parchados y medios malformados en pruebas. |
| Pérdida o duplicación | Probar dispatch duplicado, lease vencido, caída tras upload, callback fuera de orden y cancelación durante encode. Solo el intento vigente confirma, y una salida huérfana se concilia o expira. |
| Errores editoriales y desfase | Corpus español con pausas intencionales, repetición pedagógica, retakes, audio ausente o separado, VFR y cortes junto a palabras. Comparar mapa, frames, captions y alineación A/V. Revisar manualmente uniones, legibilidad y contenido retenido. |
| Paridad y escalamiento | Archivos pequeños y del máximo permitido. Probar picos simultáneos por tenant, cuota global y cancelación. Medir cola, tiempo por etapa, p95, RSS, scratch, rechazo, reintentos, costo y output. Validar ida y vuelta de snapshot hasta MP4 con fuentes y assets congelados. |
| Privacidad, licencias y costo | Verificar política por organización, retención, residencia, transferencia de voz, derechos del material y notices de cada asset. Fijar presupuesto por job y por tenant. Mantener control de aprobación para publicar. |

El costo por video combina minutos de entrada para ASR, tokens, tiempo real de cómputo, minutos de salida para render, almacenamiento, transferencia y reintentos. Tres referencias ilustrativas en USD, antes de cuotas y descuentos:

- **Actions.** Linux x64 estándar 2-core a USD 0.006/min. Un job de 12 minutos cuesta **USD 0.072** de runner. [Tarifas de GitHub](https://docs.github.com/en/billing/reference/actions-runner-pricing).
- **Cloud Run Jobs.** Con 2 vCPU, 4 GiB y 720 s a USD 0.000018/vCPU-s y USD 0.000002/GiB-s en la tarifa de referencia, el cómputo es **USD 0.03168**. Es una configuración ilustrativa y la tarifa depende de la región. [Tarifas de Cloud Run](https://cloud.google.com/run/pricing).
- **HeyGen.** HyperFrames publica USD 0.15/min de salida para 1080p/30. Ocho minutos serían **USD 1.20** por render. Confirmar perfil, contrato y créditos de la cuenta antes de presupuestar. [Tarifas de HeyGen](https://help.heygen.com/en/articles/10060327-heygen-api-pricing-credits-explained).

Para esos supuestos, Actions más HeyGen suman USD 1.272 por video. Falta añadir ASR, modelo, transferencia, almacenamiento y reintentos. Concurrencia efectiva ≈ tasa de llegada × tiempo medio de procesamiento, con margen para picos. Dimensionar por jobs multimedia simultáneos y máxima edad de cola, usando límites por organización y por etapa.

### Evidencia de esta investigación

- Herk `npm test` pasó 11/11. `npm run check` revisó 716 archivos de distribución, dos estilos y 406 tarjetas con cero errores estructurales.
- Herk `npm run test:media` pasó en Windows con un video sintético de ocho segundos. Los resultados codificados fueron 3.960 s tras omitir pausas y 3.673 s tras omitir una repetición, frente a 3.960 s y 3.660 s del transcript. El smoke comprueba ambas pistas y diferencias menores a 120 ms para esta fixture.
- Courseforge `npm run test:composition-worker-runtime` compiló y pasó 23/23. La suite cubre arranque seguro de módulos, dependencias y contratos del runtime de conformidad. No ejecuta el piloto de edición en la nube.
- La inspección fue de los checkouts locales y documentación oficial. La ejecución integral en runner Linux, la configuración real de los ambientes, el ASR con grabaciones reales, la experiencia visual y el costo productivo permanecen por verificar. La investigación no inició jobs pagados, migraciones remotas ni despliegues.

## 6. Mejoras adicionales recomendadas

Orden de inversión: propuesta de cortes y captions en Ensamble, después estilos nativos, después ampliación de formatos y volumen. Abrir OpenSpec al iniciar la implementación para registrar el contrato, los escenarios y la evidencia. Activar por organización y detener nuevos despachos desde el flag si el piloto falla. Conservar versiones, propuestas y la auditoría para terminar o cancelar jobs ya aceptados.

