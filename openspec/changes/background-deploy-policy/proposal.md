# Conservar el despliegue en llamadas internas a workers

## Why
La generación iniciada en staging llama al worker del dominio principal. El resolver
prioriza `URL` sobre `DEPLOY_URL`, mezclando versiones; el contrato de referencias
ampliado puede quedar sustituido por el validador antiguo en la ejecución remota.

## What Changes
- Capturar el origen del deploy durante el build de Netlify sin serializar secretos.
- Compartir resolución entre API y workers encadenados, sin alterar la URL pública.
- Fallar explícitamente si falta el destino desplegado; preservar desarrollo local.
- Cubrir resolución, captura y fallo seguro con pruebas sin proveedores reales.

## Capabilities
### New Capabilities
- `background-deploy-routing`: identidad del despliegue en llamadas internas.

## Impact
Resolvers compartidos de workers y comando de build Netlify. Sin cambios de datos,
firmas, identidad, roles ni permisos. Requiere desplegar para afectar al entorno.
