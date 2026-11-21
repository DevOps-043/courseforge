## ADDED Requirements

### Requirement: Ejecutar modelos OpenAI en Architect

Architect SHALL usar OpenAI para las nuevas llamadas de generación, búsqueda y agentes.

#### Scenario: Configuración histórica

- **WHEN** una configuración activa contiene un ID de otro proveedor
- **THEN** la siguiente petición usa un modelo OpenAI de la misma capacidad y el historial sigue disponible

#### Scenario: Configuración nueva

- **WHEN** un administrador selecciona o guarda un modelo
- **THEN** el sistema solo admite modelos OpenAI compatibles con esa capacidad
