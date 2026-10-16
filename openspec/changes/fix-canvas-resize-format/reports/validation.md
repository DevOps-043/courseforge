# Evidencia — 2026-10-16

## Alcance y diagnóstico

Rama local `codex/fix-canvas-resize-format`, base `6feb7269` (`staging`), checkout limpio al inicio.

Se inspeccionaron el compilador del preview, el contrato `composition.canvas-size`,
los patches de escena, la cola de guardado y el selector de formato.

**Causa principal confirmada en la pestaña del curso indicado por el usuario:**
los registros de staging contienen repetidamente `ReferenceError: i is not defined`
en `resolveSmartResize`, correspondiente al preview del borrador activo. Se
reprodujo con el código de HEAD minificado mediante Terser: `ReferenceError:
e is not defined` (el nombre concreto depende del minificador). Serializar por
separado funciones que se referencian entre sí pierde los nombres renombrados del
módulo. La solución encapsula las tres funciones en una factoría autocontenida;
se conserva la API pública y se prueba la ejecución aislada del módulo minificado.

La consola también registra `TypeError: Failed to fetch` y fallo de reconciliación
de assets. Son evidencia de fallos de red, pero no identifican el PUT concreto
del cambio de formato. El aviso de cambios locales fue descrito por el usuario;
no estaba visible al inspeccionar la pestaña. No se cambió ni recargó el curso.

1. **Reproducido:** el gesto usaba el ancho del documento que compiló el iframe,
   aunque el patch de escena ya había cambiado `canvasWidth`. La prueba Chromium
   falló con `Formato 1080x1920: ancho 816, esperado 636.0655737704918` antes de
   corregir el runtime. Afectaba arrastre, redimensionamiento y selección rectangular.
2. **Confirmado por código:** el tirador proporcional ignoraba `dy` y usaba solo
   `dx`. Ahora el eje de mayor desplazamiento proporcional determina el tamaño;
   los arrastres exclusivamente verticales están incluidos en la regresión.
3. **Riesgo confirmado, incidente original sin atribución definitiva:** el PUT y
   la lectura JSON carecían de deadline mientras el selector permanecía desactivado
   por `saving`. Se limita a 30 s; la cola termina, el cambio fallido y su journal
   quedan disponibles y el mensaje advierte que el resultado remoto es incierto.
   No se reintenta automáticamente ni se elimina el control ETag.

## Validación

- `tsc -p apps/web/tsconfig.hyperframes-test.json`: código 0.
- Regresión focalizada de geometría y solicitud de guardado: 15 pruebas aprobadas,
  incluida ejecución tras minificación de producción.
- Chromium aislado, HTML real compilado y eventos CDP de mouse: código 0;
  12 gestos de agrandar/reducir (diagonales y verticales), horizontal → vertical →
  horizontal, comprobación de tamaño y ausencia de errores del runtime.
- Compilador de preview, patches y composiciones independientes: 133 pruebas
  aprobadas, código 0.
- `npm run typecheck`: código 0.
- `npm run test:remotion --workspace=apps/web`: código 0.
- `git diff --check`: código 0.
- ESLint focalizado sobre los ocho archivos TypeScript/TSX afectados: código 0.
- `npm run verify:pr`: código 1; adaptadores, arnés estructural y enlaces pasan;
  se detiene porque el ejecutable local `openspec` no está instalado/disponible.
- `npm run test:hyperframes --workspace=apps/web`: código 1; se detiene en
  `composition-agent-model-output.test.js` por no resolver el alias
  `@/lib/server/outbound-http`. Las pruebas focalizadas posteriores se ejecutaron
  por separado. No se afirma aprobación de la suite completa.
- El primer `test:harness` falló por permisos al crear `.git/config` de repositorios
  temporales. La repetición con permisos para esos repositorios aislados aprobó
  16 pruebas, código 0.
- `npm run verify`: código 1; lint encontró 1646 errores en el árbol de trabajo,
  incluidos archivos JavaScript generados bajo `apps/web/dist/composition-worker`.
  No se limpiaron artefactos ajenos ni se relajó la configuración.

## Revisión adversarial propia y límites

No se modifican autorización, APIs, base de datos, medios, snapshot ni proveedor.
Se mantiene el documento V2 y el guardado condicional. Un timeout no prueba que
el servidor haya revertido la escritura: debe recargarse el documento desde el
editor; un reintento con hash anterior puede devolver 409, sin sobrescribir datos.

La QA cubre el runtime del preview con una capa de texto local; no es una prueba
E2E autenticada del documento afectado. Se leyó la consola de la sesión existente,
pero no se probó persistencia remota, render pagado o publicación. El fallo de
red/guardado concreto del cambio de formato sigue sin atribución definitiva.

Reproducción futura: `npm run test:composition-resize-format` y
`npm run qa:composition-resize-format` (Chrome/Edge instalado). Mantener el test de
orientación si se cambia cómo el runtime ajusta la escala del canvas.

Rollback: revertir este diff; no existen migraciones ni cambios de datos.
