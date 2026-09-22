# Adaptador PCM para RNNoise

`rnnoise-pcm.c` procesa PCM crudo `s16le`, mono, 48 kHz. Su contrato es:

```text
rnnoise-pcm MODEL.bin INPUT.pcm OUTPUT.pcm
```

El archivo de modelo es obligatorio. El código no contiene pesos, no descarga
artefactos y no se ejecuta todavía desde el worker. El build deberá compilarlo
contra la versión aprobada de `rnnoise.h` y `librnnoise`, con el modelo verificado
por SHA-256 antes de la ejecución. No usar el ejemplo `rnnoise_demo` como binario
de producción.

La implementación lee como máximo 50 MiB de entrada, rechaza archivos vacíos
o con un byte incompleto, conserva exactamente el número de muestras y publica
la salida solo tras completar la escritura. El estado de RNNoise vive durante
todo el archivo. Descarta la primera salida no inicializada y envía un cuadro
de ceros al final para recuperar las muestras retrasadas.

La prueba `node apps/api/native/rnnoise/test/test-adapter.mjs` compila el
adaptador con un mock de RNNoise que retrasa exactamente un cuadro. Valida
longitudes, muestras, archivos incompletos y fallos básicos sin usar pesos.
Requiere un compilador C11 de tipo `cc` y se ejecuta en GitHub Actions sobre
Ubuntu. Antes de usar el modelo real, faltan pruebas de impulso/alineación,
calidad auditiva, clipping y rendimiento con la biblioteca aprobada.

El adaptador devuelve `2` para uso incorrecto, `3` para entrada inválida,
`4` para modelo no disponible, `5` para error de I/O y `6` para error del motor.
No imprime rutas de archivos ni audio en sus mensajes de error.
