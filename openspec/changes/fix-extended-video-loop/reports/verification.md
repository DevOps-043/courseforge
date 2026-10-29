# Evidencia de verificación — 2026-10-29

Base: `13774405`. Rama aislada: `codex/fix-video-loop`.
Se preservó el checkout original con cambios previos de exportación de clips.
Dependencias: junction al `node_modules` ya instalado; no se copiaron secretos ni configuraciones locales.

## Reproducción y corrección

En Chromium local, una fuente sintética de dos segundos extendida en vivo a seis
permitía seek a los ciclos siguientes, pero durante reproducción quedaba pausada
cerca de 1.98 s después del primer ciclo. Se observaron búsquedas reiteradas y
buffering, mientras el reloj de composición también quedaba cerca de ese límite.

La comparación circular por sí sola no bastaba: el precalentamiento durante
buffering y el reinicio forzado del reloj volvían a reposicionar el decoder.
La corrección conserva la intención de reproducción durante buffering y recupera
sin forzar el seek. La entrada al clip y los seeks manuales conservan precisión.

## Comandos y resultados

Ejecutados desde el worktree, salvo la comparación explícita de línea base:

| Comando | Resultado real |
| --- | --- |
| `npm run qa:composition-video-loop --workspace=apps/web` | Código 0; compila TypeScript, genera fuente sintética y valida extensión en vivo 2→6 s, seis tiempos/píxeles y tres ciclos con 37 muestras. |
| `node node_modules/typescript/bin/tsc -p apps/web/tsconfig.hyperframes-test.json` | Código 0 después de añadir cobertura del precalentamiento durante buffering. |
| `node --test` con `composition-preview-compiler.service.test.js`, `editor-patch.service.test.js` y `composition-preview-scene-patch.test.js` compilados | Código 1: 124/125 pasan, incluida la nueva regresión. El único fallo es la expectativa antigua de branding descrita abajo. |
| `npm run test:remotion --workspace=apps/web` | Código 0; 232 pruebas pasan. |
| `npm run test:harness` | Código 0; 20 pruebas pasan. |
| `npm run test:hyperframes --workspace=apps/web` | Código 1 por `Cannot find module '@/lib/server/outbound-http'` en `composition-agent-model-output.test.js`. El mismo bloqueo se observó al ejecutar la suite en el checkout original. |
| `npm run verify:pr` | Código 1: adapters, harness y docs pasan; se detiene porque el ejecutable `openspec` no está instalado. No alcanzó los controles posteriores. |
| `git diff --check` | Código 0. |
| ESLint sobre compilador, prueba del compilador y nueva QA | Código 0, sin diagnósticos. |

La prueba `compiles HyperFrames media as provider variables instead of ZIP paths`
espera `SofLIA - Engine remote asset`; el código vigente emite
`SofLIA Architect remote asset`. Se ejecutó esa misma prueba en el checkout
original sin la corrección y falló de igual forma. No se alteró una expectativa
de branding ajena para obtener verde.

El resumen de la captura sintética está en [browser-qa.json](browser-qa.json).
La QA completa deja el medio y el reporte detallado en
`apps/web/.tmp/composition-video-loop-qa/`; los logs locales están en
`.tmp/verification/` y no se incluyen como archivos de producto.

## Revisión adversarial

Revisión realizada por el mismo agente, sin afirmar independencia:

- Diff limitado al transporte interactivo, pruebas, comando QA y documentación.
- El HTML enviado al proveedor, schemas, tablas, permisos y persistencia no cambian.
- La regresión cubre decoder adelantado/atrasado, desfase real, seek explícito,
  entrada al clip, medio sin bucle y precalentamiento con/sin intención de reproducción.
- La QA utiliza contenido generado, loopback con Range y perfil de navegador aislado.
- No se ejecutó despliegue ni render pagado. Falta validar la lección afectada en
  una sesión autenticada y completar las compuertas generales una vez reparada su línea base.
- Rollback: revertir el cambio del controlador; no exige migración ni reescritura de documentos.
