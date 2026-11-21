# División del pipeline híbrido: pasos 3 a 8

## Objetivo y aceptación

El recorrido aprobado es la fuente de distribución. Academy recibe únicamente lecciones asíncronas; Hub recibe preparación de sesiones en vivo. Compartir un tema no crea dos lecciones ni obliga a producir un video para una sesión. IDs y orden deben conservarse. Una distribución ausente, inválida o cambiada bloquea aprobación y publicación hasta reconciliar contenido.

## Diagnóstico inicial verificado

- Paso 3: instructional-plan-background genera todos los módulos y la aprobación compara contra todo el temario. No usa hybridRoute.
- Paso 4: mergeDeliveryCurationPlan agrega necesidades a las lecciones existentes, pero omite las exclusivas de sesiones si el plan asíncrono se filtra.
- Paso 5: los materiales parten de instructional_plans. Deben verificar la distribución vigente también al reintentar una lección.
- Pasos 6 y 7: producción y ensamble parten de material_components; datos anteriores pueden conservar componentes que ya no pertenecen a Academy.
- Paso 8: getPublicationData lee material_lessons sin filtrar por recorrido. El payload no lleva identidad externa por lección ni recorrido.
- Academy: la publicación vigente escribe en courseengine_inbox y pasa por cron, staging y revisión. La aplicación desde staging usa la posición de módulos/lecciones como identidad y retira contenido obsoleto; no aplica hybridRoute. Cambiar la distribución puede asociar contenido o progreso a otra lección. El importador HTTP alternativo además borra módulos al reimportar, pero no es el transporte vigente de Architect. Añadir el recorrido al JSON sin cambiar el receptor no acredita su aplicación correcta. Se necesita recepción compatible antes de habilitar publicación híbrida; SENT significa entrega al inbox, no publicación aprobada en Academy.
- Hub: la preparación ya referencia curso, sesión de destino, sesión de autoría y revisión. No debe recibir el currículo asíncrono ni crear salas desde este cambio.

## Ruta de implementación

1. Resolver una proyección única de Academy en servidor desde el recorrido validado, conservando IDs antes de filtrar módulos.
2. Aplicarla a generación y aprobación de planes; vincular cada plan al hash de distribución para rechazar generaciones anteriores.
3. Curar la unión de necesidades de Academy y Hub sin duplicar la identidad temática; generar materiales asíncronos solo para el plan vigente.
4. Comprobar selección y vigencia antes de producción, ensamble y publicación, conservando contenido anterior sin publicarlo accidentalmente.
5. Ampliar coordinadamente el contrato receptor de Academy con identidad externa y recorrido, recepción idempotente que preserve progreso y comprobantes de revisión. Mantener bloqueada la publicación híbrida si el receptor no demuestra compatibilidad.
6. Revisar etiquetas y resumen de destinos de los pasos 3 a 8. Probar modalidad pura, recorrido incompleto/cambiado, contenido anterior, reintento, referencias ajenas y envío por destino.

No se aplican migraciones ni se publica contenido remoto como parte de esta revisión. Las verificaciones y límites se registrarán al terminar la entrega local.

## Implementación local de esta entrega

- Proyección única academyScope y lectura autorizada del workspace/temario: IDs curriculares y módulos conservados antes del filtrado; reconocimiento del sufijo histórico -G de materiales.
- Plan: generación solo para lecciones asíncronas, metadato delivery_route_hash y comprobaciones antes de generar, validar, aprobar y confirmar el resultado. Contenido anterior sin huella debe regenerarse; no se asume vigente por su estado.
- Curación: unión de necesidades de las sesiones y Academy por identidad; conserva temas exclusivos en vivo. Un tema compartido no crea dos lecciones.
- Materiales: arranque, generación por lección y QA comprueban pertenencia y vigencia; los componentes reciben huella de distribución. Reiniciar desde otra distribución requiere reconciliar el paquete anterior, sin borrarlo automáticamente.
- Producción/ensamble: listados de materiales y componentes filtran lecciones de Academy; automatización, contexto de jobs y lotes comprueban pertenencia/huella. Esto no certifica cada endpoint audiovisual independiente del producto; el inventario restante se conserva como pendiente.
- UI: apartados identifican Academy y Hub; los botones de sesiones ya no disparan implícitamente generación asíncrona. La aprobación continúa coordinando ambos conjuntos.
- Publicación: vista de lecciones filtra por Academy y no excluye una lección híbrida solo porque carezca de video. La publicación híbrida se bloquea con diagnóstico hasta tener recepción compatible; las modalidades puras conservan sus destinos.

## Pendientes que impiden cerrar el flujo completo

1. Contrato versionado de publicación híbrida y receptor del inbox/staging que preserve IDs externos, progreso y orden. Se requiere diseñar la persistencia y su migración con las tablas reales de Academy, más pruebas de reimportación y revisión obsoleta; no basta cambiar /api/courses/import.
2. Recepción, programación y asociación de cada sesión de autoría con una sesión real del mismo curso/organización en Academy; comprobante que permita mostrar revisión entregada por destino. La entrega individual existente ya valida membresía y estado programado.
3. Navegación del recorrido en Academy y resolución autorizada de los accesos a Hub.
4. Auditoría de endpoints audiovisuales independientes, reconciliación de paquetes históricos tras mover lecciones y commit transaccional que vincule la huella híbrida con cada escritura. Las comprobaciones previas al commit reducen resultados obsoletos, pero no eliminan una carrera entre verificación y escritura; aprobación/publicación deben seguir rechazando huellas anteriores.
5. Piloto local de generación real de ambos destinos y recorrido de aprobación/publicación, sin asumir que pruebas de políticas equivalen al piloto.

No se modificaron Academy ni Hub en esta entrega. El alcance efectivo es separación y guardas locales en Architect, más revisión del receptor. No declarar la integración completa ni desplegar hasta cubrir estos pendientes.

## Evidencia de verificación

- test:course-delivery: 53/53 aprobadas; incluye proyección por destino, IDs previos al filtrado, sufijos históricos, huella de plan/materiales, organización ajena, duplicados y despacho exclusivo de sesiones. Log .tmp/hybrid-scope-tests.log.
- test:materials-generation: 29/29 de generación y 5/5 de recuperación aprobadas. Se ampliaron los fixtures con lecturas de modalidad y un plan real mínimo, conservando los controles de validación, reintento y escritura atómica. Log .tmp/hybrid-materials-tests.log.
- OpenSpec: validate unify-workshop-authoring-form --strict aprobado. Log .tmp/hybrid-scope-spec.log.
- git diff --check aprobado. Los avisos de CRLF no son errores del diff. Log .tmp/hybrid-scope-diff.log.
- npm run typecheck aprobado (código 0), log .tmp/hybrid-scope-types.log. ESLint dirigido a diez archivos de políticas, servicios, pruebas e interfaz aprobado con --max-warnings 0, log .tmp/hybrid-scope-lint.log.
- Revisión visual pendiente: Chrome ya no tenía una pestaña de Architect ni una sesión disponible. No se abrieron aplicaciones ni se modificó contenido del curso durante esta entrega. No se invocaron proveedores reales, no se corrió SQL, no se crearon commits ni se hizo push/despliegue.

La revisión adversarial detectó y corrigió el renumerado al filtrar, los sufijos -G de materiales, la omisión de necesidades exclusivas de Hub y el despacho implícito de la otra modalidad. Se mantiene explícito el riesgo de carrera entre lectura y commit y la necesidad de una recepción transaccional antes de habilitar publicación híbrida.
