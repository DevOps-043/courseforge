# Importación de temarios: aplicación manual y activación

## Estado de entrega

La implementación local permite cargar un temario principal, revisar su interpretación contra el texto original, corregirla, confirmarla y completar objetivos faltantes. Las ampliaciones son propuestas separadas que requieren selección y nueva confirmación. Plan, búsqueda de fuentes y materiales utilizan la estructura aprobada y verifican su versión.

**Producción no se ha modificado.** El usuario confirmó que la conexión local apunta a producción y decidió aplicar la migración manualmente. La inspección de solo lectura encontró las tablas históricas, pero no los campos nuevos ni las tablas de importación visibles en PostgREST. El modo permanece apagado por defecto.

Migración: `supabase/migrations/20261009010000_provided_syllabus_imports.sql`. Ejecutar el archivo completo, una sola vez; incluye `BEGIN` y `COMMIT`. Si falla, no continuar con fragmentos: revisar el error y el estado de la transacción. No utiliza borrados de datos históricos. Añade columnas, tablas, índices, restricciones, funciones y triggers; clasifica las filas históricas por su ruta actual. No regenerar cursos como parte de la migración.

## 1. Preparación del administrador de producción

1. Confirmar en el administrador SQL el proyecto y la base de producción previstos. No pegar credenciales en tickets ni en este documento.
2. Verificar respaldo recuperable y procedimiento de restauración del proveedor. Programar la aplicación fuera de una ventana con generaciones activas: `ALTER TABLE` y la clasificación inicial toman locks; la duración depende de las filas y la actividad reales.
3. Mantener `PROVIDED_SYLLABUS_ENABLED=false` tanto en la aplicación como en las funciones de background.
4. Revisar el esquema y las políticas efectivas con las consultas siguientes. La introspección REST no sustituye esta revisión SQL.

```sql
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name in ('syllabus','instructional_plans','curation','materials','publication_requests')
order by table_name, ordinal_position;

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('artifacts','syllabus','instructional_plans','curation','materials','publication_requests');

select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('artifacts','syllabus','instructional_plans','curation','materials','publication_requests')
  and grantee in ('anon','authenticated','service_role')
order by table_name, grantee, privilege_type;
```

Los nombres/columnas usados por los triggers deben coincidir con el esquema existente: `artifact_id`, `state`/`status`, `upstream_dirty`, `upstream_dirty_source`, `iteration_count` en planes, `attempt_number` en curación, `version` en materiales y `qa` JSONB en syllabus. Los FK de actor apuntan a `profiles`, conforme al Auth Bridge. Si falta alguno, detener la aplicación y resolver la diferencia; no eliminar una guarda para forzar el despliegue.

La migración protege las tablas nuevas con RLS y sin acceso directo para `anon`/`authenticated`. Los handlers autorizan artefacto y organización antes de utilizar el cliente administrativo. Las políticas históricas conservan su definición: comprobar que el acceso de usuario a cursos de otra organización esté denegado antes del piloto.

## 2. Aplicación manual

Ejecutar íntegramente la migración con una cuenta administradora SQL. Si se aplica mediante SQL Editor, registrar fecha, operador, proyecto y resultado. Si el equipo utiliza el historial de Supabase CLI, reconciliar esa aplicación manual con su procedimiento habitual antes del próximo push; no volver a ejecutar el archivo sobre un esquema ya migrado.

Mantener disponible esta versión de la aplicación, que soporta columnas nuevas y una lectura compatible mientras la migración está pendiente. El flag apagado evita cargas persistentes y creación de nuevas importaciones.

## 3. Verificación posterior de solo lectura

