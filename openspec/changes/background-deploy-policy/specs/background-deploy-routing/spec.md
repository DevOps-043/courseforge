## ADDED Requirements

### Requirement: Workers conservan la identidad del despliegue
El sistema SHALL invocar workers desde el origen inmutable capturado en su build.

#### Scenario: Staging con URL pública de producción
- **WHEN** la API recibe una generación en staging y URL apunta al sitio principal
- **THEN** el destino es el origen del deploy capturado, incluso sin DEPLOY_URL en runtime

#### Scenario: Preview o producción con metadato capturado
- **WHEN** el worker encadena un trabajo desde un deploy de preview o producción
- **THEN** el resolver compartido conserva el mismo origen inmutable

### Requirement: Configuración incompleta falla de forma explícita
El sistema SHALL rechazar despachos desplegados sin destino seguro.

#### Scenario: Falta el metadato y DEPLOY_URL
- **WHEN** solo existen URL o NEXT_PUBLIC_APP_URL
- **THEN** se produce un error antes de enviar el trabajo y no se usa el sitio principal

#### Scenario: Origen inválido
- **WHEN** el destino contiene credenciales, ruta, parámetros o un protocolo distinto de HTTPS
- **THEN** se rechaza sin recurrir a otro entorno

### Requirement: Desarrollo directo permanece local
El sistema SHALL preservar ejecución local sin exigir metadatos de Netlify.

#### Scenario: Desarrollo fuera de Netlify
- **WHEN** NODE_ENV es development y NETLIFY no es true
- **THEN** el destino HTTP es localhost:8888 y los handlers directos existentes se conservan
