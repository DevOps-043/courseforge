# Ampliar el tamaño de importación HTML

## Why
El límite inicial de 500 KB bloquea archivos HTML/CSS de varias diapositivas. El mismo límite se usa para fuente, familia procesada y mensajes, aunque representan presupuestos distintos.

## What Changes
- Admitir archivos HTML de hasta 2 MB y familias normalizadas de hasta 2 MB.
- Centralizar presupuestos y mensajes; limitar peticiones y respuestas a 5 MB, por debajo del límite de 6 MB de Netlify.
- Leer JSON mediante un stream acotado y validar bytes UTF-8, incluso sin Content-Length.
- Conservar las restricciones del editor por fragmento, CSS y complejidad, con mensajes que distingan el presupuesto excedido.
- Validar un deck realista de texto/SVG de más de 500 KB, límites exactos y ampliación por JSON/previews.

## Capabilities
### Modified Capabilities
- `imported-slide-templates`: presupuestos de tamaño separados para importación y procesamiento.

## Impact
Contrato compartido, cliente de importación, frontera HTTP y validación del dominio. Se conserva el cambio visual pendiente de la misma funcionalidad en la rama actual. Sin publicación, migraciones, cambios de permisos ni ampliación de recursos externos admitidos.
