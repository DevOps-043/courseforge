# Plantillas HTML importadas

Estado: implementación local, actualizada el 2026-10-20. No implica despliegue ni validación con un export real del proveedor.

## Uso

En **Plantillas de diapositivas → Importar HTML**, carga el archivo, revisa cada diseño y asigna sus campos a título, subtítulo, contenido o decoración. Debe existir un título por diseño y como máximo un subtítulo. Los campos de contenido se llenan en orden; decoración conserva el texto original.

Confirma la revisión y guarda. El paquete aparece en la biblioteca y en los selectores existentes de generación manual y automatizada. «Revisar diseño» abre una importación guardada; guardar modificaciones conserva la anterior como otro recurso inmutable.

El flujo utiliza `EngineDialog`, igual que usuarios y confirmaciones. Su portal lo mantiene fuera de los estilos del encabezado; controles y avisos consumen los tokens del tema. El cuerpo tiene scroll interior y el encabezado y las acciones permanecen visibles en escritorio y móvil.

## Perfil inicial

- Archivo original de hasta **100 MB** (100 000 000 bytes). Antes de subirlo, un Web Worker local lee bloques de 256 KiB y retira scripts, comentarios, notas, navegación, imágenes y recursos excluidos, incluidas URLs CSS con base64. No ejecuta HTML ni descarga recursos. La UI muestra progreso, cancelación y un resumen de la reducción.
- La fuente preparada enviada a la API admite hasta **2 MB UTF-8**, CSS incluido, con entre 1 y 24 secciones `.slide`, sin slides anidadas. Un original grande cuyo contenido útil exceda ese presupuesto falla con un mensaje diferente al límite del archivo. El servidor vuelve a sanear todo y comprueba sus bytes reales.
- La familia normalizada admite hasta 2 MB serializados. El transporte JSON y la respuesta con previews tienen presupuestos independientes de 5 MB; el servidor limita la lectura del stream aunque falte `Content-Length`. Los previews se generan desde una sola normalización y su tamaño se comprueba antes de responder.
- Estos presupuestos dejan margen frente a los 6 MB documentados para funciones síncronas en [Netlify](https://docs.netlify.com/build/functions/configuration/). La [evidencia del cambio de tamaño](../../openspec/changes/expand-slide-import-size/reports/verification.md) distingue admisión, compatibilidad y límites de las pruebas.
- El límite de archivo no garantiza compatibilidad: se conservan los topes de 120 000 caracteres CSS, 100 000 caracteres por fragmento, nodos/profundidad y el preflight del editor. Un archivo grande puede rechazarse por estos controles; repartir diseños entre archivos reduce el tamaño total, pero no elimina el límite de un fragmento individual.
- Canvas 1920×1080. Se conserva HTML/CSS estático y SVG sin recursos externos.
- Se retiran scripts, eventos, navegación, imágenes, fuentes y recursos externos. Los comentarios CSS se eliminan antes de comprobar caracteres activos; combinadores válidos como `>` se conservan. CSS con escapes activos, anidación o complejidad excesiva se rechaza. Animaciones y reglas de navegación se materializan como estado estático cuando es posible; el preview requiere revisión.
- Las anclas visuales `data-od-id` se convierten en `data-cf-design-id` en HTML y selectores CSS. Solo conservan estilos, sin conceder identidad editable ni autoridad.
- Las gráficas dinámicas no tienen binding en este perfil; su generación devuelve una incompatibilidad explícita. Tampoco se descargan assets ni se reconstruyen elementos dibujados exclusivamente por JavaScript.
- Los límites de caracteres son controles de capacidad, no una garantía de ajuste visual con cualquier fuente. El preview de importación usa contenido de muestra; QA de generación sigue siendo necesario.
- La inferencia inicial de roles es algorítmica y revisable por una persona. No se llama a un modelo para clasificar el HTML. El agente de copy existente recibe únicamente capacidades estructuradas, nunca el HTML como instrucciones.

## Contratos y seguridad

La preparación local es una optimización del transporte, no una frontera de confianza. El original completo se queda en el dispositivo; solo la fuente reducida viaja por HTTP y el diseño normalizado se guarda en el paquete. Se conservan por separado los contadores de preparación local y los del saneamiento del servidor. Para conservar imágenes o archivar originales completos harían falta un contrato de assets y otra vía de almacenamiento.

El worker se termina al completar, fallar, cancelar, desmontar el componente o agotar 120 segundos. La entrada tiene topes de 10 000 elementos y profundidad 80; los límites más estrictos del diseño/editor siguen en servidor. No se promete memoria constante: el parser puede retener un atributo individual grande, aunque la lectura sea por bloques y ocurra fuera del hilo UI.

`courseforge-imported-slide-design-v1` vive en `importedDesign`, opcional en specs de paquetes y `course-deck-v1`. Su incorporación no cambia los layouts ni documentos anteriores. El [contrato](../../apps/web/src/domains/production/slides/import/imported-slide-design.contract.ts) centraliza límites y campos.

`POST /api/admin/slides/templates/import` admite `analyze`, `load` y `save`. Solo ADMIN/SUPERADMIN con tenant activo. La identidad y la organización provienen del servidor; el payload no puede conceder permisos. `save` exige revisión, vuelve a sanear y ejecuta preflight editorial antes de persistir. Los errores de datos son 400/422; tamaño excesivo, 413; permisos, 401/403; recursos ajenos o inexistentes, 404.

HTML se parsea con Cheerio y sanea con sanitize-html; CSS se parsea con PostCSS, se aísla bajo una raíz y se eliminan recursos de red y código. El renderizador revalida también el JSON persistido. Los previews usan iframe sin permisos y CSP sin red ni scripts. Las identidades estáticas de estilo se transforman a clases para no interferir con los IDs del editor.

El [renderizador importado](../../apps/web/src/domains/production/slides/import/imported-slide-renderer.service.ts) reemplaza campos mediante nodos de texto, conserva una sola copia de CSS por deck y selecciona diseños por propósito y capacidad. Si no existe uno compatible, falla sin truncar bloques ni sustituirlo por un diseño estándar.

La exportación utiliza el productor editorial existente y su compilador independiente. No se debilita el catálogo de confianza ni se concede autoridad a atributos importados. Motion sigue siendo propiedad del documento de composición.

La prueba local con `SofLIA_Highlands_Premium_EN_v4.html` confirma preparación y análisis de 16 diseños tras corregir los falsos positivos CSS. El preflight editorial todavía rechaza sus 16 layouts: contiene shorthand de fuentes, medidas calculadas y transformaciones inline fuera del perfil estático admitido. Analizar y mostrar previews no acredita que pueda guardarse como plantilla editable. Los resultados y límites están en [el informe de compatibilidad](../../openspec/changes/fix-opendesign-css-compatibility/reports/verification.md).

## Persistencia y recuperación

Se reutilizan `soflia_bundle_conversations`, `soflia_bundle_specs`, `soflia_bundle_generation_runs` y el bucket privado `template-bundles`. No hay migraciones nuevas.

Las identidades derivan de organización, nombre y diseño normalizado. Un reintento recupera las filas existentes; el ZIP tiene entradas con fechas deterministas y nombre por hash. Un upload duplicado solo se acepta después de descargar y comprobar su hash. El run pasa de QUEUED a PACKAGED después de confirmar storage y actualización de BD. Un fallo parcial deja un recurso reanudable, sin anunciar éxito. El mismo reintento debe conservar nombre y diseño.

El límite de 100 conversaciones activas se comprueba antes de admitir un recurso nuevo, igual que en el estudio actual; es un control de admisión, no una cuota transaccional frente a importaciones diferentes concurrentes.

## Verificación y reversión

`npm run test:slide-template-import -w apps/web` comprueba saneamiento, estado visible, campos, capacidad, compilación editorial, hashes, separación de tenants y recuperación tras fallos. También cubre originales sintéticos de 21,7/50/100 MB, reducción de URLs CSS entre bloques, frontera de 2 MB, UTF-8 multibyte, lectura acotada sin confiar en cabeceras, familia editable mayor de 500 KB y presupuesto de previews. Está incluido en `test:coverage-gaps`, consumido por `verify`.

El fixture de navegador `apps/web/tools/qa/import-slide-template.smoke.mjs` monta los componentes reales dentro de `engine-page-hero`, cargando CSS Modules y el sistema de estilos real, con API y persistencia simuladas. Valida carga con el worker real y originales sintéticos hasta 100 MB, cancelación, expansión JSON, preview, revisión, guardado, contraste, Escape, retorno del foco y acciones visibles en claro/oscuro y escritorio/móvil. Sus capturas y resultados se generan bajo `apps/web/.tmp/html-template-import-theme-qa/`; usa fuentes de sistema de respaldo y no valida Supabase real ni un archivo real de Open Design. La corrección visual conserva evidencia en [su cambio OpenSpec](../../openspec/changes/fix-slide-import-modal-theme/reports/verification.md); la preparación de archivos grandes, en [su informe](../../openspec/changes/prepare-large-html-slide-files/reports/verification.md).

Para revertir el acceso nuevo, ocultar los botones de importación. Mantener el lector/renderizador opcional mientras existan decks o paquetes que declaren `importedDesign`; no borrar fuentes, paquetes ni revisiones anteriores. La evidencia de esta entrega vive en [OpenSpec](../../openspec/changes/import-html-slide-templates/reports/verification.md).
