## ADDED Requirements

### Requirement: Grafo fiel a los alias de TypeScript
El gate de arquitectura MUST conservar la base y las opciones reales de tsconfig
y analizar las dos entradas existentes sin excluir dependencias de tipos.

#### Scenario: Alias válido
- **WHEN** un módulo usa un alias definido por paths relativo al tsconfig
- **THEN** su arista aparece resuelta en el grafo

#### Scenario: Ciclo por alias o tipos
- **WHEN** los imports por alias o solo de tipos forman un ciclo
- **THEN** el comando devuelve un resultado fallido

#### Scenario: Código de salida del comando real
- **WHEN** un proceso ejecuta el runner sobre una fixture válida, cíclica o con import desconocido
- **THEN** devuelve respectivamente 0, 1 y 1 y conserva el alcance de sus entradas en el reporte

### Requirement: Referencias no resueltas explícitas
El gate MUST rechazar referencias desconocidas; los casos legítimos del bundler
deben tener clasificación y recursos instalados comprobables, sin esconderlos.

#### Scenario: Import inexistente
- **WHEN** un import no puede resolverse y no tiene clasificación verificable
- **THEN** el gate falla aunque no haya ciclos

#### Scenario: Recurso de bundler ausente
- **WHEN** desaparece el recurso que justifica una referencia clasificada
- **THEN** esa referencia deja de aceptarse y el gate falla
