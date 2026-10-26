# Plan de implementación del flujo sincrónico e híbrido

Fecha: 2026-10-26.
Estado: implementación local bajo habilitación, sin despliegue; ver [operación](../operations/synchronous-hybrid-courses.md) y tareas OpenSpec para el progreso real.
Fuente de alcance: [análisis de estructuración](synchronous-hybrid-course-flow-analysis.md).
Cambio de desarrollo: [propuesta OpenSpec](../../openspec/changes/archive/2026-10-26-add-synchronous-hybrid-course-flow/proposal.md).
Seguimiento ejecutable: [tareas](../../openspec/changes/archive/2026-10-26-add-synchronous-hybrid-course-flow/tasks.md).

## 1. Objetivo y límites

Incorporar autoría sincrónica e híbrida dentro de las ocho etapas actuales, reutilizando Nexus, curación, producción y Configuración. Los entregables son presentación con notas, guía del facilitador y material del participante, coordinados y fundamentados en fuentes aprobadas.

Este plan organiza el desarrollo, no añade fases al producto. La petición posterior autorizó implementar y coordinar ambas ramas al pulsar el botón de generación; no ejecutar SQL remoto, pruebas pagadas, publicación o despliegue.

No incluye calendario, videollamadas, asistencia, evaluación de participantes, certificación ni seguimiento obligatorio de preparación. No incluye un contrato nuevo de publicación en SofLIA sin verificar el receptor. No cambia restricciones editoriales Nexus incidentalmente.

## 2. Resultado esperado en las ocho etapas

| Etapa existente | Cambio de implementación | Condición observable |
| --- | --- | --- |
| Base | Modalidad y enfoque híbrido en configuración del curso. | Los datos se capturan una vez y persisten; cursos anteriores conservan Nexus. |
| Temario | Agenda integrada tras aprobar el syllabus. | Distribución editable con sesiones e IDs estables; sin aprobación adicional. |
| Plan | Planes de sesión y coordinación híbrida. | Una acción genera lo requerido y la aprobación existente comprueba todas las partes vigentes. |
| Fuentes | Entrada de necesidades sincrónicas. | Se reutilizan fuentes pertinentes y solo se buscan brechas. |
| Materiales | Contenido estructurado por sesión. | Consignas, respuestas y preparación se generan de forma coordinada. |
| Producción | Adaptador de presentación y documentos. | Un curso sincrónico puede producir sus tres entregables sin generar video. |
| Ensamble | Aplicabilidad por modalidad y entregables. | Se muestra «No requerido» y se omite al continuar cuando no hay audiovisual aplicable. |
| Publicar/Entregar | Paquete sincrónico y salida Nexus existente. | Permisos, vigencia y completitud se verifican al ejecutar cada salida. |

Producción, Ensamble y Publicar/Entregar siguen siendo espacios accesibles tras aprobar Materiales. Su acceso no depende de completar el anterior; la acción final exige los recursos correspondientes.

## 3. Decisiones previas y supuestos de planificación

La tabla conserva las decisiones de planificación. Su resolución para la primera versión se documenta a continuación; no implica una autorización de despliegue:

| ID | Decisión pendiente | Supuesto recomendado | Bloquea |
| --- | --- | --- | --- |
| D1 | Formato inicial de entrega. | Presentación web y guía/cuaderno imprimibles; confirmar si PDF o archivos editables son obligatorios. | Contrato final y aceptación de exportadores en E6. |
| D2 | Acceso del facilitador. | Usuarios internos existentes y descarga autorizada; no añadir roles ni acceso público. | Distribución fuera del equipo y modelo de acceso de E6. |
| D3 | Duración variable entre sesiones. | Modelar duración por sesión; confirmar si la UI permite variación desde el lanzamiento. | Cierre de experiencia y límites de agenda en E3. |
| D4 | Reglas editoriales Nexus. | Conservar las vigentes, incluida duración configurable de video. | Cualquier nueva restricción editorial; no bloquea contratos aditivos. |
| D5 | Destino de sesiones. | Paquete entregado desde Engine; integrar con SofLIA en otro alcance si se acuerda contrato. | Publicación sincrónica externa; no bloquea entrega interna. |
| D6 | Catálogo de IA y autorización para instrucciones temporales. | Tres capacidades propias con herencia y prompts modulares; usar permisos existentes revisados. | Cierre de Configuración y exposición de ajustes en E2. |

Cerrar decisiones en la especificación y registrar responsable y fecha antes de implementar el entregable dependiente. Se puede avanzar en trabajo independiente; no desarrollar exportadores o permisos basados en decisiones no confirmadas.

