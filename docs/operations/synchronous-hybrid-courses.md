# Operación de cursos sincrónicos e híbridos

Fecha: 2026-10-26. Estado: implementación local bajo habilitación explícita; sin despliegue ni aplicación de SQL remoto.

El [análisis](../architecture/synchronous-hybrid-course-flow-analysis.md) conserva la intención y el [plan](../architecture/synchronous-hybrid-course-implementation-plan.md) las entregas. Este documento describe los contratos implementados y sus límites.

## Alcance confirmado

El usuario confirmó presentación web, guía y cuaderno imprimibles, descarga HTML desde Engine y acceso mediante usuarios internos existentes. Autorizó que el botón de generación completa coordine las ramas Nexus y sincrónica usando las APIs configuradas cuando un usuario autorizado lo pulse. Esa autorización no incluye pruebas con proveedores reales, publicación ni despliegue.

Se conservan las ocho etapas. En híbrido una intención de aprobación coordina las acciones QA existentes de Nexus y confirma la revisión sincrónica. La migración no autoaprueba tablas Nexus ni omite sus validadores. Si la segunda confirmación falla, Nexus puede quedar aprobado por separado; la etapa híbrida sigue incompleta y se reconcilia al reintentar.

La guía y el cuaderno son HTML imprimible, no archivos Word/PPTX ni un servicio nuevo de PDF. La presentación es web estática con notas desplegables. No se modifica HyperFrames, motion ni render audiovisual.

## Componentes y persistencia

- Dominio: [contratos course-delivery](../../apps/web/src/domains/course-delivery/types/delivery.schemas.ts), con configuración, políticas, servicios, UI y pruebas separados.
- API: [GET/POST de impartición](../../apps/web/src/app/api/artifacts/[artifactId]/delivery/route.ts). Valida tamaño, comando, identidad, rol y organización.
- Exportación: [ruta de documentos](../../apps/web/src/app/api/artifacts/[artifactId]/delivery/export/route.ts), con audiencia, vigencia, escape HTML, CSP y ausencia de caché compartida.
- Generación: [job firmado](../../apps/web/netlify/functions/course-delivery-background.ts). El cuerpo solo contiene el ID reservado; contexto y configuración se leen de una instantánea privada.
- Persistencia: [migración aditiva](../../supabase/migrations/20261026160000_synchronous_course_delivery.sql), aún no aplicada a un servidor remoto.

Las tablas nuevas son course_delivery_workspaces, course_delivery_versions y course_delivery_runs. No se guardan sesiones como lecciones Nexus ficticias. El borrador es un agregado JSON validado y acotado por curso; las unidades del run conservan progreso por sesión. Un trigger conserva las revisiones anteriores antes de modificar el agregado.

Las tablas privadas y RPCs solo permiten acceso del backend. Las capacidades nuevas de modelos/prompts tienen políticas restrictivas que impiden editarlas directamente desde navegador mediante políticas históricas de settings.

## Límites actuales

- Hasta 24 sesiones y 300 lecciones por curso; sesiones entre 15 y 480 minutos.
- Agregado y snapshot limitados a 8 MiB cada uno; petición de edición limitada a 2 MiB.
- Una ejecución activa por curso; unidades secuenciales, solicitud al modelo de 90 segundos y presupuesto de job de nueve minutos. Si no cabe otra unidad y su posible respaldo, se pausa.
- Lease de doce minutos. Un proceso repetido no reclama una ejecución activa; un token anterior no guarda después de cancelación o sustitución.
- La suficiencia pedagógica de las fuentes requiere revisión humana; una referencia válida no acredita por sí sola exactitud semántica.

La serialización es por curso y se limita a transacciones cortas; no hay locks durante llamadas a IA. No se promete carga masiva ni existe un benchmark de producción. El historial puede crecer: no hay limpieza automática ni eliminación de revisiones aprobadas.

## Modelos y prompts

Configuración incorpora un panel sincrónico con tres capacidades:

| Capacidad | Herencia si no hay configuración propia |
| --- | --- |
| SYNCHRONOUS_AGENDA | SYLLABUS |
| SYNCHRONOUS_PLAN | INSTRUCTIONAL_PLAN |
| SYNCHRONOUS_MATERIALS | MATERIALS |

