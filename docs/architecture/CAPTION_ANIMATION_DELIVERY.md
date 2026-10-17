# Animación y énfasis de captions: entrega local

Fecha: 2026-10-15. Implementación local; publicación del código y validación de un render remoto por el proveedor actual pendientes.

## Uso

Seleccionar una capa de captions y abrir el inspector de contenido. En **Animación y resaltado**:

1. Activar **Configurar efectos de toda la capa** y elegir entrada/salida.
2. Elegir una frase y activar **Personalizar esta frase** para modificar propiedades concretas. Desactivarlo restaura la herencia de capa.
3. Configurar **Palabra activa**: karaoke original, desactivado, opacidad o color. El pulso es opcional y requiere timestamps por palabra alineados con el texto.
4. En **Palabras clave**, elegir color/fondo y pulsar las palabras a marcar. Funciona sin timestamps, identifica apariciones repetidas por posición y respeta Unicode.
5. Pulsar **Guardar contenido y estilo**. Contenido, estilos y efectos se guardan en el mismo lote atómico del documento.

Los captions pueden ser manuales, importados SRT/VTT o generados desde voces con timestamps vigentes. Esta entrega no convierte subtítulos incrustados en un video ni importa automáticamente la URL de subtítulos de HeyGen.

## Contrato

`NATIVE_CAPTIONS.effects` es opcional, con `version: 1`. Incluye `entry`, `exit`, `durationSeconds`, `intensity`, `karaoke`, `activeColor`, `inactiveOpacity` y `pulse`. Los cues pueden contener `effects` parciales y `emphasis` con rangos UTF-16 seguros por grafema y colores enumerados por esquema hexadecimal.

La nueva operación `clip.caption-effects` recibe la configuración completa o `null` para volver al comportamiento heredado. `clip.caption-cues` conserva los metadatos por frase; editar el texto invalida sus palabras acústicas y énfasis. Los contratos estrictos rechazan versiones desconocidas y referencias inválidas.

- Configuración ausente: renderer y karaoke anteriores.
- Override de frase: hereda todas las propiedades que no declare.
- Color activo tiene prioridad temporal sobre el color estático; al terminar vuelve al estilo base/énfasis.
- La opacidad del texto se conserva en los colores RGBA; las opacidades de capa, frase y palabra siguen siendo independientes.
- Presets de entrada: Ninguna, Fade, Subir suavemente y Pop. Salida: Ninguna o Fade.
- Entradas y salidas se ajustan para caber en la frase, incluso si dura un frame.

No se almacena HTML, JavaScript ni selectores enviados por el usuario. No se añaden tablas ni dependencias. Los validadores SQL de extracción narrativa conservan campos adicionales del cue/source por igualdad JSON, por lo que no requieren una migración para esta configuración.

## Arquitectura y archivos

En `apps/web/src/domains/production/composition-editor/`:

- `composition-caption-effects.types.ts`: contrato, flag y límites centralizados.
- `composition-caption-effects.service.ts`: herencia, rangos Unicode, invalidación y edición de intervalos.
- `composition-caption-effects-plan.ts`: plan determinista y fragmentación textual; evita crear una animación general por palabra.
- `composition-caption-effects-runtime.ts`: scheduler GSAP autocontenido compartido entre preview y exportación.
- `composition-caption-effects-projection.ts`: expectativas QA con el mismo scheduler/easing.
- Renderer, compilador, esquemas de documento/patches, políticas de preview y contratos/captura QA: integración con los flujos existentes.

En `apps/web/src/domains/materials/components/composition-editor/`, los nuevos controles `CompositionCaptionEffectsControls.tsx` y `CompositionCaptionEmphasisControls.tsx` se integran con el formulario existente de `CompositionTextControls.tsx`. El componente principal no concentra lógica de animación.

## Recortes y edición

- Split/remove-range: preservan configuración, énfasis y overrides; intersectan tiempos de cue/palabra con cada fragmento.
- Una frase cortada conserva el texto autoritativo y puede reiniciar su entrada en cada fragmento.
- Trim izquierdo: recalcula el origen; extender hacia la izquierda añade silencio sin adelantar las palabras existentes.
- Duración más corta: recorta cues/palabras fuera del intervalo. Extender no estira timestamps ni inventa texto.
- Editar los límites de una frase desde el inspector recorta las palabras al guardar; no las regenera ni estira.
- Mover, duplicar y restaurar documentos mantienen configuración local y referencias independientes.
- Cambiar texto retira tiempos por palabra y rangos textuales de ese cue; mantiene su configuración de animación.
- Regeneración desde voz conserva efectos de capa e informa cuántas frases pierden personalizaciones. Continúa rechazando capas manuales/importadas y múltiples capas generadas fragmentadas, explicando el impacto sobre recortes.
- Los conflictos de animación general de capa al cortar siguen sujetos a las protecciones anteriores.

