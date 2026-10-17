# Diseño de la investigación

Contrastar tres evidencias: el mensaje visible y respuesta autenticada de staging,
la consulta versionada en la ruta HTTP y la definición de la tabla obtenida desde
la vista de solo lectura de Supabase. No sustituir errores por listas vacías ni
suprimir columnas de integridad para aparentar compatibilidad.

La corrección operativa propuesta utiliza la migración existente
`20260919120000_harden_organization_fonts_for_video.sql`. Antes de ejecutarla debe
verificarse el historial de despliegue, la definición actual de las políticas de
la tabla y configuración del bucket. Se recomienda ejecución transaccional para
evitar que una falla intermedia deje una parte del cambio aplicada. El SQL crea
columnas, hace backfill de estado/bucket, agrega constraints/índice y retira la
política de escritura directa del cliente; no es solamente una modificación UI.

No reaplicar a ciegas: los UPDATE de estado pueden cambiar estados existentes.
Las fuentes subidas sin checksum quedan LEGACY y deben pasar la validación
binaria para poder utilizarse en video. No marcarlas READY manualmente.

Evidencia y validación pendiente en [reports/diagnosis.md](reports/diagnosis.md).
