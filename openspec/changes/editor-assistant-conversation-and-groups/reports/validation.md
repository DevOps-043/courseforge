# Verificación local

- `npm run test:hyperframes --workspace=apps/web` terminó con código 0.
  Incluye la prueba del límite conversacional, la agrupación con confirmación y
  reversión, y el rechazo del guardado directo del agente.
- Plan del agente y grupos anidados, ejecutados desde la salida compilada de
  HyperFrames, sumaron 36 pruebas aprobadas.
- Validación estricta del cambio OpenSpec, ESLint dirigido y
  `git diff --check` terminaron con código 0.
- `npm run verify:pr` terminó con código 0. El lint global registró
  cero errores y cero diferencias con su línea base.

Las pruebas usan documentos locales. No se comprobó el incidente original
contra respuestas almacenadas ni se invocaron proveedores de IA. La aplicación
y el guardado real en staging requieren una verificación en ese entorno.
