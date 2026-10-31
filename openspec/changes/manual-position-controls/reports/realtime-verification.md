# Posición en tiempo real — 2026-10-31

## Causa y solución
Los controles X/Y existentes sólo llamaban a setState. El monitor recibía su posición al admitir el commit de autosave. Ahora un hook emite posiciones parciales válidas por el canal del iframe, sin PUT, modificación del hash ni reconstrucción del timeline. La opacidad conserva su funcionamiento existente; el alcance solicitado es el desplazamiento manual en tiempo real.

Un runtime separado superpone left/top sobre la base canónica. Restaura y rebasa alrededor de patches DOM para conservar movimientos posteriores frente a confirmaciones anteriores. Retira la superposición al confirmar coordenadas coincidentes, cambiar selección o bloquear/desmontar el inspector. El guardado mantiene la cola, precondiciones y permisos existentes. No se alteran tamaño, opacidad, transform ni motion.

## Verificaciones
- `npm run typecheck`: salida 0, incluida la nueva suite.
- ESLint desde apps/web sobre CompositionInspector, NativeCompositionPreview, useCompositionPositionPreview, composition-position-preview-runtime, composition-preview-protocol y composition-preview-compiler.service con `--quiet`: salida 0.
- `npx tsc -p apps/web/tsconfig.hyperframes-test.json`, seguido de `node --test` sobre composition-position-preview-runtime, composition-preview-protocol, composition-interaction-autosave y composition-local-edits en apps/web/.tmp/hyperframes-tests/domains/production/composition-editor/__tests__: salida 0; 37 pruebas aprobadas.
- El test nuevo se incluye al inicio de `test:hyperframes`, después de compilar, para que no dependa de ejecución manual.
- `npm run test:hyperframes --workspace=apps/web`: salida 1 por el alias ajeno `@/lib/server/outbound-http` de composition-agent-model-output, igual que en la entrega inicial. Salida en realtime-hyperframes.log.
- `npm run verify:pr`: salida 1 en el cambio ajeno diagnose-font-catalog sin deltas; este cambio OpenSpec pasa. Adaptadores, arnés y enlaces pasan. La verificación posterior de producto no se alcanza. Salida en realtime-verify-pr.log.
- `git diff --check`: salida 0.
- `npm run docs:check`: salida 0; 187 documentos verificados.

## QA con navegador real
Comando: `$env:CHROME_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'; node openspec/changes/manual-position-controls/reports/position-controls-smoke.cjs`, desde la raíz, después de compilar las pruebas HyperFrames. Salida 0.

La prueba monta los controles React, el hook y autosave reales junto a un iframe del compilador real. Verifica X antes del pointerup, sin commits durante el gesto; Y también cambia durante la interacción. Comprueba decimales, valores negativos, bloqueo, selección nueva y rechazo de entradas inválidas manteniendo el último preview válido. El callback de persistencia usa memoria; no se conecta a Supabase ni se publica o renderiza en cloud.

El primer intento de la ampliación falló porque la composición sintética no tenía fuente de duración. Se corrigió el fixture con metadata de B-roll sintético de 4 segundos; no se añadió un medio remoto. Chrome se ejecutó fuera del sandbox, como en la QA inicial.

## Revisión y límites
Revisión adversarial por el mismo agente: emisor y receptor validan entradas; se conserva la comprobación de event.source y protocolVersion del listener existente. Se probaron confirmación anterior, confirmación coincidente, reemplazo/eliminación de nodo y conservación de opacidad/tamaño/rotación en la suite del runtime. Las entradas temporales no conceden autoridad de persistencia.

Sin E2E autenticado, recarga tras guardar, render final ni QA visual de la página completa. El preview no muestra clips fuera de su intervalo de tiempo ni cambia la visibilidad editorial. Los dos fallos generales permanecen documentados; no se modificaron sus archivos para obtener verde. La reversión retira el comando, hook y runtime temporal sin migrar documentos.
