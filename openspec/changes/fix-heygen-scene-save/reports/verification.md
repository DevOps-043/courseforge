# Evidencia de guardado de escenas

Fecha: 2026-10-17. Rama: codex/fix-heygen-preset-handoff. Base: 64606f73.

## Diagnóstico comprobado y límite del reporte

El usuario no cuenta con el detalle de qué sucede al pulsar Guardar cambios.
La captura muestra el botón pero no acredita una respuesta HTTP ni persistencia.
No se inspeccionaron datos, logs remotos, credenciales ni configuración personal.

Antes del cambio, se ejecutó el schema compilado con un clip manual de guion
vacío (el mismo estado que produce createManualSceneClip). Resultado:
`success:false`, issue `clips/0/script_text`, código `too_small`. PATCH recibe
el conjunto completo: un borrador impedía guardar las demás ediciones.

`handleSaveSceneEdits` sólo confirmaba mediante toast; la búsqueda de Toaster
en src no produjo coincidencias y Providers/RootLayout no montan su visor.
El botón no tenía estado de progreso. Esto explica una posible ausencia de
respuesta visual, sin demostrar que el incidente concreto fuera ese caso.

`deleteSceneClip` eliminaba las escenas manuales del snapshot. El servicio y
el RPC `merge_material_component_scene_assets` conservan ausencias para evitar
que snapshots viejos borren escenas concurrentes. Ahora se envía deleted=true,
como ya se hacía para las escenas de storyboard.

## Implementación y alcance

- Schema editorial admite guion vacío; generación sólo admite vacíos en escenas
  no seleccionadas o eliminadas. El preflight del servicio conserva validación
  de existencia, medio esperado y texto de la selección persistida.
- Módulo cliente separado para PATCH, timeout y validación de respuesta. No se
  confirma éxito si faltan escenas o el servidor devuelve estructura inválida.
- Guardando, éxito y error aparecen junto al botón mediante región accesible.
  El bloqueo por ref evita escrituras simultáneas y el fieldset bloquea edición
  mientras se envía el snapshot. El guardado sin componente ya no simula éxito.
- Polling no inicia/aplica respuestas durante el guardado y descarta respuestas
  iniciadas antes de un guardado. No es una reconciliación global de edición
  pendiente ni control de concurrencia entre pestañas.
- Se conserva la corrección previa de presets. No hay SQL, dependencias nuevas,
  cambios de autoridad, credenciales, despliegue ni generación real facturable.

## Verificaciones

- `npm run test:remotion --workspace=apps/web`: salida 0 en el intento final.
  Incluye 9 casos nuevos de guardado, los 8 de presets y suites existentes de
  catálogo, cliente, escenas, importación, repositorio y producción.
- Hubo fallos iniciales en los fixtures nuevos (tipo del doble Supabase,
  payload de generación con campo extra y cliente de prueba sin inyectar).
  Se corrigieron los fixtures sin relajar los contratos de producción.
- El test de persistencia usa RPC y proveedor simulados: comprueba parámetros,
  respuesta y reconstrucción de escenas; no acredita una ejecución real de SQL.
- `npm run typecheck`: salida 0 después de corregir el fixture tipado.
- ESLint directo `--quiet` sobre cliente UI, validadores, transporte y pruebas:
  salida 0, repetido con los últimos ajustes de UI. Typecheck final: salida 0.
- `git diff --check` y `npm run docs:check` finales: salida 0; 73 documentos.
- `npm run verify:pr`: salida 1; adapters:check, harness:validate y docs:check
  pasaron (72 documentos). Se detuvo porque la CLI openspec declarada en el
  lockfile no está instalada. No se alteró ni omitió esa compuerta.
- Lint global ya falló en el trabajo previo por errores fuera del cambio,
  incluidos archivos compilados; no se volvió a ejecutar sin un cambio que lo
  justificara. El arnés pasó 16/16 en el trabajo previo y no se modificó.

## Revisión adversarial del mismo autor

- Un 403 y una respuesta inválida nunca muestran éxito ni actualizan el listado.
- No se reintenta automáticamente un PATCH cuyo resultado sea desconocido.
- Un borrador guardable no se convierte en una generación facturable vacía.
- Los IDs de organización enviados por el cliente siguen siendo rechazados;
  no se cambia autenticación, autorización ni scope de organización en la ruta.
- Borrar manualmente usa eliminación lógica compatible con el contrato existente;
  no se eliminan filas ni medios almacenados.
- Se revisaron diff y límites sin atribuir independencia a esta revisión.

## QA pendiente y riesgos residuales

Validar autenticado: guardar avatar/voz/guion, ver Guardando y éxito, recargar;
agregar un borrador vacío; eliminar una escena manual y recargar; simular un
403 o error de red y confirmar que se conserva la edición y se muestra error.
No se ejecutó QA visual ni contra BD real. No se puede asegurar que estos
hallazgos expliquen el reporte original sin reproducirlo en su entorno.

La política de reuso de medios y el merge concurrente de múltiples pestañas no
cambian. Limpiar campos opcionales enviados como undefined puede conservar el
valor previo por el merge JSON del RPC; ese comportamiento requiere un contrato
explícito de borrado de campos y no se altera con esta corrección acotada.
