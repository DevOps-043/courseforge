# CAP-029 — revisión de entregas paralelas CAP-022 y CAP-025

Fecha: 2026-10-10. Revisión del checkout de integración, sin modificar los paquetes,
stores, rutas compartidas, políticas, SQL ni configuración del compañero.

## Resultado

El commit `e0f77bd3` contiene ambas entregas y es ancestro del HEAD inspeccionado
`c3f79e8f` (merge de `origin/stagin-2` en `staging`). Los archivos inspeccionados de
agentes y media-derivatives no tienen diferencias locales respecto al checkout.
Integración en Git no implica integración funcional ni aceptación productiva.

| Frente | Paquete recibido | Estado de la capacidad completa |
| --- | --- | --- |
| CAP-025 | Lecturas acotadas, sesión host-scoped, simulación multi-step, presupuesto JSON y DTO de integración | Parcial: faltan consumidores y garantías durables de R23–R25 |
| CAP-022 | Planificador, orquestador/verificador, reader, adapter de jobs/cache y UI aislada | Parcial: faltan adapters reales, entrega HTTP y wiring de consumidores de R13 |

Fuentes: `SOFLIA_ENGINE_MULTIMEDIA_EDITOR_CAP025_DELIVERY.md` y
`SOFLIA_ENGINE_CAP022_DELIVERY.md`. Ambas declaran explícitamente implementación
parcial, no «completada, solo QA». El paquete independiente entregado no equivale
al CAP completo; no se asigna porcentaje a estas capacidades sin una rúbrica propia.

## Hallazgos corroborados en código actual

1. CAP-025: `composition-agent-proposal-store.service.ts` no selecciona ni coteja
   `created_by` al leer la propuesta. La autorización HTTP comprueba usuario,
   tenant y rol de edición, no delegación explícita de ese creador. La RPC preparada
   `apply_video_composition_agent_proposal` tampoco coteja el creador/delegación.
   El test `audit gap: store currently permits another same-tenant actor without
   checking proposal owner` reproduce esta brecha con dependencias simuladas.
   No demuestra una explotación en una BD desplegada, cuyo estado no se consultó.
2. CAP-025: `Date.parse(stored.expiresAt) <= Date.now()` admite NaN en el lector TS.
   El segundo test `audit gap` lo reproduce. PostgreSQL tiene timestamptz tipado;
   no atribuir a esa columna una fecha inválida por este test de adaptación TS.
3. CAP-025: los módulos de sesión, plan y contrato nuevos no tienen consumidores
   de producción fuera de sus definiciones en el árbol `apps/web/src` inspeccionado.
   El store conserva replay desde documento actual, sin binding/revisión base
   monotónica/recibo histórico implementados. No existe la migración propuesta
   de delegaciones/binding en `supabase/migrations` del checkout.
4. CAP-022: probe, generación, decodificación, autoridad, Storage y jobs son ports
   inyectados. No hay implementación concreta ni consumidores HTTP/timeline en
   el árbol web inspeccionado. Un AbortSignal/deadline no acredita contención OS.
   La fixture WebP es sintética y SSR no monta el ciclo de vida React/browser.
5. CAP-029 I04: previews de agent-proposals y preset-applications aún llaman al
   compilador sin contexto HTML exacto. El de agentes usa CSP genérica inline.
   No basta agregar el hash candidato ni habilitar ese CSP para HTML editable.
6. CAP-029 I05: ninguna de estas dos entregas contiene el catálogo UX HTML reservado.
   No asumir que el merge libera esa reserva o que el selector ya está terminado.

## Validación repetida en este checkout

- Compilación `apps/web/tsconfig.hyperframes-test.json` a `.tmp/cap029-tests`: exit 0.
- Once archivos `composition-agent-*.test.js`, con resolución de alias hacia esa
  salida y sin sustituir dominio: **83/83**, cero fallos, skips o cancelaciones.
  Incluye los dos tests de caracterización de brechas; el verde no las corrige.
