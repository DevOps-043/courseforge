## ADDED Requirements

### Requirement: Perfiles de salida congelados

El editor SHALL presentar tres niveles MP4 diferenciados y un perfil MOV compatible con HeyGen.

#### Scenario: Elegir una salida de alta calidad

- **WHEN** el usuario selecciona Alta calidad y prepara un snapshot
- **THEN** el snapshot fija MP4, 4K, 30 FPS y calidad high
- **AND** el despacho comprueba esos valores frente al snapshot aprobado

#### Scenario: Elegir MOV

- **WHEN** el usuario selecciona MOV para edición
- **THEN** el snapshot fija MOV, 1080p, 25 FPS y calidad high
- **AND** el perfil rechaza la combinación MOV y 4K

#### Scenario: Recuperar una revisión anterior

- **WHEN** se carga una revisión histórica de borrador o alta calidad
- **THEN** sus parámetros originales siguen disponibles para aprobar y renderizar
