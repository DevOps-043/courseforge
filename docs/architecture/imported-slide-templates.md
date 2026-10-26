# Plantillas HTML importadas

Estado: implementación local, actualizada el 2026-10-21. Validada con el archivo HTML proporcionado por el usuario; no implica despliegue ni escritura en Supabase remoto.

## Uso

En **Plantillas de diapositivas → Importar HTML**, carga el archivo, revisa cada diseño y asigna sus campos a título, subtítulo, contenido o decoración. Debe existir un título por diseño y como máximo un subtítulo. Los campos de contenido se llenan en orden; decoración conserva el texto original.

Confirma la revisión y guarda. El paquete aparece en la biblioteca y en los selectores existentes de generación manual y automatizada. «Revisar diseño» abre una importación guardada; guardar modificaciones conserva la anterior como otro recurso inmutable.

## Bases generales del estudio

Una importación guardada también sirve como base para crear plantillas independientes. Desde la biblioteca, «Usar como base» abre el estudio con `baseRunId`; desde «Crear plantilla», el selector ofrece la base predeterminada y las importadas PACKAGED de la organización. Importar desde el estudio actualiza ese selector al guardar. «General» significa reutilizable dentro de la organización: no comparte diseños entre tenants.

El estudio HTML muestra el diseño real en iframe aislado. Se pueden elegir una o varias composiciones, nombrar la nueva plantilla, solicitar cambios de texto/roles/estilo con IA y guardar un paquete independiente. Al reabrirlo continúa desde su última revisión, sin volver a los seis layouts fijos. Una derivada guardada puede usarse a su vez como base. La fuente permanece inmutable; la revisión de importación original sigue disponible.

`designBase` fija run, spec, hash y título de origen por servidor. El lector exige ADMIN/SUPERADMIN y consultas de run PACKAGED y spec filtradas por organización. La creación persiste una conversación nueva y un borrador base antes de solicitar IA. Las revisiones posteriores mantienen procedencia y recursos; BD sigue almacenando manifiestos sin base64. El empaquetado hidrata recursos autorizados antes de producir el ZIP. No hay migraciones nuevas.

`GET /api/admin/slides/templates/design-bases/:runId` entrega la base con previews acotados y `private, no-store`. El POST existente de specs admite `importedBase` con `baseRunId`, `layoutIds` y `reviseWithAi`. El cliente no puede imponer `importedDesign` ni procedencia mediante overrides. El workflow conserva la ruta predeterminada existente para creaciones sin base.

La edición conversacional de importados usa Gemini, proveedor existente, con configuración de BUNDLE_AGENT por organización. Recibe instrucciones del usuario y estructura HTML/CSS sin binarios, como datos no confiables. Devuelve parches JSON de campos, etiquetas, propósitos y CSS estático; no HTML nuevo, scripts ni recursos. El servidor comprueba IDs, capacidad, título único, presupuesto y saneamiento completo. `clear` vacía texto real y conserva la caja; no equivale a ocultarlo con CSS. Las revisiones manuales/guardados no vuelven a llamar al modelo.

Límites: contexto de edición 384 KB, respuesta 128 KB, CSS adicional 20 000 caracteres y timeout del proveedor 45 s. La admisión comprueba hasta 12 specs por usuario/organización en la última hora antes de revisar con IA; es un control por recuento, no una cuota transaccional ni una reserva de intentos fallidos. Un error del proveedor conserva el borrador y no inserta una revisión inválida. Los fallos previos a crear la primera spec pueden dejar una conversación vacía recuperable mediante el mismo intento en pantalla, como en el estudio existente.

Este perfil no convierte a geometría nativa ni crea bindings matemáticos de gráficas. Los cambios visuales y los datos requieren revisión; vaciar algunos campos no certifica una limpieza editorial completa ni OCR de imágenes. La [evidencia de bases y estudio](../../openspec/changes/archive/2026-10-26-imported-template-design-bases/reports/verification.md) distingue las pruebas con proveedor simulado de una llamada real.

