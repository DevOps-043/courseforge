# Verificación: bases importadas del estudio

Fecha: 2026-10-21. Base: staging `554cc397`. Rama:
`codex/imported-template-design-bases`. Checkout limpio al comenzar.

## Resultado implementado

El estudio permite elegir la base predeterminada o un paquete HTML importado
PACKAGED de la organización. La biblioteca incorpora «Usar como base» y abre
un estudio HTML con el diseño real. Se eligen uno o varios layouts, se crea una
conversación propia, se revisa texto/CSS con IA y se guarda una plantilla nueva.
Las derivadas se reabren en ese estudio y pueden servir como bases posteriores.
No se modifica el original ni se comparte entre organizaciones.

La procedencia `designBase` contiene run/spec/hash/título resueltos por servidor.
Los recursos se hidratan bajo autorización al editar o empaquetar; BD conserva
manifiestos sin base64. La última revisión derivada es el punto de partida de
la siguiente, incluso cuando el guardado no llama al modelo. El cliente crea
un borrador de la base antes de solicitar IA para conservar una versión recuperable.

El proveedor de la edición importada es Gemini, ya existente en el proyecto,
con settings BUNDLE_AGENT por organización. No se cambiaron secretos, dependencias
ni la configuración de proveedores existente. Las pruebas inyectan propuestas;
no se hizo ninguna llamada pagada ni se comprobó credencial/servicio remoto.

## Matriz y pruebas ejecutadas

| Verificación | Evidencia y resultado |
| --- | --- |
| Importación y bases | 44/44 pruebas; compilación TypeScript de tests y Node, código 0 |
| Tipo web completo | `npm run typecheck`, código 0 |
| ESLint dirigido | Código 0, sin errores; 12 avisos en código previo del estudio predeterminado y biblioteca |
| Producción/paquetes | `npm run test:remotion --workspace=apps/web`, secuencia completa, código 0 |
| HyperFrames | Falla con código 1 en `composition-agent-model-output.test.js`: Node no resuelve `@/lib/server/outbound-http`; el módulo no fue modificado y el fallo ya estaba documentado en la entrega anterior |
| Navegador | Cuatro escenarios Chrome: claro/oscuro, 1440/390 px; proveedor/API/persistencia simulados y servicios de dominio reales; código 0 |
| Seguridad | `npm run test:security-boundaries`, 30/30, código 0 |
| Arnés | `npm run test:harness`, 20/20, código 0 |
| OpenSpec | Cambio válido con `--strict` y CLI temporal disponible, código 0 |
| Compuerta global | Pasan adaptadores, arnés y enlaces (128 documentos); `verify:pr` se detiene con código 1 porque `openspec` no está instalado en el PATH del proyecto. No se modificó el gate para omitirlo |

Las pruebas de dominio cubren rol y organización ajenos, run no disponible,
selección individual, procedencia, fuente inmutable, recursos, revisión acumulativa,
texto vaciado realmente, texto escapado, IDs inválidos/duplicados, capacidad,
título obligatorio, CSS escapado/URLs, CSS repetido sin crecimiento y fallo del proveedor
sin insertar una revisión inválida. La suite se incluye en `test:slide-template-import`
para que forme parte de los checks existentes de producto.

El fixture `apps/web/tools/qa/imported-template-studio.smoke.mjs` usa el componente
React real, CSS/Tailwind/tokens reales y preview sandbox real. Comprueba fondo
importado, selección de una composición, revisión simulada a «Liderazgo», retirada
de fecha, construcción real del ZIP, recarga con título/revisión, ausencia de
scripts y desbordamiento, contraste del botón >=4,5, fuente sin cambios
y recuperación de un borrador después de un fallo simulado del proveedor. Salida
y capturas en `apps/web/.tmp/imported-template-studio-qa/`. Se inspeccionaron las
capturas claras de escritorio y oscuras móviles; las fuentes del harness son
respaldo local, no el sistema completo de fuentes de Next.

## Archivo real del usuario

Se volvió a preparar `SofLIA_Highlands_Premium_EN_v4.html` con los servicios reales,
se guardó la base en un fixture y se creó una derivada de `design-1`, `design-2`
y `design-6`, con proveedor simulado. Se vaciaron cuatro campos de pie/folio,
se recuperaron los ocho recursos originales y se construyó el ZIP derivado.
El contexto del modelo no contiene base64 y la respuesta permanece bajo 5 MB.
En esta derivada el contexto ocupa 37 043 bytes, la respuesta con previews
3 557 958 bytes y el ZIP 1 848 027 bytes. El paquete declara las composiciones
seleccionadas en README y su contador de layouts, sin listar el catálogo fijo.
La fuente no cambió. Recuentos, hash y tamaños:
[evidencia del archivo](real-file.json).

Esto prueba el circuito estructurado de edición/recursos/paquete con ese archivo;
no demuestra que un modelo real interpretará correctamente todas las instrucciones.
Tampoco convierte la gráfica original a datos vinculados ni acredita limpieza
editorial completa de los 16 diseños.

## Revisión adversarial y límites

- Revisión del mismo agente, no independiente. Se revisaron autorización antes de
  leer la base, filtros de tenant en run/spec, estado PACKAGED, preservación de fuente,
  procedencia acumulativa, campos vaciados, recursos, resultado revalidado y límites.
- El modelo propone JSON acotado; no suministra HTML ejecutable, URLs ni recursos.
  El contexto de referencia se trata como datos no confiables. Las decisiones
  semánticas todavía requieren revisión humana antes de usar la derivada.
- El contexto tiene límite 384 KB, respuesta 128 KB, CSS propuesto 20 000 caracteres,
  timeout 45 s y presupuesto de salida. Existe control de admisión por specs del
  usuario/tenant (12/h); no es una reserva atómica de tokens/coste ni cuenta intentos
  fallidos. El límite de generación de paquetes existente sigue vigente.
- Los originales siguen siendo revisables mediante el importador. Las derivadas
  se editan con IA sin convertir al editor geométrico. No cambió motion.
- No se ejecutó HTTP Next real, Supabase remoto, un render cloud, un modelo real,
  build completo/CI o despliegue. API, configuración efectiva del proveedor y
  persistencia remota requieren comprobación en staging.
- La política editorial general del informe anterior sigue pendiente. Esta entrega
  permite solicitar vaciado de campos concretos y revisar la variante; no afirma
  haber automatizado identificación semántica, OCR, citas o bindings de gráficas.

## Reversión

Ocultar selector y «Usar como base» evita nuevas derivadas sin borrar paquetes.
Mantener lectura y render de specs con `designBase`/`importedDesign` mientras
existan recursos que los declaren. No convertirlas silenciosamente al catálogo
fijo ni eliminar sus bases privadas. No hay migraciones, integración remota,
publicación ni despliegue en esta entrega.
