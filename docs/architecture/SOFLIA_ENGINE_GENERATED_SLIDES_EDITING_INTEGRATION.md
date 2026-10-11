# Diapositivas nuevas: preparación editorial desde la generación

Fecha: 2026-10-10. Alcance: productor de diapositivas Engine, no migración de
talleres existentes ni cambios CAP-022/025/worker. Fuente de prácticas:
`docs/prompt_maestro.md`. La implementación del editor no acreditaba esta integración.

## Estado y límite de esta entrega

La generación guarda ahora **dos salidas del mismo CourseDeckSpec**:

1. Presentación navegable existente, sin cambiar su renderer/comportamiento.
2. Preparación `courseforge-generated-editable-deck-v1`, con fragmentos estáticos,
   IDs deterministas, declaraciones tipadas, hash por fuente y preflight del
   compilador editorial real. También se reconstruye en cambios de apariencia
   de materiales que ya tengan preparación editorial.

**No es todavía el flujo completo de edición automática.** El artefacto declara
`activation: REQUIRES_AUTHORIZED_DRAFT_REGISTRATION`. Ahora Ensamble consume los
fragmentos al crear un documento nuevo, siempre que no haya fuentes personalizadas
sin vincular ni HTML externo mezclado. Los endpoints de plantillas e inicialización
reconstruyen el catálogo por clip, sin añadir declaraciones a `.env`. El registro
sigue siendo explícito mediante el flujo existente del inspector y exige un
snapshot real activo de la composición. No se inventan anclas ni se escribe en GET.
Los borradores existentes no se migran al regenerar materiales.

| Unidad necesaria | Estado |
| --- | --- |
| Producir campos/fragmentos deterministas y compilables | Implementada |
| Resolver imágenes por registro tenant/componente/path/checksum | Implementada; permisos de borrador deben revalidarse al importar |
| Persistir preparación con hash/versionar cache/reconstruir apariencia | Implementada |
| Materializar fuentes personalizadas con autoridad nativa | Uploaded READY y Google admitido/fijado integrados en documentos, compiladores, preview, snapshots y reconstrucción; SQL preparado, no aplicado |
| Consumir diapositivas nuevas en Ensamble | Implementado con fuentes de sistema, uploaded READY y Google fijado; instancias por clip |
| Catálogo reconstruido/registro explícito | Implementado; conserva bootstrap/recibos/CAS y requisito de snapshot real |
| Activación inicial automática/registro de todo el deck | Pendiente; no confundir catálogo con registro o enlace nativo |
| Validar flujo integrado generación→edición→preview/render | Integración automatizada de productor/registro/importación/catálogo/primer cambio/ambos compiladores/ZIP; pendientes DB/Storage/browser/render reales para QA |

## Contrato del productor

- El modelo propone contenido estructurado, no permisos, UUIDs de recursos ni
  declaraciones privilegiadas. El productor determinista conserva el renderer.
- IDs por slide.id/rol de campo, no por texto ni orden global. Cambiar texto no
  renombra el campo. IDs de diapositivas duplicados se rechazan.
- TEXT: títulos, párrafos/subtítulos, bullets, tarjetas, destacados y código
  representable por el contrato actual. Un texto con delimitadores HTML puede
  conservarse escapado pero queda enumerado como read-only; no se relaja el
  contrato seguro. Una diapositiva sin ningún campo admisible se rechaza.
- IMAGE: solo registro exacto de `production_assets`, misma organización y
  componente, tipo SLIDE_IMAGE_SET no archivado, slot/path/checksum coincidentes
  y un solo candidato. Se producen alias `conformance-media/<UUID>`, no URLs.
- CHART: contrato/renderer existentes para barras, líneas, áreas y proporciones.
  Datos no admitidos quedan señalados como read-only, sin otro motor de gráficas.
- CSS de la salida editorial: perfil explícitamente estático del renderer propio,
  tipografía geométrica acotada y bordes con longhands. Movimiento pertenece al
  timeline. Sombras, backdrop filters y transforms CSS no se incluyen en este
  perfil; sus diferencias con la presentación se declaran. No es un sanitizador
  para HTML arbitrario ni una relajación del compilador.
