# Corrección básica de color V1 — gates de distribución y QA

## Fase 6 — distribución y compatibilidad

HyperFrames declara el contrato `hyperframes-color-grading-runtime` versión 1.
Su manifiesto incluye nombres, tamaños y SHA-256 de los artefactos IIFE y ESM.
El tarball de `@hyperframes/core` debe contener:

- `dist/hyperframe.color-grading.runtime.iife.js`
- `dist/hyperframe.color-grading.runtime.mjs`
- `dist/hyperframe.manifest.json`

Courseforge valida antes de inyectar el IIFE:

- nombre y versión exactos del contrato;
- nombre esperado del artefacto;
- tamaño declarado y tamaño real;
- SHA-256 declarado y SHA-256 real;
- presupuesto máximo de 160 KiB.

Un artefacto presente pero incompatible falla cerrado. Si el runtime no está
publicado, el preview continúa con el medio original, informa el estado
`unavailable` y deshabilita los controles de color para no guardar cambios que
no puedan revisarse visualmente. El puente al repositorio hermano existe sólo
para desarrollo local.

### Gate externo pendiente

Courseforge continúa fijado a `@hyperframes/core@0.7.106`. No se debe cambiar
esa versión hasta que exista una publicación nueva que contenga los tres
archivos anteriores. Publicar a npm queda fuera de una implementación local y
requiere autorización explícita.

## Fase 7 — matriz de QA

| Escenario | Evidencia | Resultado esperado |
| --- | --- | --- |
| Contrato alterado | Test unitario de Courseforge | Rechazo antes de inyectar |
| Hash o tamaño alterado | Test unitario de Courseforge | Rechazo antes de inyectar |
| Bundle excesivo | Gate de paridad de HyperFrames | Falla sobre 160 KiB |
| WebGL disponible | Smoke Chromium con SwiftShader y asset 1920×1080 | Estado `active`; clip visible |
| WebGL no disponible | Smoke Chromium sin GPU | Estado `unavailable`; medio original visible |
| Runtime standalone | Tests de HyperFrames | No instala player, timeline ni transporte |
| Preview y render | Tests del compilador | Mismo `data-color-grading` normalizado |
| CORS remoto | HTML compilado | `crossorigin="anonymous"`; fallback visible ante fallo |
| Rollback de UI | Feature flag | Oculta controles; conserva grados persistidos |

El smoke 1080p reporta la latencia de despacho síncrono del patch, no el tiempo
de rasterización GPU. La medición de frame time con varios clips superpuestos
debe hacerse en hardware objetivo antes de ampliar V1; no bloquea el MVP de un
clip corregido.

V1 garantiza SDR/Rec.709. Courseforge todavía no persiste metadata suficiente
para identificar de forma fiable HLG, PQ, HDR o LOG, por lo que no afirma una
conversión correcta de esos formatos. Esa detección permanece como trabajo de
Product/ingesta, no como heurística del editor.