```sql
select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'syllabus' and column_name in ('input_mode','content_version','active_import_id'))
    or (table_name in ('instructional_plans','curation','materials','publication_requests')
      and column_name = 'syllabus_content_version'))
order by table_name, column_name;

select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('syllabus_source_documents','syllabus_imports','syllabus_import_revisions');

select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('syllabus_source_documents','syllabus_imports','syllabus_import_revisions')
  and grantee in ('anon','authenticated','service_role')
order by table_name, grantee, privilege_type;

select event_object_table, trigger_name
from information_schema.triggers
where trigger_schema = 'public'
  and (trigger_name like '%syllabus%' or trigger_name like '%provided%')
order by event_object_table, trigger_name;

select has_function_privilege('authenticated',
  'public.transition_syllabus_import(uuid,uuid,integer,text,jsonb,uuid)', 'EXECUTE') as authenticated_can_mutate,
  has_function_privilege('anon',
  'public.transition_syllabus_import(uuid,uuid,integer,text,jsonb,uuid)', 'EXECUTE') as anonymous_can_mutate;

select input_mode, count(*) from public.syllabus group by input_mode;
```

Esperado: siete campos nuevos; las tres tablas con `rowsecurity=true`; ningún grant para `anon`/`authenticated` en las tablas nuevas; ambos permisos de mutación RPC `false`; filas históricas clasificadas en `IDEA` o `DOCUMENT_BASED`. Revisar también políticas heredadas y grants a `PUBLIC`. Los triggers deben incluir las guardas de fidelidad, cuotas, versiones, invalidación y dependencia de las cuatro fases.

La revisión REST auxiliar es de solo lectura:

```powershell
node scripts/provided-syllabus-production-preflight.mjs
```

El script lee la configuración local y muestra únicamente presencia de tablas/columnas. No ejecuta SQL, no imprime claves ni filas. Si el esquema REST aún no se actualizó, revisar la caché de PostgREST mediante la administración del proyecto antes de activar.

## 4. Activación controlada y prueba de aceptación

Desplegar aplicación y funciones juntas. Configurar en servidor:

```env
PROVIDED_SYLLABUS_ENABLED=true
PROVIDED_SYLLABUS_ORGANIZATIONS=<UUID de la organización piloto>
```

La lista es de UUID separados por coma. Una lista vacía con flag `true` habilita todas las organizaciones; usar una lista explícita durante el piloto. Estas variables no usan el prefijo `NEXT_PUBLIC_`.

Crear un artefacto de prueba identificado como tal en la organización piloto y completar:

1. Cargar un TXT/DOCX con dos módulos, cantidades diferentes de lecciones, objetivos y subtemas. Elegirlo como principal; otro documento puede ser apoyo.
2. Comparar el texto original con la interpretación. Corregir cualquier omisión y guardar. Confirmar explícitamente después de revisar advertencias y temas sin ubicación.
3. Completar objetivos: los ya proporcionados deben permanecer iguales; títulos, orden, IDs y temas deben conservarse. Si excede 12 horas, debe guardarse el borrador y bloquearse la aprobación con explicación.
4. Solicitar ampliaciones. Rechazar todas y verificar que no cambie la estructura; repetir y aceptar una. Debe agregarse únicamente la seleccionada y requerir nueva confirmación.
5. Aprobar el temario, generar el plan y buscar fuentes. Verificar objetivos/subtemas por ID en cada lección; las fuentes deben corresponder a ese plan.
6. Modificar mediante una nueva revisión confirmada. Comprobar que plan, fuentes, materiales y publicación queden obsoletos y no puedan continuar con versiones anteriores.
7. Recargar la página durante un trabajo, comprobar progreso y simular una reserva vencida en un ambiente aislado. La recuperación debe conservar el original y el borrador. No provocar fallas mediante modificaciones SQL de un curso real.
8. Probar acceso con usuario de otra organización y sin sesión: no debe obtener documentos ni importaciones. Probar también un artefacto histórico y un flujo SCORM de prueba.
9. Confirmar ejecución tanto local como en Netlify con firma de background válida. Registrar el resultado real del proveedor de IA y la curación; las pruebas aisladas no sustituyen esta aceptación.

