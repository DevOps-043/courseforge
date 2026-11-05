# Restaurar ejecución Node de pruebas HyperFrames — F3.4.a

## Why
La suite HyperFrames se interrumpe en composition-agent-model-output por un import
@/lib/server/outbound-http que tsc conserva y Node CommonJS no puede resolver.
Impide ejecutar los tests posteriores y debilita la evidencia del plan.

## What Changes
- Usar una referencia relativa al mismo transporte interno en el adaptador del agente.
- Validar compilación, prueba que fallaba y suite HyperFrames completa existente.
- Reconciliar la aserción obsoleta de marca detectada al alcanzar el compilador:
  validar el manifiesto completo contra APP_CONFIG, como establece branding.
- Mantener visible cualquier otro fallo y la matriz de CI todavía pendiente.

## Impact
Una dependencia de módulo; sin cambios de contratos de proveedor, timeouts,
límites HTTP, modelos, schemas ni credenciales. Sin proveedores reales o render.
F3.4.a es un prerrequisito local de F3.4, no su integración completa en CI.