- El fragmento contiene su wrapper, apariencia y CSS. Su hash cubre todos ellos,
  para evitar aceptar un layout/apariencia distintos con el mismo hash de fuente.
- Las fuentes externas no se descargan en este productor. Se declaran por familia,
  fuente y fontAssetId si existe; las URLs firmadas no son identidad durable.
- El preflight usa identidades sintéticas internas exclusivamente para compilar.
  No se persisten ni constituyen autorización, grants reales o recibos de borrador.

## Persistencia y compatibilidad

El JSON se guarda en Storage interno bajo un nombre direccionado por su SHA-256.
`assets.slides.editable_deck`, el asset HTML y el output del job registran su
referencia, hash, hash del spec, conteos y estado pendiente de activación. El
artifact contiene las declaraciones; **no se coloca un catálogo creciente en env**.
La versión editorial entra en la clave de idempotencia de generación.

La ruta de apariencia prepara el nuevo artefacto antes de subir el HTML actualizado
y reemplaza la referencia activa. Para material antiguo sin preparación mantiene
el flujo anterior y deja la referencia editorial en null. No cambia clips,
revisiones HTML, undo, snapshots, grants ni documentos existentes. Storage y patch
de materiales conservan la limitación transaccional preexistente; un fallo posterior
al upload puede dejar un objeto no referenciado, nunca prueba de activación.

## Criterios de integración

1. Resolver el artefacto desde procedencia servidor/autorización actual, con
   presupuesto de bytes, versión, hash y cotejo del spec y recursos. Un JSON en
   Storage o un marker en HTML no establece por sí solo confianza de catálogo.
2. Resolver fuentes mediante el inventario nativo autorizado, sin insertar URLs
   externas en CSS ni cambiar silenciosamente la tipografía elegida.
3. Importar los fragmentos completos/estáticos antes de persistir el borrador
   nuevo. No sustituir fuentes de revisiones editadas ni migrar talleres viejos.
4. Registrar mediante bootstrap/recibos/CAS existentes, con anclas reales y grants
   actuales. Recuperar resultados inciertos; no hacer registro en un GET de
   lectura ni repetir escrituras ciegamente. Registrar no equivale a enlazar la
   revisión nativa: cubrir también esa vinculación y el primer preview.
5. Verificar batch parcial, concurrencia, revocación, fuentes y recursos del primer
   preview antes de declarar edición lista. Integrar aceptación de las salidas
   registradas con preview/render, no comparar solo HTML serializado.

## Validación

Compilación dirigida: `tsconfig.remotion-test.json`. Tests nuevos:
`course-deck-editable-artifact.test.ts` y
`course-deck-editorial-preparation.test.ts`; regresiones:
`course-deck-renderer.test.ts` y `animated-deck-preprocessor.service.test.ts`.
Cubren layouts claro/oscuro, cuatro tipos de gráfica, 24 slides, modificación real
de texto, identidad/hash, recursos ambiguos o ausentes, tenant/componente, errores
de Storage y preservación del renderer de presentación.

El registro/Storage de los tests son simulados. No se ejecutan IA, red, SQL,
render ni QA browser. No se acredita paridad visual por aprobar compilación.
No hay migraciones SQL nuevas ni variables adicionales para esta entrega.

Resultado del corte: **100/100 tests**, cero fallos/skips/cancelaciones (31 nuevos
y 69 de regresión); compilación dirigida exit 0, tipado web noEmit exit 0 y lint
de los siete archivos TS de integración/tests exit 0, sin advertencias. Comando:

```powershell
# Desde apps/web
node ../../node_modules/typescript/bin/tsc -p tsconfig.remotion-test.json
node --test --test-reporter=tap .tmp/remotion-tests/domains/production/slides/__tests__/course-deck-editable-artifact.test.js .tmp/remotion-tests/domains/production/slides/__tests__/course-deck-editorial-preparation.test.js .tmp/remotion-tests/domains/production/slides/__tests__/course-deck-renderer.test.js .tmp/remotion-tests/domains/production/validation/__tests__/animated-deck-preprocessor.service.test.js
node ../../node_modules/typescript/bin/tsc --noEmit --incremental --tsBuildInfoFile .tmp/editorial-generation-web.tsbuildinfo
```

