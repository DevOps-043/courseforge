## ADDED Requirements

### Requirement: Maestro global persistente
El sistema SHALL permitir guardar un maestro de volumen de 0 a 100% para toda la composición.

#### Scenario: Ajustar mezcla completa
- **WHEN** el usuario establece el maestro a 50%
- **THEN** todos los medios audibles se atenúan a la mitad conservando sus niveles individuales.

#### Scenario: Silencio y restauración
- **WHEN** establece 0% y después 100%
- **THEN** la composición queda silenciada y después recupera la mezcla anterior sin reescribir pistas o clips.

### Requirement: Paridad y compatibilidad
El sistema SHALL aplicar el mismo maestro una sola vez en preview, render y referencia de audio.

#### Scenario: Automatizaciones
- **WHEN** existen fades, ducking, curvas y crossfade
- **THEN** se multiplica el resultado final por el maestro sin cambiar sus tiempos ni aplicar dos veces la ganancia.

#### Scenario: Documento anterior o valor inválido
- **WHEN** se lee un documento sin maestro o se envía un nivel fuera de 0..1
- **THEN** la ausencia conserva el volumen y el hash; un valor inválido se rechaza.
