# Generación coordinada de materiales

## Why
El híbrido ofrece controles inconexos para Hub y Academy. Hub detiene toda la tanda ante un fallo; los reintentos asíncronos pueden alterar el estado de otros workers. Los diagnósticos fragmentados dificultan localizar causas sin repetir trabajo pagado.

## What Changes
- Vista de Materiales con inicio coordinado y progreso separado por destino.
- Fallos tipados por etapa con acción de recuperación y correlación segura.
- Academy permite reintentar una lección fallida mientras otras continúan, preservando componentes correctos y con reserva transaccional y concurrencia limitada.
- Hub continúa otras sesiones después de un fallo de Materiales y acepta reintentos priorizados mientras la tanda sigue activa.
- El estado global se reconcilia sin dar por terminados workers activos ni aceptar escrituras canceladas.

## Impact
Architect: UI, acciones, workers, RPC y pruebas. No cambia contratos de entrega de Academy/Hub, publicación ni generación audiovisual final. Migración local pendiente de aplicación autorizada. No inicia consumo real ni despliegue.