Resolución del 2026-10-26: el usuario confirmó D1/D2 (web y HTML imprimible, descarga interna) y la coordinación explícita de generación Nexus/sesiones. D3 admite duración por sesión; D4 conserva reglas actuales; D5 entrega desde Engine; D6 implementa capacidades con herencia y administración por organización, sin instrucciones temporales nuevas. Ver contratos finales en la guía operativa.

## 4. Diseño de implementación y contratos mínimos

### 4.1 Distribución por dominio

La modalidad y su política compartida deben poder consumirse desde UI, acciones y jobs. Agenda pertenece a syllabus; el plan de sesiones, a plan; el contenido de sesión, a materials. Curación y producción reciben adaptadores específicos. No crear un segundo motor completo de cursos ni un framework genérico de workflows.

Mantener validadores, servicios, acceso a datos y presentación separados siguiendo las [convenciones de dominio](../../apps/web/src/domains/README.md). Los nombres definitivos de módulos y tablas se fijan en E0; los contratos siguientes son lógicos y propuestos.

### 4.2 Contratos de datos

| Contrato lógico | Contenido mínimo | Invariante |
| --- | --- | --- |
| Configuración de modalidad | Curso, organización, modalidad, enfoque híbrido, preferencias y revisión. | Autoridad resuelta en servidor; ausencia legacy equivale a Nexus según estrategia compatible. |
| Agenda y sesión | Revisión de syllabus, ID estable de sesión, orden, duración disponible, objetivos y vínculos de cobertura. | Vínculos al mismo curso; distinguir alcance parcial, repaso y duplicación accidental. |
| Plan de sesión | Revisiones de entradas, bloques ordenados, tiempos, actividad, criterios, recursos requeridos y coordinación Nexus. | Suma de bloques dentro del tiempo disponible; todos los objetivos requeridos tienen cobertura. |
| Contenido de sesión | Conceptos, ejemplos, consignas, respuestas, preparación, notas y fuentes aprobadas. | Una actividad conserva identidad y contenido común entre salidas; respuestas privadas se separan por audiencia. |
| Ejecución y unidad | Operación, revisiones de entradas, configuración IA fijada, estado, intento, idempotencia y diagnóstico. | Resultados tardíos no sobrescriben revisiones nuevas; reintentos no duplican unidades. |
| Paquete de entrega | Curso, audiencia, revisiones concretas, archivos, integridad y estado de preparación. | No mezclar revisiones ni declarar publicada una descarga local. |

La persistencia es aditiva. Antes de escribir SQL se deben definir relaciones, llaves foráneas, unicidad, ownership, RLS, límites JSON, retención y consultas. Referencias a lecciones almacenadas en documentos deben validarse contra la revisión curricular; no inventar una FK a una entidad relacional inexistente. Evitar duplicar el currículo solo para facilitar una FK.

Las aprobaciones se vinculan a revisiones concretas. Reservas, guardado de resultados y aprobación utilizan transacciones o comparación atómica de revisión donde sea necesario. Retener resultados anteriores y evitar transacciones abiertas durante llamadas a proveedores.

### 4.3 Operaciones de aplicación

| Operación lógica | Entrada | Resultado y control |
| --- | --- | --- |
| Guardar modalidad/preferencias | Curso y revisión esperada. | Configuración actualizada o conflicto de versión. |
| Proponer/editar agenda | Syllabus aprobado, preferencias y revisión esperada. | Agenda validada; no aprueba el plan. |
| Generar plan | Curso y versiones de entradas. | Ejecución que coordina las partes requeridas por modalidad. |
| Aprobar plan | Revisión de plan y agenda. | Confirmación atómica si ambas experiencias requeridas están vigentes. |
| Generar/reintentar materiales | Curso, unidad y revisión. | Progreso por unidad con configuración fijada y recuperación parcial. |
| Preparar/descargar paquete | Revisión de entrega y audiencia. | Archivos autorizados de versiones compatibles. |

E0 decidirá qué operaciones amplían server actions y cuáles requieren rutas HTTP. No crear endpoints duplicados por costumbre. Toda frontera tendrá schema, límites de payload, errores seguros y autorización; si usa HTTP, distinguir entradas inválidas, ausencia de sesión, falta de permisos, conflicto y aceptación asíncrona según los contratos existentes.

Los jobs existentes y nuevos conservan firma, origen del mismo despliegue y tenant validado. No tomar organización o configuración efectiva como autoridad del payload.

## 5. Secuencia de entregas de desarrollo

