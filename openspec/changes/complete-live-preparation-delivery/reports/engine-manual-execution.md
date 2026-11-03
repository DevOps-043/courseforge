# Aplicación manual del esquema de Engine

Fecha: 2026-11-03. Estado: aplicación manual informada por el usuario y postflight aportado verificado; historial de migraciones pendiente de comprobar.

## Procedencia

El usuario había aprobado «Aprobar migración y verificaciones en Engine» y decidió ejecutar los archivos en SQL Editor. Las capturas muestran la consulta previa, el mensaje Success de la ejecución y el postflight; una captura identifica SofLIA - Engine, rama main, proyecto emsjctbdevufloxntjll. Después el usuario pegó el [JSON completo del postflight](engine-manual-postflight.json), que se conserva como evidencia de catálogo y cantidades, sin datos de negocio ni credenciales.

Se esperaba [20261026160000_synchronous_course_delivery.sql](../../../../supabase/migrations/20261026160000_synchronous_course_delivery.sql). La comprobación local del JSON confirmó nombres y cantidades exactos de tablas, funciones y políticas, además de privilegios y opciones. La evidencia procede del usuario; el agente no ejecutó la migración ni volvió a consultar la base. El hash del archivo preparado está en el [reporte de implementación](implementation.md); no acredita que los bytes pegados manualmente fueran idénticos.

## Resultado comprobado

- Tres tablas: course_delivery_workspaces, course_delivery_versions y course_delivery_runs. Todas con RLS y sin privilegios SELECT/INSERT/UPDATE/DELETE efectivos de anon/authenticated según public_access; los tres contadores son cero.
- Siete funciones esperadas: SECURITY INVOKER, search_path vacío, EXECUTE denegado a anon/authenticated y permitido a service_role. El permiso service_role observado para la función del trigger no abre acceso al navegador.
- Trigger preserve_course_delivery_version instalado y habilitado.
- Políticas course_delivery_models_backend_only y course_delivery_prompts_backend_only: restrictivas, para anon/authenticated y ALL, con USING/WITH CHECK que excluyen las tres capacidades síncronas.
- El check de model_settings conserva los doce tipos anteriores visibles y añade SYNCHRONOUS_AGENDA, SYNCHRONOUS_PLAN y SYNCHRONOUS_MATERIALS.

El check termina en NOT VALID, conforme a la migración preparada. Esto omite escanear las filas preexistentes al instalarlo; las inserciones y actualizaciones posteriores sí deben satisfacerlo. No se ejecutó VALIDATE CONSTRAINT ni se afirma validación retrospectiva de datos. [Semántica oficial de PostgreSQL](https://www.postgresql.org/docs/17/sql-altertable.html#SQL-ALTERTABLE-DESC-ADD-TABLE-CONSTRAINT).

## Pendientes delimitados

El JSON completo de preflight y su respaldo de políticas/check anteriores no fueron compartidos. Las capturas no permiten reconstruirlos; no se inventa un respaldo. El postflight no acredita conectividad Auth Bridge, ejecución de RPCs con usuarios reales, asesores del proyecto, modelos configurados, despliegue ni calidad audiovisual. La suite SQL local conserva esa distinción.

No hay versión remota de migración confirmada. Al ejecutar en SQL Editor se debe comprobar y, si corresponde, reconciliar el historial antes de db push; no insertar un registro ni volver a ejecutar el CREATE TABLE a ciegas. La reconciliación requiere identificar primero el historial real y el archivo aplicado. Se mantiene como pendiente separado.

Faltan publicación coordinada de Learning/Engine/Hub, configuración administrada y piloto real. La autorización SQL no habilita automáticamente SYNCHRONOUS_COURSES_ENABLED, Zoom, consumo de IA, grabaciones ni publicación de cursos. La [recuperación del plan](engine-activation-plan.md#recuperación) conserva tablas y contenido.
