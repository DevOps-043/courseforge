## ADDED Requirements

### Requirement: Presupuesto explícito de build
El build de Netlify SHALL disponer de un máximo de heap Node de 4096 MiB conservando la comprobación TypeScript.

#### Scenario: Worker de tipos
- **WHEN** Next.js ejecuta el worker de TypeScript durante el build
- **THEN** hereda el presupuesto configurado sin ignorar errores de tipos

### Requirement: Descubrimiento sin salidas generadas
La configuración TypeScript SHALL excluir salidas de compilación auxiliares sin excluir fuentes ni pruebas del producto.

#### Scenario: Artefactos locales
- **WHEN** existen carpetas dist o .tmp en el workspace
- **THEN** sus archivos no se agregan como entradas raíz de TypeScript
- **AND** los tipos de Next.js conservan su inclusión
