## ADDED Requirements

### Requirement: Motor común de búsqueda por lección
Web y Archivos + Web SHALL usar el mismo motor de búsqueda, reintento, respaldo y
validación, con una lección por solicitud y cuotas calculadas desde el plan.
DOCUMENTS_ONLY SHALL permanecer sin búsquedas web.

#### Scenario: Mixto sin documentos
- **WHEN** una lección requiere tres fuentes y no hay documentos ni fuentes previas
- **THEN** se buscan y validan tres URLs distintas con el mismo motor usado por Web
- **AND** no se reduce la cuota ni se omiten validaciones para completar la lección

### Requirement: Progreso seguro y recuperación acotada
El motor SHALL confirmar fuentes válidas antes de contarlas, conservar las
anteriores, buscar solo faltantes y excluir candidatos intentados y destinos
duplicados. SHALL respetar cancelación, revisión y deadline del adaptador.

#### Scenario: Reintento parcial
- **WHEN** una lección conserva dos de tres fuentes válidas
- **THEN** la búsqueda solicita la restante y conserva los registros anteriores
- **AND** una lección completa no dispara otra búsqueda

### Requirement: Diagnóstico sin datos privados
La finalización incompleta SHALL distinguir errores técnicos de falta de nuevas
fuentes válidas mediante motivos y contadores seguros.

#### Scenario: Fallo aislado
- **WHEN** una lección agota sus reintentos transitorios
- **THEN** las demás pueden confirmar su progreso y el cierre informa el fallo
- **AND** no se publica la respuesta del proveedor ni se aprueba cobertura incompleta