## Seguridad y límites

Se reutilizan autenticación, aislamiento por organización, historial y autorización de patches. Los efectos nuevos requieren intención de usuario y respetan pistas bloqueadas. El texto se escapa antes de renderizar. Colores, versiones, presets y números se validan explícitamente.

La configuración tiene un máximo de 100 rangos por cue, 2 segundos de duración nominal por fase y **4.000 elementos derivados de efectos por documento**. No se consume el presupuesto de 200 animaciones generales por palabra. El presupuesto se valida antes de persistir/compilar y rechaza el exceso con un mensaje accionable.

La prueba inicial de carga con 10.000 elementos derivados excedió el timeout de evaluación de Chromium de 20 s en el host de referencia. Por ello se redujo el límite; las cifras del benchmark aprobado se conservan en el reporte local. Este límite no constituye una garantía de FPS para cualquier equipo o proyecto con otros medios.

`NEXT_PUBLIC_CAPTION_EFFECTS_ENABLED=false` deshabilita autoría nueva, pero no lectura/render de efectos guardados. Cambiar esta variable pública requiere reconstruir el frontend. Desactivar la flag no hace compatible un binario antiguo: el rollback debe conservar un lector del contrato o restaurar explícitamente una revisión anterior.

## QA reproducible

Desde `apps/web`:

```powershell
npm run test:composition-caption-effects
npm run test:composition-native-fragments
npm run test:composition-timeline
npm run test:composition-transitions
npm run qa:composition-caption-effects
# Opcional: carga cercana al presupuesto y MP4 local con el encoder ya instalado.
npm run qa:composition-caption-effects -- --benchmark --ffmpeg ../../node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe
```

El script de QA usa Chromium local y, opcionalmente, FFmpeg. No solicita renders remotos ni usa Cloud Run. Produce `.tmp/composition-caption-effects-qa/` con HTMLs de preview/export, documento, capturas, reporte JSON y MP4 si se proporciona encoder.

Cobertura: contratos inválidos, grafemas, puntuación, palabras repetidas/CJK, ausencia de timestamps, frases cortas, silencios, límites, herencia, cambios de texto/timing, cortes, restauración, pistas bloqueadas, flag de autoría, scheduler embebido y seek inverso. La captura de conformidad verifica color, fondo, opacidad y transforms de los elementos internos contra expectativas congeladas, además de las protecciones geométricas anteriores.

Verificación final: 219 pruebas aprobadas en las suites afectadas y de regresión, incluyendo 15 específicas de efectos; TypeScript completo (`tsc --noEmit --incremental false`), compilación del harness y lint de módulos afectados sin errores.

QA visual local aprobada: nueve checkpoints en preview y HTML de exportación, igualdad píxel por píxel, seek inverso y rechazo de color alterado deliberadamente. Se generó un MP4 local H.264 de 6 s, 640×360, 25 FPS y 150 frames, verificado con FFprobe.

Host de referencia: Windows x64, AMD Ryzen 5 5500U, 12 procesadores lógicos. El reporte JSON registra compilación, tamaño de HTML, elementos derivados y, con `--benchmark`, inicialización y seek del caso grande. Las mediciones son locales y no extrapolan rendimiento del proveedor.

Medición aprobada al límite: 100 frases, 2.000 palabras temporizadas y 4.000 elementos derivados; documento de 151 KB y HTML de 4,35 MB. Compilación de aproximadamente 62 ms, inicialización de Chromium de 3,66 s y cinco seeks entre 20 y 40 ms. Antes de preparar los estados GSAP durante la carga, el primer salto grande tardaba hasta 2,8 s. La preparación solo toca wrappers de captions y permanece bajo el único timeline maestro pausado.

## Validación residual y evolución

Antes del rollout productivo: validar el inspector en una sesión autenticada con un curso real, guardar/recargar y deshacer/rehacer desde UI; completar un render por la integración HyperFrames/HeyGen existente con las fuentes y medios del curso. La prueba local no acredita el procesamiento remoto del proveedor.

Quedan fuera: transcripción/alineación nueva, importación remota de SRT de HeyGen, regeneración coordinada multicapas, edición libre de keyframes por palabra y énfasis parcial dentro de cajas TEXT. Extender presets desde el contrato/plan/runtime y añadir sus checkpoints; evitar lógica de negocio dentro del inspector.
