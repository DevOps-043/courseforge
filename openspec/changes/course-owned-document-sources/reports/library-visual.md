# Biblioteca documental: presentación y alcance

Fecha: 2026-11-20.

Se renovaron CourseSourceLibrary y la sección de política de CourseSourceReviewPanel
con estilos compartidos y fondos sólidos del tema de Architect. El panel explica
el uso del contexto documental en Base/Temario/Plan, la revisión de cobertura en
Fuentes y el uso de evidencia aprobada en Materiales. Las políticas presentan
descripciones, estados de selección y foco visible. Se reorganizó la carga con
formatos, límites, estado vacío, versiones y mantenimiento.

Las reglas del servidor y las operaciones de carga no cambian. Se contrastó la
explicación con prepareCourseGeneration, CourseSourceCuration y el rechazo de
búsqueda web en startCurationAction para DOCUMENTS_ONLY. El modo mixto busca
vacíos en curación y no agrega investigación web a Base/Temario/Plan documentales.

QA con el script existente scripts/qa-course-source-library.cjs, adaptado para
empaquetar CSS Modules: componentes reales con APIs simuladas sin acceso externo.
Pasaron sustitución, historial tras recarga, escape de texto, rechazo de formato,
importación histórica, conciliación, confirmación explícita de purga simulada y
móvil sin desbordamiento. No se cargaron ni retiraron archivos reales.

Capturas revisadas: `.tmp/source-library-visual/desktop.png` (tema claro) y
`.tmp/source-library-visual/mobile-dark.png` (tema oscuro, 375 px). Logs en
`.tmp/source-library-visual.log`, `.tmp/source-library-types.log` y
`.tmp/source-library-lint.log`. Esta evidencia no sustituye un piloto documental
con archivos reales ni una revisión autenticada completa de curación.

ESLint dirigido de los dos componentes con `--max-warnings 0`: aprobado.
`npm run typecheck`: aprobado.
`harness:validate`: aprobado. `git diff --check` dirigido: aprobado.
`docs:check` falla por los cuatro enlaces locales preexistentes del reporte
reportes/2026-11-14-factibilidad-herk-edit-kit.md hacia otro checkout.
No se ejecutó verify:pr completo para este ajuste visual.
