# Verificación de máscaras — 2026-10-31

## Resultado y alcance
Máscaras opcionales CIRCLE, ELLIPSE y ROUNDED_RECT (redondeo porcentual 0–50). Selector y deslizador junto al recorte para imagen/video/diapositiva. Las capas anidadas intersectan máscara y crop; no cambian layout, opacidad, motion, referencias de fuente o archivo original.

El documento guarda `clip.mask`; `clip.mask` como operación aplica o retira el campo. El servicio y schema rechazan tipos de clip no compatibles y el servicio rechaza pistas bloqueadas. Reset elimina ambas decisiones; presets capturan/aplican máscara. El renderer compartido sirve preview y HyperFrames render. Un documento legacy sin máscara no añade el wrapper ni el atributo opcional.

## Comandos y resultados
- `npm run typecheck`: salida 0, incluida la última implementación del runtime.
- `npx tsc -p apps/web/tsconfig.hyperframes-test.json`: salida 0.
- `node --test` sobre los archivos compilados composition-visual-mask, editor-patch.service, composition-preview-visual-patch, composition-preset.service y composition-preview-protocol bajo apps/web/.tmp/hyperframes-tests/domains/production/composition-editor/__tests__: salida 0; 115 pruebas. Ver domain-tests.log.
- ESLint desde apps/web, `npm exec -- eslint <archivos modificados del inspector, controles, modelo, máscaras/runtime, renderer, patches, protocolos, presets y tests> --quiet`: salida 0. Se repitió para composition-preview-compiler.service después del ajuste final de reapply.
- `npm run test:hyperframes --workspace=apps/web`: salida 1 por `Cannot find module '@/lib/server/outbound-http'` en composition-agent-model-output, fallo ya documentado antes de este cambio. La suite nueva se ejecuta al inicio del script y pasa. Ver hyperframes.log.
- `npm run verify:pr`: salida 1 en diagnose-font-catalog por ausencia de deltas, fallo anterior. Este cambio pasa OpenSpec. Adaptadores, arnés y enlaces pasan (191 documentos en esa ejecución). La compuerta no alcanza la verificación posterior de producto. Ver verify-pr.log.
- `git diff --check`: salida 0.

La primera ampliación del test de audio tuvo un error de tipos por track opcional en el fixture; se corrigió antes de compilar y ejecutar la suite final. initial-domain-tests.log conserva la primera ejecución acotada; domain-tests.log es el resultado final.

## QA local en navegador
Desde la raíz, después de compilar pruebas:

```powershell
$env:CHROME_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
node openspec/changes/visual-clip-masks/reports/mask-controls-smoke.cjs
```

Salida 0 con Chrome headless fuera del sandbox. Monta los controles y el boundary React reales y un iframe generado por el compilador real; fuente sintética SVG roja embebida, sin URLs de medios externas. El callback de persistencia del harness captura en memoria y envía el patch visual real.

Comprueba círculo/elipse/redondeo, preview antes de autosave, ausencia de commits durante arrastre, commit al soltar, bloqueo y conservación de crop/src/tamaño al quitar. Hit testing del navegador confirma centro visible, esquina dentro del crop oculta por círculo, esquina recuperada al quitar máscara y borde izquierdo aún recortado. Un patch canónico con radio 20 durante el gesto de radio 35 conserva 35 en pantalla.

## Revisión adversarial y límites
Revisión por el mismo agente: formas y parámetros cerrados, sin CSS/URLs/SVG de usuario; límites y campos extra rechazados. Se conserva origen y versión del protocolo del iframe, autorización tenant en las rutas existentes y aislamiento de archivos originales. El runtime temporal no guarda versiones por cada movimiento. Los patches canónicos y cambios de escena reaplican el gesto posterior; limpiar restaura el último atributo canónico.

No se ejecutó E2E autenticado contra Supabase, QA de página completa ni render cloud/video final. Las pruebas del renderer verifican ambas salidas HTML; no equivalen a un render remoto observado. No se probaron máscaras dibujadas, feather, inversión, animación ni archivos de máscara: están fuera de alcance. El recorte en modo de edición sigue mostrando la fuente completa para ajustar tiradores, mientras la máscara permanece aplicada.

Compatibilidad: campo opcional sin migración SQL ni cambios al proveedor. Lectores estrictos anteriores rechazan documentos/presets enmascarados: desplegar web y worker compatibles juntos. Para revertir, retirar máscaras del documento activo y conservar lector compatible para versiones históricas. No se aplicó despliegue, publicación ni operación remota.
