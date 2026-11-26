## ADDED Requirements

### Requirement: Promoción con dependencias corregidas
La promoción SHALL conservar auditoría activa y usar dependencias de ejecución
sin hallazgos críticos ni altos conocidos por el registro consultado.

#### Scenario: Verificación previa
- **WHEN** se prepara la integración de staging a main
- **THEN** se ejecuta `npm audit --omit=dev` sin reducir el umbral de CI
- **AND** se verifican los contratos afectados por actualizaciones mayores

### Requirement: Remotion coordinado
Los paquetes de Remotion y los bundles nuevos SHALL compartir versión exacta.

#### Scenario: Nuevo bundle
- **WHEN** el agente genera un bundle y su manifiesto
- **THEN** sus dependencias y su versión declarada coinciden con el runtime instalado
- **AND** no se reescriben los bundles históricos