## Segundo corte: consumo de material generado en Ensamble

Cambios implementados:

- `course-deck-editorial-reader.server.ts`: lectura por relación tenant/componente;
  límites de spec/artefacto (1/4 MiB), formato, ruta direccionada por contenido,
  conteos y hashes. Reconstruye el productor propio con el registro actual de
  imágenes. No descarga ni confía en declaraciones del JSON de Storage. Esto
  verifica procedencia reproducible, no disponibilidad física del export JSON.
- `composition-generated-deck-import.server.ts` y `hyperframes-draft.service.ts`:
  importación solo antes de persistir el documento inicial; CSS autocontenido,
  sin stylesheet global remoto; IDs distintos por instancia de clip. Fuentes,
  timing, layout, revisiones y planes de documentos existentes no se reemplazan.
  Los planes de escenas se trasladan solo si pertenecen a la presentación exacta
  reconstruida; planes obsoletos conservan necesidad de revisión.
- `composition-generated-deck-catalog.server.ts`: catálogo de un solo fragmento
  reconstruido por clip. Se resuelve **después** del RPC de actor/source/CAS;
  comprueba composición/componente/tenant y source exacto. El catálogo del operador
  se conserva exclusivamente para material legacy; no se fusionan organizaciones
  ni se adopta HTML arbitrario. Errores de integridad no habilitan un fallback.
- Bootstrap HTTP: consulta de plantillas, registro y registro con recibos utilizan
  ese proveedor. Un recibo histórico se consulta antes de reconstruir catálogo y
  no reactiva contenido ni repite escrituras inciertas.
- Preview y snapshots: las imágenes `conformance-media/<UUID>` se resuelven desde
  vínculos actuales del borrador, tenant, MIME y estado vigente; también cuando
  no existe public_url. Se rechazan recursos desvinculados/archivados. Un alias no
  es un grant. Los compiladores mantienen source original y referencia nativa al
  guardar un campo; las diapositivas vecinas pueden seguir sin overrides.

### Límites del segundo corte (histórico; Google actualizado al final)

1. Fuentes Google: aún falta materializar archivos locales verificables mediante
   el contrato nativo. Uploaded READY ya está integrado (cuarto corte). Google,
   registros ausentes/revocados o familias incompatibles bloquean la importación
   antes de persistir un documento incompleto; no se sustituye la tipografía.
   La descarga de Google es implementación pendiente, no QA.
2. Primer ancla: implementado el onboarding explícito descrito en el tercer corte.
   Requiere aplicar su migración SQL; no se relaja el requisito de snapshot real
   ni se registra automáticamente desde lecturas. Pendiente validación en DB/browser.
3. El registro sigue siendo por clip mediante el inspector existente. La primera
   modificación enlaza su revisión mediante el gateway coordinado existente.
   No se ha añadido un batch automático ni SQL de activación masiva.
4. Reensamble posterior: se rechaza con 409 cuando podría reconstruir fuentes
   editables; no se borran referencias para hacer pasar la operación. Una mezcla
   inicial de HTML importado y diapositivas generadas requiere adaptación explícita
   y devuelve 422 en vez de omitir fuentes. Los proyectos standalone manuales
   conservan su camino actual.
5. Probar SQL/Storage reales, cancelaciones de red, concurrencia de creación,
   revocación durante commit, navegación del inspector y paridad visual real.
   Las pruebas de dominio no acreditan estas condiciones operativas.

### Validación del segundo corte

**218/218 pruebas aprobadas**: 112 del productor/reader/regresiones y 106 de
integración, bootstrap, plantillas, compiler, native media, snapshot, drafts y
standalone. Son 20 pruebas nuevas en este corte; las otras 198 son regresiones.
Los dobles simulan DB/Storage; la reducción de texto, enlace nativo y compilación
de ambos targets sí utilizan los módulos reales. No se ejecutó render/browser,
SQL, IA, despliegue ni llamadas a proveedores.

