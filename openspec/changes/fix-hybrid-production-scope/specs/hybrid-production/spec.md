## ADDED Requirements

### Requirement: Asignación visible durante autoría
El editor SHALL mostrar por lección un destino explícito solo síncrono, solo asíncrono o compartido y sus sesiones/tramo. SHALL guardar la distribución mediante el contrato existente y revalidar las dependencias.

#### Scenario: Cambiar compartida a solo síncrona
- **WHEN** el autor cambia el destino de una lección compartida a solo Hub
- **THEN** el borrador conserva su cobertura en sesiones y retira la asignación Academy; no cambia recursos remotos hasta guardar ni elimina contenido generado

#### Scenario: Faltan destinos
- **WHEN** no existe sesión o tramo necesario para la asignación
- **THEN** se informa qué añadir y no se inventa una asignación ni se guarda un recorrido inválido

### Requirement: Paginación sin falsos rechazos
El conversor SHALL distribuir todos los puntos en orden respetando presupuestos y mínimo normalizado de QA cuando exista una partición válida, sin añadir texto ni debilitar el validador.

#### Scenario: Página residual
- **WHEN** el límite de puntos crea una página insuficiente y existe otra distribución válida
- **THEN** se redistribuyen fragmentos y todas las páginas conservan texto y referencias con QA vigente

#### Scenario: Contenido realmente insuficiente
- **WHEN** ninguna partición satisface el mínimo
- **THEN** el rechazo QA permanece visible y no se inventa explicación

### Requirement: Producción según asignación aprobada
Producción y Ensamble SHALL excluir recursos exclusivos de Hub del circuito de video y SHALL conservar los videos de temas explícitamente compartidos con Academy. La API SHALL verificar el alcance antes del despacho.

#### Scenario: Tema exclusivo de sesión
- **WHEN** una lección no figura en ningún tramo asíncrono
- **THEN** sus recursos históricos no se ofrecen como videos en Producción ni Ensamble y la solicitud de video final no se despacha

#### Scenario: Tema compartido
- **WHEN** una lección figura en un tramo asíncrono y también en una sesión
- **THEN** conserva el video de Academy y la interfaz informa su asignación compartida

#### Scenario: Recorrido desconocido
- **WHEN** el snapshot de impartición aún no se ha consultado
- **THEN** no se habilita producción audiovisual usando Nexus como valor predeterminado