Estas entregas son unidades de revisión e integración, no pasos adicionales para el creador. Cada una puede dividirse en PR pequeños sin perder sus criterios de salida. Antes de cambios materiales se debe crear o reutilizar una rama/worktree recuperable conforme a las reglas del repositorio.

| Entrega | Depende de | Resultado | Tamaño relativo |
| --- | --- | --- | --- |
| E0. Cierre de diseño | Análisis y decisiones aplicables. | Contratos de datos, operaciones, permisos, límites y matriz de pruebas. | Medio. |
| E1. Fundamentos y compatibilidad | E0. | Política de modalidad, revisiones y persistencia aditiva autorizada. | Alto. |
| E2. Modelos y prompts | Contratos E0 y persistencia E1. | Configuración editable, herencia y captura efectiva por ejecución. | Alto. |
| E3. Agenda y plan | E1 y E2. | Autoría por sesión dentro de Temario y Plan. | Alto. |
| E4. Curación compartida | E3. | Necesidades de ambos planes y trazabilidad de cobertura. | Medio. |
| E5. Materiales por sesión | E2, E3 y E4. | Contenido común y recuperación por unidad. | Alto. |
| E6. Producción y entrega | E5 y decisiones D1/D2. | Presentación, guía, cuaderno y paquete por audiencia. | Alto. |
| E7. Integración y habilitación | E1 a E6. | Navegación completa, regresión Nexus, piloto y operación documentada. | Medio/alto. |

Los tamaños son relativos, no fechas ni compromisos de esfuerzo. No estimar calendario definitivo hasta cerrar D1/D2, comprobar exportadores reutilizables y revisar persistencia real. El camino crítico es E0 → E1 → E2 → E3 → E4 → E5 → E6 → E7.

### E0. Cerrar contratos antes de modificar el producto

- Revalidar evidencia primaria y restricciones en el checkout de implementación.
- Cerrar decisiones que afecten al primer entregable; mantener identificadas las restantes.
- Definir esquemas, invariantes, errores, límites y transacciones del apartado 4.
- Precisar eliminación/reordenación de sesiones, cambio de modalidad y aprobaciones obsoletas.
- Investigar la desalineación de índices de publicación documentada en el análisis; reproducir su efecto y delimitar la corrección necesaria para dependencias.
- Elegir estrategia de habilitación gradual por organización y rollback de aplicación.

Salida: diseño implementable y escenarios aceptados. No implica permiso para aplicar SQL remoto, desplegar o generar contenido pagado.

### E1. Implementar fundamentos sin cambiar Nexus

- Incorporar modalidad y política común de requisitos/aplicabilidad.
- Añadir persistencia de agenda, sesiones, revisiones y referencias según el diseño cerrado.
- Revisar RLS y autorización explícita antes de acceso privilegiado; datos y consultas siempre acotados al curso y organización.
- Definir compatibilidad de cursos existentes y backfill por lotes solo si es necesario; no reescribir contenido aprobado.
- Establecer invalidación selectiva de dependencias y aprobación ligada a versiones; conservar lectura de resultados anteriores.

Salida: contratos y permisos probados, migraciones locales validadas, Nexus sin cambios de comportamiento y sin exposición prematura de una modalidad incompleta.

### E2. Integrar Configuración de IA antes de habilitar generación

- Registrar capacidades propuestas de agenda, plan y materiales sincrónicos en tipos, catálogo, UI, validadores, persistencia y resolvers.
- Definir herencia explícita de `SYLLABUS`, `INSTRUCTIONAL_PLAN` y `MATERIALS`, con precedencia propia de organización/global antes de heredar. Reutilizar `CURATION` y capacidades de slides aplicables.
- Incorporar prompts editables y versionados para agenda, sesiones, coordinación y contenido modular; no triplicar generaciones por guía/cuaderno/presentación.
- Mostrar configuración efectiva, origen y versión. Revisar permisos de lectura y edición para configuraciones globales y por organización.
- Diferenciar configuración ausente de error de lectura; rechazar resolución requerida no confiable.
- Fijar configuración por ejecución, incluida instantánea protegida o referencia inmutable reconstructible para prompts e instrucciones temporales.
- Validar compatibilidad del principal y respaldo con herramientas, salida estructurada y parámetros. Registrar el modelo realmente usado.

Salida: tests de precedencia, permisos, error, cambios durante una ejecución y reintentos. No hay generación sincrónica accesible antes de completar esta entrega.

### E3. Integrar agenda y plan en los paneles actuales