No ampliar disponibilidad antes de completar esta lista y revisar errores/consumo. Límites actuales: 15 MB por archivo, 40 MB por selección, 40,000 caracteres por documento, 120,000 por selección, ocho documentos seleccionados, 50 persistidos por artefacto, diez nuevas importaciones por artefacto en 24 horas, máximo tres intentos y reserva de diez minutos. Los límites de cardinalidad del temario están centralizados en `syllabus-import.schema.ts`; las cuotas de persistencia/concurrencia también se aplican en SQL.

## 5. Reversión y operación

Apagar `PROVIDED_SYLLABUS_ENABLED` en aplicación y funciones. Conservar tablas, documentos, revisiones y lectores del modo importado; el temario persistido sigue disponible en el curso. El flag impide nuevas operaciones desde la API; un trabajo previamente reservado puede terminar y debe observarse hasta su cierre. No volver a una versión que regenere libremente un temario importado ni borrar columnas como rollback habitual.

La invalidación es transaccional: un error al marcar dependencias revierte también el cambio de contenido. Los workers antiguos no pueden completar una importación con revisión/reserva vencida. Las fases registran `syllabus_content_version` y rechazan versiones obsoletas. Conservar los eventos operativos y la telemetría IA existentes; no registrar texto privado de documentos ni respuestas del proveedor.

Límites pendientes: no hay OCR para PDF escaneado; la extracción/modelo puede interpretar u omitir un elemento, por lo que la revisión humana es obligatoria. Las cuotas por artefacto no equivalen a un presupuesto global por tenant ni a una cola capaz de soportar 100,000 generaciones simultáneas. Para ese volumen se necesita planificación de workers, backpressure y cuotas organizacionales.

## 6. Evidencia reproducible de QA local

Desde `apps/web`:

```powershell
npm run test:syllabus-import
npm run test:syllabus-import-flow
npm run test:syllabus-duration
npm run test:curation
npm run test:materials-generation
npx tsc --noEmit --pretty false --incremental false
npm run build
```

SQL aislado desde la raíz, sin conexión a producción:

```powershell
npm install --prefix apps/web/.tmp/syllabus-sql-runtime --no-save --package-lock=false --ignore-scripts @electric-sql/pglite@0.5.8
node --test scripts/test-provided-syllabus-migration.mjs
node scripts/check-migration-versions.mjs
```

PGlite ejecuta la migración real contra PostgreSQL aislado con tablas mínimas que reproducen los contratos usados. Verifica reservas, revisión, snapshots, fidelidad, permisos, asociaciones entre artefactos, recuperación, cuotas, versiones e invalidación atómica. No acredita políticas históricas de producción ni pruebas E2E con IA real.

El resultado final de cada comando y las limitaciones del build se registran en `plan-importacion-temario-explicito.md`.

La evidencia ampliada de contratos HTTP, proveedores simulados y recuperación está en `qa-temario-explicito.md`. Esos tests bloquean red y no cargan configuración de producción. Un temario con todos sus objetivos completos ya no depende de consultar configuración IA ni documentos de apoyo para guardarse; ambos proveedores rechazan salida marcada como truncada.

## Decisiones de implementación

- Un endpoint de comandos `POST /api/syllabus/imports` y consulta `GET` mantienen las transiciones bajo un contrato estricto y el mismo caso de uso para local/Netlify. No se distribuye lógica de fidelidad entre varios handlers.
- `PROVIDED_SYLLABUS` es independiente de la ruta de fuentes. Un documento de apoyo no convierte la generación libre histórica en un temario autoritativo.
- El modelo interpreta y propone; los IDs son asignados por servidor. Solo el usuario revisa y confirma cambios estructurales. El enriquecimiento tiene un contrato de parches de objetivos y no puede reescribir títulos, orden o temas.
- La aprobación contrasta con el snapshot confirmado protegido en BD, no con un baseline reemplazable en metadata. SQL también verifica fidelidad en escrituras directas y controla contadores de versión.
- Las generaciones de estructura histórica conservan su política; el modo importado admite su cardinalidad original dentro de límites de recursos y exige revisión, objetivos y duración válidos.