Tipado dirigido Remotion e Hyperframes y noEmit web: exit 0. Lint de módulos nuevos,
endpoints y bootstrap: sin errores ni advertencias nuevas. Los servicios legacy
tocados conservan advertencias preexistentes `no-explicit-any` (28); no se ampliaron
por esta integración. No hay nuevas dependencias, variables ni SQL que ejecutar.

Comandos adicionales, desde `apps/web`:

```powershell
node ../../node_modules/typescript/bin/tsc -p tsconfig.hyperframes-test.json
node --test --test-reporter=tap .tmp/remotion-tests/domains/production/slides/__tests__/course-deck-editorial-reader.test.js
node --test --test-reporter=tap .tmp/hyperframes-tests/domains/production/composition-editor/__tests__/composition-generated-deck-integration.test.js .tmp/hyperframes-tests/domains/production/composition-editor/__tests__/composition-html-editing-bootstrap-host.test.js .tmp/hyperframes-tests/domains/production/composition-editor/__tests__/composition-html-editing-template-choices.test.js .tmp/hyperframes-tests/domains/production/composition-editor/__tests__/composition-preview-compiler.service.test.js .tmp/hyperframes-tests/domains/production/composition-editor/__tests__/composition-html-editing-preview-native-media.test.js .tmp/hyperframes-tests/domains/production/composition-editor/__tests__/composition-snapshot.service.test.js .tmp/hyperframes-tests/domains/production/hyperframes/__tests__/hyperframes-draft.service.test.js .tmp/hyperframes-tests/domains/production/composition-editor/__tests__/standalone-media-composition.test.js
```

## Tercer corte: primera revisión desde el inspector

Se priorizó cerrar este bloqueo del recorrido básico antes de extender fuentes.
No hay cambios CAP-022/025, worker, catálogo legacy ni nuevas variables de entorno.
Se reutiliza `COMPOSITION_HTML_EDITING_INITIALIZATION_ENABLED` y su par público.

### Recorrido explícito

En «Preparar campos HTML»:

1. **Comprobar revisión guardada**: consulta autorizada de disponibilidad, sin
   crear snapshots ni registrar campos. Una revisión real existente no se reactiva.
2. Si no existe: **Preparar primera revisión para editar**. Congela el documento
   guardado con el servicio nativo existente, empaqueta ZIP/recursos y registra
   una revisión real. No renderiza, aprueba, cambia el timeline ni añade undo.
3. Una vez disponible: buscar la plantilla compatible y habilitar sus campos
   mediante los flujos de inicialización/recibos existentes. El primer cambio
   conserva el gateway coordinado de enlace nativo. No hay registro masivo.

La disponibilidad actual **no es un recibo** del POST anterior. Tras un resultado
incierto se ofrece únicamente consulta explícita; nunca un reenvío automático.
Recargar/cambiar de clip no concede autoridad para reemplazar una salida activa:
el servidor devuelve disponibilidad si ya existe, sin crear otra revisión.

### Seguridad/concurrencia

- Endpoint `drafts/[draftId]/html-editing-initial-anchor`: límites de cuerpo/URL/
  respuesta/tiempo, anti-CSRF para POST, tenant/actor/rol desde sesión, rate limit
  compartido, errores seguros y correlación sin payloads de proveedor.
- El host nativo reserva la cola y el lock compartido entre pestañas; bloquea
  tracking pendiente, previews/cambios incompatibles y cambios de owner/documento.
  Refresca el historial sin adoptar ni restaurar un documento.
- `snapshotCompositionDocument.initialEditorialAnchor`: hash exacto del documento
  serializado, sin reutilizar filas legacy parcialmente vinculadas ni activar
  con el UPDATE legacy. Los demás callers mantienen su comportamiento.
- La activación nueva es transaccional: draft primero, actor vigente, último hash
  guardado, composición aún sin salida activa, revisión/snapshot de ese tenant y
  draft, ruta/checksum/tamaño y vínculos de recursos vigentes. Se reutiliza
  `private.html_snapshot_resource_bindings`; una revocación o identidad distinta
  impide activar. No se mantienen locks durante compilación/Storage.
