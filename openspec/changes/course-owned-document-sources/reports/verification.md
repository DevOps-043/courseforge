# Verificación del plan — 2026-11-05

Alcance: propuesta, contexto, diseño, tareas y escenarios; no implementación de producto.

| Comando | Resultado observado |
|---|---|
| `npm run openspec:validate` | Código 0; 49 elementos aprobados, 0 fallidos, incluido `course-owned-document-sources`. |
| `npm run docs:check` | Código 0; 335 documentos verificados por el comprobador. No certifica semántica ni anclas. |
| `git diff --check` | Código 0; sin errores reportados. Los documentos nuevos estaban sin seguimiento; esta comprobación no sustituye su validación estructural. |

Revisión propia del diseño: incluye el research de Base, los filtros de cobertura tanto en UI como en worker, el mínimo histórico de fuentes, el límite de extractos PDF, la independencia del importador de temarios, versiones concurrentes y exclusión de fuentes privadas del payload público. No se presenta como revisión independiente.

Actualización tras respuesta del usuario: se sustituye la propuesta inicial de exclusivo predeterminado por elección explícita entre exclusivo y mixto en cada curso documental. Propuesta, contexto, diseño, tareas y escenarios se alinearon con esa decisión; no es una configuración aplicada al producto.

No se ejecutaron migraciones, cambios de configuración, despliegues, llamadas IA ni publicación. No se repitieron suites de producto por cambios exclusivamente documentales; los resultados de la auditoría anterior se distinguen en context.md. La aceptación operativa del diseño continúa pendiente de implementación y piloto.

## Diagnóstico de rechazo en Base

La suite `npm run test:course-sources --workspace=apps/web` terminó con código 0
y 68 pruebas aprobadas. Comprueba los cuatro códigos de rechazo con entradas
sintéticas. La prueba del worker persiste `verification` y el código esperado
en un reporte simulado, sin guardar la Base rechazada, la cita ni la explicación
del auditor. La prueba de éxito conserva el recibo de respaldo.

`npm run verify:pr` terminó con código 0. OpenSpec aprobó 57 elementos y el
arnés omitió una prueba de enlaces simbólicos porque el entorno no los permite.

El cambio usa el JSON existente del artefacto. La verificación local no
requiere migraciones ni llamadas a un proveedor de IA. La comprobación en
staging requiere desplegar el worker y consultar el reporte de un intento nuevo.

## Continuación automática de Base

- `npm run test:course-sources --workspace=apps/web`: 71 pruebas aprobadas.
  Incluye continuación de la misma ejecución, despacho duplicado y división
  de un lote cuya cita siguió siendo inválida después de corregirlo.
- `node --test scripts/test-course-source-migration.mjs`: 32 pruebas aprobadas
  en PostgreSQL aislado. Cubre aislamiento, lease vencido, extensión única,
  conservación de contadores y persistencia de motivos de salida inválida.
- `npm run verify:pr`: código 0 durante la implementación, con una prueba de
  enlaces simbólicos omitida por limitación del entorno. Tras los últimos
  cambios pasaron también lint, tipos, documentación, OpenSpec y el guard de
  migraciones. `git diff --check` no reportó errores.

No se aplicó SQL remoto ni se desplegó. El piloto en staging queda pendiente,
incluido el disparo periódico firmado en despliegues de rama y la recuperación
tras interrumpir una invocación real. El verificador final de Base conserva su
contrato y se revisará en la siguiente entrega.
