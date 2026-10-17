# CAP-027 — entrega del render consumido a conformidad

## Estado

Implementación opt-in y migración PREPARADA, NO aplicada ni ejecutada en PostgreSQL. No QA formal,
activación de worker o aprobación de conformidad. El código no acredita operación cross-host.

## Problema y contrato

El job de conformidad se crea desde la integridad del video, después de finalizar su subida.
Publicar únicamente una reserva por job exige que ese job ya exista: no es válido elegir el más
reciente, inventar un ID o repetir el render si todavía no se ha creado.

La opción operatoria `deferConformanceReservation: true` de `createControlledRenderWorkerHost`
(también admitida por su composición Windows) conecta `CompositionConformanceRenderReservationService.defer`
al supervisor. Por defecto está ausente/false: el flujo anterior no llama al RPC nuevo. No existe
un flag de composición/HTML ni se ha activado esta opción.

Secuencia de la ruta opt-in:

1. El renderer original entrega artefactos y selección exacta de referencias.
2. El supervisor valida, firma y guarda checkpoint local ANTES de consumir autoridad.
3. Tras admisión CONSUMED, publica la entrega intermedia exacta ANTES de subir/finalizar el video.
4. La integridad posterior crea el job; su trigger enlaza esa entrega a su ID real.
5. El worker reservado lee el manifiesto exacto y recupera autoridad, sin recaptura ni rerender.

`EXACT_RENDER_RESERVATION_OUTBOX_V1` contiene scope/binding/original-receipt-SHA/artefactos/referencias;
no jobId ficticio, lease, ruta local, firma completa o claves. El reader sigue usando la reserva
V1 por job; no necesita acceso a la tabla intermedia. No cambia PASS/FAIL/INCOMPLETE ni aprueba QA.

## Consistencia y errores

La migración `20261008220000` crea una tabla privada/RLS sin acceso directo de service_role y un
RPC exclusivo de service_role. El RPC exige request/org/revisión/ejecución CONSUMED, recibo exacto,
contrato y referencias, y consulta revocación actual. Publicaciones idénticas son idempotentes;
otra ejecución/payload/hash para la misma request se rechaza. No sobrescritura ni selección latest.

Staging y trigger comparten lock de la request. Se usa `FOR NO KEY UPDATE` para serializar ambas
rutas sin bloquear los `KEY SHARE` de sus FK; esto sigue requiriendo pruebas de transacciones reales.
Referencia: [locks de PostgreSQL](https://www.postgresql.org/docs/current/explicit-locking.html).
Si el job ya existe, el RPC lo enlaza en esa transacción; si nace después, el trigger lo enlaza
antes de hacer visible el commit. Ambos reutilizan el registro de reserva existente y sus checks.
Un error de enlace revierte la transacción; no marca el job como aprobado o medido.

El manifiesto por job se serializa mediante jsonb::text y recibe SHA de SUS bytes, diferente del
SHA de la entrega inicial. Ambos quedan estables e independientes. Antes de guardar se verifica
el tamaño futuro, incluyendo expansión JSONB y campo UUID; una entrega no enlazable por tamaño
no debe persistir y bloquear posteriormente la creación del job. No mezclar `.publish(job, ...)`
manual con outbox sobre una misma request: su serialización puede diferir y el CAS debe rechazarla.

ACK perdido/timeout/error deja checkpoint y render consumido intactos e impide subida/finalización
en esa ejecución. El error seguro `RENDER_SUPERVISOR_CHECKPOINT_RESERVATION_UNCONFIRMED` exige
recuperación según el contrato de cola. No borrar inputs ni consumir nueva autoridad. El host que
reconcilie usa resumeCheckpoint: primero verifica historia CONSUMED y recibo exacto, y repite
staging idempotente. Solo historia indisponible permite comprobar la admisión original pendiente;
revocación, cambio o recibo ajeno no habilitan esa alternativa. `resume` sin checkpoint se rechaza
cuando esta opción está activa, para no saltarse la entrega. Cada RPC tiene timeout cooperativo
de 15s y señal del dueño; no se afirma detener adapters que ignoren AbortSignal.

## Validación y operación pendientes

46/46 autoridad/firmas/checkpoint/upload, 3/3 lectores de reserva y 7/7 checks estructurales SQL
pasan. Compilación operativa y de tests pasan. Archivos/hash/firmas son reales; DB/upload/render
simulados. Los checks SQL NO prueban sintaxis, ejecución, permisos o concurrencia en PostgreSQL.

Antes de aplicar/activar: verificar dependencias de migración, ambas carreras y conflictos,
revocación, ACK perdido, contratos silenciosos/eventos, límites JSONB, FK/locks/deadlocks bajo
concurrencia y limpieza con retención. La FK RESTRICT exige una política autorizada de eliminación
coordinada para request/ejecución/evidencia: no se implementó GC ni borrado de datos retenidos.
Migración no tiene backfill; jobs legacy sin outbox conservan su ruta anterior.

Rollback operativo: no activar la opción; si llegó a usarse, reconciliar entregas y reservas
antes de retirar infraestructura. No eliminar tabla ni checkpoint para ocultar estados inciertos.
