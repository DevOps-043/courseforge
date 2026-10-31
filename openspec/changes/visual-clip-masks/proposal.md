# Máscaras geométricas junto al recorte visual

## Why
El recorte por bordes sólo produce ventanas rectangulares. Se requieren formas no destructivas sobre el mismo medio.

## What Changes
- Máscara opcional de círculo, elipse o rectángulo redondeado en clips de imagen, video y diapositiva.
- Selector en propiedades junto al recorte, preview inmediato y guardado por interacción.
- Intersección de máscara y recorte sin alterar layout, motion ni archivo original.

## Capabilities
### New Capabilities
- `visual-clip-masks`: formas geométricas no destructivas para medios.

## Impact
Documento V2 aditivo, operación clip.mask, protocolo del iframe, renderer compartido y panel. Sin APIs nuevas, migraciones ni medios remotos. Los lectores antiguos estrictos no aceptan el campo nuevo: desplegar cliente/servidor/worker compatibles juntos y no retroceder a lectores antiguos con documentos enmascarados.
