## Context

El inbox actual se deposita por slug. Academy valida módulos como unknown y el
importador hace upsert por orden, elimina contenido obsoleto y confirma en varias
escrituras. La guarda de Architect evita perder el recorrido; ver proposal.md.

## Goals / Non-Goals

Contrato explícito y rollout compatible, sin descartar metadatos silenciosamente.
Este primer incremento entrega contrato de currículo/recorrido y clasificación
en las fronteras del receptor. No habilita todavía el importador v2 ni sesiones
reales: las unidades restantes figuran en tasks.md, no son una capacidad terminada.

## Decisions

1. Identidad externa compuesta por organización, artefacto e ID de contenido.
   Revisión entera e ID de publicación distinguen versión y reintento. Slug y
   posición son atributos editables, nunca claves de progreso de v2.
2. Separar currículo completo de lecciones Academy. Las exclusivas Hub siguen en
   el currículo/recorrido pero no generan una lección con video vacío o ficticio.
   Cada lección debe tener destino y aparecer una vez en la parte asíncrona;
   cobertura en vivo puede repetirse si el repaso es explícito.
3. Sesiones se entregan como preparación, no como reuniones con fecha inventada.
   La programación vincula una plantilla aprobada a una sesión real en Academy.
   El contrato inicial del recorrido identifica la revisión de preparación;
   el snapshot y sus archivos requieren la fase de persistencia/traslado.
4. Un único contrato portable compatible con Zod 3/4. Architect mantiene la fuente;
   Academy consume una copia vendorizada, verificada byte a byte por script con
   destino explícito y fixtures compartidas. No hay imports entre checkouts ni
   dependencias nuevas. No duplicar reglas dentro del cron o la aprobación.
5. V1 conserva comportamiento salvo rechazo explícito de metadatos híbridos que
   antes se perderían. V2 válido se reconoce pero no se degrada al importador v1.
   Una versión desconocida se rechaza. La validación no concede autorización.
6. Antes de activar v2: tablas de identidad externa/recorrido y plantillas,
   restricciones de tenant, función transaccional de aprobación que bloquee la
   revisión, preserve progreso, publique contenido y registre confirmación juntos.
   Conflictos de slug/tenant o revisión obsoleta deben producir errores, no merges.
7. Receptor primero, emisor después: negociar soporte en servidor antes del envío;
   mantener el outbox durable y confirmar separadamente RECEIVED/APPROVED/REJECTED.

### Persistencia y contrato del segundo incremento

- Academy es dueña del contenido, sesiones, asignaciones y progreso (instancia
  SOFIA). Un vínculo administrativo uno a uno relaciona el UUID de la
  organización de Architect con el UUID de Academy. La recepción verifica el
  slug vigente de Academy y una membresía activa de tipo propietario o admin.
  El UUID de actor para el RPC debe proceder de un transporte autenticado.
- Una fila por organización externa y artefacto serializa recepción y futura
  aprobación. La revisión guarda un JSONB privado inmutable con el recorrido,
  las lecciones y las plantillas sin programar. Una decisión terminal opcional
  referencia esa revisión. El mismo contenido y publicación devuelven su estado
  previo. Un contenido distinto para la revisión, un ID de publicación ya usado
  por otro destino o una revisión anterior desconocida se rechazan.
- La preparación usa los mismos validadores de documentos, bloques, prácticas,
  evaluaciones y notas que el aula. La plantilla omite fecha, aula y curso de
  destino. Las escenas, anexos y demás materiales refieren archivos por ID,
  bytes, MIME y SHA-256. La transferencia debe comprobar autorización, MIME real
  y huella antes de confirmar su custodia. Ni el manifiesto ni el SQL acreditan
  que los bytes se hayan transferido. La configuración de diálogos se valida
  contra el runtime de Academy antes de aprobar.
- Antes de vincular un curso activo, Academy debe aplicar el ámbito tenant al
  catálogo y a las asignaciones que usan el cliente privilegiado. Hoy existen
  listados globales que no reciben las restricciones RLS del alumno. No
  certificar el aislamiento de contenido con las pruebas del receptor privado.
  El detalle empresarial también carga por ID con el cliente privilegiado.
  El catálogo de Hub puede incluir un curso por la membresía de su instructor
  en otra organización. Ambos lectores requieren el mismo ámbito. Mantener
  las verificaciones existentes de suscripción y adquisición del flujo de
  asignación. El recibo y la aprobación no generan una compra ni otorgan cupos.
  Los archivos privados necesitan una proyección autorizada para reproducción.
- El ámbito de un curso v2 vive en `courses.hybrid_organization_id`. Se usa
  `NULL` para mantener el alcance de los cursos legacy. La clave foránea del
  artefacto exige que su curso tenga la misma organización. Los catálogos
  empresariales y Hub filtran antes de mostrar datos o contar filas. Los
  escritores de inscripciones, asignaciones, adquisiciones y sesiones también
  validan el ámbito. La migración antecede al despliegue de los lectores.
- Una revisión v1 con el slug de un curso ya vinculado a v2 debe rechazarse
  antes de llegar a las escrituras por posición, aunque cumpla el contrato
  legacy. La protección debe cubrir el staging, la aprobación y la
  importación directa.
- La aprobación debe tomar el mismo bloqueo de artefacto y reevaluar al revisor,
  al instructor y la revisión vigente. Una colisión de slug bloquea la operación.
  La correspondencia de módulos/lecciones será por ID de autoría. Actividades y
  adjuntos se identifican dentro de su lección. El orden es un atributo mutable.
  Antes de escribir posiciones, confirmar los índices vigentes y diseñar la
  transición para que un intercambio no choque con posiciones existentes.
  Los contenidos retirados con referencias académicas se conservan fuera del
  recorrido vigente. La aprobación no programa sesiones ni asigna alumnos.

## Risks / Trade-offs

- Dos repositorios → contrato portable y prueba de paridad local; no declarar
  compatibilidad remota por pruebas locales.
- Importación parcial/identidad posicional → v2 bloqueado hasta la transacción y
  pruebas PostgreSQL reales de rollback, duplicados, orden y progreso.
- Filtrado de notas privadas → almacenar snapshot reservado; proyección de alumno
  del contrato de preparación existente, sin claves de respuestas.
- Sesiones sin horario → plantillas; instructor confirma horario y duración.

## Migration Plan

Validadores y pruebas primero. Después migraciones aditivas del receptor con RLS
y funciones restringidas, pruebas aisladas y revisión. Desplegar receptor, verificar
capacidad, desplegar emisor y hacer el piloto autorizado. No aplicar SQL compartido
ni cambiar variables remotas durante este incremento. Rollback de aplicación
conserva v1 y la guarda híbrida; no eliminar datos ni reasignar IDs para revertir.
