# Continuidad: puente Architect → Academy → Hub

Actualizado: 2026-11-27, America/Mexico_City.
Documento de traspaso del trabajo local; no acredita despliegue ni publicación v2.

## 1. Objetivo y estado exacto

El usuario pidió planificar y comenzar un puente que permita entregar un taller
híbrido completo desde Architect a Academy, aprobarlo allí y comprobar instructor
y participante en Hub, sin saltar validaciones ni introducir atajos de integridad.
Después pidió documentarlo para continuar en otro chat.

**El puente completo sigue pendiente.** Al contrato de recorrido y las guardas
legacy se sumaron el contrato del paquete v2, la custodia de archivos y el
receptor HTTP autenticado de Academy con recepción SQL idempotente. Faltan el
catálogo aislado por tenant, la aprobación transaccional y la conexión del
emisor. La guarda de publicación híbrida permanece activa.

Lectura inicial:

1. `D:/Pulse Hub/SofLIA-HUB/AGENTS.md` y `docs/prompt_maestro.md` del mismo repo.
   Este último es un alias: leer completamente `docs/standards/engineering-practices.md`.
2. `AGENTS.md` y estándares del área de cada repositorio aplicable.
3. [Contexto del cambio](../context-pack.md), [propuesta](../proposal.md),
   [diseño](../design.md), [tareas](../tasks.md) y
   [resultados del primer incremento](first-increment.md) y
   [resultados del segundo incremento](second-increment.md) y
   [recepción HTTP](third-increment.md) y
   [diagnóstico del bloqueo](publication-blocker.md).
4. [Contrato y operación actuales](../../../../docs/architecture/hybrid-publication-bridge.md).

El estado «complete» de los artefactos de planificación del CLI OpenSpec no
significa que las tareas de implementación estén terminadas. Permanecen abiertas
las secciones 2–4 de tasks.md. No archivar este cambio.

## 2. Repositorios y conservación de trabajo

| Repositorio | Ubicación | Rama de revisión | Commit base |
| --- | --- | --- | --- |
| Architect | `D:/Pulse Hub/courseforge` | `codex/hybrid-publication-bridge` | `1a117dc78808ced7c63f656c34a2de7ff94a7e4d` |
| Academy | `D:/Pulse Hub/SofLIA-Learning` | `codex/hybrid-publication-bridge` | `7ddb98db357f10eefabe1316831177586fc6b266` |
| Hub | `D:/Pulse Hub/SofLIA-HUB` | `codex/hybrid-publication-bridge` | `ee47aa145e8435f1e997b794000e6b74bcf964ed` |

Consultar el estado local y el remoto de las ramas de revisión antes de retomar.
La presencia de una rama en GitHub no acredita un despliegue ni la aplicación
de la migración de ámbito. La entrega deja pendiente la aprobación
transaccional y el emisor v2. No usar reset, clean, restauraciones amplias ni
cambiar de checkout sin revisar los cambios locales.

Architect exige trabajar en el checkout principal y no crear worktrees salvo
solicitud explícita. No mover ni descartar cambios ajenos para aislar la tarea.

Cambios de Academy que **ya existían antes del puente** y deben preservarse:

- `apps/web/src/features/live/LiveCatalog.tsx`
- `apps/web/src/features/live/LiveSessionDetails.tsx`
- `apps/web/src/features/live/client.ts`
- `apps/web/src/features/live/session-presentation.ts` (nuevo)
- `apps/web/src/features/live/__tests__/session-presentation.test.tsx` (nuevo)
- `docs/live-video-sdk.md`

Son ajustes de fechas/estado de sesiones, no parte de la implementación del puente.
Los directorios `.tmp/` contienen logs y diagnósticos locales; no versionarlos
indiscriminadamente ni depender de ellos como única evidencia.

## 3. Qué se implementó en el primer incremento

### Architect

Rutas relativas a `D:/Pulse Hub/courseforge`:

- `apps/web/src/domains/publication/contracts/hybrid-publication-route.ts`:
  fuente portable del contrato de **metadatos del recorrido** v2. Identifica
  organización, slug organizacional, artefacto, publicación y revisión; conserva
  currículo, IDs de lecciones de Academy, sesiones, revisión de preparación y ruta.
