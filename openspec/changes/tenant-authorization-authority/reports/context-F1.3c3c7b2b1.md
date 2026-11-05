# Continuidad F1.3.c.3.c.7.b.2.b.1 — 2026-11-05

Base dac19f4a. Alcance: verificar la frontera compartida
composition-html-authenticated-read-handler.server.ts. Once adaptadores la usan;
reconstruction-resource la instancia dos veces (lookup/read). La existencia de
imports no acredita contratos de cada adaptador o seguridad de su dominio.

La inspección detectó respuestas 503 neutrales, no-store y Vary explícito;
actor/tenant/rol se verifican antes del cliente privilegiado. No se normalizan
indiscriminadamente las factories: las escrituras tienen semántica de efectos
inciertos y política de no reintento, diferente de las lecturas.

Plan previo a cambios: añadir pruebas ejecutadas de permisos, errores de autoridad,
fallo del logger, entradas inválidas, cuota y contaminación entre organizaciones.
Usar el handler real, schemas reales y errores reales, con cliente/lectura de dominio
simulados. No acceder a DB, Storage, credenciales ni generación. Mantener el producto
si ya cumple el contrato; extender la suite de autoridad, no depender de OpenSpec.

## Evidencia

- test:auth-bridge: código 0; contrato 15/15 y autoridad 465/465, incluidas 23
  nuevas. Ejecución con Node 22 offline: código 0, 23/23.
- Dos canarios sobre la copia compilada local, nunca sobre fuentes de producto:
  retirar comparación tenant.userId/actor produjo código 1 (200 en vez de 403);
  retirar matches de resultado produjo código 1 (200 en vez de 503). Se restauró
  el archivo en finally tras cada prueba; suite restaurada código 0, 23/23.
- Logs locales .tmp/module-graph/f1-3c3c7b2b1-{auth,node22,canary-actor,
  canary-owner,restored,gate}.log. Verify:pr: código 0, lint cero errores/570
  warnings sin diferencias; grafo 2310 módulos/9059 aristas, cero ciclos y cero
  imports sin resolver (dos referencias de bundler justificadas). DB migrations:
  214 archivos con colisiones históricas congeladas; no ejecuta SQL remoto.
- docs:check final: 332 documentos; OpenSpec estricto: 48/48, código 0;
  diff --check correcto. No se ejecutó build, CI ni QA visual real.

El handler, schemas Zod, constantes de roles, correlación y clases de autoridad
son reales. Authenticate, RPC de cuota y lectura de dominio son dobles explícitos;
no prueban SQL/RLS, membresía real, rate limiting distribuido o Storage. Se prueban
roles válidos, denegaciones, errores desconocidos/impostores, filtrado previo al
authenticate, cuotas agotadas/indisponibles y contaminación de resultado entre
solicitudes del mismo handler. No se cambia código de producto porque la frontera
compartida ya satisface estos contratos; la deuda cubierta es falta de regresión
ejecutada de esta frontera dentro del script de autoridad.

hyperframes-delegated-read-topology.json conserva HEAD, hashes de las doce rutas
GET e imports de once adaptadores. La búsqueda léxica es solo topología; no sustituye
pruebas de sus schemas específicos ni integración del composition root real.

## Hallazgos y siguiente acción

La inspección de catches encontró callbacks logFailure sin protección en
composition-html-snapshot-publication-handler.server.ts y
composition-html-snapshot-recovery-handler.server.ts. Si observabilidad lanza,
puede reemplazar la respuesta segura y perderse el protocolo de resultado incierto.
Los handlers narrativos command/fragment-plan también invocan logging sin contención.
Estos hallazgos requieren reproducción y corrección focalizada, no marcar los
30 adaptadores como cerrados por la prueba del core. Siguiente unidad .7.b.2.b.2:
publicación/recuperación snapshot; después narrativa y contratos restantes.

Revisión propia, no independiente. Sin cambios de producto, secretos, servicios
reales, SQL remoto, publicación o despliegue. Se preserva trabajo heredado.
El lote de 30 rutas sigue abierto; esta evidencia no valida todos los adapters
ni los protocolos de escritura, preview con capability o comandos narrativos.
