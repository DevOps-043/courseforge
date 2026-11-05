# Fuente de verdad: documento, medios y render de composiciones HyperFrames

Estado: **vigente; correccion P0 implementada, migracion de integridad pendiente de despliegue**  
Ultima revision tecnica: 2026-10-31
Responsables: Production Engineering, Platform y QA  
Alcance: editor nativo, documento versionado, previews, snapshots ZIP, entrega de medios y HyperFrames Cloud.

## 1. Regla de mantenimiento

Este archivo es la fuente de verdad operativa del flujo de composicion y render
HyperFrames de Courseforge. Todo cambio que afecte documento, assets, preview,
snapshot, ZIP, variables, envio a HeyGen, polling, importacion o SFX debe:

1. actualizar primero el contrato o decision correspondiente en este archivo;
2. enlazar migracion, servicio y prueba que constituyen la evidencia;
3. agregar una entrada al historial de cambios;
4. ejecutar `npm run test:hyperframes --workspace=apps/web` y las pruebas E2E
   proporcionales;
5. seguir `docs/compliance/protocolo-actualizacion-heygen-hyperframes.md` si
   cambia HyperFrames, HeyGen, credenciales, webhooks o el artefacto enviado.

El codigo y las migraciones prevalecen si este documento queda desactualizado;
esa discrepancia es un defecto documental y debe corregirse en el mismo cambio.

## 2. Resumen del incidente SFX

La importación de plantillas de diapositivas dispone de un perfil `html-text`
para conservar HTML/CSS, fuentes e imágenes embebidas y sustituir campos de
texto. Su paquete privado guarda recursos deduplicados y manifiestos; no genera
un documento del editor geométrico ni importa animaciones a `document.motion`.
Las reglas de autoridad y render nativo de este documento siguen vigentes.
Contrato y evidencia: [plantillas HTML importadas](imported-slide-templates.md)
y [validación de fidelidad](../../openspec/changes/preserve-imported-html-design/reports/verification.md).

Las bases HTML importadas pueden originar nuevas plantillas desde el estudio,
con procedencia fijada y revisiones de texto/CSS validadas. El preview utiliza
el HTML importado y conserva recursos privados. Esta edición conversacional
no crea geometría nativa ni altera `document.motion`; véase el contrato de
[bases reutilizables](imported-slide-templates.md).

### Sintoma

Al agregar un efecto de transicion, el enlace entre asset y borrador se crea,
pero `PUT /api/production/hyperframes/drafts/:draftId/document` responde `500`.
La solicitud contiene precondiciones validas y coincidentes en `If-Match` y
`X-Composition-Version`; por ello no corresponde al flujo esperado de conflicto
`409`, precondicion `428` ni validacion `400`.

### Causa raiz con alta confianza

`assertAddedAssetsBelongToDraft` consulta desde la tabla de enlace hacia
`sound_effect_assets`, una relacion muchos-a-uno, y trata la relacion embebida
como arreglo:

```ts
row.sound_effect_assets?.some((asset) => asset.status === "READY")
```

PostgREST devuelve el extremo "to-one" como objeto o `null`, no como arreglo.
Por ello, cuando existe el enlace, `.some` no es una funcion y se produce una
excepcion inesperada. La ruta la normaliza como `500` generico. El mismo patron
esta duplicado en la resolucion de assets del preview, por lo que corregir solo
el guardado dejaria una segunda falla inmediata.

Evidencia primaria:

