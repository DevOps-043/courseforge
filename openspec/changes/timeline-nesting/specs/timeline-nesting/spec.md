## ADDED Requirements

### Requirement: Distinción entre agrupar y anidar
El editor SHALL ofrecer acciones separadas y persistir el modo de anidación.

#### Scenario: Colapsar una selección
- **WHEN** se anidan dos o más unidades completas del mismo nivel
- **THEN** aparece un solo bloque entre el inicio mínimo y el final máximo
- **AND** los clips, audio, motion y tiempos permanecen intactos.

#### Scenario: Comprimir una agrupación existente
- **WHEN** se selecciona un único grupo visible completo del nivel actual y se pulsa «Anidar selección»
- **THEN** ese mismo grupo aparece como un solo clip editable que cubre su rango original
- **AND** conserva identidad, etiqueta, miembros y duración audiovisual.
- **AND** «Agrupar selección» sigue requiriendo al menos dos unidades.

#### Scenario: Editar contenido
- **WHEN** se abre el bloque con doble clic o Enter
- **THEN** se muestran sus miembros y se puede regresar mediante Escape o la ruta.

#### Scenario: Compatibilidad y recuperación
- **WHEN** se carga un grupo sin modo o se desanida un contenedor
- **THEN** los clips originales permanecen visibles sin modificar su contenido.

#### Scenario: Persistencia no disponible
- **WHEN** SQL no anuncia soporte del modo
- **THEN** la creación se deshabilita y el servidor rechaza nuevos contenedores.
