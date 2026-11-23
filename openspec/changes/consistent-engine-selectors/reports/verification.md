# Verificación de selectores

Fecha: 2026-11-23. Base: `dc38bd84`, árbol limpio al inicio. Cambio local en el checkout principal.

## Cobertura

- Se migraron 68 controles nativos y el selector propio del plan instruccional. `rg -n '<(select|option|optgroup)\b' apps/web/src -g '*.{tsx,jsx}'` finalizó con código 1, correspondiente a cero coincidencias.
- El selector de duración comparte implementación entre creación global, creación por empresa, plan y revisión de materiales. Los modos de entrega, opciones de clip, filtros, enlaces a IDs y grupos de fuentes mantienen su contrato de datos.
- Se revisaron también los menús de acciones y la navegación desplegable. Sus superficies y acentos ya usan los tokens del sistema. El diseño de los selectores se registra en el [contexto operativo](../../../../docs/architecture/system-context.md#patrones-importantes).
- Se contrastó README y el contexto con las rutas y componentes que cambiaron. `npm run docs:audit` completó el inventario generado.

## Navegador local

- La [prueba del selector](../../../../apps/web/tools/qa/engine-select.smoke.mjs) pasó en Chrome con la hoja global real, tema claro y oscuro a 1365 y 390 px. Cada tema se probó con la preferencia del sistema opuesta. Se confirmó el cambio de duración, la opción Personalizado, nombre y estado accesibles, grupos, opciones deshabilitadas, flechas, Inicio, Fin, selección por teclado y clic o toque, cierre exterior, Escape dentro de un diálogo, avance con Tab y posición del menú sobre el control cerca del borde inferior.
- La QA de la barra de composición pasó en Edge en seis anchos, con inspector abierto y cerrado. La primera ejecución encontró un solapamiento a 390 px. Se recuperó el ancho compacto previsto por la barra y se ajustó el espaciado interno del disparador.
- Pasaron las pruebas de reemplazo de medios y capas con los selectores migrados. La prueba unitaria del teclado del panel pasó sus seis casos, incluido Escape con un selector desplegado.
- Capturas locales en `apps/web/.tmp/engine-select-qa/duracion-{light,dark}-{1365,390}.png`.

## Compuerta y suite de dominio

- `npm run verify:pr` completó la compuerta con código 0. OpenSpec validó 50 elementos. Lint registró 0 errores y 0 diferencias con el baseline de 570 advertencias.
- `npm run test:hyperframes -w apps/web` y `git diff --check` completaron con código 0.

## Revisión y límites

La revisión del mismo agente siguió los callbacks de selección, la validación de campos obligatorios y el guardado por clic o teclado en el inspector. Se contrastó la semántica del control con la referencia de combobox de selección única. [Guía WAI-ARIA](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/examples/combobox-select-only/).

Las pruebas visuales montaron componentes reales con datos de prueba y cubrieron una muestra de flujos. La verificación de accesibilidad se limitó a semántica, foco y teclado en navegador. Pendientes de integración: visualización en un despliegue con sesión y pruebas con lectores de pantalla.

## Integración local en staging

Se resolvieron cinco conflictos al integrar `94bc0c65` sobre `f1f268d0`. El formulario compartido de modalidad de staging conserva sus tarjetas y ayudas, y usa `EngineSelect` en enfoque y relación con las lecciones asíncronas. El editor de contenido y la entrega hacia Academy y Hub conservan sus controles de revisión, sus estados de carga y el bloqueo cuando falta una selección. La biblioteca de composición conserva `next/image` y los nuevos selectores.

- `npm run typecheck` y las 70 pruebas de `npm run test:course-delivery` pasaron. La prueba del selector pasó en los cuatro escenarios de Chrome. Una prueba local de los componentes reales verificó la configuración híbrida, la selección de sesiones y el comando de entrega con un controlador simulado.
- Se retiró del baseline una advertencia de curación que ya no aparecía en staging. Tras ajustar el bundle aislado para la configuración de `next/image`, la prueba de medios pasó en Edge con filtros, reemplazo, revinculación y deshacer/rehacer.
- La segunda ejecución de `npm run verify:pr` terminó con código 0. OpenSpec validó 65 elementos y lint registró 0 errores y 0 diferencias con el baseline. La comprobación documental se repitió después de conciliar el contrato de entrega.
