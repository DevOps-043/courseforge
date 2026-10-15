# CAP-029 — auditoría final de consumidores editoriales R20/R22

Fecha:2026-10-10. Implementación preparada, no aceptación de ambiente/QA.
Esta revisión retira el pendiente de auditoría de consumidores R20/R22.
Su corte anterior conservó≈95%; el guard I02 posterior lleva la rúbrica a100%
de implementación necesaria preparada. Ninguna revisión certifica paridad de píxeles.

## Operaciones explícitas del roadmap

Nombres OP son capacidades del roadmap, no strings aceptados por el HTTP.
Los comandos reales usan la unión estricta de html-editing.contract.ts:

| Roadmap | Comando real | Consumidor e invariantes comprobados |
| --- | --- | --- |
| OP-021 html.setText | SET_TEXT | Texto asignado con node.text, no HTML; límite Unicode/multiline, locale/dirección solo si declarados |
| OP-022 html.setAttribute | SET_ATTRIBUTE | Atributo exacto de manifest, allow-list title/aria-label/aria-description/lang/dir; no on*, style, src/href ni selector libre |
| OP-023 html.setStyleToken | SET_THEME / SET_STYLE_RANGE | Token/choice enumerados o rango finito con min/max/step; CSS generado desde propiedad/unidad fijas, no CSS arbitrario |
| OP-024 html.setImage | SET_IMAGE | UUID declarado y con grant vigente, fit CONTAIN/COVER y alias materializado exacto, no URL enviada por cliente |
| OP-025 html.setVisibility | SET_VISIBILITY | Booleano y display visible declarado; ocultar no borra fuente, hijos, medios ni historial |
| OP-026 html.reorderElement | SET_SLOT_ORDER | Permutación completa de hijos inmediatos declarados; sin inserción, duplicados ni movimiento fuera del slot |
| OP-027 html.updateChartData | SET_CHART_DATA | Dataset tipado y bounded, IDs/series/labels declarados; renderHtmlEditingChart produce SVG admitido, no código de chart del cliente |
| OP-028 html.resetOverride | RESET | Retira override de un campo declarado; ALL no es permiso sobre DOM. UI multifield prepara un lote atómico de resets explícitos por campo |

Schemas, manifest digest y validateHtmlEditingCommand verifican binding, tipo de
campo, identidad estable y duplicados antes de reducción. El compilador editorial
vuelve a admitir el output agregado tras los overrides. Source/manifest originales
no cambian. Campos múltiples comparten targetElementId sin colisionar sinks; no se
acepta target/selector del cliente en un command.

## Recorrido conectado, no puertos sin consumidores

1. NativeCompositionPreview monta CompositionHtmlEditorialInspector para el clip
   seleccionado y crea CompositionHtmlEditorialNativeHost. El host reserva la
   cola nativa, bloquea trabajo concurrente y conserva seguimiento durable.
2. CompositionHtmlEditableFields y sus campos slots/chart/range preparan localmente
   un lote; useCompositionHtmlEditorialSession lo valida y llama host.execute.
   Sin host la consulta es read-only; flags por sí solos no habilitan POST libre.
3. La ruta editorial POST y la ruta operations/[operationId] POST llaman handlers
   autenticados: tenant/actor/reviewer server, same-origin, cuotas y payload bounded.
   Actor/binding/grants/source no vienen del cuerpo. La segunda conecta el servicio
   durable cuando su flag está habilitada; GET permite consultar con writes apagados.
4. Servicio→HtmlEditingRevisionGateway→SupabaseHtmlEditingRevisionRepository verifica
   hash/versión editorial y hash nativo. RPC append_html_editing_revision prepara
   una única transacción de append nativo+revisión; commit_html_editing_operation
   añade recibo idempotente a esa transacción. SQL1/2/12 preparados, no ejecutados.
5. Tras ACK el host consulta y verifica native/inspector antes de adoptar. Si falta
   ACK o cambia owner/base, conserva seguimiento y bloquea, sin retry automático.
   Adopción proyecta referencias HTML confirmadas sobre el historial nativo;
   checkpoints incompatibles crean barrera, no sobrescriben otra fuente.
6. HtmlEditingEditorialHistory usa locators confirmados: UNDO/REDO envía RESTORE;
   el servidor lee el histórico autorizado, exige misma fuente/manifest y compila
   con grants actuales. Restaurar crea una versión nueva, nunca rebobina counters.

## Derivación compartida de R22

readCompositionHtmlEditingCompilation obtiene revisiones exactas seleccionadas por
pointers nativos; compileCompositionHtmlEditingFragments comprueba conjuntos,
scope, documento/source/hash/version/template/manifest y recursos locales.
compileCompositionPreview consume esa única función en INTERACTIVE_PREVIEW y
HYPERFRAMES_RENDER, incluyendo deckStyles aislado y el mismo runtime de layout.
Contexto ausente/ambiguo o perfil incompatible rechaza: no fallback al original.

La ruta html-snapshots POST compone createHtmlEditingSnapshotHost.publishAuthorized:
lectura exacta→medios/fonts autorizados→archivo congelado→intención durable→Storage
create-only→commit atómico. El archivo contiene los dos targets. El consumo congelado
verifica perfiles/bytes y autoridad vigente; no elige implícitamente la última fila.
La entrega web monta transporte privado y URLs internas temporales, por lo que
el documento completo de preview no es byte-idéntico al de render. La igualdad
verificada es del fragmento editorial/derivación seleccionada, no de píxeles.

## Evidencia y frontera de cierre

Inspección de consumidores concretos anteriores y compilación fresca de tests.
Selección51/51: client/mutation/batch/field-command/history-projection y contratos
element-operations/multifield. Selección74/74: style-range/slots/chart/text-locale,
repository y snapshot-bundle. Los últimos invocan ambos compiladores concretos y
comparan fragmentos derivados de contextos vivos/congelados; rechazan fuente,
hash, grants, punteros o perfil incorrectos. Son125 pruebas existentes, no nuevas
capacidades ni aumento del porcentaje. Regresión general previa1068/1068.

R20 y la implementación compartida de R22 quedan preparados; interacción UI,
RLS/locks/receipts reales, accesibilidad, fonts/decode y paridad visual pertenecen
a A01/A02/Q01. R19 conserva su [auditoría de trazabilidad](SOFLIA_ENGINE_CAP029_LEGACY_LINEAGE_AUDIT.md)
y [continuidad independiente](SOFLIA_ENGINE_CAP029_HISTORICAL_CONTINUITY_AUDIT.md).
R21/I02 preparado tras autorización e integración del guard HTML de cuotas existentes
en el host Windows, sin cambiar bridge/límites/gates/stores. Regresión posterior
1074/1074 y guard/bridge24/24 aprobados; ejecución de kernel/browser sigue pendiente.
No afirmar que un timer o una medición posterior preempta trabajo nativo.
[Geometría y guard](SOFLIA_ENGINE_CAP029_GEOMETRY_AUDIT.md),
[expediente QA](SOFLIA_ENGINE_CAP029_QA_HANDOFF.md).
