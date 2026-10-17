# Contrato de referencias de fuentes

`course-source-reference.contract.ts` define el contrato compartido para evidencias,
`validationHints.sourceRefs`, gráficos, citas y assets visuales de diapositivas.

- Una referencia es un ID opaco, una ruta del componente o una URL completa. No es texto visible.
- El límite es de 8192 caracteres por referencia para admitir URLs largas y mantener acotados los metadatos.
- No se truncan referencias ni se normalizan sus caracteres internos: eso rompe identidad, deduplicación y asociación con la evidencia.
- El recolector conserva su comportamiento de ignorar metadatos ausentes/no textuales y recortar espacios de los extremos. Las cadenas no vacías se validan antes de planificar.
- Las referencias demasiado largas se rechazan explícitamente. No se descartan fuentes para permitir que una generación continúe sin evidencia.
- Los límites de cantidad por consumidor se conservan; este contrato unifica la representación de cada referencia.

El cambio amplía los límites anteriores de 120/180 caracteres, conserva la estructura
`course-deck-v1` y no requiere migración. No reconstruye referencias truncadas en
decks ya almacenados: esos decks deben regenerarse desde sus fuentes originales.

Al agregar un consumidor, reutilizar `courseSourceReferenceSchema` en lugar de
introducir otro límite. Cambiar el límite compartido requiere validar todos los
consumidores con `npm run test:slide-source-refs` desde `apps/web`.

Las pruebas cubren los límites antiguos, el nuevo límite, rechazo por exceso,
identidad/deduplicación, generaciones de guion/storyboard y propagación a assets,
gráficos y citas. No realizan llamadas a proveedores ni verifican datos de producción.
