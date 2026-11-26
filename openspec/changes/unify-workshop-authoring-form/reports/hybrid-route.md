# Recorrido híbrido y activación de agenda

19 de noviembre de 2026. Cambios locales sin commit, push ni despliegue de código en esta entrega.

## Diagnóstico

El hook de impartición no volvía a consultar el estado cuando el temario se aprobaba en la misma ficha. Además, el resolver de modelos rechazaba el respaldo heredado idéntico al principal. La pantalla autenticada confirmó este segundo error mediante su diagnóstico de fallback_model. No se inspeccionaron ni modificaron credenciales ni configuración remota.

## Implementación

La nomenclatura visible de la plataforma de estudio se actualizó a Academy en el recorrido, ayudas de modalidad, validaciones y entrega de preparación. Los identificadores técnicos y contratos existentes conservan sus nombres.

Se refresca la instantánea cuando cambia el estado de temario recibido del servidor y cuando se recupera foco. Se descartan respuestas fuera de orden y de otro artefacto. La interfaz conserva su instantánea durante actualizaciones y añade Actualizar estado, indicaciones de bloqueo y configuración inválida. Se normaliza el respaldo heredado idéntico a null al resolverlo; no se registra un nuevo modelo ni se llama dos veces al mismo proveedor.

hybridRoute es opcional en el documento JSON existente. El editor permite crear, ordenar y quitar tramos de un borrador. Los tramos asíncronos incluyen título, minutos y lecciones; los síncronos referencian sesiones de agenda. Guardar agenda y recorrido usa una operación validada por servidor y la RPC existente bajo revisión. Se conserva contenido anterior y se invalidan las aprobaciones y planes dependientes.

El recorrido exige cubrir el currículo entre ambas modalidades sin obligar a duplicarlo en vivo. Se rechazan referencias ajenas, duplicados y omisiones. El síncrono puro conserva cobertura completa en vivo. El orden entra en las huellas de plan y en el contexto de generación; los enlaces antes/después deben respetarlo. La generación de agenda no sustituye un recorrido ya guardado. Los documentos anteriores siguen legibles; generar o aprobar planes híbridos nuevos exige recorrido válido.

## Verificación

- Suite test:course-delivery: 47 pruebas aprobadas, con seis pruebas nuevas de recorrido. Incluye persistencia simulada bajo revisión, rechazo previo a escribir, referencias, cobertura, límites y huellas.
- La ejecución final también comprueba que repetir un guardado idéntico no escribe ni invalida aprobaciones y que una agenda anterior sin recorrido puede recibirlo.
- Validación estricta de OpenSpec aprobada. verify:pr llegó hasta docs:check y quedó bloqueado por cuatro enlaces locales preexistentes en reportes/2026-11-14-factibilidad-herk-edit-kit.md hacia el repositorio herk-edit-kit. Adaptadores y arnés aprobados; la compuerta completa no pasó. Evidencia en .tmp/hybrid-route-gate.log.
- npm run typecheck aprobado en el estado final.
- ESLint dirigido a doce archivos del cambio aprobado con --max-warnings 0. No se deshabilitaron reglas; se eliminó la actualización síncrona de estado del efecto de consulta.
- En Chrome autenticado se comprobó Proponer agenda habilitado después de normalizar el respaldo. No se lanzó generación de agenda con IA.
- En el curso de prueba 238c635b-1dab-4997-ab6c-2c2fc85eb080 se creó una sesión de 90 minutos que cubre una lección y un tramo asíncrono de 600 minutos que cubre las otras 19. Se comprobó bloqueo por entradas incompletas, selección, resumen de 690 minutos y reordenamiento en ambos sentidos. Se guardó mediante la UI y se recargó la página, confirmando los títulos, orden y tiempos persistidos. Es una distribución de QA, no una aprobación pedagógica.
- Captura hybrid-route-saved.jpg en visualizaciones de esta conversación. No se aplicó SQL ni se publicó en Learning/Hub.

## Límites y reversión

Ajuste visual posterior: el contenedor de tramos usa una separación de 16 px y los encabezados reutilizan el título e indicador +/− de las sesiones. Se verificó en Chrome local el espaciado y la apertura/cierre de una sesión sin guardar cambios de contenido. ESLint dirigido al componente aprobó sin advertencias. Captura hybrid-route-spacing.png en las visualizaciones de esta conversación.

La prueba no acredita generación completa de planes/materiales ni el piloto entre plataformas. La producción y publicación Nexus existentes aún trabajan sobre el currículo anterior: filtrar sus materiales y ejecutar esta secuencia en Academy requiere ampliar su contrato de publicación y navegación. La entrega actual a Hub no transmite el nuevo recorrido. La tarea 4.6 conserva este pendiente explícito.

Revertir clientes debe conservar el JSON y las versiones; un cliente anterior estricto no entiende hybridRoute. Coordinar lectores compatibles antes de desplegar y evitar reescribir workspaces nuevos desde clientes antiguos. No hay migración de columnas ni eliminación de datos.
