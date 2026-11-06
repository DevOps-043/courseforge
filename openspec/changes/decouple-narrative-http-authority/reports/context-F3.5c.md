# Continuidad F3.5.c — 2026-11-05

## Base y resultado

Base 5da052824e5a0f0ef7c4703ff36f081503ee405d en staging. El grupo HTTP narrativa
queda resuelto localmente mediante un contrato de tipos neutral. El grafo pasa
de ocho a siete recorridos y de dos a una componente, ahora solo QA. TD-12 y el
objetivo global conservan todos sus criterios pendientes.

## Cambio y compatibilidad

La unión NarrativeExtractionHttpAuthorization se traslada literalmente al nuevo
composition-narrative-http-authorization.contract.ts. Los cuatro consumidores
de implementación usan import type desde ese contrato. El adaptador de voz
conserva el export anterior mediante reexport de tipo; sus interfaces públicas
y todos los consumidores compilan sin cambios.

No se agregaron estados, grants, lecturas o efectos. AUTHORIZED sigue exigiendo
organizationId/userId y los rechazos siguen siendo AUTH_REQUIRED, TENANT_FORBIDDEN
y ROLE_FORBIDDEN. Las decisiones del servidor, 401/403, rate limit, cancelación,
idempotencia, apply/recovery y errores de dependencia permanecen iguales. Esto
no completa los lotes HTTP de autoridad de F1.3 ni acredita SQL/RLS.

verify-type-extraction.mjs compara la unión AST con la base y transpila los
cuatro módulos modificados: JavaScript CommonJS idéntico byte a byte. Los hashes
se conservan en narrative-emission.log. El nuevo contrato solo exporta un tipo
y carece de imports de implementación. No se añade runtime a sus consumidores.
La comprobación es CommonJS de TypeScript, no comparación del bundle de Next.

## Verificación y límite de scripts

Salidas completas locales en .tmp/module-graph.

| Comprobación | Resultado | Evidencia |
|---|---|---|
| verify-type-extraction.mjs con SHA base | 0; cuatro emisiones idénticas y unión igual | narrative-emission.log |
| npm run test:hyperframes -w apps/web | 0; script completo existente | narrative-hyperframes.log |
| node --test, cinco archivos compilados indicados abajo | 0; 59/59 | narrative-targeted.log |
| npm run db:migrations:check | 0; 214 archivos, colisiones históricas congeladas; solo guard de versiones | narrative-migrations.log |
| Madge API + Tarjan | 0; 2.287 archivos, siete recorridos, 582 avisos y una componente QA; cero componentes narrativas | narrative-graph.log/json |
| npm run verify:pr | 1 solo por siete ciclos; arnés 26/26, OpenSpec 46/46, lint cero errores/572 warnings sin diferencias y tipos aprobados | narrative-gate.log |
| npm run docs:check | 0; 313 documentos | narrative-docs.log |
| npm run openspec:validate | 0; 46/46 | narrative-openspec.log |

La ejecución dirigida usa estos archivos de
apps/web/.tmp/hyperframes-tests/domains/production/composition-editor/__tests__:

- composition-narrative-extraction-http-handler.test.js
- composition-narrative-fragment-http.test.js
- composition-narrative-fragment-command-http.test.js
- composition-caption-effects.test.js
- composition-generated-deck-fonts.test.js

El script test:hyperframes compila estas fuentes pero no ejecuta ninguno de
esos cinco archivos. Se comprobó el contenido real de package.json; por eso se
ejecutaron aparte tras finalizar su compilación. Cubren permiso/tenant/rol,
origen y body, rate limit, abortos y estados inciertos de narrativa, además de
captions y referencias tipográficas. Se corrige el registro F3.5.b: su prueba
readonly se ejecutó aquí, no dentro del script anterior. La cobertura faltante
del script/gate sigue siendo parte de F3.4/TD-31; no se presenta como resuelta.

El grafo API conserva las entradas apps/web/src y apps/web/netlify/functions,
extensiones ts/tsx y tsconfig del gate. Tarjan es el de F0.3; comprueba todas las
componentes y no solo la lista de recorridos de Madge. No cambian versiones,
scripts o ignores del analizador.

## Revisión adversarial propia y continuidad

Revisados todos los usos del tipo y su reexport público. No se derivan permisos
del payload ni se modifican clases de error, credenciales o repositorios. No se
agregan tests que reflejen únicamente el traslado: emisión, typecheck y suites
existentes demuestran compatibilidad y escenarios de autorización con
dependencias simuladas. No es revisión independiente ni validación RLS remota.
Sin servicios externos, secretos, SQL, build, CI, publicación o render cloud.

Reversión: revertir el commit local F3.5.c. Los cinco documentos heredados y la
auditoría/plan se preservan fuera del commit. Próxima unidad F3.5.d1, contratos
de QA de ejecución/materialización/supervisor; inspeccionar aristas completas y
consumidores antes de extraer. Después F3.5.e debe corregir el resolvedor con
canarios y conservar visibles referencias de bundler. También siguen pendientes
los lotes de autoridad y todas las fases restantes del plan principal.
