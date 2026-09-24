# Avisos de terceros

Este archivo acompaña las distribuciones de Courseforge que incluyan código de
terceros. No concede derechos adicionales ni sustituye las licencias originales.

## HyperFrames

Courseforge declara estas dependencias directas en `apps/web/package.json`:

- `@hyperframes/core` 0.7.106
- `@hyperframes/studio` 0.7.106
- `@hyperframes/studio-server` 0.7.106

Sus dependencias `@hyperframes/parsers`, `@hyperframes/player` y
`@hyperframes/sdk` se resuelven a la versión 0.7.106
en `package-lock.json`.

Origen: <https://github.com/heygen-com/hyperframes>  
Copyright 2026 HeyGen, Inc.  
Licencia: Apache License, Version 2.0. Su texto completo se entrega en
[`licenses/Apache-2.0.txt`](licenses/Apache-2.0.txt).

No se afirma patrocinio, afiliación ni certificación de Courseforge por HeyGen
o HyperFrames. Las marcas se usan únicamente para identificar el origen del
software.

## Workers de audio opcionales

Las imágenes que incorporen DeepFilterNet deben incluir los textos originales
`LICENSE-APACHE` y `LICENSE-MIT` y el inventario de dependencias Rust del
binario. Courseforge selecciona Apache-2.0 para el código de DeepFilterNet. El modelo ONNX se
registra por separado en el manifiesto de la imagen, con la licencia y revisión
aprobadas para ese artefacto exacto.

Las imágenes que incorporen RNNoise deben incluir su aviso BSD-3-Clause
[`licenses/RNNoise-BSD-3-Clause.txt`](licenses/RNNoise-BSD-3-Clause.txt),
además de la documentación aplicable a los pesos elegidos. Este aviso identifica
la licencia del código RNNoise; no atribuye automáticamente esa licencia a los
pesos descargados por separado.

Ambas imágenes deben registrar también la licencia y configuración de la build
de FFmpeg incluida. Los modelos no se versionan en este repositorio.

## Alcance de este aviso

Este aviso cubre HyperFrames y las imágenes de audio que incorporen los
componentes descritos arriba. Cada release debe verificar y documentar las
licencias de todas las dependencias presentes en su artefacto final, incluidas
las transitivas. Consulte
[`docs/compliance/registro-heygen-hyperframes.md`](docs/compliance/registro-heygen-hyperframes.md)
y el protocolo de actualización antes de publicar.
