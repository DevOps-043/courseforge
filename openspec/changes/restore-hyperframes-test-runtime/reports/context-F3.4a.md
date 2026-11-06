# Continuidad F3.4.a — 2026-11-05

Zona America/Mexico_City; responsable Codex; base 3ce00036, staging.
Estado: cerrado como prerrequisito local de runtime. Objetivo global activo;
TD-31 y matriz CI pendientes.

Entrada: test:hyperframes de F1.3.c.3.c.2 termina 1 por MODULE_NOT_FOUND en
@/lib/server/outbound-http desde composition-agent-provider.service compilado.
Se referencia exactamente el mismo módulo mediante ruta relativa, sin cambiar
el lector limitado ni las operaciones/modelos del adaptador. No hay mocks nuevos,
proveedores, generación, render, instalación ni datos de usuario.

## Hallazgo posterior a la carga

Corregir el import permite llegar al compilador de preview: una prueba esperaba
SofLIA - Engine, aunque el productor y docs/architecture/product-branding.md
derivan la etiqueta de APP_CONFIG.name (SofLIA Architect). Se valida el atributo
JSON completo decodificado contra la configuración, además de atributos html
exactos, IDs/data-var-src y ausencia de URL remota literal. No se cambia el
productor ni la marca; se elimina la dependencia de orden de propiedades HTML.

## Evidencia

| Comando | Resultado | Archivo |
|---|---|---|
| Prueba dirigida antes | 1; MODULE_NOT_FOUND | before.log |
| Resolución TypeScript de alias y ruta relativa | 0; mismo archivo físico | module-resolution.log |
| test:hyperframes tras corregir alias | 1; alcanza aserción obsoleta de marca | hyperframes.log |
| test:hyperframes tras reconciliar aserción | 0; script completo sin omitir comandos | hyperframes-final.log |
| Compilación y prueba dirigida final del agente | 0; 6/6 | model-output-final.log |
| Prueba final del compilador tras precisar límites de atributos | 0; 42/42 | compiler-final.log |
| npm run test:branding | 0 | branding.log |
| npm run lint | 0; 572 warnings, sin diferencias de huellas | lint.log |
| npm run typecheck | 0 | types.log |
| npm run verify:pr | 1; 42 ítems OpenSpec, 26 tests arnés, lint y tipos aprueban; 11 ciclos | gate.log; 2.280 archivos/582 warnings Madge |
| docs:check y openspec:validate finales | 0 / 0 | docs.log / openspec.log |
| git diff --check | 0 | Sin errores; advertencias CRLF de Git |

## Revisión y límites

Revisión propia con adversarial-review, sin independencia. Se comprobaron las dos
resoluciones contra tsconfig y las pruebas existentes del adaptador/compilador.
No se cambian versiones, dependencias, lector incremental, timeouts, límites,
payloads, proveedores, documentos ni snapshots. La aserción conserva el contrato
completo de variables; no se sustituye por un contains de marca ni se omite.

Los logs se guardan locales y este registro conserva resultados versionados.
La suite HyperFrames no acredita render real, proveedores, E2E de despliegue,
RLS ni la matriz CI de TD-31. El gate no ejecuta los pasos posteriores a ciclos.
Sin generación pagada, instalaciones, SQL remoto, publicación o despliegue.

Checkpoint local: el commit que contiene este registro reúne dos archivos de
código/pruebas y este OpenSpec. El plan principal recibe el enlace de F3.4.a y
permanece con la auditoría heredada fuera del commit. Consultar git log para el ID.
Reversión por commit, sin datos remotos. No archivar hasta integración autorizada.

Retomar F1.3.c.3.c.3 (conexiones/configuración) y F0.3 (clasificar ciclos). F3.4
conserva pendiente la matriz de cobertura, canarios y adopción CI de las suites
críticas del plan. No se cierra TD-31 por recuperar este prerrequisito.
