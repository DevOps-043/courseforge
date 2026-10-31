# Evidencia: edición visual y transiciones de audio

Fecha: 2026-10-31. Windows local, checkout principal; árbol limpio al iniciar.
Base del alcance: `f37c79f5`. Sin SQL, proveedores nuevos, generación pagada ni
render cloud. No se crearon worktrees.

## Resultado

- Audio adyacente en una misma pista admite CROSS_DISSOLVE + CROSSFADE, expuesto
  como «Crossfade de audio». Se validan duración de fuente, handles, pista,
  vecindad, tercer clip y ventana. No se admiten efectos visuales sobre AUDIO
  ni una pareja mixta AUDIO/VIDEO. Quitar la transición restaura el corte original.
- Runtime `audioOnly` evita aplicar opacity/transforms a los elementos de audio.
  Las ventanas solapadas y offsets reales se compilan en preview y render;
  pistas de runtime distintas evitan solapar dos medios en un track del proveedor.
  El documento conserva tiempos y offsets canónicos. El crossfade usa la
  envolvente compartida y se combina con maestro, curvas y fades existentes.
- «Ampliar audio» enfoca el audio seleccionado con objetivo de 8 px por frame
  hasta un máximo de 128x. La escala no cambia duración ni playbackRate.
  El ruler tiene presupuesto de 2.000 marcas; waveform conserva el mecanismo
  existente de petición de la ventana visible. Se alineó la onda al ancho
  temporal del clip, eliminando el margen horizontal decorativo de 8 px.
- Doble clic en la onda ubica el cursor en el frame pulsado; «Dividir audio» usa
  el mismo comando no destructivo de split, historial y undo del editor. Se
  conserva Alt+arrastrar para slide, trim/roll y la navegación por frame existente.
  Los grupos conservan el doble clic para entrar a editar su contenido.
- Cursores y marcas del ruler muestran milisegundos donde corresponda. La UI no
  ofrece cortar por muestra: la precisión editorial sigue siendo la del FPS.

## Validación ejecutada

- Compilación HyperFrames mediante la QA final: código 0.
- Cinco suites focalizadas ejecutadas sobre esa compilación: código 0, 49 pruebas
  (edición de audio, transiciones, envolventes/crossfade, maestro y lanes).
  Ocho casos nuevos verifican autorización estructural del tipo de transición,
  handles, pista bloqueada, audio/visual mixto, tercer clip, tres alineaciones,
  ventanas/offsets, ausencia de tweens visuales, split/trim, referencia y zoom.
- Tras revisar el orden determinista de clips de audio/visuales en una pista,
  se repitió el script `test:composition-audio-editing`: compilación y 31 pruebas
  de edición, transiciones y envolventes aprobadas, código 0.
- `qa:composition-audio-editing`: código 0. Chromium headless con perfil temporal
  aislado y WAV sintético local. Se requirió ejecución fuera de la restricción
  del entorno para el navegador; no se usaron sesiones personales.
- QA runtime en ambos targets: ganancias 0.4/0.3 en el centro del crossfade
  (bases 0.8/0.6), offsets/ventanas solapados, lanes distintas y seek inverso.
- QA React con Timeline y TransitionControls reales: añadir/quitar crossfade,
  ampliar la onda, doble clic mediante eventos CDP y división del audio en 1.6 s.
  El segmento derecho conserva offset 2.6 s de una fuente inicialmente recortada
  desde 1 s. Se comprueba que no aparezcan errores de patch. Se repitió la QA de
  controles después de ajustar rótulos con milisegundos y nombre del crossfade:
  código 0. [Informe](browser.json) y [captura](waveform-zoom.png).
- Primer fixture UI: falló por importar una fábrica con `node:crypto` en el
  bundle de navegador. Se corrigió preparando el documento en Node e inyectando
  solo JSON; no se cambió el código de hashing ni se agregó un polyfill.
- Primeras pruebas detectaron la restricción visual duplicada en el schema del
  documento; se actualizó con la misma condición estricta que el servicio. No
  se deshabilitó la validación ni se aceptaron transiciones visuales sobre audio.
- `npm run typecheck`: código 0, repetido sobre la implementación final del gesto.
- `npm run test:remotion --workspace=apps/web`: código 0.
- `npm run test:security-boundaries`: código 0, 30 pruebas.
- ESLint focalizado: código 0, sin salida en servicios, QA y controles nuevos;
  la ejecución inicial sobre archivos existentes incluyó NativeCompositionPreview.
  Verificación de rótulos finales: código 0, sin warnings ni errores.
- `npm run verify:pr`: código 1. Este OpenSpec pasa; adaptadores, arnés y docs pasan.
  Se detiene en el cambio existente `diagnose-font-catalog` sin deltas.
- `npm run test:hyperframes --workspace=apps/web`: código 1 por el alias existente
  `@/lib/server/outbound-http` en `composition-agent-model-output.test.js`.
- Auditoría documental acotada: código 0 con la copia temporal ya documentada
  en el cambio de subtítulos; README/contexto y fuente canónica contrastados con
  servicios, schemas y QA. No se modificó el script de auditoría versionado.
- Documentación final: código 0, 223 documentos.
- OpenSpec focalizado: código 0.
- `git diff --cached --check`: código 0, incluidos archivos nuevos.

## Revisión propia, operación y reversión

No hay nuevos endpoints ni acceso a medios externos; los permisos y checksums
de ventanas de waveform continúan bajo el contrato existente. Se comprueban
fuentes y handles antes de persistir y se mantienen append con hash y ownership.
El zoom no genera nodos por muestra; ruler, SVG y solicitudes de waveform siguen
acotados. La petición detallada ya existente se cancela al cambiar de viewport.

Crossfade no inventa audio fuera de los límites de fuente: un archivo que termina
exactamente en el corte puede necesitar otra alineación o un recorte que deje
material disponible. No se introduce auto-ripple ni se cambia la duración del
video. Los cortes siguen usando el frame rate del canvas.

La QA observa valores en medios DOM/GSAP, offsets, interacción y una forma de onda
sintética; no certifica escucha física, loudness perceptual ni un MP4/cloud real.
La captura del fixture usa CSS modular y utilidades mínimas, no la página completa
del producto. No se probó persistencia remota ni carga de un archivo largo real.
Revisión del mismo agente que implementó el cambio, no independiente.

Compatibilidad: un lector anterior sigue rechazando transiciones sobre audio.
Desplegar schema, servicios, runtime y UI juntos. Reversión: mantener lector
compatible o quitar primero las transiciones de audio; sin migraciones SQL.