- Build aislado `media-derivatives/tsconfig.unit.json`: exit 0; **50/50** tests,
  cero fallos, skips o cancelaciones, sobre el output recién compilado.
- Tipado web `tsc --noEmit --incremental --tsBuildInfoFile .tmp/cap029-web.tsbuildinfo`:
  exit 0. Los errores Buffer históricos de las notas no aparecen en esta ejecución.

No se ejecutaron proveedores, red, SQL, Storage, codecs, renderer, QA manual,
despliegue ni activación de flags. Tests simulados no prueban locks/RLS/delegación
durable, contención, calidad de frames ni funcionamiento en browser real.

## Flujo de integración necesario, sin duplicación

Reutilizar la simulación y contratos recibidos; no crear otro planificador,
allow-list, store, cola, ledger o renderer. Para I04, resolver autoridad vigente
del candidato almacenado y de su base, conservar pointers HTML exactos y reutilizar
la entrega HTML aislada (recursos, sesión, CSP y compilador comunes). La corrección
durable de ownership/delegación/binding es integración CAP-025, no una autorización
deducida de un DTO ni una condición ocultable como QA. Acordar sus archivos antes
de editar ese núcleo; la instrucción recibida permite revisar las entregas juntadas,
no certifica por sí misma las garantías faltantes.

CAP-029 conserva **aproximadamente 85% ±10 puntos**: I01/I03 preparados;
I02/I04 parciales e I05 reservado. Esta revisión determina dependencias reales,
no acredita implementación nueva ni aumenta el porcentaje. Sin SQL adicional;
se conserva `SOFLIA_ENGINE_CAP029_SQL_MANUAL_ORDER.md`, pasos 1→29, solo pendientes
verificados y con prerrequisitos de ambiente, sin aplicación automática.

## Actualización posterior autorizada

El usuario autorizó la integración HTML propia (propuestas/presets, reader layout
del executor y catálogo UX) sin política/stores CAP025 ni resto del worker. I04
queda implementado/preparado en un reader HTML read-only con creator/base/status/
expiry actuales, autoridad exacta de la base y transporte común. No se deduce
delegación/recibos durables generales de esta corrección puntual.
[Auditoría I04](SOFLIA_ENGINE_CAP029_PREVIEW_CONTEXT_AUDIT.md). CAP022/CAP025 mantienen
los hallazgos anteriores; CAP029≈90%±10, I02/I05 pendientes. SQL1→29 sin adiciones.

Siguiente corte autorizado I05: catálogo UX conectado al catálogo servidor y
bootstrap exacto existentes; selector explícito alimenta inicialización durable,
sin entrada manual como fallback, instalación ni registro automático. CAP029≈95%±10,
solo I02 con implementación necesaria pendiente. Regresión1062/1062 y dirigidas29/29;
tipado/lint aprobados, browser/SQL reales separados. CAP022/CAP025 no se modifican
ni se cierran por esta entrega. [Auditoría I05](SOFLIA_ENGINE_CAP029_TEMPLATE_CATALOG_UX_AUDIT.md).

## Cierre autorizado del guard HTML

El usuario autorizó expresamente exigir cuotas CPU/memoria existentes en
composition-windows-render-worker-host.ts, únicamente para HTML editable. Guard
conectado antes de prepareLaunch/spawn, sin tocar bridge, límites, gates generales,
stores CAP025 ni resto del worker. Regresión1074/1074 y guard/bridge24/24 aprobados;
tipos web/worker/tests y lint dirigido aprobados. Proceso y materialización exterior
simulados, sin cuotas físicas/browser/SQL reales. Rechazo owned conserva cuarentena
y fence según ciclo existente, requiere intervención antes de reintentar.

CAP029100% de implementación necesaria preparada, I01–I05 preparados; A01/A02/Q01
pendientes. CAP022/CAP025 siguen parciales según los hallazgos de esta revisión;
este guard no los modifica ni los cierra. SQL1→29 sin adiciones ni aplicación.
