# Contexto

- Objetivo y actor: autor que reposiciona un clip visual desde propiedades.
- Base y alcance: checkout principal; inspector de texto, subtítulos y medios.
- No objetivos: alineación automática, posición de audio, cambios de tamaño o motion.
- Dominios/contratos: `clip.layout.x/y`, esquema existente y CompositionAutosaveBoundary.
- Permisos y efectos externos: controles deshabilitados en pista bloqueada o edición restringida; persiste por la ruta autorizada existente.
- Criterios verificables: dos deslizadores etiquetados, campos exactos sincronizados, negativos válidos, rangos adaptados al lienzo, conservación del otro eje y tamaño.
- Riesgos e incertidumbres: el preview temporal no representa persistencia confirmada; los errores mantienen el borrador del guardado existente.

## Diseño
Componente de presentación controlado sin persistencia propia. Cada eje muestra un rango desde menos la dimensión del lienzo hasta esa dimensión, extendido si la posición existente queda fuera. Los límites absolutos provienen de compositionLayoutSchema. Los campos mantienen texto incompleto para que el guardado existente muestre validación sin convertir vacío en cero. El boundary agrupa el gesto y confirma al soltar; el teclado mantiene su flujo actual.

### Acceso al selector — 2026-11-03
La rama de medios conservaba campos X/Y simples antes de tiempo/audio y colocaba
los deslizadores compartidos al final. Estos campos duplicados no emitían preview
temporal. Se retiran y se coloca una única sección «Posición manual» antes de
capas, tiempo y audio, como en texto y subtítulos. Los ejes se identifican
visualmente como «Horizontal (X)» y «Vertical (Y)». Se preservan nombres accesibles,
validación, rangos y el guardado existente. La QA debe montar también el inspector
completo: el control aislado no acredita su ubicación en el producto.

## Reversión
Retirar el componente y sus dos integraciones. Los documentos existentes siguen siendo compatibles porque no cambia su esquema.

## Ampliación: posición en tiempo real
Un comando aditivo `courseforge-composition-preview-position` lleva hfId y posición parcial X/Y validada por el esquema, o null para retirar el preview. No modifica el documento, hash o cola. El inspector lo emite por cada cambio válido; vacío o fuera de límites conserva el último preview válido. Al cambiar selección, desmontar o bloquear el control se retira el preview temporal. La opacidad conserva su control y persistencia existentes: esta ampliación corresponde al desplazamiento solicitado.

El runtime conserva coordenadas canónicas antes de superponer el borrador. Antes de patches DOM restaura la base y después la actualiza, conservando posiciones temporales posteriores a una confirmación anterior. Si las coordenadas canónicas coinciden con el borrador, deja de superponerlo. No cambia transform, opacity, tamaño ni motion. El receptor conserva las verificaciones de origen/versión existentes y valida claves, finitud y límites nuevamente.
