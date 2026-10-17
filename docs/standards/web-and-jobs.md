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
- Las llamadas internas a workers usan el origen inmutable del mismo despliegue,
  capturado desde `DEPLOY_URL` por `scripts/capture-background-deployment.mjs` antes
  del build en `netlify.toml`. El manifiesto generado contiene solo el origen público,
  se empaqueta con Next.js y las funciones, y no debe editarse manualmente ni
  guardar valores de un despliegue real en Git. Su valor versionado es `null`.
- No usar `URL`, `NEXT_PUBLIC_APP_URL`, headers del request ni aliases de rama para
  decidir el destino de workers. Sin captura ni `DEPLOY_URL` explícito en ejecución,
  un entorno desplegado falla; solo desarrollo directo usa `http://localhost:8888`.
  Netlify no garantiza `DEPLOY_URL` en runtime: cambiar solo la precedencia no basta.
- Desplegar mediante el comando de build de `netlify.toml`; si se sustituye en la UI,
  conservar el paso de captura. Para un build manual local, ejecutar la captura sin
  `NETLIFY=true` antes de compilar para restablecer el manifiesto a `null`.
- No iniciar generación pagada, render cloud o publicación como prueba sin autoridad.
- Para multimedia, leer [flujo HyperFrames](../architecture/hyperframes-composition-render-flow-source-of-truth.md)
  y [ADR motion](../architecture/adr-composition-motion-source-of-truth.md).
