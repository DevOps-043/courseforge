# Importación de plantillas HTML de diapositivas

## Why
El catálogo configura seis layouts del mismo renderizador. Importar diseños HTML debe conservar su estructura visual y permitir sustituir contenido sin ejecutar código externo.

## What Changes
- Incorporar carga, limpieza, revisión de campos, preview aislado y guardado desde plantillas de diapositivas.
- Conservar una familia HTML/CSS versionada en las specs existentes y empaquetarla en el catálogo actual.
- Renderizar esa familia con contenido del agente, selección por capacidad y errores explícitos si no cabe.
- Mantener los seis layouts existentes para plantillas anteriores.

## Capabilities
### New Capabilities
- `imported-slide-templates`: importar diseños HTML estáticos y reutilizarlos.

## Impact
Dominios slides/bundle-agent, API admin, biblioteca y generación. No se aplican migraciones ni se ejecutan modelos pagados como prueba. Sin despliegue ni publicación.
