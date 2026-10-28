# Presupuesto de memoria para el build de Netlify

## Why
El build reportado compila correctamente, pero el worker TypeScript agota el heap de Node aproximadamente a los 2 GB. La configuración TypeScript también descubre artefactos generados mediante patrones globales.

## What Changes
- Fijar un heap máximo de 4096 MiB para los procesos Node del build Netlify, heredado por el worker de tipos.
- Excluir salidas generadas de TypeScript sin retirar fuentes, pruebas ni validaciones de tipos.
- Documentar el diagnóstico, validaciones y las advertencias de tracing como trabajo distinto del OOM.

## Capabilities
### New Capabilities
- `netlify-build-memory`: presupuesto explícito de memoria durante build.

## Impact
Configuración de build y descubrimiento TypeScript. Sin cambios a identidad, permisos, servicios ni despliegue automático. El máximo del heap no garantiza que el contenedor disponga de esa memoria: verificar el siguiente build remoto.
