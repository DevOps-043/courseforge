# Evidencia de revisión e implementación

Fecha: 2026-10-30. Base: `13774405`. Rama: `codex/branding-clip-controls`.
Worktree: `D:/Pulse Hub/courseforge/.tmp/worktrees/branding-clip-controls`.
No se alteró el checkout original ni se copiaron secretos o configuraciones.
Dependencias: junctions locales al node_modules raíz y web ya instalados del checkout original;
sin instalación ni cambios al lockfile.

## Hallazgo confirmado

La afirmación es parcial en este código: `CompositionInspector` ya muestra
profundidad, transformación y motion para VIDEO sin excluir branding. El selector
corporativo no abre esas propiedades. Además, el reconciliador eliminaba los
ajustes y animaciones al volver a materializar los mismos recursos.

El checkout actual tiene biblioteca corporativa de outros y selección de intros
desde Producción. Las intros corporativas históricas conservan compatibilidad.
Esta revisión de código no acredita qué versión está desplegada ni una sesión
real de OneDrive o una empresa en producción.

## Archivos y comportamiento

- `CompositionTimelineWorkspace.tsx`: accesos Editar intro/outro; seleccionan una
  instancia, limpian selección múltiple/grupos, abren propiedades y sitúan cursor.
- `CompositionInspector.tsx`: limita Separar audio a PRODUCTION_ASSET, coherente
  con el handler existente; evita mostrar una acción sin efecto en branding.
- `composition-branding.service.ts`: conserva instancia, profundidad, geometría,
  audio, recortes y animaciones al coincidir asset/placement; reserva sus IDs y
  conserva la duración editada al recolocar inicio/final.
- `composition-production-intro.service.ts`: reaplicar el mismo asset es una
  operación sin cambios. Sustitución y retiro conservan su comportamiento previo.
- Tests de branding, intro y compilación: cubren conservación, idempotencia,
  reemplazo, retiro, pistas bloqueadas y proyección de capas/motion a ambos targets.
- `composition-branding-controls.smoke.mjs`: fixture reproducible con componentes
  reales, patches reales y persistencia sólo en memoria.
- Fuente canónica HyperFrames y OpenSpec: contrato, alcance, rollback y evidencia.

## Verificación aprobada

- `tsc -p apps/web/tsconfig.hyperframes-test.json`: compilación del dominio aprobada
  durante la ejecución de `test:hyperframes` (el proceso avanza a ejecutar tests).
- Dos archivos compilados de branding/intro con `node --test`: **8/8**.
- `node --test --test-name-pattern='intro y outro compilan'` sobre el archivo
  compilado `composition-preview-compiler.service.test.js`: **1/1**; cubre intro y
  outro, preview y render, fuente remota, profundidad y motion.
- Archivo compilado `editor-patch.service.test.js`: **78/78**.
- `npm run test:remotion --workspace=apps/web`: salida **0**.
- `npm run test:harness`: **20/20**, salida **0**. La primera ejecución falló al
  crear repositorios temporales por restricciones del sandbox; se repitió con
  permiso de ejecución y no se modificaron pruebas ni verificadores.
- `npm run docs:check`: salida **0**, 152 documentos al incluir este reporte.
- ESLint focalizado en los archivos TypeScript/TSX/QA afectados: salida **0**.
- `npm run typecheck` con `NODE_OPTIONS=--max-old-space-size=8192` y dependencias
  locales raíz/web enlazadas: salida **0**, sin errores de TypeScript.
- `adapters:check` y `harness:validate`: salida **0** dentro de `verify:pr`.
- `git diff --check`: salida **0**.
- QA de Chrome: accesos para intro corporativa histórica, outro e intro de
  Producción; selección individual, cursor, bajar/subir capa, añadir animación,
  reaplicar sin perder ajustes, ausencia de botones sin branding y Separar audio
  sólo para la fuente soportada. Sin errores de
  página. Se usa un origen HTTPS interceptado localmente, sin acceso externo.

Reproducir QA después de compilar la suite HyperFrames:

```powershell
$env:BRANDING_QA_BROWSER_CHANNEL = 'chrome'
node apps/web/tools/qa/composition-branding-controls.smoke.mjs C:/Users/Lordg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules
```

El segundo argumento es opcional cuando Playwright está instalado en el proyecto.
El fixture sustituye clases CSS y acredita interacción funcional; no certifica
layout visual, persistencia Supabase, autenticación ni render remoto.

## Límites de las compuertas completas

- `npm run verify:pr`: salida **1** al llegar a OpenSpec porque no está instalado
  su ejecutable local. No se modificaron dependencias ni se omitió la compuerta.
- `npm run test:hyperframes --workspace=apps/web`: salida **1**. Tras resolver la
  dependencia local GSAP mediante el junction, avanza hasta el test del agente y
  falla al resolver `@/lib/server/outbound-http` desde CommonJS emitido. Ese módulo
  y el script de la suite no se modificaron en este cambio.
- La ejecución completa del test de compilador revela una expectativa antigua:
  espera `SofLIA - Engine remote asset` y el compilador emite
  `SofLIA Architect remote asset`. Se reprodujo **también usando el archivo de test
  obtenido con `git show HEAD:...`**, empaquetado con esbuild, antes de añadir el
  nuevo test. No se cambió esa expectativa para simular verde.
- El primer `npm run typecheck` agotó el heap predeterminado de Node (~2 GiB).
  La repetición con 8 GiB detectó que faltaba enlazar las dependencias locales de
  apps/web (`@types/react-dom` sí está instalado allí). Se enlazó también ese
  node_modules y la repetición terminó con salida **0**, sin instalar ni cambiar versiones.

## Revisión adversarial y riesgos residuales

Realizada por el mismo agente, sin atribuir independencia. Se revisaron diff,
fuentes y resultados. No hay nuevas rutas, autoridad por payload, acceso a
secretos, URLs persistidas, migraciones ni llamadas de render. Se mantienen los
patches validados, bloqueo de pistas, guardado e historial existentes.

La reconciliación corporativa sigue anclando la intro al inicio y el outro al
final al aplicar branding. Los controles afectan al clip completo; no reconstruyen
capas internas de un MP4 ni modifican el archivo corporativo original.
La paridad acreditada abarca propiedades visuales y motion. Las operaciones
especializadas que requieren PRODUCTION_ASSET (reemplazo, reinicio o derivados
de medios) no se amplían a ASSEMBLY_BRAND_ASSET en este cambio.

Pendiente antes de desplegar: prueba autenticada de selección, autoguardado,
recarga y deshacer/rehacer; comprobar superposición con texto/video y comparar
preview con render final en el entorno autorizado. No se ejecutaron build, QA
visual con CSS real, SQL remoto, publicación ni render cloud.

Extensión: otras fuentes de branding deben incorporarse a la selección de clips
y reutilizar el inspector y contrato de patches. No crear otra fuente de motion.
Rollback: revertir el diff, conservando lectura V2 y los documentos persistidos.
