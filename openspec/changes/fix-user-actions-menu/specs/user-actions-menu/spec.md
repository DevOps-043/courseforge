## ADDED Requirements

### Requirement: Acciones visibles junto al usuario
El sistema SHALL mostrar el menú de acciones fuera de los ancestros transformados de la página, dentro de la ventana y asociado al usuario seleccionado.

#### Scenario: Abrir en el layout animado
- **WHEN** se activa el botón de acciones de una fila en modo claro u oscuro
- **THEN** el menú se monta en document.body junto al disparador y muestra Ver / Editar Rol

#### Scenario: Abrir junto a un borde
- **WHEN** no existe espacio suficiente debajo o a la derecha del botón
- **THEN** el menú ajusta su posición para conservar sus acciones dentro de la ventana

### Requirement: Navegación y selección del usuario
El sistema SHALL permitir acceder por teclado a las acciones y abrir el modal del usuario seleccionado.

#### Scenario: Consultar un rol
- **WHEN** se activa Ver / Editar Rol por clic o Enter
- **THEN** se cierra el menú y se abre el modal existente con la identidad de esa fila

#### Scenario: Descartar las acciones
- **WHEN** se pulsa Escape, Tab, se hace clic fuera o se desplaza o redimensiona la ventana
- **THEN** el menú se cierra sin modificar usuarios