- Si gana otra edición/activación, la revisión preparada puede quedar **inactiva**;
  un fallo de Storage/registro puede dejar un objeto huérfano. No se borra ni se
  reutiliza a ciegas, y no se afirma rollback de Storage. La numeración concurrente
  conserva la restricción existente: puede fallar de forma segura y requiere
  consultar antes de un nuevo intento explícito. No se promete procesamiento
  masivo/horizontal ilimitado de ZIP dentro de una petición síncrona (timeout 60s,
  límites de archivo existentes); sería un flujo de jobs independiente.

### SQL manual y rollout

**No se ejecutó SQL.** Si las migraciones CAP-029 previas ya están aplicadas, la
única migración incremental de este corte es:

`supabase/migrations/20261010200000_initial_html_editing_anchor.sql`.

Orden: migraciones existentes del editor/snapshots en orden cronológico → esta
migración → desplegar la aplicación → verificar en staging con un documento nuevo
sin fuentes personalizadas. Depende de
`20261005200000_html_editing_revision_store.sql` (`assert_html_editing_actor`) y
`20261006000000_html_snapshot_resource_validation.sql` (validador de recursos),
además de tablas nativas de composición/branding/SFX ya existentes. No ejecutar
solo esas dependencias aisladas sobre una instalación incompleta ni reaplicarlas
si ya figuran en el historial de migraciones.

Rollback de funcionalidad: deshabilitar inicialización con sus flags existentes
o retirar el caller nuevo; no borrar snapshots creados, pues pueden ser anclas de
revisiones HTML. No hay migración destructiva ni eliminación automática.

### Validación y pendientes

Tests de contrato, permisos, cuota, origen, integridad de owner/hash, abortos,
respuesta incierta, cola/lock y paquete real de diapositivas generadas. La prueba
real de ZIP usa compiler/JSZip existentes; DB y Storage siguen simulados. Los
checks textuales del SQL **no son una ejecución PostgreSQL ni prueban su locking**.
Faltan DB real, red/Storage real, QA browser y concurrencia/revocación transaccional
real. Fuentes Google, reensamble seguro y mezcla inicial de HTML siguen
pendientes de implementación; uploaded READY se incorporó en el cuarto corte.

## Cuarto corte: tipografía uploaded READY en documentos generados

Las fuentes elegidas desde el inventario de la organización se conservan como
`DECK_SLIDE.source.fontBindings = [{fontAssetId, fontFamily}]`, sin URLs, binarios
ni permisos en el documento. El campo es opcional y no introduce defaults en
documentos anteriores. El hash nativo cubre las dependencias cuando existen.

- `composition-font-references.ts` centraliza recolección y límites (32 IDs),
  rechaza familias incompatibles para un mismo ID y alimenta los consumidores de
  preview, manifiestos, snapshots y reconstrucción. Texto/subtítulos nativos
  conservan sus contratos existentes.
- `composition-font-registry.server.ts` comparte la lectura acotada ya usada por
  snapshots HTML: tenant verificado, uploaded/READY, SHA-256, MIME, tamaño máximo
  50 MiB, bucket y ruta local admitidos. Es autoridad de metadatos, no prueba de
  disponibilidad física, decodificación ni una autorización permanente.
- El lector generado reconstruye el artefacto y coteja requisitos ID/familia con
  el inventario vigente antes de importar. El catálogo recibe las dependencias
  del documento validado por actor/source/CAS, no del navegador, y las coteja de
  nuevo. Registro revocado o referencia ausente no habilita fallback de catálogo.
- Ambos destinos del compilador requieren la fuente resuelta. Primer guardado
  de campos conserva las referencias de todos los clips. La adquisición HTML
  verifica bytes, tamaño y MIME; el snapshot inicial empaqueta el archivo bajo
  `assets/fonts/<sha256>.<ext>` y congela su manifiesto. Reconstrucción exige ese
  conjunto de dependencias en vez de descartarlo al omitir clips DECK.
- El preview nativo inicial, propuestas y presets permiten exclusivamente las
  rutas de fuentes firmadas por el servidor en el Storage configurado. No se
  habilita un origen completo ni se insertan tokens en CSP. El canal HTML editable
  conserva su política aislada; no se modifica el worker ni stores/políticas IA.
