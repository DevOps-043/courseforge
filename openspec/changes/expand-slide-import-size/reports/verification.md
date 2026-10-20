# Evidencia — tamaño de importación HTML

Fecha: 2026-10-20. Rama `codex/fix-slide-import-modal-theme`; continuación de sus cambios visuales autorizados, preservados en el mismo checkout.

## Diagnóstico y cambios

Los 500 000 bytes se aplicaban tanto al archivo como a la familia normalizada. Se amplían a 2 000 000 bytes independientes. El JSON de transporte y los previews tienen presupuestos de 5 000 000 bytes, dejando margen frente al límite síncrono documentado de Netlify de 6 MB. Referencia: https://docs.netlify.com/build/functions/configuration/ .

El parser HTTP cuenta el stream real, admite JSON UTF-8 y cancela lecturas excesivas; Content-Length solo permite rechazo temprano. El frontend muestra el límite compartido. Se comprueba también el tamaño de la familia después de sanearla. La generación conjunta de previews normaliza una sola vez y reserva 1024 bytes para el envelope de la respuesta.

No cambian permisos, aislamiento por organización, políticas de recursos ni límites de nodos, profundidad, CSS, fragmentos o geometría del editor. Se mantienen las formas de request/response y el preflight previo al guardado.

## Validación

- `npm run test:slide-template-import` en apps/web: 22 pruebas, 22 aprobadas. Incluyen exactamente 2 MB de fuente y rechazo de un byte adicional, UTF-8 multibyte, stream excesivo sin cabecera o con cabecera falsa, JSON/UTF-8 inválidos, familia serializada excesiva y presupuesto de previews. La familia de diez diseños SVG supera 500 KB tanto en fuente como normalizada; pasa preflight y guardado/empaquetado con catálogo y storage simulados. La salida final se conserva en `apps/web/.tmp/slide-import-size-tests.log`.
- `npm run typecheck`: aprobado.
- ESLint de contrato, servicios de importación modificados, parser nuevo, componente, tests, ruta y fixture de navegador: aprobado.
- Chrome local: cuatro escenarios aprobados (claro/oscuro × 1440×1000/390×844). Cada uno carga un HTML de 600 KB, rechaza un HTML mayor de 2 MB sin enviarlo al servidor y completa revisión y guardado simulado. Se comprueban contraste, portal, Escape/foco, preview aislado, controles y acciones visibles. Cero errores de página. Evidencia en `apps/web/.tmp/html-template-import-theme-qa/result.json` y capturas del mismo directorio; inspección visual de `empty-light-1440.png`.
- OpenSpec temporal fijado a 1.8.0: `validate expand-slide-import-size --strict --no-interactive` aprobado.
- Comprobación final: docs:check aprobado (106 documentos), OpenSpec del cambio válido y `git diff --check` sin errores. ESLint final del test y fixture aprobado.
- `npm run verify:pr`: adapters:check (27), harness:validate y docs:check (105 documentos antes de este informe) aprobados. Se detiene en openspec:validate porque falta el ejecutable raíz `openspec`; no se afirma aprobación de la compuerta completa. Salida en `.tmp/expand-slide-import-verify.log`.
- La primera ejecución restringida del runner no pudo crear el subproceso Node (EPERM); se repitió con permisos. Los primeros fixtures de tamaño excedían límites independientes del editor (espacios conservados en el fragmento y demasiados números SVG); se corrigieron los fixtures sin modificar esos controles.

## Revisión y límites

Revisión adversarial del mismo agente: identidad y autorización siguen resolviéndose antes de leer la solicitud, el payload no concede organización/rol, y no hay red ni escritura remota en pruebas. No se afirma revisión independiente, build, despliegue, rendimiento de producción ni validación con un export real de Open Design.

El archivo de 600 KB del navegador contiene relleno en un script que el saneamiento elimina; demuestra admisión y limpieza, no carga visual compleja. La familia SVG de dominio sí conserva más de 500 KB de diseño y prueba la ruta editorial y el paquete. Un archivo menor de 2 MB puede seguir siendo incompatible por complejidad, fragmentos, CSS o expansión de previews.

Reversión: restaurar los presupuestos/mensajes y parser de la ruta, manteniendo el lector de diseños ya persistidos. No hay migraciones. Volver al tope anterior de familia podría impedir reutilizar nuevas familias mayores de 500 KB; conservar la lectura ampliada evita esa regresión.
