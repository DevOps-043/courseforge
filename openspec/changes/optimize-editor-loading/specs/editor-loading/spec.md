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

### Requirement: Comprobaciones acotadas
El sistema SHALL limitar a cuatro referencias las comprobaciones simultáneas y
conservar descargas secuenciales.

#### Scenario: Error de Storage
- **WHEN** falla una comprobación
- **THEN** se propaga el error sin iniciar otro lote ni ocultarlo como éxito.