Se busca organización/global de la capacidad propia y después organización/global de la fase heredada. Error de lectura no equivale a ausencia. La fase heredada debe tener un modelo activo o la capacidad debe configurarse explícitamente.

Los prompts admiten organización/global/default versionado y se muestran en el panel. Los propios se versionan en transacción. El panel configura la organización activa; no crea un editor global nuevo. Curación conserva su administración existente.

La ejecución fija texto, versión, origen, modelo, parámetros, hash y contexto. Reintentos conservan esa instantánea. Editar Configuración afecta a nuevas ejecuciones, sin regenerar contenido aprobado. Se registra el modelo realmente utilizado y uso de IA mediante la instrumentación existente.

## Activación controlada

1. Revisar y aplicar la migración en la base de desarrollo mediante el proceso autorizado. El guard de versiones no aplica SQL; no ejecutar SQL remoto automáticamente.
2. Confirmar modelos de fases heredadas o configurar capacidades propias.
3. Configurar SYNCHRONOUS_COURSES_ENABLED=true en el entorno autorizado.
4. Para el piloto, configurar SYNCHRONOUS_COURSES_ORGANIZATIONS con IDs separados por coma. Sin lista y con habilitación true quedan habilitadas todas las organizaciones; los permisos de curso siguen siendo obligatorios.
5. Reiniciar/recompilar según el entorno y confirmar que API y jobs usan el mismo despliegue y configuración.
6. Ejecutar un piloto autorizado de las tres modalidades y comprobar aprobación, entrega y consumo antes de ampliar.

No se modificaron .env, credenciales ni configuración remota. La ausencia de migración conserva lectura Nexus cuando la funcionalidad está deshabilitada; con funcionalidad habilitada el fallo de esquema es explícito.

## Recuperación y reversión

- Reanudar procesa pendientes; no repite unidades válidas. Un timeout de proveedor no garantiza ausencia de consumo externo.
- Cambiar entradas invalida aprobaciones y marca contenido afectado, sin borrarlo. El historial conserva el documento anterior.
- Cambiar agenda afecta las sesiones modificadas; cambiar configuración pedagógica marca planes y materiales. Los hashes detectan fuentes o planes incompatibles.
- Una fuente rechazada impide entregar contenido que la cite. Una nueva generación usa las fuentes aprobadas actuales.
- Pausa/fallo bloquea nuevas reservas hasta reanudar o cancelar; el lease expirado permite reanudar.
- Cancelar invalida el token de escritura anterior y conserva contenido ya guardado.
- Conflictos de revisión requieren actualizar, no sobrescriben otra edición.

Rollback: deshabilitar nuevas operaciones globalmente o por lista. Los workers se pausan entre unidades al observar la deshabilitación. Se conservan modalidad, historial y descargas autorizadas de paquetes vigentes; no se convierten cursos a Nexus ni se borran tablas.

## Verificación reproducible

~~~powershell
npm run test:course-delivery
npm run test:curation --workspace=apps/web
npm run test:materials-generation --workspace=apps/web
npm run test:security-boundaries
npm run test:syllabus-duration --workspace=apps/web
npm run db:migrations:check
~~~

Prueba SQL en PostgreSQL local en memoria, con dependencia temporal y sin .env:

~~~powershell
npm install --ignore-scripts --no-save --package-lock=false --prefix .tmp/sql-verification @electric-sql/pglite@0.3.14
node --test scripts/test-course-delivery-sql.mjs
~~~

La prueba aplica la migración sobre un esquema fixture mínimo. Comprueba sintaxis ejecutable, revisiones, claim, cancelación, privilegios y políticas; no sustituye una migración sobre el esquema completo desplegado ni sesiones Auth Bridge reales.

La [QA de documentos](../../scripts/qa-course-delivery-exports.mjs) requiere compilar la suite del dominio y disponer de Playwright/navegador. COURSE_DELIVERY_PLAYWRIGHT_PATH permite usar el runtime disponible y COURSE_DELIVERY_BROWSER_CHANNEL un navegador instalado. Solo usa datos sintéticos y guarda HTML, capturas e impresión A4 en .tmp.

La evidencia y límites se conservan en el [reporte de implementación](../../openspec/changes/archive/2026-10-26-add-synchronous-hybrid-course-flow/reports/implementation.md).
