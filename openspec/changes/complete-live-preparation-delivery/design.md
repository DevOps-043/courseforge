## Context
Learning es propietario del aula y su autorización académica. Engine conserva contenidos, revisiones y aprobaciones. La entrega previa HTML sigue disponible.
## Goals / Non-Goals
Entregar láminas y consignas aprobadas con un acto explícito del revisor. No entregar respuestas, notas ni criterios privados, inferir quizzes ni modificar cuentas.
## Decisions
Contrato canónico copiado desde Learning con verificador. Identidad y organización salen del tenant activo de Engine. Consulta y entrega usan endpoint HTTPS fijo derivado de configuración del servidor y HMAC con propósito/timestamp. Learning revalida la autoridad sobre el destino y serializa la escritura con CAS e idempotencia. No se permite modalidad Nexus con materiales antiguos.
## Risks / Trade-offs
El formato del aula es menor que el de autoría: se rechazan excesos explícitamente sin pérdida silenciosa. Una respuesta perdida puede ocultar éxito remoto; el payload determinista permite reintento con el mismo comando. Los tokens de servicio no se envían al navegador.
## Migration Plan
Publicar Learning y su migración antes de habilitar entrega. Desactivar la UI/API de entrega conserva HTML, autoría, Nexus y preparación ya recibida.

El esquema de autoría de Engine se instala por separado con preflight de catálogo, respaldo de políticas/check y postflight sin escrituras de negocio. Sus siete funciones usan SECURITY INVOKER y search_path vacío; el backend conserva los privilegios y la revalidación de permisos por recurso. El flujo SQL se verifica con service_role sin superusuario ni propiedad de las tablas, además de pruebas negativas desde navegador. La aprobación remota del usuario está registrada en el plan de activación; recuperar acceso al servicio no requiere pedir esa aprobación otra vez.