- `apps/web/src/domains/publication/contracts/fixtures/hybrid-route-v2.json`:
  fixture sintética con solo Hub, solo Academy y compartidas. No es el taller real.
- `apps/web/src/domains/course-delivery/__tests__/hybrid-publication-route.test.ts`:
  valida destinos, reordenación sin sustituir IDs, referencias, duplicados,
  cobertura completa y protección del outbox v1.
- `apps/web/src/domains/publication/publication-outbox.ts`: añade la guarda de
  compatibilidad para que v2/modalidades no soportadas no viajen como v1.
- `scripts/sync-hybrid-publication-contract.mjs`: sincroniza/verifica contrato y
  fixture con un repositorio Academy explícito y valida su package.json.
- Documentación nueva en `docs/architecture/hybrid-publication-bridge.md` y
  `openspec/changes/implement-hybrid-publication-bridge/`.

### Academy

Rutas relativas a `D:/Pulse Hub/SofLIA-Learning`:

- `apps/web/src/lib/course-import/contracts/hybrid-publication-route.ts` y
  `contracts/fixtures/hybrid-route-v2.json`: copia vendorizada de la fuente y fixture.
- Guardas añadidas antes de efectos de contenido en:
  - `apps/web/src/app/api/cron/process-inbox/route.ts`
  - `apps/web/src/features/admin/actions/admin-courses/approve-course.service.ts`
  - `apps/web/src/lib/course-import/course-mutations.ts`
  - `apps/web/src/lib/course-import/apply-payload.ts`
  - `apps/web/src/lib/course-import/preview.ts`
- Pruebas nuevas:
  - `apps/web/src/lib/course-import/__tests__/hybrid-publication-route.test.ts`
  - `apps/web/src/app/api/cron/process-inbox/__tests__/hybrid-compatibility.test.ts`
  - `apps/web/src/features/admin/actions/admin-courses/__tests__/hybrid-approval-guard.test.ts`
- `docs/architecture/hybrid-publication-bridge.md`: estado del receptor y límites.

Las guardas reconocen v2 pero **lo rechazan** con
`COURSE_IMPORT_V2_REQUIRES_ATOMIC_APPROVAL` si el recorrido es válido. Un recorrido
v2 inválido devuelve `COURSE_IMPORT_INVALID_HYBRID_ROUTE`; una versión desconocida,
`COURSE_IMPORT_UNSUPPORTED_VERSION`. V1 con metadatos de modalidad devuelve
`COURSE_IMPORT_LEGACY_DELIVERY_NOT_SUPPORTED`, en vez de descartarlos.

V1 sin esos metadatos conserva su compatibilidad. El cron puede marcar el inbox
como error, pero no escribe staging ni contenido para estos rechazos. El contrato
no crea fechas, videos ficticios, roles ni autorizaciones. Validar el JSON no
prueba que el actor tenga acceso a la organización.

## 4. Diagnóstico que guía la siguiente implementación

El receptor actual NO es seguro para publicar v2:

- El inbox y staging se buscan por slug, insuficiente como identidad multitenant.
- El cron actual valida `modules` como una lista de `unknown`.
- `course-import/apply-payload.ts` hace upsert por posición de módulo/lección y
  elimina contenido obsoleto: no usarlo para v2 ni para preservar progreso.
- `course-import/instructors.ts` puede elegir el primer usuario si no resuelve
  instructor. No permitir este respaldo en el nuevo contrato.
- La aprobación actual hace varias escrituras separadas y algunas confirmaciones
  no verifican todos los errores. V2 necesita su operación transaccional propia.
- Las guardas del incremento 1 no corrigen esas limitaciones internas de v1.

Archivo que mantiene el bloqueo en Architect:
`apps/web/src/domains/course-delivery/services/delivery-publication.ts`.
Sigue lanzando el error del receptor incompatible después de comprobar readiness.

Puntos de entrada útiles para el siguiente análisis:

