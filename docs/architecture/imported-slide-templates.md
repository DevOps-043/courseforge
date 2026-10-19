# Plantillas HTML importadas

Estado: implementación local, 2026-10-19. No implica despliegue ni validación con un export real del proveedor.

## Uso

En **Plantillas de diapositivas → Importar HTML**, carga el archivo, revisa cada diseño y asigna sus campos a título, subtítulo, contenido o decoración. Debe existir un título por diseño y como máximo un subtítulo. Los campos de contenido se llenan en orden; decoración conserva el texto original.

Confirma la revisión y guarda. El paquete aparece en la biblioteca y en los selectores existentes de generación manual y automatizada. «Revisar diseño» abre una importación guardada; guardar modificaciones conserva la anterior como otro recurso inmutable.

## Perfil inicial

- HTML de hasta 500 KB con entre 1 y 12 secciones `.slide`, sin slides anidadas.
- Canvas 1920×1080. Se conserva HTML/CSS estático y SVG sin recursos externos.
- Se retiran scripts, eventos, navegación, imágenes, fuentes y recursos externos. CSS con escapes, anidación o complejidad excesiva se rechaza. Animaciones y reglas de navegación se materializan como estado estático cuando es posible; el preview requiere revisión.
- Las gráficas dinámicas no tienen binding en este perfil; su generación devuelve una incompatibilidad explícita. Tampoco se descargan assets ni se reconstruyen elementos dibujados exclusivamente por JavaScript.
- Los límites de caracteres son controles de capacidad, no una garantía de ajuste visual con cualquier fuente. El preview de importación usa contenido de muestra; QA de generación sigue siendo necesario.
- La inferencia inicial de roles es algorítmica y revisable por una persona. No se llama a un modelo para clasificar el HTML. El agente de copy existente recibe únicamente capacidades estructuradas, nunca el HTML como instrucciones.

## Contratos y seguridad

`courseforge-imported-slide-design-v1` vive en `importedDesign`, opcional en specs de paquetes y `course-deck-v1`. Su incorporación no cambia los layouts ni documentos anteriores. El [contrato](../../apps/web/src/domains/production/slides/import/imported-slide-design.contract.ts) centraliza límites y campos.

`POST /api/admin/slides/templates/import` admite `analyze`, `load` y `save`. Solo ADMIN/SUPERADMIN con tenant activo. La identidad y la organización provienen del servidor; el payload no puede conceder permisos. `save` exige revisión, vuelve a sanear y ejecuta preflight editorial antes de persistir. Los errores de datos son 400/422; tamaño excesivo, 413; permisos, 401/403; recursos ajenos o inexistentes, 404.

HTML se parsea con Cheerio y sanea con sanitize-html; CSS se parsea con PostCSS, se aísla bajo una raíz y se eliminan recursos de red y código. El renderizador revalida también el JSON persistido. Los previews usan iframe sin permisos y CSP sin red ni scripts. Las identidades estáticas de estilo se transforman a clases para no interferir con los IDs del editor.

El [renderizador importado](../../apps/web/src/domains/production/slides/import/imported-slide-renderer.service.ts) reemplaza campos mediante nodos de texto, conserva una sola copia de CSS por deck y selecciona diseños por propósito y capacidad. Si no existe uno compatible, falla sin truncar bloques ni sustituirlo por un diseño estándar.

La exportación utiliza el productor editorial existente y su compilador independiente. No se debilita el catálogo de confianza ni se concede autoridad a atributos importados. Motion sigue siendo propiedad del documento de composición.

## Persistencia y recuperación

Se reutilizan `soflia_bundle_conversations`, `soflia_bundle_specs`, `soflia_bundle_generation_runs` y el bucket privado `template-bundles`. No hay migraciones nuevas.

Las identidades derivan de organización, nombre y diseño normalizado. Un reintento recupera las filas existentes; el ZIP tiene entradas con fechas deterministas y nombre por hash. Un upload duplicado solo se acepta después de descargar y comprobar su hash. El run pasa de QUEUED a PACKAGED después de confirmar storage y actualización de BD. Un fallo parcial deja un recurso reanudable, sin anunciar éxito. El mismo reintento debe conservar nombre y diseño.

El límite de 100 conversaciones activas se comprueba antes de admitir un recurso nuevo, igual que en el estudio actual; es un control de admisión, no una cuota transaccional frente a importaciones diferentes concurrentes.

## Verificación y reversión

`npm run test:slide-template-import -w apps/web` comprueba saneamiento, estado visible, campos, capacidad, compilación editorial, hashes, separación de tenants y recuperación tras fallos. Está incluido en `test:coverage-gaps`, consumido por `verify`.

El fixture de navegador `apps/web/tools/qa/import-slide-template.smoke.mjs` monta los componentes reales con API y persistencia simuladas. Valida carga, preview, revisión, guardado, escritorio y móvil. Sus capturas y resultados se generan bajo `apps/web/.tmp/html-template-import-qa/`; no valida Supabase real ni un archivo real de Open Design.

Para revertir el acceso nuevo, ocultar los botones de importación. Mantener el lector/renderizador opcional mientras existan decks o paquetes que declaren `importedDesign`; no borrar fuentes, paquetes ni revisiones anteriores. La evidencia de esta entrega vive en [OpenSpec](../../openspec/changes/import-html-slide-templates/reports/verification.md).
