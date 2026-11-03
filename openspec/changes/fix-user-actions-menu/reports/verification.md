# Evidencia del menú de usuarios

Fecha: 2026-11-03.

## Causa y alcance

`engine-design-system.css` aplica `engine-content-enter ... both` a `.engine-content`; el último frame conserva `transform: translateY(0)`. UsersTable renderizaba su menú fijo dentro de ese ancestro usando coordenadas obtenidas de `getBoundingClientRect`. El portal elimina esa discrepancia sin cambiar el layout global.

Se modificó UsersTable, se añadió UserActionsMenu y se incorporó `apps/web/tools/qa/user-actions-menu.smoke.mjs`. Los contratos y decisiones quedan en este cambio. La ruta global y la ruta por empresa comparten UsersTable. No se modificaron API, roles, permisos ni persistencia.

## Verificaciones

- TypeScript: `npm run typecheck` pasó, incluida la segunda ejecución con la referencia final del disparador.
- ESLint de UsersTable.tsx, UserActionsMenu.tsx y el smoke: código 0, sin advertencias tras pasar el objeto ref en lugar de leerlo durante render.
- QA: `node apps/web/tools/qa/user-actions-menu.smoke.mjs <runtime-node-modules>` pasó con Chrome local; cuatro escenarios, claro/oscuro a 1365×768 y 390×844; cero errores de página. Se montó el componente real dentro de `.engine-content` con CSS del producto y se esperó el final de la animación que conserva la transformación.
- Se verificaron portal a body, coordenadas junto al botón, límites de ventana, foco inicial, apertura por Enter, cierre por Escape/clic exterior/scroll/resize, apertura del diálogo y valor de identidad correcto para primera y última fila. No se pulsó Guardar ni se modificaron usuarios.
- Capturas locales: `apps/web/.tmp/user-actions-menu-qa/{light,dark}-{1365,390}.png`; resultados en `result.json`. Inspección visual de claro/escritorio y oscuro/móvil: menú legible y junto al disparador.
- `npm run verify:pr`: adapters:check (27), harness:validate y docs:check (226 documentos) pasaron. OpenSpec: 33 aprobados, 1 fallido; `fix-user-actions-menu` pasó. La compuerta se detuvo en `diagnose-font-catalog`, cambio existente sin delta de especificación. No se ejecutaron las etapas posteriores de esa compuerta ni se debilitaron sus reglas.
- `git diff --check`: código 0.
- Comprobación documental final: `npm run docs:check` pasó con 227 documentos.

## Límites y revisión

La QA es local con ocho identidades ficticias y CSS real; no acredita una sesión ni despliegue en staging, persistencia remota, contraste formal de toda la pantalla ni carga de usuarios. La primera ejecución de QA buscaba la identidad como texto, aunque el nombre está en un input; se corrigió la aserción al valor real. La siguiente encontró un cierre por el scroll automático del navegador antes de pulsar en móvil; el fixture ahora termina ese desplazamiento antes de hacer clic. La versión final pasó en los cuatro escenarios.

Revisión del mismo agente: identidad seleccionada conservada, ninguna operación de escritura añadida, desmontaje del menú antes del diálogo, foco devuelto al disparador y listeners existentes con limpieza. Tab y navegación por flechas están implementados; la QA automatizada ejercita Enter y Escape. Revertir los dos componentes revierte la corrección sin migraciones. La publicación está pendiente y no se realizó ninguna operación remota.
