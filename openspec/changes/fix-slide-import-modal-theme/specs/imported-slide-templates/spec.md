## ADDED Requirements

### Requirement: Modal consistente con el tema
El sistema SHALL mostrar la importación fuera de los estilos del encabezado, con colores del tema y acciones accesibles sin desplazar todo el modal.

#### Scenario: Abrir desde el encabezado en modo claro u oscuro
- **WHEN** se abre Importar HTML desde el hero
- **THEN** título, descripción, controles y avisos conservan contraste y el modal utiliza EngineDialog

#### Scenario: Revisar un diseño desde móvil
- **WHEN** el usuario carga HTML y revisa campos en una pantalla estrecha
- **THEN** el contenido se desplaza dentro del cuerpo sin ocultar el encabezado ni el pie de acciones ni desbordar horizontalmente
