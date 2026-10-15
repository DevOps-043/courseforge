# CAP-029 — catálogo UX instalado (I05)

Fecha: 2026-10-10. **Implementado/preparado; ambiente y QA manual pendientes.**
Alcance autorizado: reutilizar el catálogo servidor de CAP029 y la inicialización
durable existente. No importador/generador, catálogo duplicado, editor nuevo,
instalación automática, registro automático ni activación de plantillas.

## Recorrido de producto

1. El inspector existente monta `CompositionHtmlInitializationPanel`, bajo los
   flags actuales. La consulta ocurre únicamente al pulsar «Consultar plantillas
   instaladas»; no al montar, cambiar de clip o recuperar un intento pendiente.
2. GET `/api/production/hyperframes/drafts/{draftId}/html-editing/{clipId}/templates`
   exige `expectedDocumentHash`. Reutiliza el handler autenticado de lecturas HTML:
   tenant/actor del host, reviewer actual, cuotas organización/actor, same-origin,
   límites, cancelación, respuesta privada no-store y errores correlacionados seguros.
3. `CompositionHtmlEditingBootstrapHost.listTemplateChoices` reutiliza la lectura
   exacta `read_html_editing_bootstrap_context`: borrador activo, versión guardada,
   hash recalculado, clip DECK_SLIDE todavía no editorial y autorización del actor.
   El mismo método privado de validación sigue alimentando la inicialización.
4. `HtmlEditingTemplateCatalog.listSourceMatches` consulta exclusivamente el
   catálogo instalado por el operador en `COMPOSITION_HTML_EDITING_CATALOG_JSON`,
   para ese tenant y SHA256 de la fuente guardada. Hasta32 entradas. Devuelve solo
   identificador/versión/número de campos, nunca fuente, manifest, grants, assets
   permitidos, configuración de otro tenant ni HTML ejecutable.
5. La UI muestra coincidencias o ausencia explícita, exige selección y conserva
   el único envío `host.initialize(SEND)` con guardado coordinado, operationId,
   journal/recibo y recovery existentes. No admite identificadores arbitrarios
   escritos a mano como alternativa silenciosa cuando la consulta falla.

## Límites de autoridad y compatibilidad

Una coincidencia de fuente **no es permiso de inicialización** ni evidencia de
grant, compilación segura o no-revocación durable. La inicialización vuelve a
validar configuración, fuente/hash, permisos vigentes, revocación y registro
transaccional; un cambio entre consulta y envío falla sin ampliar derechos.
No se ejecuta render ni se modifican documento, overrides, undo, snapshots,
Storage o registros editoriales durante GET. Solo los contadores de cuota tienen
el efecto de escritura habitual de las lecturas protegidas.

Los resultados se ligan localmente a actor/tenant/draft/clip/hash, se ocultan
inmediatamente al cambiar de propietario o documento y se cancelan al limpiar
el hook. Una respuesta antigua no publica opciones en el contexto nuevo. La
consulta elimina la selección anterior; no hay elección, fetch, retry o
inicialización automática. Recuperación de intentos inciertos conserva sus
controles previos y no consulta el catálogo ni reenvía el intento.

## Evidencia y entrega

Doce casos nuevos: catálogo tenant/source exacto y copias detached, lectura
autorizada sin registro/grants, autoridad extra/cancelación, scope/hash/source/
pointer existente, GET privado/auth/quota, origin/método/query duplicada/path,
roles/tenant/rate, salida corrupta/excesiva/conflicto, cliente→handler→bootstrap,
identidad/correlación/status sin retry, cancelación y wiring UI/ruta existente.
La inspección de UI/hook es estructural y tipada, no un navegador observado.
Regresión final y conteos se registran en el expediente, no se usan como métrica
de avance. Las pruebas del registro durable anterior se ejecutan también para
proteger el pequeño refactor de lectura compartida.

QA manual pendiente: consulta con catálogo vacío/no instalado, múltiples versiones,
selección explícita, cambio de actor/tenant/clip/hash durante consulta, revocación
o modificación antes de inicializar, y receipt/recovery de envío con ACK perdido.
No aprobar casos como PASS a partir de fixtures. No se aplican SQL, se activan flags
ni se instalan templates en esta entrega.

I01/I03/I04/I05 implementados/preparados; I02 conserva implementación necesaria.
Métrica **≈95% (±10 puntos)**: +5 por catálogo UX conectado, no por cantidad de tests.
SQL sin cambios: [secuencia manual1→29](SOFLIA_ENGINE_CAP029_SQL_MANUAL_ORDER.md);
el endpoint reutiliza la función ya preparada en el paso10 y cuotas existentes.
Preparación/instalación A01/A02 y QA Q01 continúan separadas.
