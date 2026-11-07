# Evidencia local

- `test:hyperframes` pasó 701 pruebas. Incluye parámetros enviados con transporte simulado, coincidencia con el snapshot y límites de tamaño.
- Las seis pruebas de evidencia de render pasaron. La variante MOV exige la extensión y el MIME correctos. Sin checksum independiente, la evidencia permanece incompleta.
- `test:hyperframes-video-range` pasó cinco pruebas, incluido MOV con MIME directo y con respuesta binaria.
- Pasaron `typecheck`, `openspec:validate`, `docs:check`, `compliance:check` y `git diff --check`.
- `verify:pr` pasó el arnés con un directorio temporal del workspace y se detuvo en lint por una advertencia nueva. La recarga de la descarga se trasladó a los eventos de finalización. `npm run lint` pasó después con cero diferencias frente al baseline.
- Pasó la prueba aislada de planificación de cuadros para 4K/30 FPS y 1080p/24 FPS.
- `test:composition-exported-video` encontró un EPERM al reemplazar un fixture en el directorio temporal del sandbox. Al usar un temporal dentro del repositorio, pasó la prueba de integridad de archivos y se ejecutaron las pruebas de análisis. El FFmpeg empaquetado terminó con código 3221225477 al generar el MP4 base; el mismo binario también falló con `-version`. La comparación integral local quedó pendiente.

## Aceptación en HeyGen

Crear un snapshot de cada perfil y probarlo con un clip corto que contenga
audio. Inspeccionar dimensiones, FPS, códec y duración mediante ffprobe.
Comprobar que MOV se descarga con extensión .mov y audio. Si se necesita
publicar MOV, comprobar la compatibilidad del destino de reproducción.
La verificación de checksum y conformidad persistida para MOV queda fuera
del pipeline actual de MP4.

El presupuesto de MOV usa una estimación de referencia de ProRes 4444,
ajustada por FPS. La cifra es orientativa y el importador aplica el límite
real de bytes.

- [Contrato público de HyperFrames Cloud](https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes-cli/references/cloud.md)
- [Tasas de referencia de Apple ProRes](https://www.apple.com/final-cut-pro/docs/Apple_ProRes.pdf)
