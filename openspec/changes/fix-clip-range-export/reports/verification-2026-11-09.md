# Verificación del recorte y la descarga individual

En `68dc3ee8` se reprodujo el rechazo de un fragmento de video cuya ventana
fuente acababa en 10,040 s después de redondear. El medio acababa en 10,025 s.
El mismo redondeo puede invalidar un recorte de audio durante el guardado.
Los nuevos casos de regresión comprueban inicio y fin de ambos fragmentos con
una posición en timeline y un offset de fuente entre fotogramas.

La preparación de descarga usaba la lista cargada de assets y fallaba cuando
el clip no figuraba en ella o el editor independiente daba `previewUrl: null`.
La prueba de guardado verifica ahora que se construye la ruta del borrador y
del asset confirmado, después de que se vacía la cola. El servidor conserva
las comprobaciones existentes de autenticación, rol, organización y vínculo.

| Verificación | Resultado |
| --- | --- |
| Pruebas dirigidas de exportación, patches, fragmentos nativos, transiciones y edición de timeline | 137/137 |
| `npm run test:hyperframes --workspace=apps/web` | Salida 0 |
| `npm run test:remotion --workspace=apps/web` | Salida 0 |
| `npm run typecheck` | Salida 0 |
| `npm run docs:check` y `npm run openspec:validate` | Salida 0, 55 elementos OpenSpec válidos |
| `node apps/web/tools/qa/composition-clip-export.smoke.mjs` | Salida 0 en Chrome aislado, fuera del sandbox tras un fallo de arranque dentro del sandbox |

El fixture de Chrome decodificó cinco MP4 y un WAV sintéticos. Comprobó
fotogramas iniciales, presencia de pistas, duración dentro de la tolerancia del
fixture, cancelación, rechazo de un códec inducido y descarga desde el botón.
El tramo fraccional de 1,990 s produjo un contenedor de 2,005 s. El reporte de
Chrome quedó en `apps/web/.tmp/clip-export-qa/results.json`.

Queda pendiente probar el recorrido autenticado con un medio de Storage real.
Los recortes guardados con el cálculo anterior conservan sus valores y pueden
requerir ajustar el borde si quedaron fuera de la fuente. El cambio no necesita
migración. Para probarlo en el editor, elimina un intervalo central, descarga
cada fragmento por separado y verifica su inicio y duración contra el original.
