# Centralizar la identidad de producto

## Why
La marca aparece escrita directamente en UI, metadatos, prompts y exportaciones. Un cambio de nombre exige editar múltiples capas y puede confundirse con identificadores de integración.

## What Changes
- Configuración pública, versionada y sin variables de entorno para nombre, nombre corto, asistente, logo, icono de pestaña y contacto.
- Consumidores de presentación y generación usan esa configuración; la marca actual sigue siendo el valor predeterminado hasta definir la nueva.
- Preservar proveedores externos, credenciales, cookies, formatos, eventos e identificadores persistidos.
- Pruebas de propagación y de compatibilidad; instrucciones para el futuro cambio de identidad.

## Capabilities
### New Capabilities
- `product-branding`: identidad de presentación compartida entre cliente, servidor y jobs.

## Impact
Frontend Next.js, mensajes del servidor, prompts predeterminados, generación de documentos y jobs. Sin migraciones ni despliegue. No reescribe contenido histórico o prompts personalizados guardados.