| Architect | Academy |
| --- | --- |
| `apps/web/src/app/api/publish/route.ts` | `apps/web/src/app/api/cron/process-inbox/route.ts` |
| `apps/web/src/domains/publication/publication-outbox.service.ts` | `apps/web/src/features/admin/actions/admin-courses/approve-course.service.ts` |
| `apps/web/src/domains/publication/lib/publication-payload.ts` | `apps/web/src/lib/course-import/apply-payload.ts` |
| `apps/web/src/domains/course-delivery/services/delivery-repository.ts` | `apps/web/src/lib/course-import/course-mutations.ts` |
| `apps/web/src/domains/course-delivery/services/delivery-live-payload.ts` | `apps/web/src/features/live/engine-preparation.server.ts` |
| `apps/web/src/domains/course-delivery/types/engine-preparation.contract.ts` | `apps/web/src/features/live/engine-preparation.contract.ts` |

Reutilizar los validadores de preparación y documentos existentes al ampliar el
snapshot. No interpretar `preparation_revision` del contrato inicial como si ya
transportara documentos/archivos. No reutilizar un `course_id` de otro taller.

## 5. Próxima unidad concreta

Continuar por las tareas 2.4–2.5. Las tareas 2.1 a 2.3 cubren el esquema aditivo,
el contrato del paquete y el receptor autenticado con custodia privada.

1. Reconciliar el esquema de Academy con el preflight de solo lectura de
   SofLIA-Learning `supabase/scripts/hybrid-publication-preflight.sql` en un
   entorno autorizado. El snapshot Database.sql no acredita el esquema remoto.
2. Preparar un ensayo contra un Storage autorizado para verificar la carga
   firmada y la caducidad de la cuarentena, y confirmar límites del hosting y
   disponibilidad del antimalware antes de habilitar el emisor.
3. Asegurar el catálogo y las asignaciones que usan clientes privilegiados.
   Las rutas empresariales `/api/business/courses` y `/api/[orgSlug]/business/courses`
   consultan hoy todos los cursos activos mediante service role.
4. Crear la aprobación transaccional con autorización server-side.
   Rechazar identidad docente no resuelta, tenant ajeno y revisión obsoleta.
   Reordenar debe preservar IDs/progreso; retirada de contenidos debe tener una
   política explícita que no borre trabajo académico por accidente.
5. Probar en PostgreSQL aislado rollback, duplicados, concurrencia, tenants,
   reordenación y preservación de progreso/respuestas. Un mock no prueba atomicidad.

Después completar sección 3: negociación de capacidad en servidor, emisor/outbox,
confirmaciones RECEIVED/APPROVED/REJECTED, preview completo y programación explícita.
`SENT` solo confirma transporte, no aprobación. No inventar horarios para crear
reuniones: primero conservar plantillas y después programar en Academy.

El rollout previsto es receptor → verificación de capacidad → emisor → piloto
autorizado. Preparar migraciones/despliegue revisables antes de pedir cualquier
aprobación requerida. **No aplicar SQL remoto, cambiar secretos o permisos,
desplegar ni publicar datos reales por inferencia de una prueba local.**

## 6. Verificación ejecutada y reproducción

Resultados acreditados del primer incremento:

- Architect `npm run verify:pr`: código 0; incluye 75 elementos OpenSpec, tipos,
  grafo sin ciclos, seguridad, audio, tooling y 97/97 pruebas de entrega.
- Academy: 4 archivos, 9/9 pruebas dirigidas; lint dirigido sin errores.
- Contrato de Academy con Zod 3.25.76: tipos aislados aprobados. Architect usa
  Zod 4.6.7. Script de paridad y fixture verificados.
- Documentación: 508 documentos comprobados; diff sin errores de whitespace.
- Tipos globales de features Academy: **fallan** con siete errores UI anteriores
  al puente. Se comparó una base virtual con los cinco archivos de producción
  afectados desde HEAD, conservando los demás cambios locales: mismos siete
  diagnósticos, por archivo/línea/código/mensaje. No se alteraron archivos al comparar.
- No se probó recepción v2 desplegada, preservación de progreso en DB ni el taller
  completo en Hub. La revisión adversarial registrada es del mismo agente.

Desde Architect:

```powershell
node scripts/sync-hybrid-publication-contract.mjs --check "D:/Pulse Hub/SofLIA-Learning"
npm run test:course-delivery -w apps/web
npm run verify:pr
npm run docs:check
```

Desde Academy:

