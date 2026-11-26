## ADDED Requirements

### Requirement: Autorización background independiente de cookies
El worker SHALL verificar la firma y nonce de la solicitud, su reserva de job y la
membresía y rol vigentes del creador sin usar cookies o headers de Next.js.

#### Scenario: Invocación desde Netlify
- **WHEN** llega una solicitud firmada para un job reservado
- **THEN** el worker verifica creador, organización, componente, artefacto, tipo y proveedor antes de ejecutar

#### Scenario: Acceso denegado antes de generación
- **WHEN** la reserva es válida pero el componente o acceso vigente no lo son
- **THEN** registra diagnóstico y marca FAILED únicamente si la reserva sigue pendiente o en cola

#### Scenario: Reserva ajena
- **WHEN** el job no coincide con el alcance firmado
- **THEN** no genera ni modifica ese trabajo