El flujo utiliza `EngineDialog`, igual que usuarios y confirmaciones. Su portal lo mantiene fuera de los estilos del encabezado; controles y avisos consumen los tokens del tema. El cuerpo tiene scroll interior y el encabezado y las acciones permanecen visibles en escritorio y móvil.

## Perfiles y presupuestos

- Archivo original de hasta **100 MB** (100 000 000 bytes). Un Web Worker local lee bloques de 256 KiB, retira scripts, comentarios, notas y navegación; deduplica imágenes y fuentes embebidas y las sustituye por referencias `cf-asset:asset-N`. No ejecuta HTML ni descarga recursos. La UI muestra progreso, cancelación y un resumen de la reducción.
- La fuente preparada enviada a la API admite hasta **2 MB UTF-8**, CSS incluido, con entre 1 y 24 secciones `.slide`, sin slides anidadas. Un original grande cuyo contenido útil exceda ese presupuesto falla con un mensaje diferente al límite del archivo. El servidor vuelve a sanear todo y comprueba sus bytes reales.
- La estructura normalizada admite hasta 2 MB serializados, sin contar base64. El perfil `html-text` conserva hasta 64 recursos únicos y 3 MB binarios (4 MB base64): PNG, JPEG, WebP VP8X, SVG estático restringido y TTF/WOFF/WOFF2. El transporte JSON y la respuesta con previews tienen presupuestos independientes de 5 MB; el servidor limita la lectura del stream aunque falte `Content-Length`. Los previews llevan referencias y los recursos viajan una vez; el cliente materializa solo el iframe seleccionado. Superar cualquier presupuesto produce un error explícito: aceptar 100 MB de original no garantiza aceptar 100 MB de recursos únicos.
- Estos presupuestos dejan margen frente a los 6 MB documentados para funciones síncronas en [Netlify](https://docs.netlify.com/build/functions/configuration/). La [evidencia del cambio de tamaño](../../openspec/changes/expand-slide-import-size/reports/verification.md) distingue admisión, compatibilidad y límites de las pruebas.
- El límite de archivo no garantiza compatibilidad: se conservan los topes de 120 000 caracteres CSS, 100 000 caracteres por fragmento y nodos/profundidad. El perfil anterior mantiene el preflight del editor nativo; `html-text` valida su propio contrato HTML y recursos, sin conversión geométrica.
- Canvas 1920×1080. Se conserva HTML/CSS estático y SVG sin recursos externos.
- Se retiran scripts, eventos y recursos externos. El modo `html-text`, predeterminado en el worker de importación, conserva composición, fuentes y recursos embebidos compatibles. Los enlaces conservan apariencia pero pierden su destino. Los comentarios CSS se eliminan antes de comprobar caracteres activos; combinadores válidos como `>` se conservan. CSS con escapes activos, anidación o complejidad excesiva se rechaza. Animaciones y reglas de navegación se materializan como estado estático cuando es posible; no se ejecutan animaciones importadas. El preview requiere revisión.
- Las anclas visuales `data-od-id` se convierten en `data-cf-design-id` en HTML y selectores CSS. Solo conservan estilos, sin conceder identidad editable ni autoridad.
- Las gráficas dinámicas no tienen binding en este perfil; su generación devuelve una incompatibilidad explícita. Tampoco se descargan assets ni se reconstruyen elementos dibujados exclusivamente por JavaScript.
- Los límites de caracteres son controles de capacidad, no una garantía de ajuste visual con cualquier fuente. El preview de importación usa contenido de muestra; QA de generación sigue siendo necesario.
- La inferencia inicial de roles es algorítmica y revisable por una persona. No se llama a un modelo para clasificar el HTML. El agente de copy existente recibe únicamente capacidades estructuradas, nunca el HTML como instrucciones.

## Contratos y seguridad

La preparación local es una optimización del transporte, no una frontera de confianza. El original completo se queda en el dispositivo; la fuente reducida y los recursos únicos viajan por HTTP. El servidor verifica base64 canónico, MIME/firma, dimensiones, presupuestos acumulados de píxeles y fuentes, SHA-256 y longitud. SVG usa una lista restringida sin código ni referencias externas. Estas comprobaciones acotan contenedores y coste declarado; no equivalen a un análisis antivirus ni a un decodificador completo de fuentes. Se conservan por separado los contadores de preparación local y los del saneamiento del servidor.

El worker se termina al completar, fallar, cancelar, desmontar el componente o agotar 120 segundos. La entrada tiene topes de 10 000 elementos y profundidad 80; los límites más estrictos del diseño/editor siguen en servidor. No se promete memoria constante: el parser puede retener un atributo individual grande, aunque la lectura sea por bloques y ocurra fuera del hilo UI.

`courseforge-imported-slide-design-v1` vive en `importedDesign`, opcional en specs de paquetes y `course-deck-v1`. Su incorporación no cambia los layouts ni documentos anteriores. El [contrato](../../apps/web/src/domains/production/slides/import/imported-slide-design.contract.ts) centraliza límites y campos.

`POST /api/admin/slides/templates/import` admite `analyze`, `load` y `save`. Solo ADMIN/SUPERADMIN con tenant activo. La identidad y la organización provienen del servidor; el payload no puede conceder permisos. `save` exige revisión y vuelve a validar según el perfil antes de persistir. Los errores de datos son 400/422; tamaño excesivo, 413; permisos, 401/403; recursos ajenos o inexistentes, 404.

HTML se parsea con Cheerio y sanea con sanitize-html; CSS se parsea con PostCSS, se aísla bajo una raíz y se eliminan recursos de red y código. El renderizador revalida también el JSON persistido. Los previews usan iframe sin permisos y CSP sin red ni scripts. Las identidades estáticas de estilo se transforman a clases para no interferir con los IDs del editor.

El [renderizador importado](../../apps/web/src/domains/production/slides/import/imported-slide-renderer.service.ts) reemplaza campos mediante nodos de texto, conserva una sola copia de CSS por deck y selecciona diseños por propósito y capacidad. Si no existe uno compatible, falla sin truncar bloques ni sustituirlo por un diseño estándar.

El perfil anterior utiliza el productor editorial existente y su compilador independiente. El modo `html-text` genera HTML conservando el diseño y sustituye sus campos de texto; no crea un artefacto del editor geométrico ni permite aplicar una paleta nativa. La conversión nativa devuelve incompatibilidad explícita y los cambios de apariencia responden 409. No se debilita el catálogo de confianza ni se concede autoridad a atributos importados. Motion sigue siendo propiedad del documento de composición.

La prueba local con `SofLIA_Highlands_Premium_EN_v4.html` recorre preparación, análisis de 16 diseños, guardado del ZIP y recarga íntegra con BD/storage simulados. La comparación estática en Chrome incluye fuentes, fondo y logotipo. El archivo no contiene animaciones de diapositivas: sus scripts controlan navegación y solo hay una transición CSS en botones. Los resultados y límites están en [el informe de fidelidad](../../openspec/changes/preserve-imported-html-design/reports/verification.md). La incompatibilidad nativa documentada en [el informe anterior](../../openspec/changes/fix-opendesign-css-compatibility/reports/verification.md) sigue siendo una restricción del editor geométrico, no del nuevo perfil HTML.

## Persistencia y recuperación

Se reutilizan `soflia_bundle_conversations`, `soflia_bundle_specs`, `soflia_bundle_generation_runs` y el bucket privado `template-bundles`. No hay migraciones nuevas.

Los binarios viven una vez en `assets/` del ZIP; BD, blueprints y listados guardan manifiestos sin base64. `resourceBundleRunId` identifica un run que el servidor vuelve a consultar por organización y estado PACKAGED antes de descargar. Se valida prefijo privado de la organización, hash del ZIP, número de entradas y longitud real descomprimida por recurso. El render vuelve a comprobar cada hash. La generación hidrata recursos bajo autorización y persiste de nuevo manifiestos en BD.

La biblioteca usa un iframe lazy hacia `GET /api/production/slides/templates/:runId/preview`, autorizado por sesión y organización tanto en run como spec. Devuelve HTML con CSP sin scripts/red externa y `private, no-store`; evita incluir todos los recursos de la biblioteca en un listado. Los recursos eliminados por importaciones antiguas requieren reimportar el original.

Las identidades derivan de organización, nombre y diseño normalizado. Un reintento recupera las filas existentes; el ZIP tiene entradas con fechas deterministas y nombre por hash. Un upload duplicado solo se acepta después de descargar y comprobar su hash. El run pasa de QUEUED a PACKAGED después de confirmar storage y actualización de BD. Un fallo parcial deja un recurso reanudable, sin anunciar éxito. El mismo reintento debe conservar nombre y diseño.

El límite de 100 conversaciones activas se comprueba antes de admitir un recurso nuevo, igual que en el estudio actual; es un control de admisión, no una cuota transaccional frente a importaciones diferentes concurrentes.

## Verificación y reversión

`npm run test:slide-template-import -w apps/web` comprueba saneamiento, estado visible, campos, capacidad, compilación editorial, hashes, separación de tenants y recuperación tras fallos. También cubre originales sintéticos de 21,7/50/100 MB, reducción de URLs CSS entre bloques, frontera de 2 MB, UTF-8 multibyte, lectura acotada sin confiar en cabeceras, familia editable mayor de 500 KB y presupuesto de previews. Está incluido en `test:coverage-gaps`, consumido por `verify`.

El fixture de navegador `apps/web/tools/qa/import-slide-template.smoke.mjs` monta los componentes reales dentro de `engine-page-hero`, cargando CSS Modules y el sistema de estilos real, con API y persistencia simuladas. Valida carga con el worker real y originales sintéticos hasta 100 MB, cancelación, expansión JSON, preview, revisión, guardado, contraste, Escape, retorno del foco y acciones visibles en claro/oscuro y escritorio/móvil. Sus capturas y resultados se generan bajo `apps/web/.tmp/html-template-import-theme-qa/`; usa fuentes de sistema de respaldo y no valida Supabase real ni un archivo real de Open Design. La corrección visual conserva evidencia en [su cambio OpenSpec](../../openspec/changes/fix-slide-import-modal-theme/reports/verification.md); la preparación de archivos grandes, en [su informe](../../openspec/changes/prepare-large-html-slide-files/reports/verification.md).

`apps/web/tools/qa/import-slide-template-fidelity.smoke.mjs` recibe la ruta de módulos del runtime y un HTML local. Usa los servicios de preparación/paquete/recarga y el componente React reales; captura cada diseño a 960×540 contra una referencia sin scripts del mismo archivo. Espera las fuentes y bloquea red. Guarda métricas y capturas en `apps/web/.tmp/html-template-fidelity-qa/`. No acredita animaciones, fuentes externas ni persistencia remota.

En el archivo del usuario, los 16 diseños presentan 0 % de píxeles distintos por encima de 12 niveles RGB por canal en esta comparación. El fixture admite como máximo 0,1 % de diferencia, configurable con `SLIDE_IMPORT_QA_MAX_PIXEL_DIFFERENCE`. Las condiciones de posición CSS se fijan antes de añadir campos para conservar estilos y saltos de línea; sustituir texto preserva sus espacios periféricos y decoración conserva el texto original.

### Limpieza editorial: limitación y análisis

Conservar el diseño no equivale a retirar el contexto de la presentación de origen. La inferencia actual puede asignar decoración a subtítulos, instituciones, categorías, pies y folios por su tag HTML. La [auditoría del archivo real](../../openspec/changes/preserve-imported-html-design/reports/content-cleanup-analysis.md) identifica 375 campos: 120 conservan su texto original al generar, incluidos 15 pies y 15 folios. También detecta gráficos cuya geometría no está vinculada al nuevo texto. La política de omisión, metadatos generados y bindings que propone ese informe todavía no está implementada; no debe confundirse la prueba de fidelidad con una validación de reutilización semántica.

Para revertir el acceso nuevo, ocultar los botones de importación. Mantener el lector/renderizador opcional mientras existan decks o paquetes que declaren `importedDesign`; no borrar fuentes, paquetes ni revisiones anteriores. La evidencia de esta entrega vive en [OpenSpec](../../openspec/changes/import-html-slide-templates/reports/verification.md).
