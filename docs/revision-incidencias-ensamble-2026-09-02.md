# Revisión e implementación de incidencias de ensamble — 2 de septiembre de 2026

Se revisó el reporte de incidencias contra el editor nativo de composición, el constructor de escenas de HeyGen y el flujo de borradores de HyperFrames. Los hallazgos reproducibles quedaron corregidos en el código local.

## Estado

| Incidencia o mejora | Diagnóstico | Implementación |
| --- | --- | --- |
| Correspondencia entre guion, voz/avatar y slides | El editor derivaba sus escenas de las slides y no conservaba la escena narrativa de producción. | El documento ahora transporta escenas narrativas, guion, marcas de palabra, identidad de medios y asociación visual revisada. El editor muestra esta información por escena. |
| Uso obligatorio de todas las slides | El documento inicial insertaba el deck completo y repartía uniformemente la duración. | Cada escena permite seleccionar cero, una o varias slides, ordenarlas y asignarles peso. El preensamble sólo incorpora la selección aprobada y la ajusta a las duraciones reales. |
| Slides eliminadas reaparecen | La reconciliación interpretaba una slide ausente como una fuente nueva. | Las exclusiones editoriales se guardan con una identidad estable del contenido. Reconciliar fuentes ya no recupera una slide quitada. |
| Preview de animaciones desactualizado | Las animaciones se clasificaban como cambios de timeline, pero no existía un parche incremental para su runtime. | El preview puede sustituir el estado completo de motion sin reconstruir el iframe. Los cambios que no admiten parche actualizan automáticamente el preview después de guardarse. |
| Cambios rápidos descartados | Con el flag V2 desactivado, una segunda operación durante un guardado podía no entrar a la cola. | Todas las escrituras del editor pasan por la cola secuencial y conservan el control de concurrencia por hash/ETag. |
| Dificultad para revisar entradas y salidas | Seleccionar una animación no garantizaba que el cursor estuviera dentro de su intervalo. | La selección lleva el cursor a la ventana de la animación y la acción «Ver animación» reproduce únicamente ese intervalo. |
| Precisión del cursor | Las flechas movían 0.5 segundos, equivalentes a 12.5 fotogramas a 25 FPS. | Las flechas avanzan un fotograma exacto; Mayús + flecha avanza un segundo. El control y el indicador respetan el FPS del documento. |
| Medios ausentes en render | El descriptor de render podía conservar sólo `data-var-src`, sin materializar `src` para el proveedor. | La preparación del render materializa las variables de medios y mantiene paridad con el preview. El diagnóstico detallado está en `docs/diagnostico-medios-render-2026-09-02.md`. |

## Preensamble narrativo

El constructor de escenas expone el catálogo versionado de slides. Cada escena guarda un `visual_plan` con:

- versión del deck;
- huella del guion guardado;
- slides seleccionadas en orden;
- peso relativo de duración por slide.

La API valida que las referencias pertenezcan al deck actual y calcula en el servidor la huella del guion. Si cambia el guion, el deck, la voz o el avatar, la escena queda pendiente de revisión. Confirmar esta asociación no genera audio, avatar ni slides y no consume proveedores externos.

El editor ofrece «Aplicar preensamble» cuando todas las escenas están revisadas y existen duraciones reales de voz o avatar. La operación usa `If-Match`, rechaza conflictos concurrentes y no modifica un track de slides bloqueado. Los borradores existentes conservan sus tiempos manuales durante la reconciliación normal; reemplazar la distribución visual requiere la acción explícita de preensamble.

La duración de una escena usa primero la voz medida y, si no existe, el medio de avatar. Voz y avatar de una misma escena no se suman dos veces. Las slides seleccionadas dividen ese intervalo según sus pesos, sin imponer una cuota por minuto.

## Preview y edición

El runtime de motion se genera desde una única función compartida. Un parche de animación elimina la versión anterior, restablece el estado visual del target y agrega la nueva timeline. Esto evita que el inspector y el canvas representen documentos distintos.

El panel narrativo permite consultar el guion junto con sus visuales. Cuando la voz tiene marcas por palabra, cada palabra funciona como navegación al tiempo absoluto correspondiente. Las escenas sin marcas siguen mostrando el guion completo.

Quitar un clip registra una exclusión durable; agregarlo nuevamente elimina esa exclusión. Las identidades de slide dependen de su contenido, por lo que reordenar el deck no reasigna silenciosamente la decisión editorial.

## Verificación

- `npx tsc -p apps/web/tsconfig.json --noEmit --pretty false`: aprobado.
- `npm run test:composition-scenes -w apps/web`: 32 pruebas aprobadas, incluidas selección narrativa, preensamble, escenas y exclusión durable.
- `npm run test:composition-preview-sync -w apps/web`: 17 pruebas aprobadas.
- `npm run test:hyperframes-media -w apps/web`: 26 pruebas aprobadas.
- `npm run test:hyperframes -w apps/web`: suite completa aprobada; incluye 46 casos del editor y 22 de compilación/paridad preview-render.
- `npm run qa:composition-preview-runtime -w apps/web`: smoke test aprobado en Chrome, incluida la actualización de motion en vivo.
- `npm run build -w apps/web`: build de Next.js aprobado.
- Inicio local y acceso a `/login`: aprobado. `/admin/heygen` redirige correctamente al login sin una sesión autenticada.

## Validación operativa pendiente

La prueba integral con proveedores requiere un artefacto real y una sesión autorizada. Para medir la mejora se debe repetir un caso base, como el video de 3:50 con 15 slides, y registrar por separado tiempo activo humano, espera de voz/avatar/slides, reintentos, ensamble, cola de render e importación final. La comparación debe verificar visualmente inicio, límites de escena y final del MP4, además de la correspondencia aprobada por escena.

El build registra avisos existentes de rutas dinámicas por uso de cookies durante la generación estática; Next.js las clasifica como rutas dinámicas y finaliza correctamente.
