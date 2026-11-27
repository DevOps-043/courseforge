## Purpose

Conservar el currículo y el recorrido híbrido al entregar un taller desde Architect
a Academy, con aprobación humana y acceso autorizado en Hub.

## ADDED Requirements

### Requirement: Contrato explícito e identidades estables
La publicación v2 SHALL identificar organización, artefacto, revisión y publicación,
así como módulos, lecciones y sesiones por IDs estables independientes del orden.

#### Scenario: Recorrido mixto
- **WHEN** el taller contiene lecciones solo Hub, solo Academy y compartidas
- **THEN** el paquete conserva los tres destinos y referencias válidas
- **AND** las exclusivas Hub no requieren un video de Academy

#### Scenario: Referencia inválida
- **WHEN** una lección queda sin destino, se repite indebidamente o apunta a una sesión ajena
- **THEN** se rechaza el paquete antes de escribir contenido del curso

#### Scenario: Archivo fuera de custodia
- **WHEN** el paquete declara un archivo que Academy no puede verificar para esa organización, artefacto y publicación
- **THEN** el receptor SHALL rechazar la entrega sin emitir confirmación RECEIVED

### Requirement: Compatibilidad sin degradación silenciosa
El receptor SHALL reconocer la versión y rechazar metadatos híbridos no soportados,
incluidos los agregados a un paquete v1. Un paquete v2 MUST NOT usar el importador posicional.

#### Scenario: Receptor sin importación v2 activa
- **WHEN** recibe v2 o un v1 que contiene recorrido híbrido
- **THEN** informa incompatibilidad sin publicar parcialmente ni descartar el recorrido

#### Scenario: Importación legacy sobre curso híbrido
- **WHEN** una revisión v1 apunta a un curso ya vinculado por identidad v2
- **THEN** el importador SHALL rechazarla antes de modificar el curso o sus contenidos

### Requirement: Aprobación atómica y autorizada
Academy SHALL aprobar una revisión en una transacción autorizada por organización,
conservando identidades, progreso y respuestas y detectando conflictos y reintentos.

#### Scenario: Falla durante la aprobación
- **WHEN** falla una escritura de contenido o preparación
- **THEN** no queda una publicación parcial ni se confirma la revisión como aprobada

#### Scenario: Organización ajena
- **WHEN** el emisor o revisor no tiene autoridad sobre la organización del paquete
- **THEN** se rechaza el acceso aunque el JSON declare una identidad válida

### Requirement: Preparación y programación separadas
Las sesiones SHALL conservar preparación y notas reservadas sin inventar fechas
ni crear reuniones. Academy SHALL programarlas explícitamente y proyectar al alumno
únicamente los documentos y actividades autorizados.

#### Scenario: Taller aprobado sin horario confirmado
- **WHEN** se aprueba un paquete con sesiones todavía sin fecha
- **THEN** se conservan sus plantillas y se solicita programación antes de ofrecer la clase