- `apps/web/src/domains/production/composition-editor/composition-document.service.ts`
- `apps/web/src/domains/production/composition-editor/composition-preview-assets.service.ts`
- [Supabase: joins y cardinalidad de relaciones](https://supabase.com/docs/guides/database/joins-and-nesting)
- [PostgREST: many-to-one se representa como objeto](https://docs.postgrest.org/en/v13/references/api/resource_embedding.html)

### Punto exacto del flujo

La falla sucede antes de aplicar el patch, persistir una nueva version, crear el
snapshot, construir el ZIP o llamar a HeyGen. El ZIP y HyperFrames Cloud no son
la causa de este `500`, aunque fueron auditados porque constituyen los pasos
posteriores del mismo caso de uso.

## 3. Flujo canonico de extremo a extremo

```text
Biblioteca SFX privada por organizacion
  -> POST /api/production/sound-effects (vincula asset READY al draft)
  -> PUT /hyperframes/drafts/:id/document (clip.add + control If-Match)
  -> documento courseforge-composition-v2 versionado por hash
  -> preview: valida enlaces, firma URLs cortas y compila HTML interactivo
  -> snapshot: resuelve identidades inmutables y compila HTML de render
  -> ZIP inmutable: HTML + GSAP + documento + manifiesto
  -> envio: firma medios, materializa src en una copia desechable del ZIP
  -> direct upload de HeyGen + POST /v3/hyperframes/renders
  -> webhook firmado y reconciliacion durable
  -> importacion reanudable del video final a Storage
```

Ninguna URL firmada forma parte del snapshot inmutable. Se genera justo antes
del envio y se incorpora solamente a la copia desechable que recibe HeyGen.

## 4. Contrato del documento editable

- Descarga individual (2026-10-29): el inspector permite eliminar un intervalo
  en segundos relativos al clip y descargar su ventana fuente vigente como
  MP4 o WAV. Un corte central produce dos clips; se descarga solo el seleccionado.
  Esta salida local aplica recortes temporales, no efectos visuales ni mezcla
  del ensamble. Usa el acceso ya autorizado al medio, sin snapshot ni render
  cloud; rechaza velocidad, congelación y bucles no representables. Fuente y
  salida limitadas a 256 MiB y tramo a diez minutos, con cancelación explícita.
  Alcance y evidencia: `openspec/changes/fix-clip-range-export/`.

  Con edición local inmediata, la descarga vacía el autoguardado, espera la cola
  y comprueba de nuevo la proyección local y los registros de recuperación antes
  de capturar el clip confirmado. Una cola vacía después de un error no habilita
  exportar ediciones pendientes. Los controles respetan `localEditingBlocked` y
  las pistas bloqueadas sin retirar los accesos de grupos anidados.

- Intros y outros (2026-10-30): los accesos Editar intro/outro de la timeline
  abren el inspector compartido de capas, transformación y animaciones. Reaplicar
  el mismo asset conserva la instancia, recortes, audio y motion. La reconciliación
  corporativa recoloca únicamente su ventana al inicio/final; sustituir o retirar
  el recurso elimina su motion anterior. Las intros nuevas proceden de Producción;
  la biblioteca corporativa administra outros y conserva intros históricas.
  Contrato y evidencia: `openspec/changes/branding-clip-controls/`.

- Plantillas HTML importadas (2026-10-19): el generador de diapositivas admite
  `importedDesign` estático opcional. Antes de registrar un paquete se ejecuta
  el productor y compilador editorial existentes. Los campos se vinculan a
  texto, sin ejecutar código externo ni crear otra fuente de motion. La
  importación no activa documentos, renders ni publicación. Perfil y límites:
  [plantillas HTML importadas](imported-slide-templates.md).

- Autoguardado por interacción (2026-10-17): los controles de geometría, recorte,
  motion/poses, texto/captions, color, audio/curvas, profundidad y velocidad no
  requieren Guardar. El preview sigue siendo local durante el gesto; al finalizar
  o tras 600 ms de pausa se envía un patch válido, deduplicando blur/Enter.
  Una interrupción de pointer finaliza el último valor válido del control nativo.
- `CompositionAutosaveCoordinator` coordina borradores con deshacer/rehacer,
  cambio de herramienta, entrega y cambio de lección. No se guardan valores
  numéricos vacíos como cero. Los efectos de sincronización de los inspectores
  conservan el borrador mientras hay una interacción pendiente.
- Continuidad nativa (2026-10-30): `CompositionLocalEdits` proyecta los comandos
  admitidos sobre el último documento confirmado. Inspector y timeline siguen
  editables durante el PUT nativo; la única cola existente persiste en orden con
  If-Match. Cada respuesta confirma sólo su comando y recompone los posteriores;
  historial y journal usan el anterior confirmado, no el borrador futuro. Un
  fallo cancela el envío de la cola restante y conserva sus copias recuperables.
- El inspector valida el grupo de campos y emite sólo propiedades modificadas.
  Cambiar X no reenvía timing ni opacidad. El contenido de texto nativo se aplica
  como texto literal sobre su propia capa, sin reconstruir escena ni tocar
  raíces HTML controladas; tipografías nuevas, captions/timing que necesiten
  escena en composiciones HTML y revisiones editoriales conservan compilación.
  No se elimina la barrera de autoridad/manifiesto para evitar una recarga.
- La cola conserva sus límites y falla cerrada, pero los comandos admitidos se
  registran primero con `composition-pending-edits.ts`: máximo 50, 2 MiB y 24 h.
  Los comandos no enviados sobreviven a la cancelación de la cola. Su recuperación
  es explícita, comprueba el hash base y requiere resolver primero una escritura
  incierta mediante el journal existente. El almacenamiento local no da autoridad:
  toda escritura mantiene validación y permisos del servidor.
- HTML guarda cada campo válido o grupo coherente mediante su host editorial;
  se conserva validación, CAS, seguimiento, adopción y deshacer/rehacer HTML.
  No se publica una revisión mediante el PUT nativo genérico. Procesar medios,
  aprobar propuestas, crear recursos, snapshots, render y publicación siguen
  siendo decisiones explícitas y no se activan por autoguardado.
- Los límites del historial no cambian: deshacer de sesión hasta 50 acciones y
  20 MiB; la consulta persistida lista 20 versiones. No se promete reversión de
  efectos externos ni disponibilidad perpetua de recursos referenciados.
- Regresión: `test:composition-autosave` y el fixture de navegador
  `apps/web/tools/qa/composition-autosave.smoke.mjs`. El fixture usa persistencia
  simulada; no acredita una sesión autenticada, SQL real ni render del proveedor.
- `qa:composition-preview-scene` añade tres intenciones con el primer PUT
  retenido, respuestas tardías, 500/409 y protección de texto frente a raíces
  HTML. Las pruebas de navegador usan persistencia simulada y el runtime real.
- Observabilidad: `admission_to_visual_update_ms` mide desde admisión local hasta
  ACK, incluyendo copia local, proyección y cola visual; excluye la pausa de
  escritura de 600 ms. `save_roundtrip_ms` termina al leer la respuesta HTTP,
  antes del ACK/historial. `preview_fallback` distingue HTML, dependencias,
  operación, runtime no listo, base incompatible, flag desactivado y fallo de
  patch. La cuota es de 100 eventos/minuto por instancia y batches de 25;
  no se vacía la cuota al enviar ni se registran contenido o URLs.

- Formato canonico: `courseforge-composition-v2`.
- Concurrencia: hash SHA-256 estable, enviado como ETag fuerte en `If-Match`.
- Persistencia: cada cambio agrega una version; no muta versiones anteriores.
- SFX: clip `kind: AUDIO`, pista `semanticRole: SFX` y fuente
  `SOUND_EFFECT_ASSET` con UUID del catalogo.
- El documento conserva identidad, timing, offset, duracion y volumen de la
  instancia; no conserva rutas de Storage ni URLs.
- Las transiciones reales se persisten como relaciones declarativas entre dos
  clips en `document.transitions`; no se representan como dos animaciones
  independientes. Su contrato y reglas de handles se definen en
  `docs/architecture/composition-transitions-v1.md`.
- El compilador deriva de esas relaciones una ventana visual desechable y, si
  hay solapamiento, lanes HyperFrames independientes. Preview y render consumen
  esa misma proyección; el documento editable conserva sus tiempos canónicos.
- Un mismo asset puede producir varias instancias con ids de clip distintos.
- Los intervalos superpuestos se empaquetan en lanes y reciben indices de track
  HyperFrames independientes.
- Un clip no puede exceder el canvas. Al insertar cerca del final, la UI recorta
  la instancia al tiempo restante; esta decision debe ser visible al usuario.
- SFX no activa ducking de musica por defecto. Voz/avatar siguen siendo los
  triggers y musica el destino.

## 5. Contrato de autorizacion y tenancy

Las 17 rutas HTTP directas del corte .7.b.2 (24 métodos) usan indisponibilidad de
autoridad segura y revisión anclada al tenant. Se conservan reasons legacy de
tenant y clasificadores de dominio. El preview nativo sigue devolviendo failure
bridge HTML para sync v2 válido y JSON en los otros casos, con CSP y generación
originales; un fallo de autoridad produce DEPENDENCY_FAILED sin detalles internos.
Los 30 adaptadores delegados requieren su inspección independiente. Inventario,
transformación reproducible y alcance de pruebas:
[F1.3.c.3.c.7.b.2.a](../../openspec/changes/tenant-authorization-authority/reports/context-F1.3c3c7b2a.md).

La frontera compartida de lectura HTML valida actor/tenant/rol antes del cliente
privilegiado y conserva errores neutrales aunque falle observabilidad. Tiene
regresión ejecutada para cuotas y aislamiento entre solicitudes. Las pruebas del
core no acreditan los contratos de cada adaptador; el inventario delega doce GET
en once adaptadores y mantiene pendientes escrituras, capabilities y narrativa.
Alcance y canarios:
[F1.3.c.3.c.7.b.2.b.1](../../openspec/changes/tenant-authorization-authority/reports/context-F1.3c3c7b2b1.md).

GET/POST de renders proyectan las clases conocidas de autoridad como 503 seguro,
con revisión anclada al tenant. El fallo de dispatcher conserva failDispatch
antes de responder; fallar al compensar no acredita reparación durable. Se
mantienen actor/tenant del servidor, attemptId y no despachar de nuevo un
resultado reutilizado o con ID de proveedor. Alcance simulado y aceptación:
[F1.3.c.3.c.7.b.1](../../openspec/changes/tenant-authorization-authority/reports/context-F1.3c3c7b1.md).

Los soportes compartidos de presets, propuestas del agente y seguimiento de
render traducen las dos clases conocidas de indisponibilidad de autoridad a
response 503 segura antes de crear admin. Sus dieciocho métodos consumidores
devuelven response antes de invocar dominio/SDK. Errores desconocidos se relanzan
al contrato propio de cada ruta; revisión y contexto corresponden al mismo tenant.
Las rutas de creación/recuperación y otros consumidores independientes siguen
pendientes. Evidencia y alcance de dobles:
[F1.3.c.3.c.7.a](../../openspec/changes/tenant-authorization-authority/reports/context-F1.3c3c7a.md).

Las ocho operaciones HTTP de automation/runs proyectan las clases conocidas
de indisponibilidad de autoridad como 503 seguro/reintentable, correlacionado
y sin caché. Se conservan filtros de organización, aprobación, configuración,
captions, edición de clips y firma de despacho. Los errores de dominio y el
callback del worker mantienen sus contratos. Esto no acredita atomicidad de
las escrituras sucesivas de configuración ni ejecución real del proveedor.
La integración de automatización se conserva en:
[F1.3.c.3.c.6.a](../../openspec/changes/tenant-authorization-authority/reports/context-F1.3c3c6a.md).

Standalone exige comprobante servidor de propósito exclusivo, ligado a vídeo y
organización y válido siete días, además de identidad/tenant/rol vigentes. Se
verifica antes de credenciales/proveedor y no se renueva por polling. El studio
lo transmite por header redactable y conserva el valor validado en cada respuesta;
todas las respuestas de vídeo son privadas/no-store. Sin comprobante válido se
deniega, incluidos IDs históricos; no se presume ownership por cuenta de HeyGen.
La firma se comprueba antes de generar. Un ID distinto del proveedor no expone
su URL. Media y vídeo proyectan indisponibilidad conocida de autoridad como 503.
El comprobante no es una bitácora durable ni revoca URLs públicas ya entregadas.
Compatibilidad, pérdidas de respuesta y aceptación pendiente:
[F1.3.c.3.c.6.b](../../openspec/changes/tenant-authorization-authority/reports/context-F1.3c3c6b.md).

La biblioteca de plantillas usa únicamente la organización del resolver vigente
antes de crear el cliente privilegiado y filtra ejecuciones, conversaciones y
especificaciones por ella. Claims y cookies históricos no conceden acceso.
Sin tenant devuelve un fallo explícito (HTTP 403); ante indisponibilidad conocida
devuelve fallo seguro y reintentable (HTTP 503), sin presentarlo como lista vacía.
El Server Action conserva success/error para sus consumidores y añade errorCode;
la UI existente muestra ese fallo. Evidencia:
[F1.3.c.3.c.5.a](../../openspec/changes/tenant-authorization-authority/reports/context-F1.3c3c5a.md).
Los otros ocho handlers de slides/open-design usan el mismo mapper de autoridad
en sus fronteras HTTP. Se conservan CSP/DTO, firmas, reutilización de jobs y
compensación de despacho/preparación; no se acredita ejecución real de proveedores.
Transformación HTML a PNG, preparación de deck animado y apariencia exigen
namespace del componente autorizado después de normalizar el path, incluso para
referencias guardadas. El rechazo precede a descarga/rasterización/sobrescritura.
Se admite HTML propio recién subido sin esperar la persistencia de su referencia.
Evidencia: [F1.3.c.3.c.5.b](../../openspec/changes/tenant-authorization-authority/reports/context-F1.3c3c5b.md).

Las operaciones HTTP de HeyGen (assets, plataforma, presets, escenas, voz,
vídeos, clips y jobs) proyectan caídas internas conocidas de autoridad como
503 seguro con correlación y `private, no-store`. Se conservan permisos y errores
de proveedor, despacho 202 y compensación de clips. Una reserva de sincronización
existente conserva su compensación antes de proyectar la caída de autoridad;
la sincronización opcional del editor mantiene su advertencia de fallo parcial.
No se certifica idempotencia o ejecución real del proveedor por estas pruebas.
Evidencia: [F1.3.c.3.c.4](../../openspec/changes/tenant-authorization-authority/reports/context-F1.3c3c4.md).

El descriptor de QA de render controlado vive en un contrato independiente de
fence, materialización y supervisor. Contiene identidad de ejecución/revisión,
organización, hashes y el contrato de conformidad existente; no contiene claves,
credenciales o leases ni acredita autoridad por sí mismo. Las validaciones y
garantías de esos servicios permanecen iguales. Evidencia:
[F3.5.d1](../../openspec/changes/decouple-controlled-render-descriptor/reports/context-F3.5d1.md).

Los handlers HTTP de narrativa comparten su tipo de autoridad desde
`composition-narrative-http-authorization.contract.ts`; el adaptador de voz
mantiene el export anterior. El contrato no depende de handlers y no concede
permisos ni cambia estados/respuestas. Evidencia:
[F3.5.c](../../openspec/changes/decouple-narrative-http-authority/reports/context-F3.5c.md).

Las conexiones/validaciones de HyperFrames y HeyGen, settings de generación,
identidad de ensamble y LiveAvatar usan la misma proyección HTTP de autoridad:
503 seguro, correlación y `private, no-store` ante clases internas conocidas.
La firma, credenciales, webhooks y medios solo se alcanzan tras validar identidad,
rol y tenant. Se conserva el orden existente de los efectos y errores de proveedor;
esto no acredita atomicidad entre guardar una credencial y configurar su webhook.
Evidencia y límites:
[F1.3.c.3.c.3](../../openspec/changes/tenant-authorization-authority/reports/context-F1.3c3c3.md).

Las fronteras HTTP de medios privados, descargas de assets/SFX, preview y biblioteca
SFX, waveform y jobs de audio distinguen indisponibilidad de autoridad de una
denegación: las clases internas de identidad/tenant producen 503 seguro con
correlación, retryable y `private, no-store`, antes de firma, ingestión o jobs.
Los redirects y TTL existentes, el acceso READY por organización y los errores
del dominio se conservan. Contrato y pruebas de entrega con NextResponse real:
[F1.3.c.3.c.2](../../openspec/changes/tenant-authorization-authority/reports/context-F1.3c3c2.md).

Antes de admitir un UUID en el documento se deben comprobar por separado:

1. borrador activo y perteneciente a `organizationId`;
2. enlace borrador-SFX de esa organizacion;
3. asset SFX de esa organizacion y estado `READY`.

No se debe depender de la forma dinamica de una relacion embebida de PostgREST
para una decision de autorizacion. El helper compartido debe devolver un
`Set<string>` tipado de ids autorizados o un error de dominio seguro.

La base debe reforzar el mismo invariante con FKs compuestas que incluyan
`organization_id`; RLS por si sola no evita inconsistencias introducidas por
service role, SQL manual o un bug del backend.

## 6. Contrato del preview

- Dos clips AUDIO adyacentes pueden usar CROSS_DISSOLVE con audioMode CROSSFADE:
  el efecto es exclusivamente sonoro, con handles y duración original verificados.
  Runtime extiende ventanas y offsets de audio; no aplica opacidad a los medios.
  Quitar la transición recupera el corte original. El timeline permite ampliar
  el audio seleccionado y doble clic para situar el cursor antes de dividir.
  [Contrato de edición de audio](../../openspec/changes/audio-clip-editing/design.md).

- `audioMix.masterVolume` opcional controla el nivel de toda la línea del tiempo
  entre 0 y 1, con ausencia equivalente a 1 sin alterar el JSON leído. La ganancia
  se aplica una sola vez sobre el volumen final de clips/pistas, fades, ducking,
  curvas y crossfades, tanto en preview como en render y referencia de audio.
  El ajuste neutro elimina el campo; la mezcla individual se conserva.
  [Contrato del maestro](../../openspec/changes/timeline-master-volume/design.md).

- Motion puede desbordar el rectángulo estático de cada asset: `.clip-content`
  permite overflow visible y el recorte final pertenece a `#composition-root`.
  Crop y máscaras siguen viajando con el sujeto animado; no se cambian layout,
  recorridos ni keyframes persistidos. Aplica al HTML de preview y render.
  Contrato y QA: [motion en el canvas del video](../../openspec/changes/video-canvas-motion/design.md).

- La automatización de producción admite `nativeCaptions` explícito en el perfil
  general y por componente (ausente: desactivado). En una ejecución aprobada,
  el refresco prepara el borrador cuando están listos los assets y las voces por
  escena con timestamps, y añade captions nativos con fondo transparente mediante
  el append versionado con hash. No activa captions del proveedor ni ASR nuevo.
  Los reintentos reconocen la misma capa; diferencias, capas manuales/importadas,
  recortes o eliminación de una capa registrada requieren revisión. Readiness
  refleja faltantes o conflictos y no declara listo un item incompleto. El render
  conserva su aprobación explícita. Contrato y evidencia:
  [subtítulos automáticos](../../openspec/changes/automatic-transparent-captions/design.md).
- Si existe una única capa de subtítulos editable, la revisión ofrece preguntar
  si se quiere sobrescribir. Aceptar autoriza solo esa capa y el hash mostrado;
  cancelar conserva su contenido. Una versión distinta exige otra confirmación.
  La autorización no se guarda en el perfil ni la reutiliza el cron. Se reemplazan
  texto, tiempos y ajustes por frase, conservando identidad, posición y estilo de
  capa con fondo transparente. Varias capas o pista bloqueada se revisan en el
  editor. «Generar desde la voz» también pregunta antes de regenerar una capa.

- Al extender videos sin velocidad ni congelación explícitas, el preview repite
  la fuente. La sincronización tolera el cruce del final al inicio con distancia
  circular; el precalentamiento no reposiciona medios activos durante buffering
  y su recuperación no fuerza otro seek al último fotograma. Los seeks manuales
  y la entrada al clip conservan precisión. No cambia el HTML de render.
  Regresión: `qa:composition-video-loop` del workspace web y
  `openspec/changes/fix-extended-video-loop/`.

- La validación de fronteras UTF-16 y rangos de énfasis vive en
  `composition-caption-text-validation.ts`, sin depender del schema de cues ni
  del servicio de efectos. El schema consume ese módulo y el servicio conserva
  sus exports públicos. No cambia texto, rangos, errores, tiempos o formato.
  Evidencia: [desacoplamiento de captions](../../openspec/changes/decouple-caption-text-validation/reports/context-F3.5a.md).
- El documento valida invariantes globales sobre `composition-clip.contract.ts`;
  ese contrato conserva los schemas de clip, layout y crop. Las referencias de
  fuentes se validan en `composition-font-reference.contract.ts`, separado de su
  lector. El plan de captions consume solo clips; los exports de las rutas
  anteriores reexportan los mismos contratos, sin cambiar reglas o formatos.
  Evidencia: [contratos de documento](../../openspec/changes/decouple-composition-document-contracts/reports/context-F3.5b.md).
- Los presets de animación Educativo, Lectura guiada y Social aplican settings de
  efectos a la capa sin modificar texto, tiempos o personalizaciones por frase.
  Los presets visuales permanecen independientes. Social usa karaoke `BACKGROUND`
  con texto/fondo activos y posiciones estables; `activeBackgroundColor` es opcional
  y validado como hexadecimal. Los lectores previos a esta ampliación no conocen
  el nuevo enum: desplegar juntos servidor, compilador y UI, sin degradar el lector
  después de persistirlo. No se requiere SQL. Los bloques generados desde voz ya
  son breves; no se resegmentan automáticamente captions manuales o importados.
  Pruebas: `test:composition-caption-presets` y `qa:composition-caption-layout`
  del workspace web.
- En captions sin efectos, la alineación vertical pertenece al contenedor flex;
  el texto y los spans sincronizados se agrupan en un bloque de párrafo interior.
  Las palabras conservan sus IDs y tiempos y se distribuyen en flujo inline,
  con ajuste de líneas al ancho disponible, tanto en preview como en render.
  Regresión: `npm run qa:composition-caption-layout --workspace=apps/web`.
- Los helpers que se serializan como JavaScript para el iframe deben conservar
  todas sus dependencias dentro de la misma función/factoría serializada. Una
  referencia a otro símbolo del módulo puede romperse al minificar el servidor.
  La geometría de recorte y snap se prueba después de minificar el módulo.
- El arrastre y la selección rectangular usan el ancho vigente del lienzo después
  de cada patch de escena; el tirador proporcional admite desplazamiento en ambos
  ejes. Regresión local: `qa/run-composition-resize-format-smoke.ts` del dominio.
- El PUT del editor limita petición y lectura de respuesta a 30 segundos. Un
  timeout libera la cola, conserva el cambio para recuperación y comunica que el
  resultado remoto es incierto; no provoca reintentos automáticos. Las siguientes
  escrituras conservan las precondiciones de versión para detectar conflictos.

- Resuelve solo assets vinculados al borrador y permitidos para la organizacion.
- Los SFX nuevos deben estar `READY`; los snapshots historicos pueden conservar
  assets archivados si su identidad inmutable ya fue congelada.
- Las URLs de preview tienen TTL corto y nunca se registran en logs o tablas.
- Preview y render se compilan desde el mismo documento y las mismas reglas de
  timing, lanes, offset y volumen.
- El navegador puede requerir gesto para desbloquear audio; esto es un estado de
  UX, no una falla del asset.
- Errores de enlace, firma o media deben producir codigo de dominio y
  `diagnosticId`, no un `500` opaco.

## 7. Contrato del snapshot y ZIP

El snapshot actual usa `REMOTE_VARIABLES`. Su ZIP contiene:

- `index.html`;
- `assets/gsap.min.js`;
- `composition-document.json`;
- `asset-manifest.json`.

Los binarios de video/audio no se copian al ZIP. El manifiesto fija por asset:
UUID, checksum, MIME, tamano, bucket y path. El ZIP se comprime con DEFLATE, se
hashea y se guarda en una ruta content-addressed.

Antes de congelarlo se debe validar:

- todos los UUID referenciados estan enlazados y resolubles;
- checksum SHA-256, MIME, tamano, bucket y path son validos;
- cada `<audio>` tiene `id`, `src` o binding resoluble, `data-start`,
  `data-duration`, `data-track-index` y `data-volume` finitos;
- entry point presente y archive menor de 200 MB;
- documento, manifiesto y revision declaran la misma version de binding.

Brecha vigente: revision, enlaces de assets y activacion se escriben en varias
operaciones sin una transaccion unica. Una falla intermedia puede dejar un ZIP
o revision huerfanos o una revision parcialmente enlazada.

## 8. Contrato de entrega a HeyGen/HyperFrames Cloud

La ruta genérica `/api/storage/signed-upload-url` no firma `production-videos`
ni admite `purpose: production-video`. Los vídeos finales conservan los flujos
específicos de render/importación y sus comprobaciones de identidad. Las miniaturas
de publicación se firman para un artefacto autorizado en un path nuevo generado
por el servidor, con sobrescritura desactivada. No se modifican URLs históricas,
documentos ni snapshots. Contrato, consumidores y pruebas:
[F1.3.c.3.b.2](../../openspec/changes/tenant-authorization-authority/reports/context-F1.3c3b2.md).
La verificación de políticas efectivas de Storage continúa pendiente.

Courseforge sigue el flujo oficial: comprimir, direct upload, crear render y
consultar el estado. La documentacion oficial fija un maximo de 200 MB para el
archivo, recomienda `--dry-run` para inspeccion y exige idempotencia para no
duplicar uploads o cobros. Referencias:

- [HyperFrames Cloud: flujo, limite e idempotencia](https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes-cli/references/cloud.md)
- [CLI oficial: cloud render](https://github.com/heygen-com/hyperframes/blob/main/docs/packages/cli.mdx)
- [Contrato oficial de variables y medios](https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes-core/references/variables-and-media.md)
- [Pipeline oficial de render y mezcla](https://github.com/heygen-com/hyperframes/blob/main/docs/packages/producer.mdx)

HyperFrames extrae audio desde el `src` escrito en el HTML. Por eso
`materializeHyperframesRenderMedia` debe reemplazar cada binding `cf_asset_*`
por una URL HTTPS firmada antes del upload, conservar el binding declarativo y
rechazar cualquier audio sin `id` o `src`.

Las URLs firmadas son credenciales temporales: no deben aparecer en logs,
diagnosticos, manifiestos persistidos ni descargas de soporte. El hash y tamano
del ZIP preparado para HeyGen deben registrarse como metadatos no sensibles,
separados del hash del snapshot original.

Version verificada en Courseforge: `@hyperframes/studio` y
`@hyperframes/studio-server` 0.7.106. Upstream publico ya presenta versiones
posteriores con correcciones de audio. No actualizar sin ejecutar el protocolo
de cumplimiento, pruebas de contrato y comparacion de render.

## 9. Hallazgos y prioridad

| Prioridad | Hallazgo | Impacto | Estado |
| --- | --- | --- | --- |
| P0 | Cardinalidad PostgREST tratada como arreglo en guardado SFX | Bloqueaba insertar cualquier SFX y devolvia 500 | Corregido y cubierto |
| P0 | El mismo patron existia en assets de preview | El preview fallaba despues del guardado | Corregido y cubierto |
| P1 | La suite HyperFrames no tenia pruebas SFX | La regresion no era detectable | Cobertura inicial agregada; faltan snapshot E2E e ingestion |
| P1 | Errores inesperados antes del RPC carecian de diagnostico estructurado | Soporte solo veia un 500 generico | Corregido para PUT con etapa y diagnosticId |
| P1 | Snapshot y enlaces de revision no finalizan transaccionalmente | Revision parcial y reintentos ambiguos | Confirmado, pendiente |
| P1 | `organization_id` de tablas de enlace no esta reforzado por FK compuesta | Riesgo de inconsistencia multi-tenant con service role | Confirmado, pendiente |
| P1 | Tabla SFX de revision no persiste `source_storage_bucket` | Procedencia incompleta y bucket hardcodeado al renderizar | Migracion y codigo listos; pendiente despliegue |
| P2 | Comentario promete inmutabilidad READY, pero la BD permite UPDATE | Un binario historico puede cambiar sin nueva identidad | Trigger listo; pendiente despliegue |
| P2 | Bucket acepta mas codecs que el ingestion actual | Contrato operacional ambiguo; la UI solo valida WAV RIFF | Confirmado, pendiente |
| P2 | Parser WAV solo calcula duracion por byte rate | Inspeccion insuficiente para archivos hostiles/corruptos | Confirmado, pendiente |
| P2 | No se registra hash/tamano del ZIP materializado | Diagnostico incompleto de lo realmente enviado | Confirmado, pendiente |
| P2 | Dependencias 0.7.106 por detras del upstream auditado | Se omiten correcciones posteriores de audio | Requiere evaluacion |

## 10. Casos de uso obligatorios

| Caso | Resultado esperado |
| --- | --- |
| Agregar primer SFX READY | Enlace idempotente, version nueva y preview audible |
| Reutilizar el mismo SFX | Varias instancias, un asset en manifiesto, ids de clip unicos |
| Dos SFX simultaneos | Lanes/track-index distintos, ambos presentes en mezcla |
| Insertar junto al final | Recorte explicito o bloqueo comprensible; nunca duracion cero |
| Mover, recortar, dividir, borrar y deshacer | Documento valido y asset fuente inmutable |
| Recargar editor | Misma version, posiciones y mezcla |
| ETag obsoleto | `409` recuperable, sin perder la edicion local |
| Asset no enlazado/no READY/de otra empresa | Rechazo `4xx`, sin revelar existencia |
| URL de preview expirada | Renovacion controlada, sin mutar documento |
| Archivar asset ya usado | No disponible para inserciones nuevas; snapshot historico reproducible |
| Restaurar snapshot con SFX | Nueva version editable, identidad historica preservada |
| Crear snapshot y ZIP | Manifiesto completo, HTML valido, hash estable |
| Reintentar upload/render | Misma idempotency key, sin doble cobro ni doble job |
| Render lento mayor al TTL | Renovacion antes de submit o error recuperable antes del cobro |
| Webhook ausente/duplicado | Reconciliacion durable e idempotente |
| Cancelar en upload/render/importacion | Estado terminal coherente y sin publicacion parcial |

## 11. Plan de implementacion aprobado para experimentacion

### Fase 0 — Contencion y evidencia

- Invalidar la sesion cuyo token fue compartido durante el diagnostico.
- Capturar el stack local del 500 sin registrar cookies, JWT ni URLs firmadas.
- Añadir `diagnosticId` y etapa (`authorize`, `asset-link-validation`, `patch`,
  `append-rpc`) a fallas del PUT.

Salida: incidente reproducible y observable sin datos sensibles.

### Fase 1 — Correccion P0 compartida

- Crear un servicio/repositorio unico para validar ids de assets enlazados.
- Consultar enlaces y assets READY con contratos tipados separados; no usar
  `.some()` sobre relaciones embebidas.
- Reutilizarlo en guardado y preview.
- Mapear ausencia/no READY a `409` o `422`, y dependencia fallida a `503`.

Salida: insercion y preview SFX funcionales sin debilitar tenancy.

### Fase 2 — Cobertura de contrato SFX

- Unit tests de upload WAV, dedupe, tags, enlace y autorizacion.
- Tests de documento para `clip.add`, restore/reconcile, ETag y UUID arbitrario.
- Tests de preview para READY, archivado, otra organizacion y URL expirada.
- Tests de compilador para audio simple, repetido, solapado, recortado y oculto.
- Tests de snapshot/materializacion para manifiesto deduplicado y todos los
  atributos `<audio>` requeridos.
- Route integration test que reproduzca el PUT observado.

Salida: el fallo actual rompe una prueba antes del fix y pasa despues.

### Fase 3 — Integridad de datos e ingestion

- Migracion aditiva con FKs compuestas `(id, organization_id)` para draft,
  asset y revision.
- Persistir `source_storage_bucket` en enlaces SFX de revision.
- Hacer inmutable la identidad binaria de un asset READY; reemplazar crea otro
  asset/version.
- Alinear allowlist del bucket con la ingesta real. Mantener WAV en el piloto o
  agregar inspeccion/transcodificacion server-side antes de aceptar otros codecs.
- Validar RIFF completo, codec, canales, sample rate, bits, duracion y checksum.

Salida: invariantes multi-tenant y de reproducibilidad garantizados en BD.

### Fase 4 — Snapshot transaccional y diagnostico ZIP

- Mover alta de revision, enlaces y activacion a un RPC transaccional e
  idempotente; conservar el upload content-addressed fuera de la transaccion.
- Implementar reconciliacion/limpieza acotada de objetos huerfanos.
- Crear un inspector interno que, sin exponer URLs firmadas, reporte archivos,
  entry point, hashes, tamanos, bindings, audios y errores de contrato.
- Registrar hash/tamano del ZIP materializado y version exacta del renderer.

Salida: ninguna revision parcialmente activa y evidencia de lo enviado.

### Fase 5 — Certificacion HeyGen

- Ejecutar `hyperframes check` sobre una reproduccion local exportada del ZIP.
- Inspeccionar archive equivalente a `cloud render --dry-run --json`.
- Render de matriz: SFX solo; voz+SFX; musica+voz+SFX; SFX solapados; inicio,
  corte y final; 24/30/60 fps; retries y cancelacion.
- Comparar preview contra video final por tiempo, presencia y ganancia de audio.
- Evaluar upgrade 0.7.106 -> version objetivo en branch aislado, aplicando
  cumplimiento y pruebas de regresion antes de decidir.

Salida: evidencia E2E de Courseforge -> HeyGen -> importacion.

### Fase 6 — Rollout controlado

- Feature flag por organizacion y catalogo piloto.
- Telemetria agregada: exito/falla por etapa, latencias, previews fallidos,
  renders con SFX y discrepancias de manifiesto; nunca nombres o URLs firmadas.
- Activar primero en una organizacion interna y ampliar solo con cero P0/P1.

## 12. Definition of Done

- El PUT observado responde exitosamente o con error de dominio accionable.
- No queda ningun uso de la cardinalidad embebida incorrecta.
- Guardado, preview, snapshot, upload, render, webhook e importacion tienen
  cobertura automatica y una corrida E2E registrada.
- Cross-tenant, asset no READY y UUID arbitrario fallan cerrados.
- Preview y MP4 contienen los mismos SFX dentro de un frame de tolerancia.
- Reintentos no crean revision, provider asset, render ni cobro duplicado.
- ZIP persistido y ZIP enviado son auditables por hash/tamano sin secretos.
- README, CLAUDE y este archivo reflejan el flujo realmente desplegado.

## 13. Validacion ejecutada durante esta revision

- Inspeccion estatica de ruta PUT, servicio de documento, preview assets,
  compilador, snapshot, materializacion, submission, migracion y biblioteca.
- Contraste con documentacion oficial Supabase/PostgREST y HyperFrames.
- `npm run test:hyperframes --workspace=apps/web`: aprobado, incluyendo los
  nuevos casos SFX de autorizacion, guardado, preview y compilacion de audio.
- `npm run build --workspace=apps/web`: aprobado. La primera ejecucion no pudo
  descargar Google Fonts por la red restringida; la repeticion con acceso a red
  compilo y genero las rutas correctamente.
- `npx supabase db push --dry-run`: no ejecutado contra remoto porque este
  checkout no tiene un proyecto Supabase vinculado. La migracion sigue pendiente
  de validacion y aplicacion en el entorno destino.
- Validacion manual en el editor real sobre el borrador reportado: el reintento
  del PUT cambio de 17 a 18 clips, mostro la capa `SFX` con `Swoosh Simple` en
  `00:23-00:27` y termino en estado `Guardado`, sin reproducir el error 500.
- No se ejecuto render pagado ni se descargo el snapshot del borrador reportado.

## 14. Historial

- 2026-11-05: clasificación de 47 candidatas HyperFrames y normalización de 17
  rutas directas, preservando contratos legacy/iframe. Evidencia .7.b.2.a en sección 5.

- 2026-11-05: autoridad HTTP de creación/recuperación de render y compensación
  preservada; evidencia F1.3.c.3.c.7.b.1 en sección 5. Rutas independientes restantes pendientes.

- 2026-11-05: autoridad segura en tres soportes compartidos HyperFrames y sus
  dieciocho métodos consumidores, sin modificar lógica del editor/render.
  Evidencia F1.3.c.3.c.7.a en sección 5; lote padre pendiente.

- 2026-11-05: comprobante de consulta standalone ligado a vídeo/organización,
  transporte en el studio y errores de autoridad en tres operaciones. Vigencia,
  compatibilidad y límites en evidencia F1.3.c.3.c.6.b de sección 5.

- 2026-11-05: ocho operaciones HTTP de automatización normalizan errores de
  autoridad. Filtros, aprobación y despacho preservados; standalone pendiente.
  Evidencia F1.3.c.3.c.6.a en sección 5.

- 2026-11-05: ocho handlers de slides/open-design proyectan indisponibilidad de
  autoridad; tres operaciones HTML verifican namespace del componente autorizado.
  Recuperación y contratos multimedia preservados; evidencia F1.3.c.3.c.5.b en sección 5.

- 2026-11-05: biblioteca de plantillas con autoridad vigente antes del acceso
  privilegiado, denegación explícita y errores seguros. Evidencia F1.3.c.3.c.5.a
  en sección 5; los otros ocho handlers siguen pendientes.

- 2026-11-05: normalización de indisponibilidad de autoridad en operaciones,
  clips y jobs HeyGen; diecinueve métodos con contratos y compensación
  preservados. Evidencia F1.3.c.3.c.4 en sección 5.

- 2026-11-05: descriptor neutral de QA; desaparece la componente circular
  restante sin cambiar las seis implementaciones emitidas. verify:pr aprueba
  localmente; TD-12 conserva pendiente la corrección del resolvedor de alias.

- 2026-11-05: contrato neutral de autoridad HTTP narrativa; elimina la
  dependencia circular entre handler genérico y adaptador de voz con emisión
  CommonJS idéntica. Evidencia F3.5.c en sección 5.

- 2026-11-05: separación de contratos de clip y referencias tipográficas del
  documento y sus lectores/planes. Serialización, hashes, errores y planes
  caracterizados sin cambios; F3.5.b elimina su componente circular.

- 2026-11-05: extracción neutral de validación de texto de captions; se elimina
  su componente circular preservando exports, Unicode y schemas. Evidencia
  F3.5.a en la sección de subtítulos; TD-12 sigue abierto por los demás grupos.

- 2026-11-05: normalización de indisponibilidad de autoridad en conexiones,
  configuración e identidad de ensamble; schemas, DTO y orden de efectos
  conservados y probados con dobles. Evidencia F1.3.c.3.c.3 en sección 5.

- 2026-11-05: las rutas de medios, descargas, audio y SFX proyectan caídas de
  autoridad como 503 seguro; se comprueban redirects/TTL/DTO y permisos sin
  modificar documento, render ni snapshots. Evidencia F1.3.c.3.c.2 en sección 5.

- 2026-11-04: cierre local de firma genérica de vídeos y ownership de thumbnails
  de publicación; render/importación conservan sus contratos. Evidencia y límites
  en F1.3.c.3.b.2, enlazada en la sección 8.

- 2026-11-03: acceso «Grupos» desde el timeline y selección explícita de grupos
  completos en el panel. La selección aditiva se procesa una sola vez en click
  para que pointerdown no sustituya las unidades elegidas con Shift/Ctrl/Cmd o
  Selección múltiple. Las acciones aparecen al inicio y se explica la capacidad
  de servidor deshabilitada. Contrato y habilitación:
  [grupos jerárquicos](../../openspec/changes/nested-composition-groups/design.md).

- 2026-11-03: pestaña «Subtítulos» con «Crear subtítulos manuales», independiente
  de voz o transcripción. La capa conserva `origin: MANUAL`, fondo transparente y
  una primera frase de hasta dos segundos para continuar escribiendo; se abre
  Propiedades y se sitúa el cursor en su inicio. Los documentos históricos no se
  reescriben y la automatización optativa de producción conserva su configuración.
  Contrato: [autoría manual](../../openspec/changes/manual-caption-creation/design.md).

- 2026-11-03: acceso directo «Guías» en el monitor, con texto visible también en
  barra compacta, panel enlazado y cierre con Escape. El menú distingue «Rejilla
  fija» de las líneas personalizables. No cambia preferencias, snap ni render.
  Contrato: [guías personalizables](../../openspec/changes/custom-reference-guides/design.md).

- 2026-11-03: el inspector visual coloca «Posición manual» antes de tiempo/audio,
  identifica «Horizontal (X)» y «Vertical (Y)» y retira los campos X/Y duplicados
  que no emitían preview inmediato. Se conserva el canal temporal y autoguardado
  existente. Contrato: [posición manual](../../openspec/changes/manual-position-controls/design.md).

- 2026-11-03: distinción entre agrupación visible y anidación editorial en un solo
  bloque de timeline mediante `groups[].timelineMode`. Migración y capacidad SQL
  específicas; no modifica el documento audiovisual compilado. Contrato:
  [anidación del timeline](../../openspec/changes/timeline-nesting/design.md).

- 2026-10-31: crossfades entre clips de audio con handles verificados, ventanas y
  offsets extendidos, sin animación visual. Zoom focal de onda y doble clic para
  situar el cursor antes de dividir audio. [Evidencia](../../openspec/changes/audio-clip-editing/reports/validation.md).

- 2026-10-31: maestro de volumen persistente para toda la línea del tiempo,
  compartido por nivel estático, envolventes, preview/render y referencia PCM.
  Incluye reconocimiento de SFX como audio configurable. Pruebas y QA local:
  [evidencia](../../openspec/changes/timeline-master-volume/reports/validation.md).

- 2026-10-31: motion ya no queda recortado por la caja estática del asset. El canvas
  del video mantiene el recorte final; crop y máscara viajan con el sujeto.
  QA local de 19 presets en ambos targets, píxeles, control negativo y seek:
  [evidencia](../../openspec/changes/video-canvas-motion/reports/validation.md).

- 2026-10-31: los subtítulos existentes pueden sobrescribirse tras preguntar al
  revisor. Confirmación por capa/versión, preservación al cancelar y rechazo de
  decisiones obsoletas. El editor también confirma antes de regenerar una capa.

- 2026-10-31: generación optativa de subtítulos transparentes durante el refresco
  de producción y tras el despacho. Configuración general/por componente,
  protección editorial, ID determinista y append con hash. Se requieren voces
  por escena con timestamps; sin ASR adicional. Pruebas y límites en
  [evidencia del cambio](../../openspec/changes/automatic-transparent-captions/reports/validation.md).

- 2026-10-31: zoom de monitor 25–400% con ajuste a lienzo completo, porcentajes,
  slider y presets. La geometría del iframe y áreas seguras conserva el mismo
  centrado. Vista ampliada dentro de la página oculta laterales sin desmontarlos
  y restaura la distribución anterior; Fullscreen API sigue independiente. Sin
  modificar clips ni render final. Diseño/evidencia:
  [espacio y zoom del monitor](../../openspec/changes/monitor-space-zoom/proposal.md).

- 2026-10-31: guías de referencia configurables exclusivamente en el editor.
  Posición proporcional, orientación, color y visibilidad se conservan localmente
  por draft; las líneas visibles alimentan el snap existente. El iframe permite
  arrastre y teclado mediante mensajes validados y generación vigente. No forman
  parte del documento, snapshots ni HTML de render. Diseño y evidencia:
  [guías personalizables](../../openspec/changes/custom-reference-guides/proposal.md).

- 2026-10-31: máscaras geométricas opcionales en `clip.mask` para imagen, video
  y diapositiva. `clip.mask` aplica/quita formas validadas; el renderer compartido
  anida la máscara dentro del sujeto recortado para intersectarla con los bordes.
  El preview temporal no cambia el archivo original. Documento legacy omite el
  campo; lectores estrictos antiguos requieren despliegue compatible antes de
  editar documentos enmascarados. Diseño y evidencia:
  [máscaras visuales](../../openspec/changes/visual-clip-masks/proposal.md).

- 2026-10-31: posición X/Y temporal desde el inspector con el comando
  `courseforge-composition-preview-position`. El monitor recibe cambios válidos
  durante el gesto; el guardado sigue agrupado al terminar. Los patches canónicos
  actualizan la base sin sobrescribir un desplazamiento temporal posterior. Al
  cambiar selección o bloquear se retira la superposición, sin alterar motion,
  tamaño u opacidad. Contrato y evidencia en el cambio de posición manual.

- 2026-10-31: el inspector nativo ofrece posición X/Y con deslizadores y campos
  en píxeles para clips visuales. Reutiliza `clip.layout` y el guardado al terminar
  el gesto, con rangos del lienzo y límites del esquema, sin cambiar el contrato
  de preview/render. Alcance y QA: [posición manual](../../openspec/changes/manual-position-controls/proposal.md).

- 2026-10-31: integración de descarga individual con edición local inmediata y
  agrupaciones. La fuente se captura después de confirmar la cola y comprobar
  recuperación pendiente. Evidencia:
  `openspec/changes/fix-clip-range-export/reports/merge-staging-latency-2026-10-31.md`.

- 2026-10-29: controles explícitos de intervalo y descarga local del clip
  multimedia seleccionado con sus offsets vigentes. Selección posterior resuelta
  contra el documento guardado. QA con MP4/WAV sintéticos, cancelación y errores
  de codificador: `openspec/changes/fix-clip-range-export/reports/verification.md`.

- 2026-10-30: acceso directo al inspector de intros/outros y conservación de
  capas, recortes y animaciones al reaplicar el mismo recurso. Se reutilizan
  patches y compilación existentes, sin migración ni cambio de proveedor.

- 2026-10-29: corrección del atasco del preview al repetir videos extendidos;
  QA sintética de extensión en vivo, seek y tres ciclos continuos.

- 2026-10-27: nombre de presentación y etiquetas predeterminadas de composiciones nuevas derivados de `apps/web/src/config/app.ts`, escapados al generar HTML. No cambian formatos, namespaces, documento editable, motion ni snapshots históricos. Contrato: [identidad global](product-branding.md).

- 2026-10-21: incorporado el flujo de bases importadas y derivados en el estudio;
  sin cambios al documento nativo ni al contrato de motion.

- 2026-10-21: delimitado el perfil HTML con campos de texto, recursos privados
  y previews aislados; sin cambios al contrato de motion o render nativo.

- 2026-10-19: importación de familias HTML estáticas revisadas y reutilización
  en la generación de diapositivas, conservando preflight editorial, tenant,
  hashes y fuente única de motion. Especificación y evidencia:
  `openspec/changes/import-html-slide-templates/`.

- 2026-10-17: autoguardado de herramientas editoriales, agrupación por interacción,
  estado pendiente visible y copia recuperable de comandos aún no enviados.
  Se conserva el host HTML y se retiran pasos de preparar/guardar por campo.
  Especificación y evidencia: `openspec/changes/editor-action-autosave/`.

- 2026-10-17: añadidos presets de animación específicos y resaltado sincronizado
  de fondo para Social, conservando posición, énfasis, timestamps y lectura V1.
- 2026-10-16: corregidos captions sincronizados sin efectos que apilaban cada
  palabra como un flex item en columna. El bloque de párrafo conserva karaoke,
  alineación, Unicode y escapes; no requiere migración de documentos.
- 2026-10-16: corregida la escala del arrastre tras cambiar orientación y el
  tirador proporcional vertical; eliminado el cierre externo de la geometría
  serializada que producía ReferenceError en staging tras minificar; añadido
  límite de espera del guardado del editor.

- 2026-09-04: se verifico la correccion P0 de extremo a extremo en la UI con el
  mismo reintento que habia fallado; el clip SFX quedo persistido y visible en
  timeline y microeditor.
- 2026-09-04: se implemento la correccion P0 con consultas explicitas de
  enlaces y assets READY reutilizadas por guardado y preview. Se agregaron
  pruebas de autorizacion fail-closed, persistencia de clip SFX, URL privada y
  contrato HTML HyperFrames. El PUT ahora entrega `diagnosticId`, codigo y etapa
  en errores inesperados. Se agrego la migracion
  `20260905100000_harden_sound_effect_asset_integrity.sql` para FKs compuestas,
  bucket inmutable de revision y proteccion de la identidad binaria READY; debe
  aplicarse antes de desplegar el codigo que lee esa columna.
- 2026-09-04: documento creado; incidente SFX diagnosticado; auditoria completa
  de documento, preview, snapshot ZIP, entrega remota y provider; plan de seis
  fases definido. No se implementaron aun las correcciones.

## Capas visuales adicionales

El rango inicial de profundidad sigue siendo 0–10 y los valores predeterminados
por tipo no cambian. `extraLayerDepths`, opcional en el documento, registra
profundidades únicas y ordenadas de 11 a 1000 (límite técnico de validación).
Las capas extra vacías también se guardan; quitar una no renumera las demás.
Los clips solo pueden usar profundidades base o extras registradas. Documentos
sin este campo conservan la normalización histórica 0–10 y su hash persistido.

`layer.add` y `layer.remove` requieren origen USER y usan la cola, ETag e historial
existentes. Quitar una capa ocupada requiere dos confirmaciones en la interfaz
y una lista exacta de IDs confirmados en el dominio; incluye clips ocultos.
Pistas bloqueadas y cambios del conjunto confirmado impiden eliminarla. La
operación es atómica sobre el documento y limpia motion, grupos y transiciones
mediante la eliminación de clips existente; conserva los assets originales y
la regla de conservar un clip en composiciones automáticas. Deshacer restaura
la capa y sus elementos mediante el historial del editor.

Preview incremental y compilación para render admiten las mismas profundidades.
El agente puede usar extras registradas, pero no crear ni quitar capas. No se
requiere migración SQL ni cambia el contrato del proveedor. Tras guardar extras,
una reversión debe conservar lectores compatibles. Evidencia y límites:
[capas dinámicas](../../openspec/changes/dynamic-composition-layers/proposal.md).

## Agrupaciones editoriales anidadas

### Agrupar y anidar en la línea del tiempo

Agrupar mantiene los clips visibles y coordina su selección y movimiento.
Anidar selección crea un grupo con `timelineMode: "NESTED"` y `groupingVersion: 2`;
la ausencia del modo conserva el comportamiento y hash históricos. El timeline
oculta las hojas y muestra un único bloque en una fila editorial propia, desde
el inicio mínimo al final máximo de la selección, incluyendo huecos internos.
Solo incorpora unidades completas seleccionadas del mismo nivel, sin capturar
otros clips que crucen ese rango. Doble clic o Enter abre el contenido; Escape
o la ruta vuelve al padre. Desanidar elimina el contenedor y conserva sus hijos.
El rango se mueve como una unidad; para recortar se abre primero el contenido.

El modo se conserva al duplicar o extraer fragmentos narrativos. No crea un medio
intermedio ni efectos o transformaciones heredados: preview y render continúan
consumiendo las hojas originales con sus tiempos, pistas, audio y motion.
La proyección vive en `composition-timeline-nesting.service.ts` y solo se usa en
el editor, nunca como documento de entrada del compilador audiovisual.

Además de los requisitos jerárquicos siguientes, crear nuevos contenedores exige
`20261103010000_timeline_nesting.sql`. El RPC anuncia `timelineNesting: true` y
GET/PUT exponen `canNestTimeline`; la UI y el servidor fallan cerrados si falta
esa capacidad. Desactivar creación conserva lectura, edición y desanidación.
La migración se entrega localmente y requiere aplicación autorizada en destino;
no se debe revertir a lectores incompatibles mientras existan estos documentos.
Pruebas y límites: [cambio OpenSpec](../../openspec/changes/timeline-nesting/proposal.md).

El contrato incorpora `groupingVersion: 2` y referencias `childGroupIds` dentro
de `groups`. `clipIds` conserva exclusivamente miembros clips directos. Los
grupos tienen padre único, sin ciclos y hasta ocho niveles; siguen vigentes
los máximos de 250 grupos y 500 clips por documento. Los tiempos, pistas,
geometría y motion permanecen en los clips; los contenedores no crean clips
HyperFrames ni transformaciones audiovisuales heredadas.

La selección opera por unidades del nivel actual. Agrupar envuelve hermanos;
desagrupar promueve únicamente sus hijos; al eliminar miembros se disuelven
contenedores vacíos o se promueve su única unidad. Mover un contenedor resuelve
hojas y vínculos avatar–voz una sola vez. La copia reconstruye de hijos a padres;
la extracción narrativa exige grupos completos y valida el mismo árbol en SQL.

Lecturas legacy no agregan campos ni reescriben hashes. Después de introducir
el marcador, las nuevas versiones lo conservan, incluso al restaurar un estado
plano; el historial original permanece inmutable. El guard SQL de inserción
valida el grafo y rechaza downgrades, también desde el wrapper de append antiguo.

Para habilitar nuevas relaciones grupo→grupo se necesitan las migraciones
`20261029230000_nested_composition_groups.sql` y
`20261029230100_nested_narrative_fragment_groups.sql`, además de
`COMPOSITION_NESTED_GROUPS_ENABLED=true` en servidor. La env por sí sola no
habilita: un RPC restringido confirma el contrato SQL, con caché de 30 segundos
y fallo cerrado. Las migraciones se entregan preparadas; no se aplican remotamente
por el hecho de editar el repositorio.

GET/PUT anuncian `capabilities` fuera del documento hasheado. El cliente envía
`X-Composition-Grouping-Version: 2`; su ausencia en escrituras jerárquicas produce
409 con `COMPOSITION_GROUPING_CLIENT_OUTDATED`. Esto es negociación de formato;
la autorización de usuario, rol, tenant y hash continúa siendo obligatoria.

Desactivar la habilitación impide nuevas relaciones, también mediante restore,
reconcile y copia, y conserva lectura, movimiento, edición y desagrupación de
árboles existentes. No se debe regresar a lectores incompatibles tras guardar
el primer árbol. La integración local, comandos, evidencia y límites se conservan
en [el cambio OpenSpec](../../openspec/changes/nested-composition-groups/proposal.md).

La integración con edición local inmediata conserva `localEditingBlocked` en
inspector, selección y transiciones. La capacidad de crear grupos anidados se
negocia por separado; limpiar la selección del timeline conserva el grupo en
edición. La proyección local y sus confirmaciones usan el mismo reducer de
grupos, sin sustituir movimientos pendientes por respuestas anteriores.
