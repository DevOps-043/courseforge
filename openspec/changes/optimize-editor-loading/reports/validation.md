# Evidencia y límites — 2026-11-06

## Diagnóstico por inspección

- `ArtifactStageContent.tsx` importaba estáticamente las siete etapas posteriores
  a la base, incluyendo producción y ensamblado. Se sustituyen por imports
  dinámicos estables y un indicador accesible de carga.
- `HyperframesCompositionPanel.tsx` esperaba sincronización, biblioteca,
  contenedor de composición y borrador de forma secuencial. El contenedor ahora
  se prepara durante la sincronización. Biblioteca y borrador se solicitan en
  paralelo después de sincronizar. El montaje espera ambos resultados.
- La sincronización esperaba registro y Storage por referencia. Ahora comprueba
  cuatro referencias por lote, con ambas consultas solapadas por referencia:
  máximo cuatro lecturas de registro y cuatro de Storage en vuelo por solicitud.
  Las descargas completas, hashes y escrituras siguen siendo secuenciales.

Estas dependencias están comprobadas en código; no se midió su contribución
porcentual a la latencia del incidente real.

## Validaciones ejecutadas

| Comando | Resultado |
| --- | --- |
| `npm run test:hyperframes --workspace=apps/web` | Ejecución final: código 0, 675 pruebas aprobadas, 0 fallos. |
| `npm run typecheck` | Ejecución final: código 0. La primera detectó un callback inferido como literal `true`; corregido con contrato explícito `() => boolean`. |
| `npm run lint` | Ejecución final: código 0, 0 errores y 0 diferencias frente al baseline de 570 warnings. |
| `npm run docs:check` | Código 0; 348 documentos verificados. |
| `npm run openspec:validate` | Código 0; 50 elementos válidos, 0 fallos. |
| `npm run verify:pr` | Código 1 en `test:harness`: 39 pruebas, 24 aprobadas y 15 fallidas por `git init` sin permiso para escribir `.git/config` en temporales del sandbox. No alcanzó `verify` de producto. |
| `git diff --check` | Código 0; advertencias de conversión LF/CRLF del checkout. |

Salidas completas locales: `.tmp/editor-loading-hyperframes-final.log`,
`.tmp/editor-loading-typecheck-final.log`, `.tmp/editor-loading-lint-final.log`,
`.tmp/editor-loading-docs.log`, `.tmp/editor-loading-openspec.log` y
`.tmp/editor-loading-verify-pr.log`. Son evidencia temporal, no archivos de producto.

## Cobertura nueva

Nueve pruebas: cuatro de preparación, tres de lotes y dos de integración del
servicio de fuentes. Validan orden de dependencias, solapamiento, biblioteca
independiente del fallo del borrador, propagación de errores, máximo de cuatro
referencias, escrituras/descargas secuenciales, parada ante errores, idempotencia,
actualización de duración precisa y rechazo de otra organización. Los tests
de integración usan un cliente simulado; no acceden a datos ni Storage reales.

## Revisión adversarial propia

- Se conserva la sincronización antes del borrador para evitar ensamblados con
  medios anteriores. No se cachean documentos ni URLs firmadas nuevas.
- Se corrigió el montaje prematuro: la respuesta del borrador no monta el editor
  hasta que también termina la biblioteca.
- La preparación anterior no puede reemplazar el estado de la nueva; también
  se comprueba vigencia antes de actualizar los clips HTML de la biblioteca.
- Se mantienen filtros por componente/organización y la recuperación de
  colisiones al registrar fuentes. Los errores no se convierten en éxito.
- La concurrencia se limita por solicitud; una carga agregada de muchas sesiones
  todavía requiere medición de capacidad. No se promete un SLO sin esa prueba.
- Revisión realizada por el mismo agente; no constituye revisión independiente.

## QA pendiente y extensión

No se ejecutaron navegador autenticado, build de producción, render cloud ni
pruebas con proveedores. Medir en QA, con build de producción y el mismo curso:

1. Abrir artefactos pequeños y grandes, con caché fría y caliente.
2. Cambiar entre lecciones con voz/avatar/slides; verificar biblioteca y preview.
3. Editar, esperar confirmación de guardado, cambiar y volver; comprobar contenido.
4. Simular error de sincronización y del borrador; verificar aviso y recuperación.
5. Comparar p50/p95 de apertura y waterfall de red antes/después, incluyendo
   peticiones a registro, Storage y reconciliación HeyGen.

La carga SSR de lecciones para publicación y la recuperación histórica de HeyGen
siguen en el flujo existente. Las miniaturas de video de la biblioteca siguen
solicitando metadatos al montarse. Son candidatos a una segunda optimización si
las mediciones los señalan. La mejora real y el tamaño final de los chunks siguen
pendientes de QA; los tests acreditan concurrencia y correctitud, no velocidad
en producción. Revertir los archivos del cambio restaura el flujo anterior, sin
migraciones ni conversión de documentos.
