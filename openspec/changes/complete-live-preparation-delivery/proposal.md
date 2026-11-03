## Why
La preparación síncrona aprobada solo se descarga desde Engine. Se necesita entregarla a una sesión autorizada de Learning conservando contenido privado y revisiones.
## What Changes
- Añadir selección de sesiones de Learning y entrega firmada desde servidor.
- Validar aprobación vigente y modalidad síncrona/híbrida antes del efecto.
- Compartir contrato canónico con Learning y rechazar excesos sin truncado.
## Capabilities
### New Capabilities
- `live-preparation-delivery`: entrega de preparación académica a Learning.
### Modified Capabilities
Ninguna adicional.
## Impact
Dominio course-delivery, etapa final y API de comandos. Se reutilizan configuración y permisos de servidor. No se despliega ni se envía contenido real como prueba.
