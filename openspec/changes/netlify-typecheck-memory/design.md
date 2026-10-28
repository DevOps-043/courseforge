# Contexto y decisión

- Base: staging `5e77942e`; árbol limpio al iniciar; rama `codex/netlify-typecheck-memory`.
- Evidencia: log entregado por el usuario; compilación Turbopack exitosa y fallo fatal `Reached heap limit` durante TypeScript alrededor de 2096 MB.
- La implementación local de Next.js crea un worker TypeScript con `isolatedMemory: false`, por lo que el presupuesto Node del build se conserva.
- Usar `[build.environment].NODE_OPTIONS` en Netlify permite propagar el máximo a Next.js y su worker sin consumir configuración de funciones ni saltar comprobaciones. Presupuesto de 4096 MiB; no representa RAM total reservada ni límite agregado de procesos.
- Excluir únicamente `.tmp`, `dist`, `coverage`, `.netlify` y sus carpetas anidadas; mantener fuentes, suites y tipos generados de Next.js.
- Las advertencias de tracing requieren revisar recursos estáticos y temporales; no se silencian ni se atribuyen como causa demostrada del fallo de TypeScript.
- Reversión: restaurar configuración; no hay datos ni migraciones.
