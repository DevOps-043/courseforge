## ADDED Requirements

### Requirement: Contexto canónico por dominio
El repositorio MUST mantener AGENTS.md como router hacia estándares, contexto
real, cambio activo y skill pertinente, con adaptadores delgados por herramienta.

#### Scenario: Iniciar una tarea de video
- **WHEN** un agente inicia una modificación de producción multimedia
- **THEN** el router dirige a la fuente de verdad de HyperFrames y al ADR de motion

### Requirement: Adaptadores deterministas
La sincronización MUST generar wrappers desde skills canónicas y su comprobación
MUST rechazar contenido divergente, metadatos inválidos y wrappers huérfanos.

#### Scenario: Skill modificada
- **WHEN** cambia una skill sin sincronizar su wrapper
- **THEN** adapters:check termina con código no cero y señala la ruta

#### Scenario: Wrapper retirado
- **WHEN** existe un wrapper de una skill que ya no tiene fuente canónica
- **THEN** la comprobación falla sin borrar el archivo automáticamente

### Requirement: Frontera de desarrollo
El arnés MUST declarar que sus roles y skills no conceden herramientas a los
agentes runtime del producto ni alteran credenciales, RLS o sesiones.

#### Scenario: Exposición indebida
- **WHEN** el registro declara una skill de desarrollo expuesta al runtime
- **THEN** harness:validate rechaza el registro

### Requirement: Verificación y estado durable
El repositorio MUST validar adaptadores, estructura, enlaces y OpenSpec, probar
casos negativos e integrar estos controles con las verificaciones existentes.

#### Scenario: Fallo de una compuerta
- **WHEN** un paso de verify:pr falla
- **THEN** se conserva el código de error y no se ejecutan pasos posteriores

#### Scenario: Cambio retomado
- **WHEN** otro agente abre el cambio activo
- **THEN** encuentra propuesta, diseño, tareas y evidencia sin depender del chat