- Imágenes locales: se verifican todos los aliases mediante vínculos actuales
  del borrador sin exigir que sean clasificados DECK_DEPENDENCY (pueden ser CLIP).
  Reconstrucción mantiene separado el conjunto de recursos HTML del de clips
  nativos; no duplica imágenes en `nativeResources` ni acepta aliases como grants.

### Límites de evidencia y continuidad

En el cuarto corte Google seguía bloqueado aunque existiera un CSS externo: no es autoridad de bytes.
No se descargan recursos remotos ni se sustituye la familia. Tampoco se transforma
un registro Google en uploaded o se reconstruyen borradores ya editados.

El manifiesto y `@font-face` no prueban uso de glifos. La política
`DECLARED_CUSTOM_NATIVE_FONT_USAGE_V1` sigue limitada a texto/subtítulos nativos;
no se inventan IDs DOM para nodos de diapositiva. El contrato separado de texto
DECK mantiene su alcance `NOT_RENDER_FONT_ATTESTATION`; sus gates no se relajan.
El navegador puede sintetizar peso/estilo o usar fallback de glifos ausentes. Esa
validación real queda pendiente, igual que DB, Storage y render reales.

Las pruebas de adquisición usan bytes sintéticos y no acreditan que sean una
fuente decodificable. Las de dominio usan productor, reducer, binding, ambos
compiladores y ZIP reales con repositorios/transportes simulados. Se incluye
rechazo de tenant ajeno, revocación, familia, MIME, hash, tamaño y ruta inválidos,
dependencias ausentes y conservación después de editar texto.

No hay SQL, flags ni dependencias nuevas en este corte. Sigue pendiente aplicar
`20261010200000_initial_html_editing_anchor.sql` después de las migraciones
anteriores del repositorio y antes del despliegue del onboarding.

Antes de probar/desplegar el canal HTML, recompilar sus inputs locales fijados:
desde `apps/web`, ejecutar `node tools/html-preview/build-runtime.mjs`. El paquete
se genera en `.tmp/html-preview-runtime`; no se compila durante una petición.

Verificación de este corte: 649/649 pruebas seleccionadas de editor, fuentes,
preview, snapshots y reconstrucción; 112/112 de productor/reader/renderer y
preprocesado. Los dos grupos no se solapan. La captura de fuentes controlada
requiere ejecutarse desde la raíz del repositorio y compilar primero
`tsconfig.composition-worker.json`; los demás grupos se ejecutaron desde
`apps/web`. Las pruebas de archivos privados se verificaron fuera del sandbox
después de confirmar que sus restricciones causaban EPERM, sin relajar los
controles del producto. Compilaciones Hyperframes, Remotion y worker sin errores.
Lint dirigido de módulos nuevos/modificados de este corte sin errores ni
advertencias nuevas; el lector de assets conserva seis advertencias `any`
preexistentes. No se ejecutaron migraciones, despliegues, DB real, descarga de
Google ni generación de pago.

Resultado de este corte: **285/285 pruebas** (112 productor/reader, 106 integración
y regresiones, 60 preparación/host nativo, 7 render TSX/contratos visuales). De
ellas, 15 son nuevas: 11 de preparación, 3 de coordinación y 1 de UI. Tipado
Hyperframes y web noEmit exitosos; lint de módulos nuevos/host/panel sin errores
ni advertencias. `NativeCompositionPreview.tsx` mantiene 52 advertencias previas,
igual que HEAD, sin incrementarlas. Esto no acredita QA visual ni SQL ejecutado.

```powershell
# Desde apps/web
node ../../node_modules/typescript/bin/tsc -p tsconfig.hyperframes-test.json
node --test --test-reporter=tap .tmp/hyperframes-tests/domains/production/composition-editor/__tests__/composition-html-initial-anchor.test.js .tmp/hyperframes-tests/domains/production/composition-editor/__tests__/composition-html-editing-native-host.test.js
# Desde la raíz, render TSX en servidor sin navegador
node scripts/test-composition-html-panel.cjs
```

## Quinto corte de integración: variantes Google desde creación hasta archivo editado

