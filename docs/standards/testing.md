# Verificación de cambios

Estado: vigente. Actualizado: 2026-10-15.

- Infraestructura de agentes: npm run verify:harness.
- Entrega de PR: npm run verify:pr, que añade la secuencia existente npm run verify.
- Tipos web: npm run typecheck; tipos API: npm run lint:legacy-api.
- El comando de tipos web fija un heap máximo de 4 GiB por proceso, igual que el
  límite del build Netlify. La compilación fría con Node 22 agotó el límite
  automático cercano a 2 GiB; no se omiten fuentes ni comprobaciones para evitarlo.
- Lint web: npm run lint. Conserva el reporte completo en
  apps/web/.tmp/lint/latest.json y compara warnings por archivo/regla y huella
  de la línea de código con
  apps/web/eslint-warning-baseline.json. Un incremento falla; una reducción exige
  retirar tolerancias obsoletas del baseline. Sustituir un warning por otro
  también falla aunque el conteo permanezca igual; moverlo de línea conserva
  su identidad. Los errores siempre bloquean.
  test:harness incluye canarios de configuración y reglas. El baseline no acredita
  ausencia de deuda ni autoriza aumentar warnings para pasar la compuerta.
- Grafo: npm run architecture:cycles usa scripts/quality/check-module-graph.mjs.
  Conserva las opciones parseadas de TypeScript y su base absoluta para resolver
  alias, incluyendo dependencias de tipos. Los ciclos y referencias desconocidas
  bloquean; Tailwind CSS y server-only solo se clasifican cuando sus recursos del
  bundler instalado existen. El reporte completo queda en .tmp/module-graph/latest.json
  con versiones, hashes, estado Git, grafo y clasificación. test:harness incluye
  canarios reales de alias, ciclos de tipos, imports ausentes y recursos de bundler.
  Sin argumentos analiza las dos entradas canónicas; --entry/--tsconfig juntos
  permiten diagnósticos acotados y --report separa sus salidas. Esos reportes
  registran su alcance y no sustituyen la verificación completa del proyecto.
- APIs/tenancy: npm run test:security-boundaries; login:
  npm run test:auth-bridge --workspace=apps/web.
- Remotion: npm run test:remotion --workspace=apps/web. Verificar que un script
  exista antes de elegirlo: apps/api no ofrece test:remotion.
- HyperFrames: npm run test:hyperframes --workspace=apps/web y QA proporcional.
- Curación: npm run test:curation --workspace=apps/web.
- Audio: npm run test:audio-processing; workers opcionales tienen pruebas propias.
- El CI conserva QA visual, compliance, build y audit adicionales a verify:pr.
- Las suites de producto compilan con tsc y ejecutan Node desde .tmp; no usar
  sintaxis de Jest/Vitest ni ejecutar tests que dependan de servicios reales sin permiso.
- No hay suite única npm test de producto. test:harness usa node --test para scripts.
- Mantener códigos de salida, límites y línea base. No declarar verde lo no ejecutado.