```powershell
npm run test -w apps/web -- --maxWorkers=1 --pool=threads src/lib/course-import/__tests__/hybrid-publication-route.test.ts src/app/api/cron/process-inbox/__tests__/hybrid-compatibility.test.ts src/features/admin/actions/admin-courses/__tests__/hybrid-approval-guard.test.ts src/lib/__tests__/course-import-activities.test.ts
```

Tipos aislados, desde `SofLIA-Learning/apps/web`:

```powershell
node ../../node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module commonjs --moduleResolution node --esModuleInterop --types node src/lib/course-import/contracts/hybrid-publication-route.ts
```

Los tests de servidor nuevos usan entorno Node. Una primera ejecución con jsdom
agotó el arranque de un worker; las repeticiones finales pasaron. No ocultar un
timeout como test aprobado. Si las pruebas Git/temporales de Architect requieren
TEMP/TMP bajo el workspace, usar un directorio temporal propio y conservar códigos
de salida. No bajar controles ni baselines para obtener verde.

Logs opcionales, ignorados por Git, útiles si aún existen:
Architect `.tmp/hybrid-bridge-verify.log`; Academy
`.tmp/hybrid-bridge-all-targeted.log`, `.tmp/hybrid-bridge-types-features.log`,
`.tmp/hybrid-bridge-types-baseline.log` y `.tmp/hybrid-bridge-type-baseline.cjs`.
Los siete diagnósticos previos afectan LiaQuickActionsChips, PageShell,
AdminCompaniesStatCard, FeatureVisual y Section. El reporte first-increment.md
conserva el resultado aunque desaparezcan los logs temporales.

## 7. Contexto del piloto y hallazgos separados

Taller de prueba de Architect:
`https://soflia-coursegen.netlify.app/pulsehub/admin/artifacts/dca8d686-2c8a-413f-b4a6-5b1e4b187547`
— Gestión del tiempo y priorización de tareas — Taller híbrido.

Producción de Architect se promovió previamente mediante PR #16, merge
`27e33483d303a3c96ef74b93adc2f64e0fb77211`. **Ese despliegue no contiene este
trabajo local del puente ni habilita v2.**

Observado antes de implementar:

- Architect: taller APPROVED, 20 lecciones compartidas, ninguna con video asignado
  en la entrega asíncrona. No generar HeyGen ni videos de pago como prueba; el
  usuario autorizó únicamente lo mínimo necesario y ningún HeyGen.
- Academy: taller ausente del catálogo y cola de pendientes revisados. Esto no
  equivale a una consulta exhaustiva de todas las tablas históricas.
- Solo se ofrecía el aula antigua Prueba de grabación Video SDK · 10 noviembre,
  del curso Revisión del panel de sesiones. **No es el taller híbrido.**
- Hub autenticado con AlexEM: selector SofLIA y Empresa Demo; la segunda remite
  a `pulsehub` en Learning. Sin próximas sesiones; historial de Empresa Demo muestra
  aquella aula antigua. No cambiar la organización basándose solo en su etiqueta.
- Detalles abre Academy dentro de Hub. «Abrir Soflia Hub» intenta `soflia://` y
  el navegador integrado lo bloquea. Fallo reproducible separado; no omitir la
  guarda ni desactivar seguridad para continuar. También se observó «Próximamente»
  en Academy para la sesión pasada del 10 de noviembre.
- Instructor y participante tienen componentes implementados en Hub y selección
  de rol mediante permisos de Academy. **No se validó el aula del taller híbrido**.
  Hub se inició con `npm run dev`; comprobar si sigue ejecutándose antes de iniciar
  otra instancia. No asumir que los handles de navegador o la autenticación persisten.

## 8. Texto sugerido para iniciar el siguiente chat

> Continúa la implementación del puente híbrido Architect → Academy → Hub.
> Lee primero `D:/Pulse Hub/courseforge/openspec/changes/implement-hybrid-publication-bridge/reports/continuation.md`,
> el diseño y tasks.md. Usa prompt_maestro.md de Hub y los estándares aplicables.
> Consulta las ramas de revisión y preserva los cambios previos de fechas
> en Academy. Retoma la aprobación
> transaccional, tareas 2.4–2.5. No retires la guarda híbrida ni apliques
> migraciones remotas hasta tener receptor, permisos, snapshot completo y pruebas
> de atomicidad/progreso. No generes HeyGen ni confundas el aula antigua con el taller.
