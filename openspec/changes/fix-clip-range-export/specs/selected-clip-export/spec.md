## ADDED Requirements

### Requirement: Descargar el tramo seleccionado
El editor SHALL descargar únicamente el medio seleccionado con su offset y duración vigentes, sin modificar el asset fuente.

#### Scenario: Clip recortado
- **WHEN** se exporta un clip multimedia después de eliminar un intervalo
- **THEN** la descarga contiene su ventana fuente vigente y comienza en cero

#### Scenario: Corte central
- **WHEN** el recorte genera dos clips y se selecciona uno
- **THEN** se descarga únicamente el fragmento seleccionado

#### Scenario: Fin del medio entre fotogramas
- **WHEN** el clip conserva la cola de un medio cuyo fin cae entre fotogramas de la composición
- **THEN** su ventana fuente termina en el límite original, sin extenderse por redondeo

#### Scenario: Clip confirmado fuera de la página actual de la biblioteca
- **WHEN** el medio del clip seleccionado no figura en la página de biblioteca cargada
- **THEN** se solicita por el endpoint autorizado del borrador usando la identidad del clip confirmado

#### Scenario: Cancelación o códec incompatible
- **WHEN** se cancela o no pueden conservarse las pistas requeridas
- **THEN** no se ofrece una descarga parcial y se liberan los recursos

### Requirement: Selección coherente tras recortar
La UI SHALL validar el mínimo temporal del documento y seleccionar un clip existente tras el guardado.

#### Scenario: Fragmento residual menor al mínimo
- **WHEN** un corte cercano al borde no genera un segundo clip
- **THEN** permanece seleccionado el clip sobreviviente
