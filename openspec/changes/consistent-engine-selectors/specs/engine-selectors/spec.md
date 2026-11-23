## ADDED Requirements

### Requirement: Selectores coherentes con el sistema visual

Los selectores de valor de los formularios y editores deberán (MUST) usar el componente visual compartido y conservar las opciones y operaciones del flujo.

#### Scenario: Seleccionar un perfil de duración

- **WHEN** el usuario elige un perfil en la creación de curso o en la revisión posterior
- **THEN** el selector muestra el perfil elegido y aplica sus valores de duración al formulario
- **AND** una duración no predefinida se representa como Personalizado

#### Scenario: Usar un selector junto al borde de la ventana

- **WHEN** se abre un selector dentro de un panel o diálogo con espacio limitado
- **THEN** la lista permanece visible dentro de la ventana y ofrece desplazamiento cuando es necesario
- **AND** usa la superficie y el acento del tema activo

#### Scenario: Recorrer las opciones con teclado

- **WHEN** el usuario abre una lista y usa las flechas, Inicio, Fin o escribe el inicio de una etiqueta
- **THEN** el foco activo se mueve a una opción habilitada y se desplaza con la lista si hace falta
- **AND** Escape conserva el valor, Enter o Espacio lo confirma y Tab continúa al siguiente control

#### Scenario: Conservar restricciones de selección

- **WHEN** una opción está deshabilitada o falta una selección obligatoria
- **THEN** la opción deshabilitada no puede elegirse y el formulario con la selección obligatoria incompleta no inicia la operación
