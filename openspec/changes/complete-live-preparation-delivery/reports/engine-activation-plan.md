# Plan de activación del esquema de Engine

Fecha: 2026-11-03. Estado: ejecutado manualmente por el usuario; postflight compartido verificado. Proyecto autorizado: Engine emsjctbdevufloxntjll. Aprobación recibida: «Aprobar migración y verificaciones en Engine». Se conserva el plan como registro histórico; consultar [ejecución manual y límites](engine-manual-execution.md). El historial remoto sigue pendiente de comprobar.

## Alcance concreto

Aplicar únicamente [20261026160000_synchronous_course_delivery.sql](../../../../supabase/migrations/20261026160000_synchronous_course_delivery.sql). Crea tres tablas privadas de autoría, sus índices, siete funciones invoker con search_path vacío y un trigger de historial. Restringe edición directa de las tres capacidades síncronas en modelos/prompts y amplía el check existente de tipos de modelo conservando su expresión anterior. No modifica contenido de cursos, usuarios, modelos ni prompts existentes.

El despliegue, habilitación global mediante SYNCHRONOUS_COURSES_ENABLED, cambios de credenciales, generación con IA, creación de aulas, Zoom, cargos y piloto real quedan fuera de esta operación SQL.

## Secuencia y criterios de interrupción

1. Confirmar el proyecto en Supabase y consultar historial. Ejecutar [preflight de catálogo](engine-preflight.sql), sin seleccionar documentos, credenciales ni datos personales.
2. Exigir todas las columnas dependientes, service_role con BYPASSRLS y los permisos del backend (SELECT/UPDATE para los locks e INSERT para settings/prompts, USAGE en sus secuencias); RLS habilitado en model_settings/system_prompts. Revisar tipos, defaults y restricciones de settings/prompts: deben aceptar las capacidades textuales nuevas, scope Cursos, source MANUAL y las columnas omitidas por INSERT mediante defaults/nulabilidad. Las tres tablas y las siete funciones nuevas deben estar ausentes. Si existe un estado parcial o una dependencia incompatible, detener la aplicación y revisar el plan.
3. Respaldar desde catálogo la definición y estado de validación del check de tipos, las políticas actuales de settings/prompts y los privilegios relevantes. El respaldo no contiene filas de negocio. Si no existe el check esperado, detenerse: la migración no debe ampliar un contrato desconocido.
4. Aplicar el archivo exacto mediante Supabase apply_migration en una sola transacción. Registrar SHA-256 y versión remota realmente asignada. Un error aborta esa transacción; no aplicar archivos adicionales como reparación automática.
5. Ejecutar [postflight](engine-postflight.sql): tres tablas vacías con RLS, sin privilegios públicos/authenticated; siete funciones invoker con search_path vacío y EXECUTE público revocado; seis RPCs accesibles por service_role, trigger instalado, dos políticas restrictivas y check ampliado. No llamar RPCs de escritura ni crear cursos de prueba en producción.
6. Revisar asesores de seguridad del dominio y registrar resultados. RLS sin políticas de lectura para estas tablas privadas es denegación deliberada, no una razón para abrir acceso al navegador.

Las pruebas SQL locales cubren CAS, aislamiento, reservas/claims, cancelación, aprobación, historial, settings y permisos. El flujo completo se ejecuta con service_role sin superusuario ni ownership e incluye insertar configuración de modelo y promoverla desde navegador como caso negativo. Los mismos archivos preflight/postflight se ejecutan contra el fixture local. Es evidencia local; el preflight del esquema desplegado sigue siendo obligatorio. Resultados: [reporte de implementación](implementation.md).

## Estado del acceso

Al continuar después de la aprobación, las herramientas Supabase ya no estaban disponibles. La búsqueda del proveedor confirmó que requería instalación/conexión en esta sesión. El usuario eligió ejecutar el SQL manualmente y aportó capturas de Engine main y el JSON completo posterior, conservado en el reporte de ejecución. Al recuperar acceso, consultar estado e historial antes de cualquier operación; no repetir la migración ya ejecutada. El agente no obtuvo un respaldo remoto previo ni ejecutó SQL adicional.

## Recuperación

Antes de habilitar la funcionalidad, mantener deshabilitada su configuración administrada. Ante un error de aplicación se conserva el rollback de la transacción y se revisa el historial. Después de una aplicación correcta, deshabilitar operaciones nuevas conserva autoría, revisiones y runs; no borrar tablas, políticas ni contenido automáticamente. Revertir el check o retirar las políticas requiere revisar los datos posteriores y autorización propia.

Learning principal ya recibió Video SDK y participación con aprobación separada. Su compatibilidad no acredita el despliegue del endpoint ni la conectividad entre ambos servicios. El [reporte coordinado](implementation.md) conserva los pendientes de despliegue y piloto.
