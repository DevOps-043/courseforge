# Diseño

UsersTable conserva selección y estado del modal. UserActionsMenu concentra portal, posición y navegación del desplegable, con estilos existentes `engine-floating-menu` y coordenadas del disparador. Se desactiva su animación de traslación para medir el tamaño final antes de pintar. Se prefiere colocación inferior; si no hay espacio se coloca arriba y se limita a la ventana.

El foco se mueve a la única acción disponible. Escape y clic exterior vuelven al disparador; Tab lo restaura antes de continuar la navegación nativa. Antes de abrir el diálogo se enfoca el disparador, permitiendo que EngineDialog restaure el foco al cerrar. Scroll y resize conservan el cierre existente para evitar un menú separado del usuario.

No se cambia el layout global: quitar su animación ampliaría el impacto a otras pantallas. Tampoco se añaden acciones ni se alteran los permisos del servidor.
