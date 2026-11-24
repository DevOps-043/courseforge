# Clip de prueba

`session-broll.mp4` es un segundo de imagen negra de 64 × 64, sin audio ni datos
personales, generado localmente con FFmpeg para probar la inspección real de MP4.
No procede de un proveedor ni requiere generar archivos durante CI.

Comando desde la raíz:

```powershell
ffmpeg -f lavfi -i color=c=black:s=64x64:d=1 -an -c:v libx264 -pix_fmt yuv420p -movflags +faststart apps/web/src/domains/course-delivery/__tests__/fixtures/session-broll.mp4
```
