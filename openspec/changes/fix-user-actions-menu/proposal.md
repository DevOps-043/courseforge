# Recuperar el menú de acciones de usuarios

## Why
El botón activa el estado del menú, pero el desplegable fijo usa coordenadas de ventana dentro de `.engine-content`. La animación `engine-content-enter` conserva una transformación (`fill-mode: both`), por lo que ese ancestro pasa a ser la referencia del elemento fijo y desplaza el menú.

## What Changes
- Montar las acciones en un portal a `document.body`, siguiendo el patrón de artefactos.
- Ajustar el menú a la ventana, enfocar su acción y permitir cierre por Escape, Tab, clic exterior, scroll y resize.
- Conservar la selección del usuario y la apertura del modal de rol existente.
- Validar el componente real con CSS del producto y usuarios ficticios.

## Capabilities
### Added Capabilities
- `user-actions-menu`: apertura y posición del menú de acciones administrativas.

## Impact
Frontend compartido por `/admin/users` y `/[empresaSlug]/admin/users`. Sin cambios de API, autorización, datos ni dependencias. Reversión: revertir la integración en UsersTable y retirar UserActionsMenu; no requiere migración.
