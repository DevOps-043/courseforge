# Ajustar presets al último frame válido

## Why
El redondeo de una ventana proporcional puede dejar su último clip fuera de
una composición cuya duración termina entre frames. Además, las capas
superpuestas heredan un requisito de capacidad propio de las secuencias.

## What Changes
- Acotar las ventanas de secuencia y superposición al timeline destino.
- Exigir un frame por clip en secuencias y un frame compartido en superposiciones.
- Evaluar ajustes temporales opcionales con SofLIA para las reglas guardadas que
  no caben en el destino.

## Capabilities
### New Capabilities
- `composition-preset-timing`

## Impact
Aplicador compartido de presets V1 y V2, pruebas y contrato HyperFrames. El
esquema almacenado y el flujo de confirmación conservan su contrato.
