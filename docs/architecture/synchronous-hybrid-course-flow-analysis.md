# Análisis de adaptación del flujo sincrónico e híbrido

Fecha: 2026-10-26.
Estado: propuesta de estructuración; pendiente de decisiones de producto y especificación de implementación.
Alcance: análisis documental y de código. Este documento no implementa ni autoriza implementación, migraciones, generación pagada, publicación o despliegue.

Continuación: [plan de implementación por entregas](synchronous-hybrid-course-implementation-plan.md), con dependencias, criterios de salida y seguimiento en OpenSpec. Las entregas de desarrollo no añaden pasos al producto.

## 1. Objetivo y restricciones

Adaptar SofLIA Engine para preparar cursos sincrónicos e híbridos aprovechando el pipeline existente, sin añadir etapas de navegación ni aprobaciones obligatorias.

La propuesta debe permitir:

- Mantener un syllabus común de módulos y lecciones.
- Distribuir su contenido en sesiones editables.
- Desarrollar planes de impartición por sesión.
- Producir presentación con notas, guía del facilitador y material del participante.
- Conservar el paquete Nexus completo en modalidad híbrida.
- Reutilizar fuentes, contenido, generación y capacidades visuales existentes.
- Recuperar fallos parciales sin regenerar el curso completo.
- Integrar toda generación nueva con la configuración de modelos y los prompts editables existentes, con aislamiento por organización y trazabilidad de la configuración efectiva.

La eficiencia comprende acciones del creador, consistencia del contenido, consumo de IA, recuperación y mantenimiento. Tener un único botón no implica ejecutar todo en una única llamada al modelo.

### Entradas del análisis

- Documento externo `Flujo sincrónico.pdf`, facilitado por el usuario, revisado en sus cinco páginas. Su ruta local original es `C:\Users\Lordg\Downloads\Flujo sincrónico.pdf`; no se incorpora al repositorio ni se presupone disponible para otros colaboradores.
- [Prompt maestro](../prompt_maestro.md), que remite al [estándar canónico de ingeniería](../standards/engineering-practices.md).
- [Contexto del sistema](system-context.md) y evidencia primaria del repositorio enumerada en este documento.
- Restricción explícita del usuario: analizar y documentar antes de implementar; no añadir pasos y buscar una estructura precisa y eficiente.

El PDF se trata como propuesta funcional, no como autorización ejecutable. Su tabla de la página 5 termina incompleta en la fila de preparación del facilitador; no se infiere contenido faltante.

### Fuera del alcance inicial

Calendario, videollamadas, asistencia, inscripción de participantes, recepción de trabajos, calificaciones, certificación del facilitador y seguimiento obligatorio de su preparación. La entrega inicial organiza recursos para impartir; no implementa la operación de una clase en vivo.

## 2. Diagnóstico del sistema actual

Los siguientes puntos son hechos observados en el código, no capacidades nuevas:

