## ADDED Requirements

### Requirement: Ayuda contextual con selección vigente
Los campos de creación SHALL ofrecer el patrón de ayuda de prompts mediante el signo de interrogación. Los selectores SHALL explicar el propósito general y la opción actualmente seleccionada, actualizando la explicación cuando cambia el valor.

#### Scenario: Cambiar enfoque o perfil
- **WHEN** el usuario cambia una opción y consulta su ayuda
- **THEN** la explicación general permanece y la descripción específica corresponde al valor vigente, sin conservar la opción anterior

### Requirement: Formulario común por modalidad
El sistema SHALL presentar los campos comunes una vez y adaptar los específicos a asíncrono, síncrono o híbrido usando el estilo de Architect.

#### Scenario: Cambiar modalidad
- **WHEN** el usuario cambia de asíncrono a síncrono o híbrido
- **THEN** conserva título, descripción, público y resultados y ve únicamente la configuración aplicable

### Requirement: Preferencias autorizadas y persistentes
El servidor SHALL validar e inicializar la configuración de la organización autorizada sin sobrescribir un workspace ya editado.

#### Scenario: Sesiones deshabilitadas
- **WHEN** una solicitud intenta elegir síncrono o híbrido con la habilitación apagada
- **THEN** se rechaza antes de iniciar generación

#### Scenario: Curso anterior o reintento
- **WHEN** se abre un curso sin configuración explícita o se repite la inicialización
- **THEN** se conserva Nexus por defecto o se confirma la configuración idéntica sin sobrescribir el contenido

### Requirement: Fuentes sin título duplicado
El borrador documental SHALL utilizar el título del formulario común y conservar su identificador cuando una etapa posterior falle.

#### Scenario: Preparar documentos
- **WHEN** el usuario crea un borrador para cargar fuentes
- **THEN** no debe escribir nuevamente el título y la modalidad se confirma antes de iniciar su base
