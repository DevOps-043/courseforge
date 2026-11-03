## Purpose
Entregar preparación aprobada de Engine a una sesión de Learning con identidad verificable, revisión vigente y separación de contenido privado.
## ADDED Requirements
### Requirement: Entrega autorizada vigente
Engine MUST comprobar rol revisor, organización, modalidad con sesiones y aprobación vigente antes de firmar la entrega.
#### Scenario: Cambio a Nexus
- **WHEN** un curso conserva materiales antiguos pero cambió a Nexus
- **THEN** la entrega se rechaza antes de contactar Learning.
### Requirement: Contenido público y límites explícitos
La entrega MUST conservar láminas y consignas, excluir notas y respuestas privadas y rechazar excesos sin truncado.
#### Scenario: Texto fuera del contrato
- **WHEN** una lámina supera el tamaño del aula
- **THEN** se informa el límite y no se entrega contenido parcial.
### Requirement: Destino confirmado
Learning MUST autorizar al actor sobre la organización, curso y sesión y confirmar la revisión recibida.
#### Scenario: Permiso retirado
- **WHEN** el actor ya no tiene permiso docente
- **THEN** no se modifica la preparación del aula.

### Requirement: Persistencia sin elevación implícita
Las funciones de autoría MUST ejecutarse como invoker con search_path vacío y acceso restringido al backend. La verificación previa a activación MUST ejecutar el flujo con service_role sin superusuario y comprobar denegación de acceso desde navegador.

#### Scenario: Backend autorizado
- **WHEN** service_role guarda, reserva, reclama, confirma y aprueba contenido en el esquema local de prueba
- **THEN** se conservan CAS e historial sin elevarse al propietario de las funciones.

#### Scenario: Activación remota pendiente
- **WHEN** no se ha autorizado el proyecto de Engine y el plan SQL concreto
- **THEN** se prepara preflight, postflight y recuperación sin aplicar la migración automáticamente.