| Hecho verificado | Evidencia primaria | Implicación |
| --- | --- | --- |
| Existen ocho etapas: Base, Temario, Plan, Fuentes, Materiales, Producción, Ensamble y Publicar. | [Navegación del flujo](../../apps/web/src/app/admin/artifacts/[id]/ArtifactWorkflowStepper.tsx) | Se puede conservar la estructura visible. |
| Producción, Ensamble y Publicar son accesibles tras aprobar Materiales, sin exigir completar uno para acceder al siguiente. | [Coordinación de la vista](../../apps/web/src/app/admin/artifacts/[id]/ArtifactClientView.tsx) | No introducir nuevas dependencias secuenciales entre estos espacios. Accesibilidad no significa autorización para publicar contenido incompleto. |
| El plan exige correspondencia uno a uno con las lecciones del syllabus. | [Validación de completitud](../../apps/web/src/domains/plan/lib/plan-completeness.ts) | Una sesión que agrupe lecciones necesita un contrato propio. |
| El esquema generado contiene planes por lección y tipos explícitos de componente. | [Esquema del plan](../../apps/web/src/domains/plan/lib/instructional-plan-generation.schema.ts) | Añadir instrucciones al prompt no amplía por sí solo el contrato. |
| La curación inicia desde los componentes de `lesson_plans`. | [Acciones de curación](../../apps/web/src/domains/curation/actions/curation.actions.ts) y [extracción de necesidades](../../apps/web/src/domains/curation/lib/curation-action-helpers.ts) | Reutilizar el proceso requiere incorporar entradas del plan de sesiones. |
| La generación crea registros en `material_lessons` desde el plan por lección. | [Generación de materiales](../../apps/web/netlify/functions/shared/materials-generation-helpers.ts) | Evitar sesiones ficticias con identificadores de lección. |
| Las slides admiten `speakerNotes` de hasta 1.800 caracteres. | [Esquema de presentación](../../apps/web/src/domains/production/slides/specs/course-deck.schema.ts) | Existe una base para notas breves; no acredita una experiencia completa de facilitación ni exportaciones con notas. |
| Parte de las notas se construye desde narraciones de componentes audiovisuales. | [Construcción de presentaciones](../../apps/web/src/domains/production/slides/planning/course-deck-from-component.service.ts) | Reutilizar la presentación requiere adaptar su entrada al plan de sesiones, sin exigir un video previo. |
| El publicador construye módulos y lecciones. | [Payload de publicación](../../apps/web/src/domains/publication/lib/publication-payload.ts) | No se ha acreditado un contrato receptor para sesiones y guías. |
| La política de video es configurable y el valor predeterminado es de seis a ocho minutos, con objetivo de siete. | [Política de duración](../../apps/web/src/domains/video-duration/video-duration-policy.ts) | El máximo de seis minutos mencionado en el PDF debe reconciliarse con el producto actual. |
| Los prompts se resuelven por código con precedencia de organización, global y valor predeterminado; el resolver expone origen y versión. | [Resolver de prompts](../../apps/web/src/shared/config/prompts/prompt-resolver.service.ts) | Las nuevas instrucciones deben incorporarse al mecanismo existente. |
| Hay configuración de modelo principal, respaldo, temperatura y nivel de razonamiento; los resolvers contemplan organización y configuración global. Existen rutas con defaults y otra que exige configuración explícita. | [Configuración de modelos](../../apps/web/src/lib/server/model-settings.ts) y [resolvers de jobs](../../apps/web/netlify/functions/shared/bootstrap.ts) | Especificar qué configuración consume cada operación nueva y su política ante ausencia o error. |
| La administración existente permite gestionar modelos y versiones de prompts. | [Acciones de Configuración](../../apps/web/src/app/admin/settings/actions.ts) | Extender esa superficie sin añadir una etapa al curso. Esta observación no certifica una auditoría de permisos de esas acciones. |

### Hallazgo adicional de coherencia

La [propagación de cambios pendientes de revisión](../../apps/web/src/lib/server/pipeline-dirty-actions.ts) asigna publicación al índice 7; la navegación la sitúa en el 8. Es una desalineación a revisar antes de extender las dependencias. No se corrigió ni se comprobó su impacto en ejecución durante este análisis.

## 3. Decisión de estructura recomendada

Conservar las ocho etapas y adaptar su contenido, requisitos y salidas según la modalidad. No crear un pipeline paralelo ni nuevas pantallas obligatorias para agenda, coordinación híbrida o preparación del facilitador.

| Etapa | Nexus | Sincrónico | Híbrido |
| --- | --- | --- | --- |
| 1. Base | Configuración actual. | Modalidad y preferencias de impartición. | Modalidad y enfoque híbrido. |
| 2. Temario | Módulos y lecciones actuales. | Syllabus común con agenda integrada. | Syllabus común y agenda vinculada a lecciones Nexus. |
| 3. Plan | Plan por lección. | Plan por sesión. | Ambos planes coordinados en el mismo espacio. |
| 4. Fuentes | Curación actual. | Fuentes para conceptos, ejemplos y actividades de sesión. | Curación compartida de necesidades de ambos planes. |
| 5. Materiales | Componentes Nexus. | Contenido estructurado de presentación, guía y actividades. | Componentes Nexus y contenido sincrónico. |
| 6. Producción | Producción visual actual. | Presentación y formato de documentos. | Producción de ambas experiencias. |
| 7. Ensamble | Ensamble audiovisual actual. | No requerido cuando no haya entregables audiovisuales. | Ensamble de los videos Nexus correspondientes. |
| 8. Publicar | Publicación actual. | Preparación y descarga del paquete aprobado, como salida inicial propuesta. | Publicación Nexus y entrega del paquete sincrónico. |

