# Evidencia — 2026-10-29

## Alcance y diagnóstico

Base: `staging`, commit `13774405`; checkout inicialmente limpio. Rama local:
`codex/fix-clip-range-export`. Sin publicación, servicios pagados, migraciones
ni acceso a secretos.

El patch de dominio ya implementaba inicio, centro y final. Se confirmó que
el formulario anterior admitía un frame mientras el dominio exige al menos
50 ms o un frame, lo que sea mayor. La selección posterior infería un fragmento
derecho desde los tiempos sin comprobar que sobreviviera al mínimo del dominio.
No existía descarga individual en la UI inspeccionada.

## Cambios

- `CompositionClipIntervalControls`: intervalo relativo al clip y descarga con
  progreso y cancelación, montado en Propiedades para video/audio/texto/captions.
- `NativeCompositionPreview`: reutiliza guardado existente y selecciona un clip
  realmente presente después del patch; espera autoguardado/cola para exportar.
- `composition-clip-export-plan`: ventana fuente acumulada, nombre y formato;
  rechaza bucles, velocidad/congelación, fuentes no admitidas y tramos >10 min.
- `composition-clip-export-io.client`: descarga de fuente limitada por tamaño
  declarado y bytes reales, incluso sin Content-Length.
- `composition-clip-export.client`: Mediabunny existente, MP4 AVC/AAC y WAV PCM;
  fuerza recodificación para recortar sin depender de keyframes; no acepta pistas
  descartadas de forma involuntaria. Fuente/salida <=256 MiB, tiempo <=15 min,
  liberación de input/conversión y Blob URL desechable.
- Scripts de prueba unitaria y QA; prueba nueva incluida en `test:hyperframes`.

## Verificaciones aprobadas

| Comando | Resultado |
| --- | --- |
| `npm run test:composition-clip-export --workspace=apps/web` | 9/9: inicio/centro/final, offset acumulado, residuos, eliminación completa, políticas, HTTP, vacío, tamaño y cancelación |
| `node --test` con `editor-patch.service.test.js`, `composition-preview-telemetry.test.js` y `standalone-media-composition.test.js` compilados | 101/101 |
| `node apps/web/tools/qa/composition-clip-export.smoke.mjs` | Chromium aislado: 4 MP4 reales y WAV decodificados, UI React y descarga por botón |
| `npm run test:remotion --workspace=apps/web` | Suite completa, salida 0 |
| `node --max-old-space-size=4096 node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit --pretty false` | Salida 0, repetido tras la corrección de estado React |
| ESLint dirigido a los archivos TS/TSX nuevos con `--max-warnings 0` | Salida 0 |
| ESLint dirigido incluyendo `NativeCompositionPreview.tsx` | Sin errores; advertencias en código existente del host. La advertencia nueva por leer ref durante render se corrigió usando estado explícito |
| `npm run test:harness` fuera del sandbox | 20/20; el primer intento dentro del sandbox falló al crear repositorios Git temporales |
| `adapters:check`, `harness:validate`, `docs:check` | Aprobados durante `verify:pr` |
| `git diff --check` | Sin errores de whitespace |

El fixture produce cuatro segundos: rojo en [0,2), verde en [2,4), tono de
440 Hz. Los MP4 exportados contienen las pistas de video y audio; el primer
fotograma es rojo o verde según el offset. Duraciones medidas: 1.002667 s para
un tramo de 1 s, 2.005333 s para 2 s (empaquetado AAC); WAV: exactamente 1 s,
192044 bytes. Se verifica cancelación antes y durante la conversión y un fallo
de codificador inducido sin archivo parcial.

La descarga por botón produce `Asset-1-recorte.mp4`, 51292 bytes, en un
directorio nuevo por ejecución. Resultados y captura funcional en
`apps/web/.tmp/clip-export-qa/`; `results.json` identifica la ruta local del video.
No se usa un archivo de una ejecución anterior para acreditar la descarga.

## Comprobaciones que no quedaron verdes

- `npm run typecheck` inicial: Node agotó el heap predeterminado de ~2 GiB.
  La ejecución explícita con 4 GiB pasó, sin cambiar configuración del proyecto.
- `npm run verify:pr`: adaptadores, arnés estructural y enlaces pasaron; se detuvo
  en `openspec:validate` porque `@fission-ai/openspec` no está instalado localmente.
  No se afirma validación OpenSpec ni compuerta completa.
- `npm run lint`: 1646 errores, incluyendo muchos archivos CommonJS generados
  dentro de `html-editing/.tmp/unit/`. No se modificó el verificador ni se
  eliminaron artefactos de otros trabajos para ocultarlos.
- `npm run test:hyperframes`: se detuvo en `composition-agent-model-output.test`
  porque Node no resuelve `@/lib/server/outbound-http` en el JS CommonJS del
  proveedor. Ese import no fue modificado por este cambio.
- La ejecución directa de `composition-preview-compiler.service.test` alcanzó
  una aserción de etiqueta de marca HTML que espera `SofLIA - Engine remote asset`.
  Se reporta como fallo en código no modificado; no se afirma línea base completa
  ni se cambia branding dentro de esta corrección.

## Revisión adversarial y límites

Revisión realizada por el mismo agente, sin atribuir independencia. Se revisaron
errores parciales, descarte de pistas, lecturas acotadas, cancelación, revocación
de URL, selección tras un corte al borde y ausencia de efectos externos.

La exportación individual aplica el recorte temporal del **fragmento seleccionado**:
no concatena todos los fragmentos que compartan asset ni aplica geometría, color,
motion, fades, volumen o mezcla del ensamble. Video/audio de biblioteca con fuente
`PRODUCTION_ASSET`; los SFX y capas nativas no se exportan por esta vía.

Se comprobaron medios sintéticos en Chromium con WebCodecs. No se observó una
sesión autenticada contra Storage real, caducidad real de firmas, otros navegadores
ni render cloud. La captura del fixture no carga la hoja Tailwind completa: acredita
controles e interacción, no una auditoría visual del estudio completo.

## Reversión y extensión

Revertir los archivos de esta rama retira la UI y la exportación sin migración ni
reescritura de documentos/assets. Para soportar bucles, efectos o archivos mayores,
añadir una salida de render aislada con límites y almacenamiento propios; no
descargar el asset original como sustituto de una exportación editada.
