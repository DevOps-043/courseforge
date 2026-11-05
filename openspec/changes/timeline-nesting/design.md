# Contexto y diseño

- Actor: editor de producción; objetivo: colapsar la selección en un solo clip
  editorial, conservando su edición interna.
- Base: grupos jerárquicos existentes y documento courseforge-composition-v2.
- Contrato: `timelineMode?: "NESTED"` en grupo y group.create; ausencia significa
  agrupación visible y conserva hashes históricos.
- Alcance del rango: miembros seleccionados completos del mismo nivel. Los huecos
  interiores cuentan en la duración; no se incorporan clips ajenos a la selección.
- Proyección: cada contenedor visible ocupa su propia fila; sus hojas se ocultan
  hasta abrirlo. Un grupo ordinario puede contener anidaciones visibles.
- No objetivos: rasterizar, crear archivos de video intermedios, recortar o aplicar
  efectos al contenedor. Los clips fuente conservan sus coordenadas absolutas.
- Seguridad: reutilizar autorización, hash y versionado existentes; comprobar
  capacidad SQL específica antes de crear modos nuevos. Lectura y desanidación
  siguen disponibles durante rollback de la capacidad.
- Riesgos: validación SQL estricta y extracción narrativa deben conservar el campo.
- Rollback: deshabilitar creación; conservar lectores y migración mientras haya
  documentos con el modo. Desanidar elimina únicamente el contenedor.
