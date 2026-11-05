# Continuidad F1.3.c.3.c.7.b.2.b.4.b — 2026-11-05

Base 1cbbf559. Plan previo: diez rutas/once métodos de raíces compartidas
narrativas, reconstruction y preview. Cargar fuentes reales a través de sus
composition roots y políticas puras; interceptar solamente factories terminales
y efectos externos para verificar wiring, autoridad actual y gates.

Comprobar allowlist de organización solo para nuevas escrituras narrativas;
recovery debe seguir usando autoridad actual y gate de persistencia. Preview
PAGE/RESOURCE_RENEWAL se elige por servidor. Recursos capability no sustituyen
sesión por usuario del payload: usan su protocolo firmado y configuración de
operador; las suites HTTP previas cubren el handler, no el wiring de esta raíz.

No derivar claves ni audience de headers. Usar valores sintéticos y permisos
sin acceso real. Registrar límites de la intercepción; no confundirla con una
prueba integrada de DB, Storage, cookies o ejecución del handler terminal.
## Implementación y evidencia

No se cambia producto: las raíces inspeccionadas ya satisfacen estas expectativas.
Se añaden 51 pruebas de composición sobre once métodos de diez rutas. El fixture
carga fuentes reales de rutas y seis módulos compartidos de composición/rollout,
más políticas reales y configuración de preview real. Intercepta factories
terminales; bloquea cualquier SDK, cliente privilegiado o dominio que se invoque
por accidente. Entorno sintético; no importa el módulo real de credenciales/env.

Se verifica dispatch exacto y params; flags estrictos; identidad/tenant actuales,
propagación de ambas clases de autoridad en identity/tenant/review según flujo;
rechazo de tenant de otro actor y revisión denegada; allowlist de organización
solo para escritura narrativa. Las solicitudes de prueba llevan origen y empresa
forjados, pero la configuración proviene del operador y falla si falta.
RESOURCE no tiene authenticate/authorize de sesión: esto acredita cableado del
protocolo capability, no aceptación de una capability concreta. Esa validación
vive en el handler real y sus suites de delivery ya activas.

- test:auth-bridge: código 0, contrato 15/15 y autoridad 625/625 (51 nuevas).
- Canario en fragment/apply que omite allowlist: código 1, 50/51 pasan; falla
  el caso de organización no habilitada. Canario renew que cambia tipo a PAGE:
  código 1, 46/51 pasan; falta la factory prevista. Bytes restaurados en finally
  y hash verificado después de cada uno; suite restaurada código 0, 51/51.
- Se detectó una suite omitida por selección de imports directos:
  composition-html-editing-reconstruction-resource-link.test.ts importa un fixture
  que construye los handlers reales. Sus 15 tests de lookup/enlace/recuperación,
  idempotencia y cliente simulado se ejecutan ahora en test:hyperframes.
- test:hyperframes completo: código 0; primer grupo 329 tests, incluidos los 15
  activados y los 314 anteriores. Node 22 offline: código 0, 66/66 (51 de wiring
  y 15 de resource-link). Logs .tmp/module-graph/f1-3c3c7b2b4b-*.log.
- verify:pr completo: código 0. Lint cero errores, 570 advertencias sin diferencias
  con baseline; grafo 2318 módulos, 9101 aristas, cero ciclos, dos referencias de
  bundler justificadas y ninguna sin resolver. docs:check: código 0, 336 documentos;
  OpenSpec estricto: código 0, 48/48. diff --check correcto.

Casos de wiring viven en tests y no dependen del archivado de OpenSpec. La
combinación de los cortes .b.4.a/.b registra treinta rutas/38 métodos sin solaparse;
no se cuenta como integración real. Las suites de handlers ejecutan sus parsers,
schemas y funciones pertinentes con repositorios simulados. No acreditan DB/RLS,
Storage, transacciones concurrentes, cookies reales o runtime de Next desplegado.

## Revisión y continuidad

Revisión propia, no independiente. Sin ampliar flags de producto, cambiar DTO,
modificar credenciales, publicar, desplegar o ejecutar generación/SQL remoto.
Trabajo heredado preservado; reversión por commit local. CI/build/QA visual y
aceptación de permisos en entorno real siguen pendientes. TD-31 queda abierto:
activar una suite adicional no demuestra que todo test compilado se ejecute.

Los cortes de composición .b.4.a/.b cubren localmente las treinta rutas delegadas,
pero el padre .7.b.2 requiere además revisar emisores posteriores al contexto.
Siguiente .7.b.2.c: inventario actual de clases de identidad/tenant, consumidores
de getAuthenticatedUser/resolveActiveTenantContext/canReviewContent y catches
reales, incluyendo capas posteriores al primer contexto y acciones fuera de
estas rutas. No cerrar .7/F1.3/TD-26 por esta cobertura de wiring. El objetivo
global conserva todas las fases y aceptación real del plan.
