# Evidencia

## Verificación local

- `npm run verify:pr` verificó el arnés y la aplicación web.
- `npm run test:coordinated-materials` verificó 64 casos de entrega, 37 de generación y recuperación de materiales y 6 pruebas PostgreSQL de reintentos de Hub y Academy.
- `npm run test:course-sources` verificó 86 pruebas de fuentes y 35 de persistencia documental en PostgreSQL. Incluye la persistencia de materiales híbridos con recibos por sesión o componente y la protección de las versiones ante escrituras tardías.
- Las suites de temario y curaduría verificaron la búsqueda de OpenAI, las citas, la configuración heredada y los contratos de persistencia.
- Una ejecución local de `20261121020000_openai_model_settings.sql` en PostgreSQL embebido comprobó los reemplazos de texto e imagen, respaldos distintos, filas de historial, valores predeterminados e idempotencia.

## Verificación en staging

La migración de configuración y la generación real contra el nuevo despliegue requieren acceso autenticado a Engine y Architect, respectivamente.
