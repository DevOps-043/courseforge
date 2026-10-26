# synchronous-hybrid-authoring Specification

## Purpose
TBD - created by archiving change add-synchronous-hybrid-course-flow. Update Purpose after archive.
## Requirements
### Requirement: Autoría por modalidad conserva las ocho etapas

El sistema SHALL resolver los requisitos de Nexus, sincrónico e híbrido dentro de Base, Temario, Plan, Fuentes, Materiales, Producción, Ensamble y Publicar/Entregar, sin añadir aprobaciones obligatorias de agenda, guía o coordinación híbrida.

#### Scenario: Curso existente sin modalidad explícita
- **WHEN** se abre un curso existente sin la nueva configuración
- **THEN** conserva el comportamiento Nexus compatible sin exigir una agenda sincrónica

#### Scenario: Sincrónico sin audiovisual
- **WHEN** un curso sincrónico prepara sus entregables sin video
- **THEN** Ensamble indica que no es requerido y continuar omite ese espacio sin simular renders

#### Scenario: Acceso a espacios finales
- **WHEN** Materiales está aprobado
- **THEN** Producción, Ensamble aplicable y Publicar/Entregar son accesibles sin una nueva cadena secuencial, mientras cada acción final conserva sus validaciones

### Requirement: Agenda mantiene identidad y cobertura curricular

El sistema SHALL permitir proponer y editar sesiones desde el syllabus aprobado, con identidad estable y referencias al alcance de lecciones y objetivos, dentro de Temario.

#### Scenario: Cantidad configurada distinta de módulos
- **WHEN** el creador establece una cantidad de sesiones distinta del número de módulos
- **THEN** la propuesta respeta esa cantidad o muestra un conflicto fundamentado sin eliminar objetivos silenciosamente

#### Scenario: Lección dividida entre sesiones
- **WHEN** una lección aparece en más de una sesión
- **THEN** se identifica el alcance cubierto o el repaso deliberado para comprobar cobertura y evitar duplicación accidental

#### Scenario: Tiempo insuficiente
- **WHEN** los bloques requeridos no caben en el tiempo disponible de la sesión
- **THEN** la aprobación del plan se bloquea con un diagnóstico dentro de la etapa existente

### Requirement: Plan se aprueba como conjunto vigente

El sistema SHALL mantener planes por sesión separados del contrato Nexus por lección y aprobar en una única decisión las partes requeridas, incluida la agenda utilizada, mediante comprobación atómica de versiones.

#### Scenario: Híbrido con parte incompleta
- **WHEN** el plan Nexus está listo y el plan de sesiones requerido no lo está
- **THEN** el Plan completo no se puede aprobar aunque sus partes puedan corregirse por separado

#### Scenario: Agenda editada durante aprobación
- **WHEN** cambia la agenda después de leer el plan y antes de confirmar su aprobación
- **THEN** se rechaza la aprobación obsoleta y se conserva el contenido para reconciliación

### Requirement: Generación utiliza configuración de IA editable y trazable

El sistema SHALL integrar agenda, plan y materiales sincrónicos con Configuración de modelos y prompts, resolver organización/global y herencia explícita, y fijar la configuración efectiva por ejecución sin modificar Nexus accidentalmente.

#### Scenario: Capacidad sincrónica personalizada por organización
- **WHEN** existe configuración propia activa para esa organización y capacidad
- **THEN** se utiliza en lugar de la global o heredada, se muestra su procedencia y otras organizaciones conservan su configuración

#### Scenario: Ausencia de configuración propia
- **WHEN** no existe configuración propia de la capacidad nueva
- **THEN** se aplica únicamente la herencia de etapa declarada y visible, respetando su resolución por organización y global

#### Scenario: Fallo al consultar configuración requerida
- **WHEN** la consulta de configuración falla
- **THEN** la nueva ejecución se detiene con un error seguro y no interpreta el fallo como permiso para seleccionar otro modelo silenciosamente

#### Scenario: Edición durante una ejecución
- **WHEN** se modifica un prompt o modelo mientras se generan varias sesiones
- **THEN** la ejecución y sus reintentos técnicos conservan la configuración fijada y la edición solo aplica a nuevas ejecuciones

#### Scenario: Uso de respaldo
- **WHEN** la política permite utilizar un modelo de respaldo compatible
- **THEN** se registra el modelo realmente utilizado y se validan las mismas invariantes de salida

