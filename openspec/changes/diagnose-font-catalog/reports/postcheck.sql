-- Solo lectura. Ejecutar después de aplicar la migración autorizada.
-- PostgreSQL debe resolver todas las columnas del SELECT de la API sin leer filas.
SELECT id, family, source, css_url, storage_bucket, storage_path,
       checksum_sha256, mime_type, file_size_bytes, status, created_at
FROM public.organization_slide_fonts
WHERE false;

-- Inventario agregado de estados; no cambia LEGACY a READY.
SELECT source, status, COUNT(*) AS cantidad
FROM public.organization_slide_fonts
GROUP BY source, status
ORDER BY source, status;

-- La autorización exige conservar lectura tenant y retirar escritura cliente.
SELECT policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'organization_slide_fonts'
ORDER BY policyname;
