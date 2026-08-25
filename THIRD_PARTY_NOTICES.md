# Avisos de terceros

Este archivo acompaña las distribuciones de Courseforge que incluyan código de
terceros. No concede derechos adicionales ni sustituye las licencias originales.

## HyperFrames

Courseforge declara estas dependencias directas en `apps/web/package.json`:

- `@hyperframes/studio` 0.7.106
- `@hyperframes/studio-server` 0.7.106

Sus dependencias `@hyperframes/core`, `@hyperframes/parsers`,
`@hyperframes/player` y `@hyperframes/sdk` se resuelven a la versión 0.7.106
en `package-lock.json`.

Origen: <https://github.com/heygen-com/hyperframes>  
Copyright 2026 HeyGen, Inc.  
Licencia: Apache License, Version 2.0. Su texto completo se entrega en
[`licenses/Apache-2.0.txt`](licenses/Apache-2.0.txt).

No se afirma patrocinio, afiliación ni certificación de Courseforge por HeyGen
o HyperFrames. Las marcas se usan únicamente para identificar el origen del
software.

## Alcance de este aviso

Este aviso cubre HyperFrames. Cada release debe verificar y documentar las
licencias de todas las dependencias presentes en su artefacto final, incluidas
las transitivas. Consulte
[`docs/compliance/registro-heygen-hyperframes.md`](docs/compliance/registro-heygen-hyperframes.md)
y el protocolo de actualización antes de publicar.