En sincrónico, Ensamble se mostraría como «No requerido» y se omitiría al continuar cuando no tenga trabajo aplicable. No se simularía un render ni se marcaría artificialmente como completado. La última etapa puede presentarse como «Publicar» o «Entregar» según la modalidad, conservando su posición.

### Base: configurar una sola vez

La configuración del curso conserva modalidad, enfoque híbrido y preferencias de impartición. Las pantallas posteriores leen esos valores; no solicitan configuraciones equivalentes otra vez.

Los cursos existentes deben conservar el comportamiento Nexus al introducir la modalidad. La estrategia concreta de compatibilidad y backfill se definirá antes de migrar datos.

### Temario: agenda integrada

La agenda está disponible después de aprobar el syllabus y se edita en su mismo panel:

- Número y duración de sesiones.
- Distribución de módulos y lecciones.
- Objetivos cubiertos.
- Preferencia entre explicación, equilibrio o práctica.
- Actividad o evidencia principal propuesta.

Una sesión por módulo es el valor inicial si no hay otra cantidad configurada. La cantidad elegida por el creador prevalece. Si la cobertura no cabe, se informa el conflicto en lugar de eliminar contenido silenciosamente.

La agenda no añade una aprobación independiente. El creador ajusta su distribución y continúa; la aprobación existente del Plan confirma también la versión de agenda utilizada.

### Plan: una acción y una aprobación por etapa

«Generar plan» coordina los trabajos requeridos por la modalidad. En híbrido presenta vistas de lecciones Nexus y sesiones en vivo dentro de la misma etapa.

Las partes pueden editarse y recuperarse por separado. La aprobación de etapa solo es válida cuando todos los planes requeridos están completos, son coherentes y corresponden a las versiones actuales de sus entradas. Una aprobación debe comprobar dichas versiones en servidor para impedir aprobar resultados obsoletos.

No se añade una aprobación de coordinación híbrida. La coordinación se valida como parte del Plan.

## 4. Responsabilidades y fuentes de verdad

| Información | Propietario lógico | Regla |
| --- | --- | --- |
| Modalidad y enfoque híbrido | Configuración del curso | No derivarlos de prompts ni del contenido generado. |
| Estructura curricular y objetivos | Syllabus | Conservar identificadores estables de módulos y lecciones. |
| Sesiones, agrupación y duración disponible | Agenda | Referenciar lecciones; no duplicar su definición curricular. |
| Bloques, distribución detallada, actividades y criterios | Plan de sesiones | Conducir la sesión dentro del tiempo disponible. |
| Explicaciones, ejemplos, consignas y respuestas desarrolladas | Materiales de sesión | Sustentar el contenido con fuentes aprobadas. |
| Diseño visual y formato documental | Producción | Consumir contenido aprobado, sin redefinir actividades. |
| Archivos finales y versiones incluidas | Paquete de entrega | Identificar las revisiones concretas entregadas. |

La agenda conserva el tiempo disponible y la organización general. El plan distribuye ese tiempo en bloques. Una vez generado el plan, su distribución detallada alimenta el resumen mostrado en agenda; no se mantienen dos distribuciones editables independientes. Cambiar la duración disponible exige reconciliar el plan antes de aprobarlo.

### Modelo conceptual propuesto

```text
Curso
|-- Configuración de modalidad
|-- Syllabus
|   `-- Módulos y lecciones
|-- Agenda
|   `-- Sesiones con referencias a lecciones
|-- Plan
|   |-- Planes Nexus por lección
|   `-- Planes por sesión
|-- Fuentes aprobadas compartidas
`-- Materiales
    |-- Materiales Nexus por lección
    `-- Materiales por sesión
