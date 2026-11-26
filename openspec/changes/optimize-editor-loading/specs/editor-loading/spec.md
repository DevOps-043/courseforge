## ADDED Requirements

### Requirement: Apertura con dependencias mínimas
El sistema SHALL cargar la etapa solicitada sin importar de forma estática todas
las etapas del flujo.

#### Scenario: Abrir la base de un artefacto
- **WHEN** el autor abre la etapa inicial
- **THEN** producción y ensamblado se resuelven mediante módulos dinámicos.

### Requirement: Preparación segura en paralelo
El sistema SHALL sincronizar medios antes de preparar el borrador, solapando
trabajo independiente sin alterar los contratos de autorización y persistencia.

#### Scenario: Cambiar de lección
- **WHEN** comienza la preparación
- **THEN** composición y sincronización pueden avanzar simultáneamente
- **AND** el borrador espera a ambas y la biblioteca permanece visible si falla.

### Requirement: Biblioteca de medios liviana
La biblioteca SHALL presentar los videos mediante iconos y diferir la carga de
las miniaturas de imagen según su proximidad al área visible.

#### Scenario: Abrir Medios en Ensamble
- **WHEN** se abre la biblioteca de una lección con varios videos
- **THEN** la lista no solicita los archivos de video para sus miniaturas
- **AND** el editor puede reproducir los medios autorizados en su vista previa.

#### Scenario: Cambiar de video con clips de HeyGen
- **WHEN** la recuperación histórica termina correctamente
- **THEN** la sincronización reutiliza su recuperación de clips locales
- **AND** devuelve tiempos separados para preparación, recuperación y registro.

#### Scenario: HeyGen no disponible
- **WHEN** falla la recuperación histórica
- **THEN** la sincronización intenta recuperar los clips locales y registra los medios disponibles.

### Requirement: Comprobaciones acotadas
El sistema SHALL limitar a cuatro referencias las comprobaciones simultáneas y
conservar descargas secuenciales.

#### Scenario: Error de Storage
- **WHEN** falla una comprobación
- **THEN** se propaga el error sin iniciar otro lote ni ocultarlo como éxito.