- Añadir modalidad a Base y agenda a Temario sin duplicar preferencias.
- Proponer sesiones solo con syllabus aprobado; configurar cantidad, duración, cobertura y enfoque.
- Conservar IDs al editar/reordenar; detectar referencias eliminadas o incompatibles.
- Añadir plan por sesión y adaptador híbrido junto al plan Nexus existente, sin poner sesiones en `lesson_plans`.
- Coordinar una acción de generación con progreso y fallos por unidad; una sola aprobación de Plan confirma todas las partes y la agenda utilizada.
- Separar tiempo disponible de agenda y distribución por bloques; reflejar resumen sin dos fuentes editables.

Salida: casos Nexus, sincrónico e híbrido comprobados con proveedores simulados; conflicto temporal o de cobertura visible dentro de la etapa.

### E4. Reutilizar curación y cubrir brechas

- Adaptar necesidades de sesiones al motor actual preservando identidad curricular y trazabilidad.
- Combinar necesidades de ambas experiencias sin duplicar búsquedas cuando las fuentes pertinentes ya cubran el alcance.
- Asociar fuentes a conceptos, actividades y respuestas; distinguir coincidencia temática de suficiencia.
- Mantener aprobación/rechazo de fuentes y devolver unidades afectadas a revisión cuando se contradigan premisas.

Salida: pruebas de cobertura compartida, fuente rechazada y sincrónico sin un plan Nexus ficticio; suite actual de curación sin regresiones.

### E5. Generar materiales coordinados por sesión

- Extender Materiales con unidades de sesión separadas de `material_lessons` y compartir únicamente servicios reutilizables.
- Generar contenido estructurado, preparación en cinco secciones, actividades, respuestas, criterios, fuentes y notas breves.
- Mantener identidad de actividad y proyecciones por audiencia; no enviar respuestas al cliente del participante.
- Guardar progreso, límites de concurrencia, idempotencia y configuración de ejecución; recuperar unidades fallidas.
- Conservar resultados aprobados al generar revisiones nuevas y proteger contra escrituras tardías.

Salida: un contenido de sesión alimenta las tres salidas; fallo y reintento no alteran unidades válidas ni mezclan configuraciones.

### E6. Producir y entregar sin dependencia de video

- Adaptar el generador de slides al contenido de sesión sin requerir narración o componente de video.
- Utilizar notas breves sin truncar silenciosamente preparación relevante; conservar la guía extensa por separado.
- Implementar los formatos confirmados en D1 y selección determinista del contenido para guía y cuaderno.
- Preparar un manifiesto de entrega por audiencia con revisiones e integridad; generar archivos desde una versión consistente y detectar cambios antes de entregar.
- Añadir preparación/descarga dentro de la etapa 8; mantener el publicador Nexus y sus controles existentes.
- Diferenciar estados de paquete preparado, descargable y publicación externa. Controlar acceso a archivos y retención de artefactos huérfanos.

Salida: QA visual del formato acordado, paquete de participante sin respuestas y entrega sin generar ni renderizar videos.

Esta entrega trabaja sobre presentaciones y documentos, no añade animación ni modifica el runtime de motion. Si el diseño final requiere alterar HyperFrames, preview, medios o render, aplicar primero sus skills y fuentes de verdad y acotar ese cambio explícitamente.

### E7. Integrar, medir y habilitar

- Integrar resúmenes de estado, aplicabilidad de Ensamble y navegación sin nuevas aprobaciones.
- Probar aprobación y entrega con versiones obsoletas, cambio de modalidad, cambio de configuración y dos editores concurrentes.
- Completar revisión de seguridad y regresión de Nexus y publicación.
- Documentar diagnóstico, reanudación, limpieza de huérfanos, habilitación y rollback.
- Ejecutar piloto autorizado por organización con los tres escenarios curriculares y medir resultados.

Salida: criterios de la especificación cubiertos, resultados reales registrados y decisiones de release explícitas. Despliegue/publicación y cualquier prueba pagada requieren la autorización correspondiente.

## 6. Estrategia de verificación

### Escenarios mínimos

| Área | Casos necesarios |
| --- | --- |
| Modalidad | Curso legacy; Nexus nuevo; sincrónico; híbrido complementario y versión de clase; cambio de modalidad. |
| Agenda/plan | Sesión por módulo; cantidad distinta; lección dividida; repaso; cobertura faltante; tiempos imposibles; edición posterior a aprobación. |
| Configuración | Organización/global/herencia; prompts temporales autorizados; fallo de consulta; principal/respaldo; edición durante ejecución; permisos globales. |
| Curación | Reutilización pertinente; búsqueda de brechas; fuente insuficiente; rechazo de fuente compartida. |
| Materiales | Consignas coherentes; respuestas fundamentadas; revisión nueva; resultado tardío; duplicado; reanudación parcial. |
| Entrega | Audiencias separadas; notas extensas; versiones incompatibles; regeneración solo visual; ausencia de audiovisual. |
| Seguridad | Sin sesión; rol insuficiente; organización ajena; referencia cruzada; acceso directo a archivos; job firmado inválido. |

