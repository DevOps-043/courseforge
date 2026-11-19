## Context

La configuración canónica es deliveryConfigSchema y se persiste con save_course_delivery bajo revisión. La generación base crea artifacts y despacha un job. El borrador documental tiene RPC idempotente independiente. SCORM crea un artefacto antes de notificar su finalización.

## Decisions

- Extraer el formulario cliente existente a su dominio; las rutas resuelven la habilitación desde servidor y mantienen su basePath.
- Compartir campos de modalidad entre creación y edición. Cambiar modalidad conserva el contenido común y las preferencias locales; los campos que no aplican se ocultan.
- Validar en servidor e inicializar el workspace con la organización autorizada. Nexus conserva el camino anterior sin exigir escrituras adicionales. Una configuración existente diferente no se sobrescribe durante la inicialización.
- Inicializar la configuración antes del despacho de IA; si falla, no generar y conservar el artefacto recuperable con error. El borrador/importación conserva su ID para reintentar configuración sin crear otro curso.
- No alterar .env, migraciones ni políticas. La creación del artefacto y su workspace usa operaciones existentes y no se presenta como una transacción única.

## Risks

Proteger reintentos, aislamiento tenant y configuración anterior. Los formularios no deben elegir una modalidad que el servidor tenga deshabilitada. El formato SCORM conserva su proceso de importación; elegir un taller no genera automáticamente sesiones ni las aprueba.
