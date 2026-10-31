# Resolución del merge de exportación con latencia y agrupaciones

Fecha: 2026-10-31. Rama: `staging`.

## Estado inicial y propósito

HEAD `1869d2d6` ya integra edición local inmediata, grupos anidados, branding y
bucle de video. MERGE_HEAD `d8cafb0a` incorpora la exportación individual y la
regla de trabajar sin worktrees. Git marcó tres archivos y ocho bloques en
conflicto. Se guardaron los archivos originales y el índice en
`.tmp/merge-export-latency-20261031/` antes de resolver.

## Decisiones e impacto

| Archivo o contrato | Resolución | Motivo |
| --- | --- | --- |
| Importaciones del preview | Conservar `CompositionLocalEdits` y añadir los controles de exportación | La proyección inmediata y la descarga cumplen funciones distintas |
| Inspector, selección y transiciones | Mantener los props de staging | Conserva bloqueos de recuperación, capacidad de grupos y contexto al limpiar selección |
| Controles de intervalo | Añadir los entrantes usando `localEditingBlocked` y el bloqueo de pista | Habilita recortar/descargar sin omitir los bloqueos del editor actual |
| Scripts de autoguardado | Conservar la versión de staging | Incluye `composition-local-edits.test.js`, ausente en la rama entrante |
| Scripts HyperFrames | Conservar staging y sumar la prueba de exportación | No retirar cobertura de ninguno de los cambios |
| QA y comandos individuales | Conservar comandos de grupos y añadir los de clips | Ambas capacidades mantienen reproducción independiente |
| Fuente de verdad | Acumular contratos e historial y conservar la nota de latencia con grupos | Evita documentación incompatible con el código combinado |

Aceptar todo el lado entrante perdería el modelo de edición local y sus bloqueos.
Aceptar todo staging eliminaría el montaje y las pruebas de descarga. Se combinan
los cambios según su propósito; no se reemplaza el archivo completo por una rama.

## Corrección semántica adicional

`CompositionSaveQueue.whenIdle()` también se resuelve si falla un comando y se
cancela su cola. Con edición local inmediata puede quedar una proyección o
recuperación pendiente. Esperar la cola por sí solo no acredita un clip guardado.

La preparación de fuente se encapsula en `prepareClipExportSource`, dentro del
módulo cliente de IO ya existente: vacía autoguardado, espera la cola, lee el
estado vigente y rechaza cambios pendientes. El host proporciona el estado real
desde sus refs y los registros de recuperación; se evita usar estado de React
capturado antes de la espera. Se captura una copia del clip confirmado.

Se añaden dos regresiones que usan las clases reales de edición local y cola:
confirmar un recorte conserva sus offsets al exportar, y una cola vacía tras un
fallo no habilita descargar la proyección sin confirmar. No se cambia el contrato
de persistencia, la autoridad del cliente ni el codificador multimedia.

## Validaciones

| Verificación | Resultado |
| --- | --- |
| Compilación HyperFrames | Salida 0 |
| Cinco archivos: edición local, exportación, grupos, autoguardado y selección | 57 pruebas aprobadas, incluidas las dos nuevas |
| Cola y journal de recuperación | 8 pruebas aprobadas |
| Tipos de la aplicación completa, heap de 4 GiB | Salida 0 |
| ESLint de host, controles, preparación de fuente y regresiones | Salida 0 |
| QA Chrome de exportación | MP4/WAV reales y descarga desde controles React aprobados; cancelación y codificador incompatible comprobados |
| QA Chrome de grupos | Selección aditiva, capacidad, dos niveles, navegación, Escape y desagrupación aprobados |
| OpenSpec de exportación y de grupos | Ambos válidos en modo estricto |
| Adaptadores | 27 verificados |
| Enlaces documentales | 176 documentos verificados |

Son resultados de esta resolución; no se reutilizaron salidas históricas como
evidencia de nuevas ejecuciones. Los archivos de Chrome se generaron en un
directorio nuevo. No se ejecutaron build ni CI ni una sesión autenticada contra
Storage real. Los smokes de navegador usan medios y documentos sintéticos.

## Límites y entrega

La descarga conserva los límites de diez minutos y 256 MiB, formatos MP4/WAV y
cancelación. No aplica motion, color ni mezcla del ensamble ni exporta bucles,
velocidad o congelación no representables. El bucle del preview permanece intacto.
No se cambian las dos migraciones ni la habilitación de agrupaciones.

Revisión del mismo agente, sin atribuir independencia. No se ejecutan SQL remoto,
render cloud, despliegue ni publicación. La resolución se deja preparada para que
el usuario revise y confirme el merge; no se crea commit ni se hace push de staging.
