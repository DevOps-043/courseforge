# Evidencia de validación

Fecha: 2026-11-24, America/Mexico_City.

## Diagnóstico observado

Staging: curso dca8d686-2c8a-413f-b4a6-5b1e4b187547, borrador 8b526a02-8bcc-4702-88a0-f233adc3aafb. El preview devuelve INVALID_REQUEST por assets sin vínculo al borrador. Correlación de diagnóstico: 74397e75-7101-45a1-b788-cc90a0beb587. Se accedió mediante la sesión existente del navegador, sin leer credenciales ni realizar SQL manual.

## Validación local

- `npm run test:assembly-stability`: 19 pruebas aprobadas. Cubre continuidad del nodo del editor durante actualización, alcance equivalente, respuesta tardía, error temporal, recuperación idempotente de imágenes y rechazo de tenant/hash/registro/alias inválidos. La prueba de inicialización repetida comprueba que la limpieza no retire las imágenes.
- `npm run test:hyperframes -w apps/web`: 707 pruebas aprobadas, cero fallos.
- `git diff --check`: aprobado.
- `npm run verify:pr`: código 0, compuerta completa. Lint: cero errores, 558 advertencias existentes y cero diferencias con la línea base. Tipos, arquitectura, migraciones locales, arnés y pruebas de producto/seguridad aprobados.
- `npm run docs:check`: 492 documentos; enlaces locales aprobados.
- `npx openspec validate fix-assembly-editor-stability --strict --no-interactive`: válido.

Una primera ejecución del arnés falló al buscar un archivo bajo la ruta temporal del sandbox. Se repite con TEMP/TMP de proceso dentro del workspace, sin cambiar la prueba. Lint detectó la huella modificada de una advertencia existente; se mantuvo la línea original de carga y se separó la invalidación de respuestas en su efecto propio. No se amplió ni editó la línea base. Una prueba nueva de orquestación requirió completar un mock de filtrado; la suite dirigida final pasó con todas sus aserciones.

## Revisión adversarial

Revisión del mismo agente, no independiente. Se conserva la autorización previa por composición/organización, el lector con hashes y registro de imágenes, y la validación propia de preview/snapshot. Un alias sin vínculo y sin artefacto verificable no concede acceso. Las imágenes se vinculan antes de reconciliar/persistir el documento; un error de escritura impide acreditar éxito. El contenido editable, hashes de documento, recorrido y proveedores no se modifican mediante la recuperación. No se añaden tablas, políticas ni secretos.

Las pruebas del contenedor ejecutan sus hooks con fronteras simuladas; no acreditan por sí solas el comportamiento visual de React en el navegador. El piloto desplegado debe comprobar monitor, interacción, cambio de foco y persistencia de selección sin reinicio.

## Staging

Commit de código `2e2d1d4b`, subido a staging indicando directamente el usuario Pedro-Echeverria01. Netlify identificó ese usuario y commit; despliegue 6b0598f81893314e63e62f92 completado correctamente.

Piloto mediante una pestaña nueva del mismo taller y sesión existente:

- Ensamble abre sin el aviso superior de Academy.
- Se recuperó el mismo borrador y la misma versión/hash de documento; no se recrearon los materiales.
- El monitor mostró las diapositivas y habilitó Reproducir, sin errores en la consola consultada.
- Reproducir avanzó el cursor a 00:01; Pausar funcionó.
- La pestaña Guion abrió sus 21 escenas. La URL del iframe mantuvo el mismo borrador, hash y generación r=1 entre esas acciones.
- Se tomó una captura visual del monitor durante la sesión de herramientas; no se exportó a un archivo del repositorio.

La prueba real de pérdida/recuperación de foco y una observación prolongada quedan pendientes. Al preparar el control nativo de Chrome, la herramienta detuvo Computer Use porque no pudo verificar la URL activa en Windows con confianza suficiente para aplicar su política. No se intentó eludir ese límite ni controlar el navegador con otra tecnología. No se afirma que este piloto parcial descarte todos los posibles reinicios.

No se generó contenido de HeyGen, avatar, locución ni video final. No se publicaron cursos ni se ejecutó SQL manual. Los logs de desarrollo quedan ignorados en `.tmp/assembly-stability-*.log`. La enumeración de cuentas guardadas fue rechazada por revisión automática; el acceso y push posteriores usaron directamente el usuario solicitado sin enumerar ni leer credenciales.
