# Verificación de cambios

Estado: vigente. Actualizado: 2026-10-15.

- Infraestructura de agentes: npm run verify:harness.
- Entrega de PR: npm run verify:pr, que añade la secuencia existente npm run verify.
- Tipos web: npm run typecheck; tipos API: npm run lint:legacy-api.
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