Actualización del 2026-10-10. Los límites históricos anteriores no describen el
estado actual de fuentes Google. No cambia CAP-025, worker, políticas de render
ni documentos existentes. Hyperframes-core orienta la conservación de recursos
locales fijados y de los IDs/timing existentes; no se actualizó el SDK.

### Implementación verificada

- La plantilla guarda `googleNativePin` después de validar explícitamente el
  conjunto revisado. El spec y la preparación editorial conservan ese pin exacto;
  las lecturas nunca eligen «la última» versión disponible.
- La generación comprueba la fuente seleccionada antes de síntesis/proveedores
  y de nuevo antes de guardar el artefacto. Un conjunto ausente/revocado impide
  publicar preparación incompleta; no se sustituye familia ni se descarga Google
  automáticamente desde el preview.
- Cada variante se identifica con su UUID admitido y transporta pin, admisión,
  peso, estilo y rango Unicode en documento/manifiesto/CSS. Se permite una familia
  con variantes de la misma admisión no conflictivas; fuentes ambiguas, mezcla
  uploaded/Google y metadata diferente siguen rechazándose.
- Preview nativo/editorial, primera revisión, archivo editado, referencia de
  conformidad y reconstrucción conservan estos descriptores. El preview publicado
  rechaza cambios de admisión/descriptores aunque los bytes coincidan. El archivo
  copia también la metadata anidada antes de sus primeras operaciones asíncronas.
- El guard SQL HTML conserva el OID del validador existente y delega sus controles
  uploaded/media, añadiendo verificación exacta Google bajo locks en la transacción
  exterior. No se extiende extracción narrativa a DECK: ese tipo ya está
  explícitamente rechazado por el contrato de fragmentos narrativos; hacerlo
  requiere un diseño separado, no omitir sus controles de fuente.

El renderer navegable de presentación mantiene su comportamiento anterior;
el editor utiliza el perfil editorial estático descrito arriba. No se promete
igualdad visual entre presentación navegable y perfil editorial ni prueba de
uso real de glifos. Ambos destinos del editor sí reciben los mismos recursos
fijados; la paridad visual de captura pertenece al QA pendiente.

### Evidencia de este corte

- **292/292** pruebas seleccionadas de fuentes, integración generada, ancla,
  preview, manifiestos, snapshots y compilador, sin skips/cancelaciones.
- **112/112** productor/reader/renderer/preprocesado, grupo separado.
- **14/14** SQL de admisión/lectura/guard HTML en PostgreSQL aislado; **5/5** SQL
  de candidatos (incluye reproducción de 42601 y rollback).
- **3/3** render SSR del control Google. Tipado Hyperframes/Remotion/web y lint
  dirigido sin errores. Runtime HTML reconstruido: 396214 bytes, 122 inputs fijados.
- La prueba de traza de dependencias del decoder compilado incluye
  `fontkit/dist/main.cjs` y dependencias (122 archivos, cero warnings). No equivale
  a un build/despliegue completo de Next/Netlify.

Las pruebas integradas usan fuentes WOFF2 reales locales (Space Mono 400/700),
productor, primer comando de texto, enlace nativo, ambos compiladores, adquisición
y ZIP reales. DB/Storage/admisión se simulan en esas pruebas; decodificación y SQL
tienen suites independientes. No se llamaron IA/Google/Supabase ni se desplegó.

### Seguimiento previo al QA y SQL

**7 de las 8 unidades principales de la tabla están implementadas (87.5%).**
Es cobertura por unidades, no estimación de horas ni porcentaje de QA. La unidad
abierta es activación inicial/registro del deck completo; hoy sigue siendo un
recorrido explícito por clip. No marcar el objetivo completo hasta cerrar y
verificar esa integración. La mezcla con HTML externo y la reconstrucción de
borradores existentes mantienen sus rechazos seguros; no migran materiales.

Después de las migraciones anteriores de editor/snapshots, ejecutar únicamente
los archivos pendientes, completos, en este orden:

1. `20261010200000_initial_html_editing_anchor.sql`.
2. `20261010210000_google_font_candidate_bundles.sql` (CASE corregido).
3. `20261010220000_google_font_native_admission.sql`.
4. `20261010230000_google_font_native_face_read.sql`.
5. `20261011000000_google_font_html_resource_bindings.sql`.

