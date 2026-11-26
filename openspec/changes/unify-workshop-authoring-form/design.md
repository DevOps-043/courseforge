## Context

La configuración canónica es deliveryConfigSchema y se persiste con save_course_delivery bajo revisión. La generación base crea artifacts y despacha un job. El borrador documental tiene RPC idempotente independiente. SCORM crea un artefacto antes de notificar su finalización.

## Decisions

- El recorrido híbrido se guarda como hybridRoute opcional en el JSON del workspace mediante la RPC existente. Una operación HYBRID_ROUTE valida y guarda agenda y secuencia juntas bajo revisión; no requiere columnas ni SQL nuevos. Las sesiones conservan UUID y los tramos asíncronos referencian IDs curriculares estables.
- La cobertura híbrida se valida sobre la unión de estudio y sesiones; la cobertura completa en vivo sigue siendo obligatoria para el síncrono puro. Un recorrido guardado se edita manualmente para no reemplazar sus asignaciones mediante otra propuesta automática. Su orden participa en las huellas de aprobación y se suministra al generador de planes.
- La aprobación del temario refresca la instantánea de impartición por el cambio de props del servidor. Se conservan las entradas visibles durante la consulta, se descartan respuestas fuera de orden y se añade recuperación manual y al recuperar foco. Un respaldo heredado igual al principal se normaliza a null en lectura, sin modificar registros ni duplicar consumo.
- La ampliación desde Plan proyecta Academy únicamente sobre lecciones asíncronas, conservando IDs y posiciones de módulo originales. Planes y componentes guardan delivery_route_hash; generación, aprobación y consumidores de producción comprueban pertenencia y vigencia. La curación utiliza la unión de necesidades de ambas modalidades. Los botones de sesiones no despachan generación de Academy implícitamente. La aprobación conjunta sigue comprobando ambos destinos. El transporte del recorrido y su navegación requieren recepción coordinada en Academy; se bloquea publicación híbrida antes de escribir al inbox hasta disponer de ese contrato. El manifiesto vigente de preparación de Hub conserva su forma.

- Extraer el formulario cliente existente a su dominio; las rutas resuelven la habilitación desde servidor y mantienen su basePath.
- Compartir campos de modalidad entre creación y edición. Cambiar modalidad conserva el contenido común y las preferencias locales; los campos que no aplican se ocultan.
- Validar en servidor e inicializar el workspace con la organización autorizada. Nexus conserva el camino anterior sin exigir escrituras adicionales. Una configuración existente diferente no se sobrescribe durante la inicialización.
- Inicializar la configuración antes del despacho de IA; si falla, no generar y conservar el artefacto recuperable con error. El borrador/importación conserva su ID para reintentar configuración sin crear otro curso.
- No alterar .env, migraciones ni políticas. La creación del artefacto y su workspace usa operaciones existentes y no se presenta como una transacción única.

## Risks

La configuración de agenda, plan y materiales de sesión reutiliza PremiumSelect y
el catálogo de modelos de texto de las fases. Conserva modelos configurados fuera
del catálogo como opciones visibles, permite retirar el respaldo y evita repetir
el modelo principal como respaldo. La herencia y el snapshot de ejecuciones
iniciadas mantienen su contrato; no se cambia la configuración remota al editar UI.

Proteger reintentos, aislamiento tenant y configuración anterior. Los formularios no deben elegir una modalidad que el servidor tenga deshabilitada. El formato SCORM conserva su proceso de importación; elegir un taller no genera automáticamente sesiones ni las aprueba.
