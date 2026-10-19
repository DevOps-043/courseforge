# Evidencia de verificación

Base: `staging`, commit `3b9e7be6`. Rama local: `codex/import-html-slide-templates`.
Alcance y contratos: [diseño](../design.md), [documentación operativa](../../../../docs/architecture/imported-slide-templates.md).

## Resultados observados

- `npm run typecheck`: pasó, incluida la API y los componentes nuevos.
- `npm run test:slide-template-import -w apps/web`: 16 pruebas pasaron; incluye regresiones del estado activo y nombres de clases. La última reejecución comprueba también el saneamiento del JSON empaquetado.
- Lint sobre todos los archivos TypeScript/TSX/MJS del diff: pasó; no se modificó la configuración ni se excluyeron reglas.
- Productor editorial existente: 22 pruebas pasaron, incluidas las 24 diapositivas y los layouts anteriores en claro/oscuro.
- `npm run test:security-boundaries`: pasó.
- `npm run db:migrations:check`: pasó (210 SQL, sin aplicar SQL).
- `npm run docs:check`: pasó al cierre (87 documentos).
- `npm run test:remotion -w apps/web`: pasó, incluidas regresiones del renderizador y paquetes anteriores.
- `npm run test:harness`: 16 pruebas pasaron con permisos para crear repositorios Git temporales. La primera ejecución restringida falló por permisos de escritura de `.git` en temporales.
- Fixture de navegador con Chrome instalado: pasó carga, reporte, preview aislado con grid 1920×1080, invalidación de revisión al editar, guardado confirmado y ancho móvil. Persistencia y API simuladas; sin servicios remotos. Capturas inspeccionadas visualmente bajo `apps/web/.tmp/html-template-import-qa/`.
- `npm run verify:pr`: adaptadores, arnés y enlaces documentales pasaron; se detuvo inicialmente por ausencia local del ejecutable `openspec`.
- OpenSpec `1.8.0` se instaló temporalmente en `.tmp/openspec-cli`, sin scripts ni cambios al lockfile. El intento offline no encontró caché y el intento restringido no resolvió npm; la descarga autorizada fuera de esa restricción funcionó. `validate import-html-slide-templates --strict --no-interactive`: pasó. `validate --all --strict --no-interactive`: 8 cambios pasaron, falló el cambio ajeno `diagnose-font-catalog`. Se desactivó telemetría en la validación completa.
- `npm run verify`: se detuvo en lint global con 1646 errores en salidas generadas preexistentes bajo `apps/web/dist/composition-worker` y `apps/web/src/domains/production/composition-editor/html-editing/.tmp`. No se borraron ni se ampliaron excepciones de lint.
- `npm run architecture:cycles`: detectó 11 ciclos entre módulos no modificados de composition-editor/QA/HTTP. Ningún archivo nuevo de esta capacidad aparece en esos ciclos; las aristas de los archivos reportados no cambiaron.
- `npm run test:hyperframes -w apps/web`: compiló y ejecutó las suites anteriores a `composition-agent-model-output`, pero se detuvo por `MODULE_NOT_FOUND: @/lib/server/outbound-http` en `composition-agent-provider.service.js`. Ese import y el runner son ajenos al diff. Log reproducible: `apps/web/.tmp/html-template-import-qa/hyperframes-check.log`. No se presenta como suite completa aprobada.

## Límites

No se probó persistencia real en Supabase ni se aplicó SQL remoto. No se ejecutó generación IA pagada, render cloud, publicación ni despliegue. Los tres diseños de prueba son fixtures sintéticos; falta contrastar un export representativo real de Open Design. Los límites por caracteres no sustituyen QA visual del contenido final.

## Revisión adversarial

Realizada por el mismo agente, sin independencia, siguiendo tenant-security-change y adversarial-review. Se revisaron privilegios, consultas tenant, HTML/CSS no confiable, scope, IDs, ausencia de recursos de red, estado visible, capacidad, bytes de CSS, reintentos tras upload, ZIP determinista y mantenimiento del compilador editorial. Se corrigieron la repetición de CSS por instancia, la pérdida del estado visible `.slide.active`, el reemplazo accidental de clases como `.slide-title` y la propagación de los límites de campos al contrato editorial. La spec empaquetada y sus ejemplos reciben la familia saneada.