No se aplicaron aquí. No reaplicar migraciones ya registradas. El nuevo quinto
archivo depende además de `20261006000000_html_snapshot_resource_validation.sql`
y sus prerrequisitos; no instala una base vacía. Rollout y QA DB/Storage/browser/
render/concurrencia reales siguen pendientes. No hay flags nuevos ni contenido
de plantillas en `.env`.

### Sexto corte: preparación atómica del deck — backend implementado

La unidad 8 continúa **parcial**. Se implementó su backend, no su activación
desde el editor. La métrica de unidades completas sigue siendo **7/8 (87.5%)**;
no se asignan fracciones arbitrarias al trabajo interno de la octava unidad.

- Nuevo contrato `composition-generated-deck-initialization.contract.ts`: el
  navegador puede enviar únicamente `operationId`, `requestSha256` y el hash
  nativo esperado. No acepta templates, HTML, grants ni declaraciones de fuentes.
- `GeneratedDeckInitializationHost` reconstruye una sola vez el material del
  tenant, exige el HTML exacto por instancia y las referencias tipográficas
  actuales, prepara revisiones iniciales v1 y verifica el conjunto completo de
  referencias. No usa el catálogo externo/legacy como fallback del lote.
- Migración `20261011010000_generated_deck_initialization.sql`: contexto
  autorizado, commit transaccional y consulta del recibo. Reutiliza registro v2,
  autoridad de fuentes/recursos, CAS/versión/auditoría nativa y lectura exacta
  existentes. Todas las diapositivas pendientes se registran juntas, se enlazan
  sus referencias iniciales sin cambios ficticios de campos y se guarda **una**
  versión nativa. Un error, incluido guardar el recibo, revierte todo el lote.
- Preserva referencias y revisiones de vecinos ya editados. No modifica fuentes,
  tiempos, layout, tracks ni el snapshot activo. Rechaza mezclas no reconocidas
  por el productor en los clips pendientes; no convierte HTML externo.
- Hasta 200 referencias totales, siguiendo el límite existente del editor; esto
  incluye instancias repetidas de las hasta 24 slides del productor. Límite del
  lote 8 MiB, contexto/documento 16 MiB y recibo 128 KiB. Si se exceden, se bloquea
  completo: no se divide ni guarda parcialmente por detrás del usuario.
- API preparada `GET/POST .../drafts/[draftId]/generated-deck-initialization`:
  actor/tenant/rol actuales, same-origin, JSON acotado, cuotas fail-closed y errores
  sin datos privados. Reutiliza cuotas existentes (POST 3 usuario/10 organización
  por minuto; GET 30/60). Requiere los flags existentes de initialization y
  initialization receipts; no agrega variables al `.env`.
- El recibo y su replay son **históricos**, no estado actual ni readiness de
  render. GET no escribe y `NOT_FOUND` no autoriza reenvío. El servicio no repite
  una escritura incierta; el frontend pendiente deberá conservar el journal
  antes del POST y verificar lectura nativa/compilación actuales antes de adoptarlo.

Validación de este corte: **35/35** pruebas de preparación/HTTP/regresiones de
generación y fuentes (12 nuevas), TypeScript HyperFrames y lint focalizado. La
suite SQL **9/9** ejecuta las migraciones completas en PostgreSQL aislado y comprueba
registro real del productor, un solo append, rollback, permisos y conservación
de vecino editado. No es QA de Supabase/Storage ni concurrencia real; no se
desplegó ni ejecutó SQL sobre el entorno del usuario.

Pendiente obligatorio de la unidad 8: journal durable/coordinador del navegador,
reserva/lock/bloqueo del host nativo, lectura actual verificable después del
recibo, preparación del ancla inicial y control Engine «Preparar todas las
diapositivas». No marcar el objetivo completo por tener el backend listo.

**SQL adicional, preparado para el release coordinado:**
`20261011010000_generated_deck_initialization.sql`, después del quinto SQL del
listado anterior y de las migraciones existentes de bootstrap, lector exacto y
append nativo. No reaplicar SQL ya exitosos ni activar esta integración como
terminada antes de entregar su cliente recuperable.
