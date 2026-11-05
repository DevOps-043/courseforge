# Continuidad F1.3.c.3.c.7.b.2.b.4 — 2026-11-05

Base e22013bd. Plan previo: verificar composición de las rutas delegadas HTML
con authenticate inline, sin confundir el callback con ejecución del handler.
Usar las fuentes reales de rutas, políticas puras de rollout reales y factories
interceptadas para inspeccionar dependencias; bloquear clientes y dominio.
Exigir identidad/tenant actuales, propagación de errores y reenvío de params.
Probar flags cerrados por defecto y recuperación GET independiente de writes.

Ejecutar también suites reales de handlers editoriales/preview ya existentes,
incorporando las que falten al comando canónico. Las pruebas del composition root
no acreditan lógica de factory; sus suites tampoco acreditan DB/Storage reales.
Preview/capabilities y roots compartidos se mantienen pendientes donde no haya
evidencia específica. No cambiar flags de producto para hacer pasar pruebas.

## Alcance de .b.4.a y evidencia

Veinte rutas con authenticate inline, 27 métodos. Los casos propios de tests
contienen ruta, método y factory esperada. El fixture intercepta factories y
bloquea dominio/clientes; carga fuentes reales y doce módulos puros de políticas
reales con process.env sintético. No lee configuración local. No se cambia
producto porque no se demostró defecto en este cableado.

109 tests nuevos: corte 20/27 y cuatro casos por método: reenvío exacto de request
y params a factory esperada, identidad/tenant actual entre solicitudes y usuario
ausente, dos clases reales por identity/tenant (108 combinaciones de propagación),
rollout cerrado con flags estrictos y recuperación GET sin flags de escritura.
No probar el rol aquí: es responsabilidad de la factory, no del callback.

Primer test:auth-bridge, código 1: 27 fallos por comparar prototipos de objetos
entre VM y host con deepStrictEqual. Se corrigió la aserción del DTO sin usuario
para comparar actorId y tenant directamente; producto intacto. Última ejecución:
código 0, contrato 15/15 y grupo de autoridad 574/574 (109 nuevas).

Dos canarios sobre una ruta de anchor originalmente sin cambios: actor forjado
y enabled constante true. Cada canario produjo código 1, 107/109 tests aprobados,
con los dos métodos GET/POST detectando la regresión. Bytes restaurados en finally
y hash original verificado tras cada canario. Suite restaurada: código 0, 109/109.
No quedaron cambios de producto en rutas. Los canarios no prueban todas las
mutaciones posibles ni integración con Next/DB.

hyperframes-html-http-suite-inventory.json conserva HEAD base y hashes de las 22
suites que importan handlers HTTP HTML/generated-deck: dos ya ejecutadas y veinte
activadas ahora en test:hyperframes. No hay dependencia de ese reporte en runtime.
El script completo dio código 0; primer grupo 314 tests (118 anteriores y 196
activados). Ejecutar los 22 archivos por separado con Node 22 junto con las 109
pruebas de composición: código 0, 336/336 (227 de handlers y 109 de composición).
No confundir tests anidados con número de archivos o suites de Node.

Logs locales .tmp/module-graph/f1-3c3c7b2b4-{auth,auth-final,hyperframes,node22,
canary-actor,canary-rollout,restored,gate}.log. verify:pr completo: código 0;
lint cero errores, 570 advertencias sin diferencias con baseline. Grafo 2315
módulos, 9091 aristas, cero ciclos, dos referencias de bundler justificadas y
ninguna sin resolver. docs:check final: 335 documentos; OpenSpec estricto 48/48;
ambos con código 0. diff --check correcto. No se cambió producto.

## Límites y continuidad

Las pruebas de wiring no ejecutan factories ni sus schemas/servicios. Las suites
de handlers sí ejecutan HTTP/parser/políticas y funciones de dominio pertinentes,
pero simulan persistencia/proveedores. Su cobertura no acredita aislamiento real
en DB/Storage, membresía con cookies, render cloud o concurrencia de producción.
Revisión propia, no independiente. Sin secretos, servicios reales, SQL remoto,
generación, publicación o despliegue; sin aceptación de CI/build/QA visual.
Trabajo heredado preservado; reversión por commit local.

El padre .b.4 permanece abierto. Próxima .b.4.b: los diez roots compartidos/once
métodos restantes del inventario de treinta rutas: cinco de narrativa, dos de
reconstruction (incluyen GET/POST de links) y tres de preview (página, renovación
y recursos capability). Acreditar cableado y políticas reales sin usar pruebas
de core como sustituto; después completar emisores posteriores al contexto y
aceptación real. TD-31 no se cierra por activar solo veinte suites.
