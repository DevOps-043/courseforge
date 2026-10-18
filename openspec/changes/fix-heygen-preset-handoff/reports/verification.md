# Evidencia y revisión

Fecha: 2026-10-17. Base: 64606f73. Rama: codex/fix-heygen-preset-handoff.

## Implementación

Producción construye el enlace con avatarPresetId y voicePresetId. HeyGen
resuelve las preferencias contra el catálogo que ya obtiene del servidor para
la organización activa. Una preferencia ausente o no disponible usa el default
o la primera opción; se avisa si la preferencia recibida no está disponible.

El guardado común de escenas completa sólo los IDs vacíos con las selecciones
del panel. Los caminos existentes de avatar, voz individual y generación mixta
pasan por este guardado antes de solicitar generación. Se bloquea el guardado
si aún no hay una carga exitosa del catálogo. La carga no modifica la BD.

## Verificaciones ejecutadas

- `npm run test:remotion --workspace=apps/web`: salida 0. Incluye catálogo,
  cliente, escenas, importación, repositorio y la nueva suite (7 casos iniciales).
- Tras agregar el escenario de recorrido completo: compilación con
  `node node_modules/typescript/bin/tsc -p apps/web/tsconfig.remotion-test.json`
  y ejecución con `node --test apps/web/.tmp/remotion-tests/domains/production/providers/heygen/__tests__/heygen-preset-selection.test.js`:
  salida 0, 8/8 casos.
- `git diff --check`: salida 0; Git advierte normalización LF/CRLF en el cliente.
- `npm run verify:pr`: salida 1. Pasaron adapters:check, harness:validate y
  docs:check; se detuvo en openspec:validate porque no está instalada la CLI
  declarada en el lockfile (`openspec` no se reconoce). No se alteró la compuerta.
- `npm run test:harness`: el primer intento falló por permisos del sandbox al
  crear repositorios temporales; reintento con permisos: salida 0, 16/16 casos.
- `npm run typecheck`: salida 0, sin diagnósticos.
- `npm run verify`: salida 1 en lint con 1646 errores. La salida incluye
  JavaScript compilado en `apps/web/dist/composition-worker` y
  `apps/web/src/domains/production/composition-editor/html-editing/.tmp/unit`,
  ajenos al diff. No se cambió la configuración de lint ni se eliminaron assets
  generados. La cadena no llegó a sus pasos posteriores.
- `npm run docs:check` tras añadir este informe: salida 0, 68 documentos.
- ESLint directo con `--quiet` sobre los cuatro archivos TypeScript afectados
  (los dos componentes, el módulo de selección y su prueba): salida 0,
  sin diagnósticos.

## Revisión adversarial del mismo autor

- El enlace no concede autoridad: sólo se aceptan sus preferencias incluidas
  en el catálogo autorizado. La autorización en APIs permanece vigente.
- Se conservan por separado avatar y voz personalizados; no se muta el array
  original de escenas ni se cambian preferencias globales de organización.
- La selección visible se materializa en el payload del guardado y éste devuelve
  los clips usados por la generación. También la voz individual guarda antes.
- Los enlaces anteriores mantienen componente, source y returnTo. Las pruebas
  cubren codificación del regreso, catálogo vacío y preferencias ajenas.
- Las escenas guardadas con IDs explícitos seguirán mostrando esos IDs aunque
  Producción elija otros. Esto es intencional para preservar personalizaciones.
- No hubo cambios de dependencias, contratos HTTP, esquema, credenciales,
  workers, render ni llamadas reales de generación.

## Límites y QA pendiente

No se probó visualmente en una sesión autenticada ni se solicitó generación real
facturable. Validar manualmente con avatar/voz distintos del default, abrir
HeyGen, revisar una escena nueva y otra personalizada, guardar y recargar.
Comprobar también un enlace con preset archivado y un error de carga del catálogo.

Los clips ya generados no se regeneran al cambiar presets. El reuso de voz
preexistente sigue su política actual; este cambio no garantiza sustituir audio
ya producido. La navegación transmite preferencias; se persisten al guardar o
generar dentro de HeyGen, no por el mero hecho de abrir la pantalla.
