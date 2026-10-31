# Evidencia: volumen maestro de la línea del tiempo

Fecha: 2026-10-31. Windows local, checkout principal; árbol limpio al iniciar.
Base del alcance: `0f811ea0`.
No se crearon worktrees ni se aplicó SQL, publicación o generación pagada.

## Implementación

El control «Volumen maestro» se muestra junto a la mezcla automática de voz.
Permite 0–100% y restablecer 100%, con teclado, estado accesible, borrador local,
autosave de última interacción y reintento explícito tras un error.

`audioMix.masterVolume` es opcional y se modifica con `audio-mix.update` sin
mezclarlo con el objeto ducking. El lector no incorpora un default al JSON;
guardar 100% elimina el campo. Diff e inversa conocen la ganancia. Silenciar
todo mediante una operación del agente se clasifica HIGH, con confirmación
reforzada; no se amplió el schema de salida ni las capacidades del modelo.

El nivel de clip/pista se multiplica por el maestro para HTML inicial, scene
patch y cambios de volumen individuales. La envolvente final se multiplica una
sola vez después de fades, ducking, curvas y crossfades. La referencia de audio
emplea la misma base/envolvente. El maestro no reactiva pistas silenciadas.

Se corrigió el reconocimiento de `SOUND_EFFECT_ASSET` como audio configurable:
así los SFX participan en envolventes y en detección de audio del documento,
incluido un documento con solo efectos. Mantienen su rol SFX, sin convertirse
en disparadores de ducking de voz.

## Verificaciones ejecutadas

- Suite `test:composition-master-volume`: compilación TypeScript y primera
  ejecución con 24 pruebas, código 0. Tras añadir casos de SFX y riesgo, se
  reejecutaron los cuatro archivos compilados con `node --test`: 26 pruebas,
  código 0. Cubren documentos anteriores, valores inválidos, persistencia,
  inversa, silencio/restauración, niveles locales, fades, ducking, curvas,
  crossfade, HTML compartido, scene/visual patches y referencia PCM estéreo.
- PCM sintético local: la salida a 50% coincide muestra a muestra con la
  amplitud neutral dividida entre dos; 0% produce muestras nulas.
- `qa:composition-master-volume`: código 0 en su ejecución final, incluida
  compilación. Chromium headless con perfil temporal aislado; se requirió
  ejecución fuera de la restricción del entorno para el navegador.
- QA de DOM/GSAP: 50%, 0% y 100% sobre tres fuentes, fades y seek inverso, en
  ambos targets; paridad de valores efectivos y actualización de scene sin
  duplicar la ganancia. Usa WAV local y no reproduce sonido en un dispositivo.
- QA React con los controles reales: emite solo el maestro, restablece 100%,
  conserva borrador tras rechazo, reintenta explícitamente y respeta disabled.
  [Resultados](browser.json) y [captura del fixture](controls.png).
- La primera prueba de recuperación esperaba un reintento automático tras otro
  input. Se corrigió la expectativa para usar el botón existente de reintento,
  conforme al contrato de autosave. No se cambió esa política para pasar la QA.
- `npm run typecheck`: código 0, repetido sobre la versión final del control.
- `npm run test:remotion --workspace=apps/web`: código 0.
- `npm run test:security-boundaries`: código 0, 30 pruebas.
- ESLint de archivos modificados existentes: código 0, 26 warnings en componentes
  existentes. En los cinco archivos nuevos se identificaron tres warnings de
  React/fixture, se corrigieron sin supresiones y se repitió ESLint; resultado
  final código 0, sin warnings ni errores en archivos nuevos.
- `npm run test:hyperframes --workspace=apps/web`: código 1 por el alias ya
  existente `@/lib/server/outbound-http` en `composition-agent-model-output.test.js`.
- `npm run verify:pr`: código 1; validación de este cambio aprobada. Adaptadores,
  arnés y docs pasan; `diagnose-font-catalog` sigue sin deltas de especificación.
- Auditoría documental acotada: código 0 usando la copia temporal descrita en la
  evidencia de subtítulos automáticos (mismo inventario Git/rutas/jobs y `rg`
  para código no ignorado). Se contrastaron README, contexto y fuente canónica
  con el schema, proyecciones y pruebas; el auditor versionado no se modificó.
- Documentación final: código 0, 218 documentos comprobados.
- OpenSpec focalizado: código 0.
- `git diff --cached --check`: código 0, incluidos los archivos nuevos.

## Revisión propia, límites y reversión

No hay nuevos endpoints, permisos, fuentes de autoridad ni credenciales. El
patch conserva el control de usuario/organización y append con hash existente.
El campo acepta solo números finitos 0..1. La región caliente no añade consultas
ni trabajo por muestra en producción; escala los puntos ya calculados cuando
el maestro es distinto de 1. La UI no guarda por cada movimiento del slider.

Se verificaron ganancia declarada en medios, valores DOM/GSAP y referencia PCM
sintética; no se afirma medición de salida física, loudness perceptual, render
cloud ni MP4 observado. La captura React usa el CSS modular del fixture, no la
página completa con todas las utilidades Tailwind del producto. No sustituye
una revisión visual de un curso real.

Lectores anteriores con schema estricto no conocen el campo. Desplegar juntos
lector/servidor/UI; para revertir mantener el lector o guardar primero 100% para
retirar la propiedad. No hay migración SQL. La revisión fue del mismo agente
que implementó el cambio, sin afirmar independencia.
