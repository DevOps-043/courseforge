# Continuidad F1.3.c.3.c.7.b.2.b.3 — 2026-11-05

Base 81e12e7a. Antes de modificar producto: reproducir el fallo de observabilidad
en command narrativo compartido y fragment-plan. Ambos catches llaman callback
o logger por defecto sin protección. Preservar clasificación de error, correlación,
requestNotApplied, recoveryRequired, commandId y ausencia de reintento automático.

Plan: usar suites HTTP existentes de extracción, fragment-command y fragment-plan;
añadir errores reales de autoridad y fallo posterior al dominio junto a logger
roto. Simular console.error solo durante la llamada para probar logger real por
defecto, restaurarlo en finally. Incorporar las tres suites a test:hyperframes:
en la base se compilan pero no se ejecutan desde ese script (TD-31 parcial).
Aplicar contención local, sin cambiar persistencia/servicios de dominio.

## Reproducción y cambio

Compilación inicial correcta. Antes de cambiar producto, ejecución explícita de
las tres suites: código 1, 65 pruebas; 35 previas pasan y las 30 nuevas fallan
con CANARIO_PRIVADO_LOGGER saliendo del catch. Log local
.tmp/module-graph/f1-3c3c7b2b3-before.log. No se relajaron expectativas.

Contención local del callback y creación/escritura del logger por defecto en
dos catches. No cambiar clasificación de errores de dominio previa al logging,
estado mayHaveCommitted, comando validado, flags o selección de mensaje seguro.
No hay log secundario, reintento o compensación nueva. El contrato del callback
es síncrono void; la prueba cubre excepciones síncronas, no rechazos de Promises
de un callback fuera de ese contrato.

Las 30 nuevas: extracción y fragmento, APPLY/RECOVERY, dos clases reales de
autoridad y error de dominio por ambos canales de logging (24); plan read-only,
las dos clases y fallo del repositorio por ambos canales (6). Antes del dominio
se exige cero cargas/recibos/commits. Después se exige una sola lectura de recibo
o commit, commandId, recoveryRequired true, requestNotApplied false y ausencia
de reintento. En extracción APPLY se usa commit que falla y la clase real
NarrativeExtractionCommitUnconfirmedError producida por el servicio.

## Evidencia local

- test:hyperframes completo: código 0. Primer grupo: 118 pruebas, cero fallos,
  incluidas 65 de estas tres suites y las 53 ya ejecutadas del grupo anterior.
- Node 22 offline sobre las tres suites: código 0, 65/65.
- docs:check: código 0, 334 documentos; OpenSpec estricto: código 0, 48/48.
- verify:pr completo: código 0; lint cero errores, 570 advertencias sin diferencias
  con baseline. Grafo 2311 módulos, 9072 aristas, cero ciclos, dos referencias de
  bundler justificadas y ninguna sin resolver. Logs locales prefijo
  .tmp/module-graph/f1-3c3c7b2b3-. diff --check correcto.

Se usan handlers, schemas, parser, servicios puros y logger por defecto reales.
La salida console.error se sustituye solo durante la petición y se restaura en
finally, igual que el callback. Tests secuenciales dentro del archivo; Node aísla
procesos entre archivos. Authenticate, rate limiting y repositorios son dobles;
la prueba no acredita Auth Bridge con cookies, SQL/RLS, concurrencia real o
atomicidad del repositorio. No afirma que el commit haya ocurrido ni se haya
revertido: exige que se conserve incertidumbre y recuperación por recibo.

## Revisión y continuidad

Revisión propia, no independiente. No cambiar DTO, namespaces, cuotas, tablas,
schemas de dominio, políticas de rollout, motion, Storage o integración del
route. Reversión por commit local. Trabajo heredado conservado. No ejecutar
DB/Storage reales, generación, publicación o SQL remoto. CI/build/QA visual
no observados; TD-31 no se cierra por activar solo tres suites.

Siguiente unidad .7.b.2.b.4: completar contratos de adaptadores delegados HTML
editoriales y preview/capabilities, acreditando composición real y flags de
rollout sin ampliar acceso. No dar por cerradas las 30 rutas por pruebas de un
core compartido. Después completar emisores posteriores al contexto y aceptación
real; .7, F1.3 y el objetivo de todas las fases permanecen abiertos.
