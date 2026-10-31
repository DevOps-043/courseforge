## ADDED Requirements

### Requirement: Límite visual en el canvas del video
El sistema SHALL permitir que el sujeto animado desborde su rectángulo estático y SHALL recortarlo en el canvas del video.

#### Scenario: Traslación y expansión fuera del asset
- **WHEN** una animación de posición, escala o rotación rebasa el rectángulo original
- **THEN** su contenido permanece visible dentro del video, en preview y render.

#### Scenario: Borde del video
- **WHEN** el contenido animado rebasa un borde del canvas
- **THEN** no se pinta fuera del área de video.

### Requirement: Preservar edición y reproducibilidad
El sistema SHALL conservar crop, máscaras, keyframes, tiempos y estado durante seeks.

#### Scenario: Recorte y máscara animados
- **WHEN** un asset recortado y enmascarado se desplaza
- **THEN** ambos tratamientos viajan con el contenido sin quedar limitados por la caja de layout original.

#### Scenario: Paridad y seek inverso
- **WHEN** se visita el mismo instante después de avanzar y retroceder
- **THEN** los mismos píxeles y estado de motion se reproducen en preview y HTML de render para todos los presets.
