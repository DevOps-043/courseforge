---
name: multimedia-production-change
description: Mantiene los contratos de composición, preview y render en producción multimedia.
---

# multimedia-production-change

1. Leer docs/architecture/hyperframes-composition-render-flow-source-of-truth.md y el ADR de motion.
2. Conservar courseforge-composition-v2 y document.motion como fuentes editables.
3. Separar snapshot inmutable sin credenciales de ZIP con medios materializados.
4. Revisar versiones/hashes, concurrencia, assets, duración, audio y estados del worker.
5. Actualizar fuente canónica y compliance cuando cambien contratos de proveedor.
6. Ejecutar tests HyperFrames/Remotion y QA proporcional; no confundir prueba con mocks con render cloud observado.
