# Consumo de todas las fuentes válidas

Fecha: 2026-11-20. Implementación local en Architect; no despliegue ni SQL remoto.

## Resultado

La ruta documental de Fuentes lista el conjunto de cada lección y ofrece «Usar
todas las fuentes y continuar a Materiales». No requiere escoger una evidencia
por objetivo, proponer asociaciones ni simular su verificación humana. La
actualización de resultados recarga el inventario; solo se monta la lista de la
lección desplegada para no multiplicar el DOM por todos los fragmentos del curso.

El servidor autoriza el recurso y verifica plan, revisión y disponibilidad. En
ausencia de documentos conserva el mínimo web del plan. Los documentos no acreditan
por sí mismos cobertura semántica: cada material sigue pasando la auditoría de
respaldo y citas. El buscador conserva fuentes ya válidas, completa pendientes y
puede concluir sin esperar asociaciones humanas. El checkpoint sigue vinculado a
attempt, revisión y currículo; otro intento no puede concluir la ejecución.

La migración 20261120010000_all_validated_material_sources.sql añade modo/ámbito a
snapshots y construye los nuevos conjuntos dentro de PostgreSQL. Incluye todos los
documentos READY y todas las URLs válidas con texto de las lecciones solicitadas,
según política. No acepta una lista de IDs elegidos ni usa títulos como contenido.
No inserta course_source_review_approvals para habilitar el consumo automático.
Los snapshots MANUAL conservan sus validaciones anteriores.

Los recibos de un conjunto multilección aceptan únicamente las lecciones de su
ámbito. Cambiar o añadir evidencia válida vuelve obsoleto el conjunto anterior,
incluso si una inserción histórica no incrementó revisión. No se truncan fuentes:
presupuestos excedidos producen un error explícito. La preparación para Hub recibe
metadatos y huellas; el worker obtiene los textos completos desde su snapshot.

## Evidencia y revisión adversarial

Se intentó omitir/forjar fuentes desde el cliente, consumir otra organización,
reutilizar un recibo para otra lección, concluir con otro attempt, reutilizar
snapshots tras añadir/retirar evidencia, introducir citas inventadas y superar el
contexto con fragmentos legales. Las pruebas comprobaron rechazo o invalidación.
Se corrigió la guarda de checkpoint que aún exigía aprobación manual y se mantuvo
el bloqueo mientras la búsqueda está activa. Funciones nuevas son invoker, solo
service_role; la autorización HTTP y RLS no se amplían.

Pruebas ejecutadas sin proveedores pagados ni datos remotos:

- Suite documental: 77 pruebas aprobadas (.tmp/all-sources-unit.log).
- Suite SQL completa final: 34 pruebas aprobadas, incluidas dos de la migración
  nueva y el checkpoint real; se repitieron las dos específicas con las aserciones
  de metadatos para Hub, aprobadas (.tmp/all-sources-sql-final.log y
  .tmp/all-sources-sql.log).
- Preparación de sesiones: 53 pruebas aprobadas (.tmp/all-sources-delivery.log).
- Materiales: 29 pruebas de generación y 5 de recuperación aprobadas
  (.tmp/all-sources-materials.log).
- QA de componentes reales y acciones simuladas: varias fuentes visibles, ausencia
  de selección manual, continuación sin IDs, fallo visible, políticas documental y
  web histórica y móvil sin desbordamiento. Script
  scripts/qa-course-source-material-set.cjs; capturas .tmp/all-sources-ui/.
- ESLint dirigido final: cero avisos (.tmp/all-sources-lint-final.log). Typecheck
  completo final: aprobado (.tmp/all-sources-types-final.log).
- OpenSpec estricto y diff: aprobados. verify:pr se ejecutó y quedó detenido en
  docs:check por los cuatro enlaces locales preexistentes del reporte Herk; el
  arnés pasó antes de ese punto. No se presenta esa compuerta como aprobada.
- db:migrations:check: aprobado (.tmp/all-sources-migration-check.log).

## Activación y límites

Aplicar primero la migración en la instancia de Architect y luego desplegar
aplicación/workers. Se probó reejecución del SQL aislado. Sin la migración, la RPC
nueva devuelve un mensaje de activación pendiente; no hay fallback silencioso al
modo manual o a fuentes web ajenas a la política.

No se probó este recorrido nuevo contra Supabase remoto ni se generaron materiales
pagados. La separación Architect/Academy/Hub y el bloqueo de publicación híbrida
incompatible siguen sujetos a su entrega propia. No hubo commits, pushes ni cambios
en Academy o Hub en esta ampliación.

Para revertir la aplicación, conservar tablas, columnas, funciones aditivas e
historial. El consumidor manual sigue disponible para snapshots anteriores. Si
ya existen resultados ALL_VALIDATED, preferir corrección hacia adelante; no borrar
recibos ni reinterpretarlos como revisión humana para forzar una reversión.
