-- Solo lectura: ejecutar en el proyecto destino confirmado por el operador.
WITH required_columns(column_name) AS (
  VALUES ('storage_bucket'), ('checksum_sha256'), ('mime_type'),
         ('file_size_bytes'), ('status')
)
SELECT required.column_name,
       existing.data_type,
       existing.column_name IS NOT NULL AS presente
FROM required_columns AS required
LEFT JOIN information_schema.columns AS existing
  ON existing.table_schema = 'public'
 AND existing.table_name = 'organization_slide_fonts'
 AND existing.column_name = required.column_name
ORDER BY required.column_name;

-- Revisar permisos antes de aplicar la migración que retira escritura directa.
SELECT policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'organization_slide_fonts'
ORDER BY policyname;

-- No selecciona credenciales ni contenido de fuentes.
SELECT id, public, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE id IN ('organization-fonts', 'production-assets');