Validar carreras mediante control real de versiones en integración local; los mocks de proveedor no acreditan transacciones ni RLS. Añadir pruebas de base local y un entorno controlado autorizado antes de afirmar aislamiento efectivo.

### Comandos y evidencia

Consultar [estándar de pruebas](../standards/testing.md) antes de ejecutar. Los comandos existentes y aplicables según el cambio son:

```powershell
npm run typecheck
npm run db:migrations:check
npm run test:security-boundaries
npm run test:syllabus-duration --workspace=apps/web
npm run test:curation --workspace=apps/web
npm run test:materials-generation --workspace=apps/web
npm run test:model-json-response --workspace=apps/web
npm run test:remotion --workspace=apps/web
npm run docs:check
npm run openspec:validate
npm run verify:pr
```

Las suites nuevas de modalidad, configuración, sesiones y entrega deben registrarse en scripts reales y ejecutarse mediante compilación TypeScript y Node según la convención actual; no asumir que las suites existentes ya cubren esos casos. Añadirlas a la compuerta correspondiente sin eliminar verificaciones previas. Ejecutar HyperFrames solo si se afecta ese dominio.

En cada entrega registrar comando, fecha, resultado, alcance, fallos y límites en el reporte del cambio. Una comprobación de migraciones no prueba SQL remoto ni RLS; los checks documentales no prueban producto. No usar generación pagada o publicación externa como smoke test sin autoridad.

## 7. Eficiencia y observabilidad

Medir por curso, modalidad, unidad y revisión: llamadas por operación, uso/costo cuando el proveedor lo exponga, latencia, reintentos, unidades reutilizadas, búsquedas evitadas y errores de vigencia. Usar correlación sin texto de prompts, respuestas privadas ni URLs firmadas en logs.

Comparar ejemplos curriculares equivalentes y registrar tamaño de entrada y número de sesiones. Establecer presupuestos y límites después de obtener línea base, antes del piloto; no prometer una reducción porcentual ni carga de usuarios sin medición.

Criterios estructurales: ninguna llamada a IA para exportación puramente determinista, ningún render obligatorio en sincrónico sin audiovisual y ningún reintento completo por un único fallo de sesión. La recuperación debe conservar trazabilidad sin prometer exactamente una ejecución de un proveedor externo tras un timeout ambiguo.

## 8. Habilitación y reversión

Aplicar el patrón aditivo: datos y lectores compatibles, servicios, UI controlada, piloto autorizado y ampliación tras evidencia. La habilitación debe comprobarse en servidor además de UI; E0 define el mecanismo concreto y evita presentar un flag no implementado como existente.

Para revertir: deshabilitar nuevas ejecuciones y exposición de modalidad, detener nuevas reservas, dejar terminar o cancelar controladamente trabajos según contrato y preservar registros, revisiones y entregas. Un trabajo cancelado no puede publicar resultados tardíos. El rollback de aplicación no debe reinterpretar cursos sincrónicos como Nexus ni borrar sus datos; mantener lectura compatible o una vista explícita de indisponibilidad.

No eliminar tablas, prompts, archivos ni configuración como rollback inicial. Las migraciones destructivas o la eliminación de artefactos requieren una estrategia y autorización independientes. Preservar Nexus y publicación existentes.

## 9. Definición de terminado

- Escenarios de la [especificación](../../openspec/changes/archive/2026-10-26-add-synchronous-hybrid-course-flow/specs/synchronous-hybrid-authoring/spec.md) cubiertos y evidencia reproducible.
- Ocho etapas, sin nueva aprobación de agenda, guía o coordinación híbrida.
- Configuración editable efectiva y fijada por ejecución para toda generación nueva.
- Paquete sincrónico utilizable, coherente y seguro por audiencia; Nexus completo en híbrido.
- Recuperación parcial, dependencias selectivas y control de concurrencia comprobados.
- QA visual de formatos confirmados y revisión humana pedagógica del paquete.
- Documentación operativa actualizada con hechos implementados; no declarar funcionalidad vigente antes de integrarla.
- Revisión adversarial proporcional, límites visibles y rollback ensayado en entorno autorizado.
- OpenSpec se archiva únicamente después de integrar el cambio en la rama objetivo; esta planificación no lo archiva.

El estado real de ejecución se mantiene en las tareas OpenSpec. Este documento conserva secuencia y criterios; no duplica una segunda lista de progreso.