#### Scenario: Instrucción temporal contradice el contrato
- **WHEN** un ajuste de prompt intenta omitir cobertura, permisos o separación de audiencia
- **THEN** los validadores del servidor impiden aprobar un resultado incompatible

### Requirement: Fuentes se comparten por suficiencia comprobada

El sistema SHALL incorporar necesidades de ambos planes a la curación existente, reutilizando fuentes pertinentes y buscando brechas sin exigir un plan Nexus ficticio para sincrónico.

#### Scenario: Fuente cubre ambas experiencias
- **WHEN** una fuente aprobada fundamenta una necesidad de Nexus y una de sesión
- **THEN** ambas pueden referenciarla sin duplicar su búsqueda por modalidad

#### Scenario: Fuente compartida rechazada
- **WHEN** se rechaza una fuente utilizada por varias unidades
- **THEN** se identifican las unidades dependientes para revisión y no se declara vigente su fundamentación

### Requirement: Materiales de sesión alimentan salidas coherentes

El sistema SHALL producir contenido estructurado común para presentación, guía y cuaderno, con identidad de actividades, fuentes y preparación del facilitador, sin tres generaciones conceptuales independientes.

#### Scenario: Corrección de consigna
- **WHEN** se corrige una actividad de sesión
- **THEN** las salidas que la utilizan se preparan desde la misma revisión o se marcan pendientes, sin entregar consignas y respuestas incompatibles

#### Scenario: Exportación determinista
- **WHEN** se recompone una guía desde contenido aprobado sin solicitar síntesis nueva
- **THEN** no se realiza una llamada a IA para volver a desarrollar el tema

### Requirement: Ejecución se recupera por unidad y versión

El sistema SHALL guardar progreso por sesión o lección, limitar concurrencia, controlar duplicados y rechazar escrituras obsoletas sin perder resultados aprobados.

#### Scenario: Fallo de una sesión
- **WHEN** falla una unidad y las demás tienen resultados válidos
- **THEN** el reintento técnico procesa las unidades pendientes o fallidas con la configuración fijada, conservando las válidas

#### Scenario: Resultado tardío
- **WHEN** llega un resultado de una revisión anterior o de una ejecución cancelada
- **THEN** no sobrescribe la revisión actual ni se incorpora al paquete aprobado

### Requirement: Recursos y audiencias se autorizan en servidor

El sistema SHALL comprobar identidad, organización, rol y acceso al curso en lecturas, modificaciones, jobs y descargas, y excluir respuestas privadas de las salidas destinadas al participante.

#### Scenario: Referencia a otra organización
- **WHEN** una operación autorizada para un curso incluye una sesión o fuente ajena
- **THEN** se rechaza antes de acceder o modificar el recurso privilegiado

#### Scenario: Descarga de participante
- **WHEN** se prepara el paquete destinado al participante
- **THEN** sus archivos y respuestas de API excluyen claves de respuesta, preparación y notas privadas aunque no se muestren en pantalla

### Requirement: Entrega utiliza versiones compatibles y destino explícito

El sistema SHALL preparar el paquete desde revisiones concretas y compatibles, conservar la publicación Nexus y distinguir entrega en Engine de publicación externa.

#### Scenario: Cambio durante preparación del paquete
- **WHEN** cambia una entrada relevante mientras se preparan los archivos
- **THEN** no se entrega una mezcla de revisiones y se solicita reconciliación o una nueva preparación

#### Scenario: Híbrido con descarga local
- **WHEN** Nexus se publica y el paquete sincrónico solo se prepara en Engine
- **THEN** ambos resultados se muestran separadamente y no se declara publicada la parte sincrónica en SofLIA

### Requirement: Modificaciones y reversión conservan trabajo válido

El sistema SHALL invalidar dependencias según su impacto, conservar resultados aprobados y permitir deshabilitar nuevas operaciones sin borrar datos ni reinterpretar cursos sincrónicos como Nexus.

#### Scenario: Ajuste exclusivamente visual
- **WHEN** se cambia el diseño de la presentación sin modificar contenido
- **THEN** solo se actualizan salidas visuales dependientes y no se vuelve a ejecutar curación o generación pedagógica

#### Scenario: Deshabilitación de la capacidad
- **WHEN** se revierte la aplicación o se deshabilita la creación sincrónica
- **THEN** se detienen nuevas reservas, se preservan datos y se ofrece lectura compatible o indisponibilidad explícita, sin borrar entregas ni convertir la modalidad
