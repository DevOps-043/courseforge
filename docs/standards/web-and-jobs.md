# Web, APIs y jobs

Estado: vigente. Actualizado: 2026-10-15.

- UI en apps/web/src/app y componentes de dominio; rutas HTTP en src/app/api.
- Respetar [convenciones de dominio](../../apps/web/src/domains/README.md).
- Mantener reglas en servicios/validadores y no en componentes o handlers extensos.
- Leer contratos de [API](../../apps/web/src/lib/server/api-contract.ts),
  [autorización](../../apps/web/src/lib/server/artifact-action-auth.ts) y
  [tenant](../../apps/web/src/lib/server/tenant-context.ts).
- Los jobs del pipeline viven en apps/web/netlify/functions. Preservar el contrato
  de [firma](../../apps/web/src/lib/server/background-payload-signature.ts) y
  [entorno](../../apps/web/src/lib/server/background-request-environment.ts).
- No iniciar generación pagada, render cloud o publicación como prueba sin autoridad.
- Para multimedia, leer [flujo HyperFrames](../architecture/hyperframes-composition-render-flow-source-of-truth.md)
  y [ADR motion](../architecture/adr-composition-motion-source-of-truth.md).