```

Las sesiones requieren identidad propia. Una sesión puede cubrir varias lecciones y una lección puede distribuirse entre varias sesiones. Los vínculos deben conservar el alcance cubierto para distinguir división deliberada, repaso y duplicación accidental.

La extensión de persistencia recomendada es aditiva: mantener los contratos Nexus e incorporar sesiones relacionadas con el mismo curso. Este es un modelo lógico; no define tablas existentes, DDL ni nombres definitivos de nuevos registros. Las llaves, revisiones, transacciones, índices y políticas de acceso deben especificarse antes de implementar.

### Fronteras de implementación previstas

- Configuración del curso: modalidad y preferencias.
- Syllabus: agenda y distribución curricular.
- Plan: generación, edición y validación de sesiones.
- Curación: adaptación de necesidades y reutilización de fuentes.
- Materiales: contenido estructurado por sesión y validación pedagógica.
- Producción: presentaciones y formatos de documentos.
- Entrega/publicación: paquetes y adaptadores de destino.
- Servicios compartidos: reglas de modalidad, versiones, autorización y dependencias.

Los handlers y componentes delegan reglas en servicios de dominio. No se necesita un framework genérico de workflows para esta extensión.

## 5. Generación eficiente y consistente

### Contenido de sesión generado una sola vez

Materiales genera un contenido estructurado por sesión con conceptos, ejemplos, confusiones frecuentes, actividades, consignas, respuestas razonadas, criterios, fuentes y preparación del facilitador. En híbrido incluye referencias a Nexus.

Las salidas reutilizan ese contenido:

| Entregable | Selección de contenido |
| --- | --- |
| Presentación con notas | Ideas visibles, ejemplos, preguntas y notas breves para conducir. |
| Guía del facilitador | Preparación, agenda detallada, conducción, respuestas y retroalimentación. |
| Material del participante | Casos, consignas, ejercicios y plantillas; sin respuestas privadas. |

No generar tres versiones independientes del tema. La síntesis visual puede usar IA adicional, pero debe conservar las actividades y respuestas aprobadas. La selección, organización y exportación deben ser deterministas cuando sea viable.

La guía conserva las secciones de preparación del PDF: qué comprender, qué explicar, qué conducir, dónde profundizar y cómo ampliar. El índice general se compone desde las sesiones; no necesita otra generación conceptual completa.

Las notas de presentación contienen apoyo breve. La preparación extensa vive en la guía y no se fuerza dentro del límite actual de `speakerNotes`.

### Curación compartida

Combinar necesidades de ambos planes, asociadas a objetivos y alcance curricular. Antes de buscar, comprobar cobertura de fuentes aprobadas; buscar brechas reales.

Una fuente sobre el mismo tema no necesariamente fundamenta un caso práctico o una respuesta. La reutilización exige comprobar pertinencia y trazabilidad. Las búsquedas opcionales del facilitador no sustituyen automáticamente las fuentes aprobadas.

El plan previo a curación define intención y estructura. Las explicaciones, respuestas y materiales finales se fundamentan después en fuentes aprobadas. Si una fuente contradice una premisa, la unidad afectada vuelve a revisión dentro de las etapas existentes.

### Coordinación híbrida

Cada sesión identifica las unidades Nexus relacionadas y su uso recomendado antes o después. El enfoque complementario concentra la clase en aplicación y retroalimentación; la versión de la clase permite cubrir autónomamente los objetivos esenciales mediante Nexus.

La coordinación debe reflejarse en actividades y tiempos, no solo en una etiqueta. Nexus mantiene sus componentes y validaciones aplicables. Las evidencias escritas de clase y la práctica conversacional pueden permanecer separadas en el lanzamiento.

### Ejecución y recuperación

- Una acción del usuario puede coordinar varios trabajos internos.
- Guardar progreso por sesión o lección y limitar concurrencia.
- Reintentar unidades fallidas sin repetir resultados válidos.
- Usar idempotencia y comprobar la versión de entradas al guardar resultados.
- Conservar contenido aprobado mientras se prepara una revisión.
- No producir videos, narraciones o renders que la modalidad no requiera.
- Consultar resúmenes de estado para el progreso; cargar contenido detallado cuando se abre la unidad.

Estas son decisiones propuestas, no garantías actuales de rendimiento. La mejora de latencia y costo debe medirse con cursos representativos; no se establece una capacidad de usuarios simultáneos sin pruebas.

### Configuración de modelos y prompts editables

Requisito confirmado por el usuario: la generación sincrónica e híbrida forma parte de la configuración de modelos y de los prompts modificables del sistema. No puede quedar como un flujo con modelos o instrucciones pedagógicas fijos en código.

La superficie de administración sigue siendo Configuración. En las etapas del curso se muestra la configuración efectiva y, donde el producto autorice instrucciones para una ejecución, se permite ajustarlas sin obligar al creador a configurar todo nuevamente.

#### Mapa de operaciones y configuración

Las capacidades de la primera columna son propuestas de diseño; no representan códigos ni tipos de configuración ya implementados.

| Operación | Configuración de modelo propuesta | Prompts editables y contexto |
| --- | --- | --- |
| Propuesta de agenda | Capacidad propia de agenda, con herencia explícita de `SYLLABUS` si no se personaliza. | Distribución de contenido, tiempos y evidencia principal; recibe el syllabus aprobado y preferencias. |
| Plan de sesiones y coordinación híbrida | Capacidad propia de planificación sincrónica, con herencia explícita de `INSTRUCTIONAL_PLAN`. | Bloques, actividades, criterios y coordinación con Nexus; recibe agenda y currículo. |
| Curación de necesidades de sesión | Reutilizar `CURATION`. | Ampliar la entrada con necesidades sincrónicas sin duplicar el proceso de búsqueda ni alterar el contrato Nexus. |
| Contenido estructurado por sesión | Capacidad propia de materiales sincrónicos, con herencia explícita de `MATERIALS`. | Instrucciones modulares para explicaciones, actividades, respuestas, preparación y notas del facilitador. |
| Síntesis y diseño de presentación con IA | Reutilizar las capacidades `SLIDES_*` aplicables. | Añadir contexto de impartición y referencias al contenido aprobado; no exigir un guion de video. |
| Armado y exportación determinista de guía y cuaderno | No requiere modelo ni prompt generativo. | Consumir el contenido estructurado. Si se añade síntesis con IA, declararla como operación configurable y trazable. |
| Revisión semántica con IA, si se incorpora | Declarar la configuración utilizada antes de habilitarla. | Criterios editables compatibles con los contratos; no sustituye controles deterministas ni aprobación humana. |

Esta granularidad permite personalizar la parte sincrónica sin modificar los valores de Nexus. No implica un modelo ni una llamada independiente por cada sección del documento: los prompts modulares pueden componerse en una misma generación por sesión.

Los nombres definitivos de nuevas capacidades, códigos de prompt, su registro en el catálogo y las migraciones necesarias se especificarán en OpenSpec. La herencia entre capacidades propuesta aquí no existe automáticamente por usar los resolvers actuales.

#### Resolución efectiva

- Para cada capacidad, resolver primero la configuración de su organización y después la global.
- En capacidades nuevas sin configuración propia, aplicar únicamente la herencia de etapa documentada, con su propia resolución por organización y global. Hacer visible cuándo se utiliza esa herencia.
- Mantener para los prompts la precedencia existente de organización, global y valor predeterminado versionado. Un valor de respaldo en código debe estar registrado y visible; no sustituir silenciosamente un prompt editable configurado.
- Las instrucciones específicas de una ejecución, cuando estén autorizadas, no modifican la configuración persistente. Definir si complementan o reemplazan el texto editable y mostrar la composición efectiva.
- Diferenciar configuración ausente de fallo al consultarla. La nueva generación debe detenerse con un diagnóstico si no puede resolver de forma confiable una configuración requerida; no cambiar de modelo silenciosamente por un error de lectura.
- El modelo de respaldo es distinto de la herencia de configuración: solo se ejecuta según la política de recuperación definida y compatible con la operación. Validar capacidades de salida estructurada, herramientas y parámetros del proveedor.

#### Prompts editables y contratos protegidos

Separar el texto pedagógico editable del contexto y del contrato técnico. El contexto incluye syllabus, agenda, fuentes aprobadas, modalidad, enfoque híbrido y versiones de entrada. Los contratos protegen estructura de salida, identidad, cobertura, tiempos, referencias y separación de audiencia.

Cambiar un prompt no concede permisos ni permite saltarse validaciones, añadir herramientas, publicar o exponer respuestas privadas. Si las instrucciones editadas contradicen un contrato, informar el conflicto dentro de la etapa existente, sin guardar el resultado como aprobado.

Los prompts de guía, notas y actividades se componen sobre el mismo contenido de sesión para conservar coherencia. En híbrido, editar el prompt sincrónico no debe reemplazar el prompt Nexus por compartir etapa.

#### Versionado y cambios durante la generación

Al iniciar una ejecución, fijar la configuración efectiva y vincularla con sus unidades de trabajo. Conservar como mínimo organización, capacidad, modelo solicitado, parámetros, política de respaldo, códigos y versiones de prompts, origen de resolución, referencias de entradas y un hash de la composición efectiva.

Registrar también el modelo realmente utilizado y si se activó el respaldo. Los modelos pueden no ofrecer una revisión inmutable del proveedor: esta trazabilidad no garantiza respuestas idénticas al repetir la generación.

Para instrucciones temporales y configuración mutable, conservar una instantánea protegida o una referencia inmutable suficiente para reconstruir la entrada; un hash por sí solo no permite reconstruirla. No registrar texto completo de prompts ni contexto del curso en logs operativos.

Una edición de Configuración aplica a nuevas ejecuciones; no debe cambiar unidades a mitad de una ejecución ni regenerar contenido aprobado automáticamente. Los reintentos técnicos reutilizan la configuración fijada. Usar otra configuración constituye una nueva revisión explícita y no sobrescribe resultados aprobados.

## 6. Política compartida de modalidad y estado

Una política de dominio determina entregables requeridos, generadores aplicables, validaciones, requisitos de avance, omisiones y salidas permitidas. UI, acciones y jobs utilizan las mismas reglas.

El estado visible de una etapa se deriva de todas sus unidades requeridas. Los resultados internos pueden tener estados propios de ejecución sin añadir etapas ni aprobaciones para el usuario.

Reglas mínimas:

- Nexus requiere sus planes y materiales vigentes.
- Sincrónico requiere agenda, plan y materiales de sesiones vigentes; no exige el paquete audiovisual Nexus.
- Híbrido requiere ambas experiencias y su coordinación vigente.
- «No requerido» se distingue de «Completado», «Pendiente» y «Fallido».
- Poder abrir Publicar/Entregar no equivale a poder ejecutar la entrega: la acción final comprueba integridad, vigencia y permisos en servidor.

### Impacto de modificaciones

| Cambio | Revisión o regeneración esperada |
| --- | --- |
| Diseño y colores | Presentación y exportaciones visuales afectadas. |
| Consigna | Actividad, respuesta asociada y salidas que la incluyen. |
| Duración o agrupación de sesiones | Distribución del plan y materiales dependientes; conservar contenido y fuentes aún válidos. |
| Objetivo o contenido curricular | Cobertura de planes, fuentes y materiales relacionados. |
| Fuente rechazada | Explicaciones y actividades dependientes. |
| Añadir sincrónico a un curso Nexus | Parte sincrónica y coordinación; reutilizar Nexus válido. |

Marcar una dependencia para revisión no implica regenerarla automáticamente. Los cambios deben conservar trabajo editorial y mostrar qué requiere reconciliación.

## 7. Seguridad y operación

- Resolver identidad, organización, rol y acceso al curso en servidor antes de leer o modificar recursos.
- No aceptar autoridad, ownership o modalidad efectiva únicamente desde el payload de UI o del modelo.
- Mantener separación de audiencia en consultas y exportaciones. No enviar respuestas y notas privadas al cliente del participante para ocultarlas después.
- Conservar validación de fuentes y medios, límites de entrada y contratos de firma de jobs existentes.
- Registrar correlación, curso, unidad, revisión, fase y error seguro; no registrar credenciales ni URLs firmadas.
- No añadir automáticamente nuevos roles de plataforma: el acceso del facilitador sigue siendo una decisión de producto.
- Mantener entrega interna y publicación externa como efectos distintos, con sus permisos y autorizaciones correspondientes.

## 8. Entrega inicial y límites de integración

La recomendación inicial es preparar y descargar el paquete sincrónico desde la etapa final de Engine. En híbrido, esa misma etapa ofrece la publicación Nexus existente y la entrega del paquete sincrónico.

No asumir que SofLIA acepta sesiones, notas o guías porque ya recibe cursos Nexus. La integración requiere acordar y verificar el contrato receptor. Publicar Nexus no debe presentar el paquete sincrónico como publicado si solo está disponible en Engine.

La guía debe estar disponible antes de impartir. Los tres días de anticipación se conservan como referencia operativa, no como bloqueo automático: no se ha definido calendario de impartición en este alcance. No se agregan exámenes ni recorridos obligatorios de preparación.

## 9. Validaciones y criterios de aceptación

### Flujo y compatibilidad

- Las ocho etapas conservan identidad y no aparecen aprobaciones obligatorias nuevas.
- Un curso Nexus existente mantiene su flujo.
- Sincrónico llega a entrega sin generar videos cuando no los necesita.
- Híbrido no se aprueba como completo si falta alguna experiencia requerida.
- Una agenda modificada no deja vigente la aprobación de un plan incompatible.

### Contenido y tiempos

- Todos los objetivos requeridos tienen cobertura trazable.
- La suma de bloques cabe en la sesión, incluyendo apertura, transiciones, pausas y cierre aplicables.
- Las divisiones de una lección entre sesiones tienen alcance explícito.
- Presentación, guía y cuaderno utilizan las mismas actividades y versiones.
- Las afirmaciones y respuestas relevantes tienen fuentes aprobadas pertinentes.
- La revisión humana confirma que el paquete permite conducir la clase; una puntuación de IA no sustituye esa revisión.

### Recuperación y seguridad

- Un fallo de sesión no obliga a regenerar las demás.
- Solicitudes duplicadas no duplican unidades ni efectos externos.
- Un resultado tardío no sobrescribe una revisión más reciente.
- Cambios de diseño no disparan curación ni regeneración pedagógica.
- Una organización no accede a recursos de otra.
- El material del participante no contiene respuestas ni preparación privada.

### Modelos y prompts

- Agenda, plan y materiales sincrónicos utilizan la configuración efectiva mostrada al usuario autorizado, sin modelos ni prompts pedagógicos ocultos al mecanismo de administración.
- Las configuraciones por organización no afectan a otras organizaciones; los cambios sincrónicos no alteran Nexus por accidente.
- La herencia de etapa y el origen de cada prompt son visibles y verificables.
- Los fallos de resolución no se confunden con ausencia de configuración.
- Los prompts editables no pueden omitir validaciones de estructura, tiempos, fuentes, acceso o audiencia.
- La ejecución conserva la configuración fijada aunque se edite Configuración mientras está en curso.
- El respaldo efectivamente utilizado queda registrado y produce salidas compatibles con el contrato.
- Un reintento técnico conserva configuración; una regeneración con otro modelo o prompt crea una revisión nueva.
- Las exportaciones deterministas no provocan llamadas innecesarias a modelos.

La implementación deberá cubrir estos escenarios con pruebas proporcionales de dominio, integración y QA manual. El análisis presente no ejecutó generación pagada, servicios externos, SQL remoto, pruebas funcionales ni ensayos de carga.

## 10. Decisiones pendientes antes del PRD y la implementación

| Decisión | Recomendación de partida | Por qué debe cerrarse |
| --- | --- | --- |
| Formato inicial de entregables | Elegir una combinación mínima que permita presentar y consultar la guía. | Web, PDF y formatos editables requieren exportadores y QA diferentes. |
| Acceso del facilitador | Definir si usa cuenta existente o recibe un paquete. | Determina permisos, distribución y necesidad de nueva experiencia de acceso. |
| Destino sincrónico | Entrega inicial desde Engine. | La publicación en SofLIA requiere un contrato receptor verificado. |
| Reglas editoriales Nexus | Preservar el comportamiento vigente hasta acordar cambios explícitos. | El PDF y la política de duración actual difieren. |
| Sesiones con duraciones diferentes | Confirmar si se permiten desde el lanzamiento. | Afecta configuración y validación del tiempo disponible. |
| Cambio de modalidad con contenido aprobado | Conservar resultados válidos y revisar dependencias nuevas. | Evita pérdida de trabajo y regeneración innecesaria. |
| Catálogo y herencia de configuración de IA | Capacidades propias de agenda, plan y materiales sincrónicos con herencia explícita de sus etapas; reutilizar curación y slides. | Concretar códigos, UI, validadores, persistencia y precedencia antes de implementar. El requisito de configurabilidad ya está confirmado. |

El siguiente entregable de diseño sería una especificación por etapa con campos, acciones, estados, contratos de datos y escenarios de aceptación. Antes de modificar contratos se debe abrir el cambio correspondiente en OpenSpec y concretar migraciones aditivas, rollback y evidencia de verificación. Este análisis no sustituye ese cambio ni representa una decisión de arquitectura ya integrada.

## 11. Verificación de este documento

La evidencia primaria se inspeccionó mediante lectura estática del código. Los enlaces relativos se verifican con `npm run docs:check`; el formato del diff, con `git diff --check`. Estos controles no certifican capacidades de servicios externos ni comportamiento del producto en ejecución.
