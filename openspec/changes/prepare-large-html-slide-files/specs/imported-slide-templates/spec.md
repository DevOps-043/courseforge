## ADDED Requirements

### Requirement: Preparación local de originales grandes
El sistema SHALL admitir archivos HTML locales de hasta 100 MB y preparar una fuente compacta antes de enviarla al análisis HTTP.

#### Scenario: Export con recursos embebidos
- **WHEN** se selecciona un HTML de 21,7, 50 o 100 MB cuyo diseño sin recursos excluidos cumple el perfil
- **THEN** se prepara en segundo plano con progreso y se envía solamente la fuente reducida al saneamiento del servidor

#### Scenario: Archivo o diseño excesivo
- **WHEN** el archivo supera 100 MB o la fuente preparada supera el presupuesto existente
- **THEN** se rechaza con un mensaje que distingue archivo original y diseño compatible

#### Scenario: Cancelación
- **WHEN** se cancela la preparación o se desmonta el componente
- **THEN** termina el worker sin enviar una importación parcial
