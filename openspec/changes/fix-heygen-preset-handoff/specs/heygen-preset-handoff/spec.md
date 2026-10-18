## ADDED Requirements

### Requirement: Herencia de presets desde Producción
El sistema SHALL transmitir avatar y voz elegidos al abrir HeyGen y utilizar
sólo preferencias incluidas en el catálogo autorizado de la organización.

#### Scenario: Preferencias válidas
- **WHEN** se abre HeyGen desde Producción con avatar A y voz B del catálogo
- **THEN** las escenas sin selección propia muestran A y B y guardan esos IDs
  antes de solicitar generación de voz o avatar

#### Scenario: Escena personalizada
- **WHEN** una escena tiene avatar C o voz D guardados
- **THEN** conserva cada selección propia aunque Producción transmita A y B

#### Scenario: Preferencias ausentes o no disponibles
- **WHEN** el enlace no incluye preferencias o sus IDs no están en el catálogo
- **THEN** se utiliza el default o primer elemento autorizado y nunca se envía
  un ID del enlace que no pertenece al catálogo

#### Scenario: Catálogo en carga
- **WHEN** las preferencias todavía no se han resuelto
- **THEN** no se guardan escenas con una selección heredada diferente a la visible
