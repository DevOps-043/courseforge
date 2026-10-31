# Contexto

- Objetivo y actor: autor que reposiciona un clip visual desde propiedades.
- Base y alcance: checkout principal; inspector de texto, subtítulos y medios.
- No objetivos: alineación automática, posición de audio, cambios de tamaño o motion.
- Dominios/contratos: `clip.layout.x/y`, esquema existente y CompositionAutosaveBoundary.
- Permisos y efectos externos: controles deshabilitados en pista bloqueada o edición restringida; persiste por la ruta autorizada existente.
- Criterios verificables: dos deslizadores etiquetados, campos exactos sincronizados, negativos válidos, rangos adaptados al lienzo, conservación del otro eje y tamaño.
- Riesgos e incertidumbres: el preview refleja la posición al confirmar el gesto mediante el guardado local existente; no se agrega un canal de preview por movimiento del puntero.

## Diseño
Componente de presentación controlado sin persistencia propia. Cada eje muestra un rango desde menos la dimensión del lienzo hasta esa dimensión, extendido si la posición existente queda fuera. Los límites absolutos provienen de compositionLayoutSchema. Los campos mantienen texto incompleto para que el guardado existente muestre validación sin convertir vacío en cero. El boundary agrupa el gesto y confirma al soltar; el teclado mantiene su flujo actual.

## Reversión
Retirar el componente y sus dos integraciones. Los documentos existentes siguen siendo compatibles porque no cambia su esquema.
