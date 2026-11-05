# Contexto

- Objetivo y actor: un autor con permisos vigentes sobre el curso aporta documentación propia y genera un curso fundamentado en ella; el revisor valida alcance, asociaciones y resultados.
- Base y alcance: checkout principal de Courseforge; Next.js/React/TypeScript, jobs Netlify y Supabase/Auth Bridge. Auditoría inicial en esta conversación y contraste de código el 2026-11-05. No se consultaron secretos ni se verificó el despliegue.
- No objetivos: biblioteca compartida entre organizaciones, edición de archivos Office, OCR, transcripción de audio/video, importación SCORM nueva, motor vectorial obligatorio, generación/render/publicación automáticos sin permisos existentes. PDF escaneado se rechaza con explicación; no se anuncia soporte OCR.
- Dominios/contratos: artifacts, syllabus, plan, curation, materials, Storage, guardas de dependencias y publicación; conservar compatibilidad de `A_WITH_SOURCE`, `B_NO_SOURCE` y `PROVIDED_SYLLABUS` sin inferir política web a partir de ellos.
- Permisos y efectos externos: identidad/organización/curso resueltos en servidor antes del acceso privilegiado; archivos privados. IA recibe el contexto seleccionado y autorizado; la interfaz informa este procesamiento. Ninguna fuente externa ni texto del modelo concede autoridad.
- Criterios verificables: ver spec.md y matriz de aceptación en tasks.md. Terminado significa aceptación desplegada con archivo real, no solo carga exitosa ni pruebas simuladas.
- Decisión del usuario: elegir entre «Solo mis archivos» y «Mis archivos + fuentes web» en cada curso documental. Requerir selección explícita antes de generar; no imponer una opción predeterminada. La política queda persistida por curso y sus cambios posteriores conservan las guardas de versión e invalidación.
- Riesgos e incertidumbres: esquema/bucket efectivos del despliegue no certificados; límites HTTP reales y fidelidad de extractores deben medirse.

## Evidencia primaria inspeccionada

| Archivo | Evidencia |
|---|---|
| `apps/web/src/domains/syllabus/components/SyllabusDocumentUploader.tsx` | Carga multipart y límites de documentos; no biblioteca de curso completa. |
| `apps/web/src/app/api/syllabus/documents/route.ts` | Extracción con permisos; persistencia opcional dependiente del modo de importación. |
| `apps/web/src/domains/syllabus/lib/syllabus-generation.ts` | Documento como fuente principal del temario; web secundaria permitida actualmente. |
| `apps/web/netlify/functions/generate-artifact-background.ts` | Base realiza investigación con Google Search; el modo exclusivo debe controlarla. |
| `apps/web/src/domains/curation/actions/curation.actions.ts` | Registro manual de PDF y URL; no se encontraron consumidores UI de esas acciones. |
| `apps/web/src/domains/curation/components/SourcesCurationGenerationContainer.tsx` | Cobertura calculada con filas automáticas y sin PDF. |
| `apps/web/netlify/functions/shared/curation-v2/workflow.ts` | Mismo filtro en worker; exponer solo UI no resuelve el bloqueo. |
| `apps/web/src/domains/curation/lib/lesson-source-requirement.ts` | Cuota de fuentes web ligada a duración, mínimo dos y máximo diez. |
| `apps/web/netlify/functions/shared/materials-source-context.ts` | Materiales lee fuentes aptas de curación. |
| `apps/web/netlify/functions/shared/materials-generation-helpers.ts` | Contexto usa `content_excerpt` y valida IDs y número de fuentes citadas. |
| `apps/web/netlify/functions/shared/curation-v2/validation.ts` | Extracto PDF limitado a 12,000 caracteres; no constituye lectura completa. |
| `supabase/migrations/20260723120000_curation_sources_v2.sql` | Bucket privado PDF y columnas históricas; revisar estado real antes de migrar. |
| `docs/architecture/operacion-temario-explicito.md` | Importación de estructura y su activación son una capacidad distinta. |

Las suites `test:syllabus-duration`, `test:curation` y `test:materials-generation` terminaron con código 0 durante la auditoría previa. Son evidencia local del comportamiento actual, no del diseño futuro ni de producción.
