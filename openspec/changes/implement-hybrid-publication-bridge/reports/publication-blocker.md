# Diagnóstico del bloqueo del piloto

Fecha: 2026-11-27. [Guía de continuidad](continuation.md).

En Architect staging, el taller de gestión del tiempo estaba aprobado en
autoría. La fase Publicar marcó el correo del instructor y el slug como listos.
La imagen de portada aparecía como requerida y los 20 videos finales seguían
sin asignación. El código del botón deshabilitaba el envío si faltaba alguno
de los tres campos obligatorios. Los avisos sobre videos eran informativos en ese
formulario.

`/api/trigger-publish` delega a
[`/api/publish`](../../../../apps/web/src/app/api/publish/route.ts).
El manejador consulta la modalidad antes de construir y encolar el paquete v1.
Cuando el paquete híbrido está vigente, la guarda devuelve 409 porque faltan
la aprobación v2 y el envío v2. Completar la portada resolvería la validación
del formulario anterior, pero el servidor conservaría la guarda. Las tablas
y el bucket observados en Supabase acreditan infraestructura de recepción.

## Cambios locales

- Architect muestra el motivo junto a «Enviar a SofLIA» y reserva la acción
  v1 para cursos asíncronos con modalidad confirmada. Los datos faltantes y
  el inventario de videos siguen visibles. El panel entrega la preparación
  sincrónica solo mediante su flujo existente de aula programada.
- Academy prepara `20261127120000_hybrid_course_tenant_scope.sql`. Vincula
  el artefacto a un curso de la misma organización, filtra RLS y el catálogo
  en vivo, y verifica las escrituras de asignaciones, adquisiciones,
  inscripciones y sesiones. El catálogo empresarial, su detalle y las
  rutas de asignación identificadas aplican el mismo ámbito.
- El cron legacy rechaza los slugs protegidos, la actualización desde staging
  filtra por cursos globales y PostgreSQL bloquea el UPSERT directo de v1 sobre
  un curso v2.
- La migración debe preceder al despliegue de los nuevos lectores. Se conserva
  mientras existan cursos híbridos vinculados. No se ejecutó SQL remoto durante
  este diagnóstico.

## Verificación

- Academy pasó 34 pruebas dirigidas en ocho archivos, tipos y lint del alcance
  editado. PostgreSQL en PGlite aplicó dos veces la migración y comprobó
  el aislamiento con un instructor de dos empresas, las escrituras por rol
  de servicio, la integridad del vínculo y el UPSERT por slug de v1.
- Architect completó `npm run verify:pr` con código 0, incluidas 102 pruebas de
  entrega. OpenSpec validó el cambio en modo estricto y `docs:check` comprobó
  512 documentos. El navegador confirmó el diagnóstico en staging. La pantalla
  modificada sigue local.

La tarea 2.4 sigue abierta. Falta convertir la revisión recibida en contenido
de Academy por identidades estables y probar que una revisión conserva
progreso y respuestas. Después corresponden el envío v2, la validación de
Storage y el piloto autorizado.
