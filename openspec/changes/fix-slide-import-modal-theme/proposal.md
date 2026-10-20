# Corregir presentación del modal de importación

## Why
El diálogo HTML se monta dentro de `engine-page-hero`. Sus reglas globales de texto claro con `!important` afectan el modal de fondo blanco, y los controles mantienen colores fijos en modo oscuro.

## What Changes
- Reutilizar EngineDialog, como los modales de usuarios y confirmación, con portal fuera del encabezado.
- Aplicar tokens del tema a controles, avisos, botones y campos; separar cuerpo desplazable y acciones persistentes.
- Corregir el fixture visual para cargar CSS real, montar el disparador dentro del encabezado y comprobar ambos temas y móvil.

## Capabilities
### Modified Capabilities
- `imported-slide-templates`: presentación consistente del flujo de importación.

## Impact
Solo frontend, estilos locales y QA de navegador. Sin cambios en APIs, seguridad del iframe, persistencia ni renderizado de diapositivas.
