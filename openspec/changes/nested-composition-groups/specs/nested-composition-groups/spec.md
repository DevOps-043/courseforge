## ADDED Requirements

### Requirement: Jerarquía editorial válida
El sistema SHALL permitir clips y grupos como miembros directos, con un único
padre por miembro, referencias del mismo documento y ausencia de ciclos.

#### Scenario: Agrupar grupos hermanos
- **WHEN** el usuario agrupa A y B completos en el mismo nivel
- **THEN** se crea P con A y B como hijos conservando sus IDs, clips y tiempos

#### Scenario: Agrupación mixta
- **WHEN** el usuario agrupa un grupo y un clip libre del mismo nivel
- **THEN** se crea un contenedor con ambas unidades como hijos directos

#### Scenario: Estructura inválida
- **WHEN** un patch produce ciclo, padre duplicado, referencia inexistente o supera un límite
- **THEN** se rechaza íntegramente sin persistir ni normalizar silenciosamente el error

#### Scenario: Profundidad máxima
- **WHEN** una operación deja un grupo en nivel 9 contando la raíz como nivel 1
- **THEN** se rechaza sin truncar el árbol; nivel 8 permanece admisible dentro de los otros límites

### Requirement: Navegación y selección por nivel
La interfaz SHALL distinguir unidades seleccionadas de clips descendientes y
permitir navegar por la ruta de grupos sin alterar el documento.

#### Scenario: Entrada y salida
- **WHEN** se entra en P y después en A y se sale un nivel
- **THEN** el contexto vuelve a P y muestra sus hijos directos seleccionables

#### Scenario: Selección entre niveles
- **WHEN** se intenta agrupar un ancestro con su descendiente o miembros de padres distintos
- **THEN** se explica la incompatibilidad y se conserva el documento vigente

### Requirement: Operaciones atómicas sobre descendientes
El sistema SHALL aplicar movimiento, desagrupación y cambios de miembros de
forma atómica y sin duplicar efectos sobre clips.

#### Scenario: Movimiento del padre
- **WHEN** se mueve P que contiene varios subgrupos
- **THEN** cada clip afectado recibe el mismo delta una vez y conserva sus offsets

#### Scenario: Restricción de movimiento
- **WHEN** hay pista bloqueada, vínculo ambiguo, contraparte agrupada externa o desborde temporal
- **THEN** se rechaza el movimiento completo sin cambios parciales

#### Scenario: Desagrupación interna
- **WHEN** se desagrupa un hijo de P
- **THEN** sus miembros pasan a P sin eliminar clips ni deshacer otros subgrupos

#### Scenario: Eliminación y normalización
- **WHEN** eliminar un clip deja un contenedor vacío o con una sola unidad
- **THEN** se elimina el contenedor vacío o se promueve la unidad, repitiendo hacia la raíz

### Requirement: Copia y extracción coherentes
El sistema SHALL preservar jerarquías completas al duplicar o extraer y validar
las mismas restricciones en los servicios y guards SQL aplicables.

#### Scenario: Duplicación completa
- **WHEN** se duplica una raíz agrupada
- **THEN** la copia contiene toda la jerarquía con IDs nuevos y sin modificar el original

#### Scenario: Extracción parcial
- **WHEN** la selección narrativa omite hojas de una raíz agrupada que toca
- **THEN** se rechaza con motivo explícito sin aplanar ni ampliar silenciosamente la selección

#### Scenario: Extracción completa
- **WHEN** se extrae una selección admisible que incluye la raíz completa
- **THEN** el documento esperado por SQL coincide con el producido por el servicio y conserva el árbol copiado

### Requirement: Compatibilidad, permisos e historial
El sistema SHALL conservar documentos planos, hashes históricos, autorización
tenant y concurrencia versionada al introducir agrupaciones anidadas.

#### Scenario: Lectura legacy
- **WHEN** se abre un documento plano o una versión histórica
- **THEN** se interpreta sin reescribirlo ni cambiar su hash por valores predeterminados

#### Scenario: Acceso no autorizado
- **WHEN** falta sesión, rol o acceso a la organización del borrador
- **THEN** se rechaza conforme al contrato de autorización antes de modificar el documento

#### Scenario: Conflicto de versión
- **WHEN** agrupar se envía con un hash anterior al documento vigente
- **THEN** se devuelve conflicto y no se sobrescriben relaciones del nuevo documento

#### Scenario: Deshacer y recargar
- **WHEN** se agrupa, confirma, deshace, rehace y recarga
- **THEN** cada estado confirmado conserva las membresías y el historial previsto

#### Scenario: Escritor incompatible
- **WHEN** un escritor intenta reemplazar un árbol descartando sus relaciones sin una operación admitida
- **THEN** se rechaza sin pérdida silenciosa de agrupaciones

#### Scenario: Capacidad de cliente ausente
- **WHEN** se intenta escribir un documento jerárquico sin X-Composition-Grouping-Version igual a 2
- **THEN** el servidor devuelve 409 con reason COMPOSITION_GROUPING_CLIENT_OUTDATED sin modificarlo

#### Scenario: Restauración plana compatible
- **WHEN** un cliente compatible restaura un checkpoint plano sobre un documento que ya usó groupingVersion 2
- **THEN** la nueva versión conserva el marcador 2 y el contenido del checkpoint sin modificar el historial original

#### Scenario: Downgrade desde otro escritor
- **WHEN** un backend anterior o escritura directa intenta omitir el marcador de un documento ya migrado
- **THEN** el guard SQL rechaza la inserción y conserva la versión actual

### Requirement: Habilitación compatible y equivalencia audiovisual
El sistema SHALL habilitar escrituras jerárquicas solo con consumidores compatibles
y conservar la salida audiovisual si la operación solo modifica organización editorial.

#### Scenario: Escrituras desactivadas
- **WHEN** la habilitación de jerarquías está desactivada
- **THEN** el servidor bloquea creaciones anidadas incluso si el cliente construye el payload

#### Scenario: Guard SQL incompatible o desconocido
- **WHEN** la variable de habilitación es true pero no se confirma el contrato SQL compatible
- **THEN** el servidor anuncia canCreateNestedGroups false y bloquea nuevas creaciones anidadas

#### Scenario: Rehacer durante deshabilitación
- **WHEN** rehacer reintroduciría relaciones anidadas mientras la creación está desactivada
- **THEN** se rechaza con explicación, conserva el checkpoint y no avanza el cursor del historial

#### Scenario: Agrupar sin mover
- **WHEN** se agrupan clips o grupos sin modificar sus propiedades audiovisuales
- **THEN** preview y render conservan geometría, timing, audio y motion de esos clips

#### Scenario: Promoción durante reversión operativa
- **WHEN** desagrupar o eliminar un contenedor promueve descendientes a un ancestro mientras la creación está desactivada
- **THEN** se admite la simplificación porque conserva una relación de ancestros ya existente, aunque cambien sus referencias directas

#### Scenario: Reversión operativa
- **WHEN** se deshabilitan nuevas creaciones después de persistir árboles
- **THEN** se conserva soporte de lectura y operación segura de documentos existentes sin aplanarlos
