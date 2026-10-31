# Revisión: generación automática de subtítulos transparentes

Fecha: 2026-10-31. Alcance: inspección del repositorio y pruebas locales; sin cambios de comportamiento ni operaciones remotas.

Seguimiento: esta revisión precede a la implementación local documentada en
[subtítulos automáticos](../openspec/changes/automatic-transparent-captions/reports/validation.md).

## Objetivo y criterio funcional

Crear subtítulos sincronizados como capas nativas editables, con opacidad del fondo igual a cero, sin escribir cada frase manualmente. Se distinguen dos alcances: generación solicitada desde el editor y generación sin intervención dentro del pipeline de producción.

## Hallazgos comprobados en código

| Capacidad | Estado y evidencia |
| --- | --- |
| Capa manual transparente | Existe. `composition-native-overlay.factory.ts` crea `NATIVE_CAPTIONS` con `DEFAULT_TRANSPARENT_CAPTION_STYLE` (`backgroundOpacity: 0`). |
| Generación de frases desde voz | Existe. `createCompositionTranscriptCaptionPlan` reutiliza la misma fábrica, conserva timestamps por palabra y produce patches del documento. No exige escribir cada frase. |
| Acceso desde UI | Texto → «Generar desde la voz» en `CompositionStudioLibrary.tsx`; `NativeCompositionPreview.tsx` calcula escenas, genera el plan y lo guarda por el flujo existente. El botón se deshabilita sin palabras disponibles. |
| Obtención de tiempos | `deriveCompositionScenes` necesita escenas narrativas con `wordTimestamps` y clips visibles en pistas con rol `VOICE`. El fallback de escenas no proporciona `wordCues`. El audio de un video importado no se transcribe en este flujo. |
| Regeneración | Actualiza una única capa con origen `TRANSCRIPT` y conserva estilo de capa. Rechaza capas manuales/importadas y múltiples capas de transcripción para proteger edición y recortes. |
| Pipeline automático | En las referencias inspeccionadas, el plan nativo solo se invoca desde la UI y pruebas. El dispatcher de producción propaga `avatar.caption` al proveedor; ese indicador no invoca la creación de capas nativas transparentes. |

Fuentes principales, relativas a la raíz del repositorio:

- `apps/web/src/domains/production/composition-editor/composition-transcript-caption.service.ts`
- `apps/web/src/domains/production/composition-editor/composition-native-overlay.factory.ts`
- `apps/web/src/domains/production/composition-editor/composition-scene.service.ts`
- `apps/web/src/domains/materials/components/composition-editor/CompositionStudioLibrary.tsx`
- `apps/web/src/domains/materials/components/composition-editor/NativeCompositionPreview.tsx`
- `apps/web/src/domains/production/automation/production-automation-dispatcher.service.ts`

## Diagnóstico

La transparencia ya está resuelta y compartida entre creación manual y generación desde voz. La brecha para automatización completa es la integración del plan nativo con el pipeline, además de obtener timestamps cuando la fuente no los contiene. Cambiar únicamente el estilo o activar captions del proveedor no cubre esa brecha.

No se identificó una composición afectada ni se inspeccionó una sesión en ejecución. Que falten timestamps en el caso reportado es una hipótesis, no una causa raíz observada en ese documento.

## Implementación recomendada

1. Reutilizar `createCompositionTranscriptCaptionPlan`; mantener `NATIVE_CAPTIONS` y el documento versionado como fuente editable. Los lectores actuales promueven las capas nativas al contrato V3; no forzar V2.
2. Añadir una preferencia explícita de subtítulos nativos en la configuración del pipeline, independiente del indicador de captions del proveedor. Evitar generar ambas variantes inadvertidamente.
3. Ejecutar el caso de uso cuando existan borrador, voces y timestamps disponibles, antes de congelar el snapshot de ensamblado. Persistir por los controles existentes de autorización, revisión/hash y concurrencia; no escribir directamente JSONB desde el dispatcher.
4. Reutilizar tiempos existentes. Para fuentes sin ellos, definir un job de transcripción o alineación con permisos sobre el asset, límites de duración/tamaño, proveedor y política de costos. No estimar tiempos a partir del guion como si fueran sincronización real.
5. Identificar el intento por borrador, revisión y fuentes para evitar duplicados en reintentos. Si cambia el documento, recalcular y volver a validar; preservar capas manuales/importadas y recortadas, con resultado observable que solicite revisión.
6. Registrar estado, conteo de frases y errores seguros. No registrar texto transcrito ni URLs firmadas. Distinguir falta de timestamps, conflicto editorial y fallo del proveedor.

## Criterios de aceptación para la ampliación

- Con automatización habilitada y voz con tiempos, el pipeline crea una sola capa editable `TRANSCRIPT`, sincronizada y transparente, sin pulsar el botón del editor.
- Reintentar no duplica capas ni sobrescribe una edición posterior.
- Sin tiempos, el sistema informa la dependencia pendiente o ejecuta el job configurado; no marca el paso como completado con subtítulos vacíos.
- Capas manuales/importadas/recortadas conservan sus datos y producen un resultado explícito de revisión cuando bloquean la generación.
- Previsualización y render usan los mismos cues y estilo. El fondo es transparente; esto no implica que el archivo de video exportado tenga canal alfa.
- Se prueban permisos entre organizaciones, conflictos de revisión, errores parciales y fuentes movidas/recortadas; velocidad y otras transformaciones requieren escenarios específicos de sincronización.

## Validación local

`npm run test:composition-caption-presets --workspace=apps/web`: código de salida 0; compilación TypeScript y 35 pruebas aprobadas, sin fallos ni omisiones.

La suite cubre presets, efectos, overlay nativo y generación/regeneración desde timestamps. No demuestra transcripción de archivos importados, ejecución automática del pipeline, persistencia remota ni render cloud.
