# Evidencia — CSS de OpenDesign

Fecha: 2026-10-20. Base staging `02595f95`; rama local `codex/fix-opendesign-css-import`. El archivo proporcionado se leyó desde Downloads, sin modificarlo, ejecutar sus scripts, publicarlo ni incorporarlo al repositorio. Los diagnósticos locales reducidos quedan en .tmp.

## Causa exacta

El guard global `/[\\<>\u0000]/` se aplicaba a CSS crudo antes de quitar comentarios. El framework del export contiene comentarios con `\3c style>` y `<section>`, además de tres selectores directos válidos: `.axis > span` y dos reglas ancladas por data-od-id. Todos provocaban el mismo error. Fuera de comentarios, los únicos caracteres que activaban ese guard en este archivo eran esos tres `>`.

Se eliminan los comentarios después del parseo/presupuesto y antes de rechazar escapes activos, `<` y NUL; `>` deja de estar prohibido globalmente. Se mantienen los controles de recursos, escapes activos, selectores, complejidad y editor. La suite incluye regresiones de código escapado, URLs de red, HTML activo y NUL.

## Incompatibilidades adicionales encontradas

- El export contiene 16 diapositivas; el importador admitía 12. El límite central pasa a 24, conservando límites de bytes, campos, nodos y respuesta.
- El perfil eliminaba data-od-id del HTML aunque dos reglas lo necesitaban. Se preserva la relación visual mediante el alias data-cf-design-id en atributos y selectores. Mantener el prefijo original habría activado el guard independiente de residuos de controladores del productor editorial; se usa un alias sin modificar ni relajar ese guard.
- El editor requiere CSS estático acotado. El diagnóstico independiente encuentra `font:18px/1.5 ...`, otros shorthand de fuentes, `width:calc(var(--v) / var(--max) * 100%)`, medidas de viewport en reglas auxiliares y transformaciones/bordes inline que el perfil no admite. No se ha implementado su normalización ni se han relajado los límites editoriales. Los 16 layouts siguen rechazados por preflight: esto es un resultado negativo observado, no un guardado exitoso.

## Resultado con el archivo real

- Original: 22 850 884 bytes.
- Preparación final: 57 064 bytes (incluye las anclas visuales que antes se perdían).
- Retirados localmente: 3 scripts, 16 recursos y 7 URLs CSS.
- Análisis: 16 diseños. Respuesta serializada con previews: 520 029 bytes.
- Referencias a anclas visuales internas en el diseño: 169; referencias data-od-id de controlador: 0.
- Preflight por layout: 0 compatibles y 16 rechazados. No se escribieron BD, storage, paquetes remotos ni revisiones.
- Resumen reproducido con los servicios compilados reales en `.tmp/highlands-compatibility.json`. Las primeras pruebas preparaban 50 756 bytes porque omitían anclas; no se presenta esa cifra como resultado final.

## Verificación

- `npm run test:slide-template-import`: 32 pruebas aprobadas. Nuevos casos: comentarios con escapes + combinadores, rechazo de escapes activos/HTML/NUL, anclas visuales sin identidad editable y familias de 16/24 diseños con rechazo de 25. Salida `apps/web/.tmp/opendesign-css-tests.log`.
- `npm run typecheck`: aprobado. Salida `.tmp/opendesign-css-typecheck.log`.
- ESLint dirigido a servicios/contrato/test modificados: aprobado.
- `npm run verify:pr`: adapters (27), arnés y documentación (114 documentos antes de este informe) aprobados. Se detiene porque falta el ejecutable raíz openspec. Salida `.tmp/opendesign-css-verify-pr.log`; no se afirma compuerta completa aprobada.

## Límites y reversión

La revisión la hizo el mismo agente; no se afirma independencia. No hubo build, QA visual nueva, render cloud, despliegue ni validación remota. Las pruebas de compilación editorial usan los componentes reales en Node; el rechazo del archivo real queda documentado explícitamente.

Revertir sanitizer, alias visual y límite restaura el perfil anterior, pero volver a 12 puede impedir leer familias nuevas de 13–24 diseños. No hay migraciones. La mejora posterior necesaria para guardar este export es un adaptador que normalice fuentes y geometría al perfil editorial con validación de fidelidad; no basta con retirar guardas.
