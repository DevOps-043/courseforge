## ADDED Requirements

### Requirement: Máscara geométrica no destructiva
El editor SHALL permitir círculo, elipse y rectángulo redondeado para imagen, video y diapositiva, conservando el archivo original.

#### Scenario: Combinar máscara y recorte
- **WHEN** el autor aplica máscara a un clip recortado
- **THEN** la región visible es la intersección de ambas formas en preview y render
- **AND** layout, opacidad, motion y fuente permanecen iguales

#### Scenario: Quitar o restaurar
- **WHEN** se quita la máscara
- **THEN** se conserva el recorte existente
- **AND** reiniciar el asset elimina tanto máscara como recorte

#### Scenario: Edición inmediata
- **WHEN** cambia la forma o redondeo desde propiedades
- **THEN** se ve en el monitor durante la interacción y se guarda con la cola existente

#### Scenario: Validación y bloqueo
- **WHEN** se solicita una forma desconocida, valores no válidos, audio/texto o pista bloqueada
- **THEN** el contrato o servicio rechaza la operación

#### Scenario: Documento sin máscaras
- **WHEN** se lee un documento anterior
- **THEN** no se añade el campo mask ni se modifica su HTML por defecto
