# Google Fonts: preparación y persistencia de candidatos, sin activación nativa

Fecha: 2026-10-10. Prácticas: `docs/prompt_maestro.md`. Alcance: fuentes de
diapositivas nuevas. No modifica CAP-022/025, borradores existentes, grants,
recibos nativos, snapshots, gates de render ni variables de entorno. Los nuevos
recibos de candidatos no conceden autoridad nativa.

## Problema y decisión

El registro Google actual contiene una URL de CSS y `status=READY` histórico.
Ese estado **no acredita archivos nativos**. Una familia puede tener varios
pesos, estilos y subconjuntos Unicode. No es correcto tomar su primer archivo,
etiquetarlo como uploaded y sustituir el resto de la familia.

Referencia primaria: [API CSS2 de Google Fonts](https://developers.google.com/fonts/docs/css2),
que distingue rangos de ejes y solicitudes optimizadas para texto. Esta
preparación conserva los descriptores recibidos; no convierte esos descriptores
en evidencia del contenido real de las tablas tipográficas.

## Implementación y contrato HTTP

`POST /api/admin/fonts/{fontId}/google-preparation`. JSON `{}` consulta; JSON
`{"persist":true,"expectedCandidateSha256":"<hash revisado>"}` solicita guardado
explícito. No hay GET. Seleccionar una fuente NO ejecuta estas operaciones.
Se requiere autenticación, organización activa autorizada, ADMIN/SUPERADMIN,
Origin igual al origen de la aplicación y Content-Type application/json.
El UUID refiere a una fuente registrada de esa organización, no a una URL libre.
No se hacen descargas al listar fuentes ni durante una visita al inspector.

La ruta adapta autenticación/HTTP/DB y el handler testeable coordina los gates
de acceso, origen, contrato y capacidad. El caso de uso
`inspectRegisteredGoogleFont` vuelve a validar UUID, tenant, familia, procedencia
y estado del resultado del repositorio antes de descargar. El parser y el
adquiridor no dependen del framework ni de Supabase y admiten fetch inyectado.

Respuesta 200 de consulta: `preparation` con familia/procedencia, hash del
conjunto canónico `candidateSha256`, hash del stylesheet,
totalBytes, uniqueFiles y faces. Cada face conserva estilo, rango de peso,
unicodeRange, hash/tamaño/MIME y embeddingCheck. La respuesta NO incluye archivos,
bytes ni URLs. Declara siempre:

```json
{
  "scope": "STRUCTURAL_CANDIDATE_BYTES_NOT_NATIVE_AUTHORITY",
  "renderEligible": false,
  "status": "NATIVE_BUNDLE_INTEGRATION_REQUIRED"
}
```

401/403: acceso no autorizado; 400/413/415: solicitud inválida;
404: UUID no encontrado en el tenant; 409: registro no preparable;
429: capacidad ocupada (Retry-After); 503: dependencia/adquisición no disponible.
Respuestas privadas no-store con correlación. Errores no incluyen CSS, URLs,
credenciales ni detalles internos del proveedor. No hay reintentos automáticos.

## Límites y seguridad

- HTTPS, hosts exactos fonts.googleapis.com y fonts.gstatic.com; sin credenciales,
  puertos alternativos, fragmentos, redirecciones ni endpoints arbitrarios.
- CSS `/css` o `/css2` de una sola familia exacta. No `text=`, callback ni parámetros
  desconocidos/duplicados. El selector legacy no se usa como permiso de descarga.
- El CSS se interpreta como datos: solo bloques font-face y descriptores
  conocidos; no imports, reglas de página, scripts, local(), fuentes alternativas
  ni escapes. Formas no soportadas se rechazan, no se degradan silenciosamente.
- Hasta 64 KiB de CSS, 32 faces, 10 MiB por archivo y 20 MiB de binarios únicos.
  Descarga secuencial, deduplicada por URL, con límites sobre bytes leídos del
  stream y timeout total de 20 segundos. Un fallo descarta el candidato completo.
- Dos preparaciones concurrentes y dos en cola por instancia, espera máxima
  dos segundos. Es backpressure local; **no es rate limiting distribuido** ni
  arquitectura para ejecutar miles de descargas síncronas. Una materialización
  automática a escala requerirá trabajos persistentes/deduplicados antes de activarse.
- Solicitud JSON limitada a 1 KiB sobre bytes leídos, aunque Content-Length falte
  o mienta. La lectura comparte el deadline de 20 segundos con la operación;
  cancela y libera el stream ante exceso o aborto. UTF-8 inválido se rechaza.
- SHA-256, MIME y cabeceras/tablas acotadas mediante la validación binaria existente.
  `UNVERIFIED_COMPRESSED` sigue explícito para WOFF/WOFF2: no se ha decodificado
  su contenido ni comprobado su licencia, familia interna o cobertura de glifos.
  `ALLOWED` del validador SFNT tampoco acredita licencia completa ni render real.

## Estado real y trabajo obligatorio siguiente

Implementado: adquisición/preparación efímera por administrador, descriptores
multi-face, límites, aislamiento por organización y pruebas con proveedor falso.
La persistencia está implementada, pendiente de aplicar su SQL: archivos privados
en `organization-fonts/{org}/google-candidates/{candidateHash}/{fileHash}.{ext}`;
metadatos/recibo inmutable en `organization_google_font_bundles`. Guarda todas las
variantes y deduplica archivos por contenido, conservando procedencia Google.
Respuesta 200 de guardado: `bundle` con bundleId, candidateSha256, created,
`status=PREPARED` y `renderEligible=false`. No cambia el READY histórico del
registro ni concede autoridad nativa.

En Admin → Slides → Plantillas → Tipografía, seleccionar una Google guardada
expone `Archivos locales de…`: consultar primero y guardar el hash revisado después.
Un guardado incierto permite `Verificar guardado` con la misma identidad, sin
reintento automático. Cambiar de fuente desmonta/cancela el control; la consulta
se mantiene explícita. Se conserva ahora el UUID Google seleccionado en los
modificadores de la plantilla y en las nuevas especificaciones/artefactos que los
consumen; esto es identidad de registro, **no un bundle autorizado para render**.

El guardado tiene contrato separado del preview: lectura actual del registro,
comprobación del hash revisado antes de cualquier escritura, subida sin upsert,
readback autenticado acotado con tamaño/MIME/hash/firma, relectura de registro y
RPC que reautoriza ADMIN/SUPERADMIN activo y tenant activo, bloquea registro y
metadata de objetos y confirma un recibo único por tenant/font/hash. Un replay
verifica los archivos existentes sin descargar Google de nuevo. Una respuesta
incierta del upload se resuelve solo por readback; una respuesta incierta del
commit, por el mismo conjunto/recibo idempotente.

Storage no participa en la transacción SQL. Un fallo puede dejar archivos privados
sin referencia; no se borran como rollback porque otra operación concurrente
puede reutilizarlos. El SQL no comprueba bytes de Storage: comprueba metadata y
locks, mientras el servidor comprueba bytes. Esto no es una garantía permanente
de disponibilidad del archivo ni un permiso reutilizable para render.

La migración usa FK restrictivas a organización/fuente/actor para preservar
trazabilidad: eliminar esos registros con bundles presentes requerirá revisar
su retención/purga expresamente. No se implementa ni ejecuta dicha eliminación.
Rollback de aplicación: volver al consumidor anterior y conservar candidatos;
no requiere DROP, modificación de fuentes existentes ni borrado de objetos.

Pendiente para usar Google Fonts en diapositivas editables nuevas:

1. Aplicar el SQL de candidatos y verificar DB/Storage reales. Antes de admisión
   nativa, comprobar tablas/familia y condiciones de embedding sin confundir
   validación estructural con decode. PREPARED no acredita esto.
2. Vincularlo desde la generación y admitirlo en preview, archivo, snapshots y
   guard SQL, manteniendo identidad de face/peso/estilo/subconjunto de extremo a extremo.
3. Comprobar en DB y navegador el flujo generación→edición→preview/render.

SQL nuevo **preparado, no aplicado**:
`20261010210000_google_font_candidate_bundles.sql`. Requiere el registro/fonts
bucket de `20260827150000_create_organization_slide_fonts.sql` y
`20260919120000_harden_organization_fonts_for_video.sql`, además de profiles,
organizations y organization_user_roles existentes. Aplicar después de las
migraciones previas del repositorio; si el ancla inicial
`20261010200000_initial_html_editing_anchor.sql` también está pendiente, el orden
es ancla inicial → candidatos Google. No repetir migraciones ya aplicadas.
La nueva migración es transaccional, no un script para reaplicar sobre una tabla
ya instalada. No modifica guards nativos ni stores CAP-025.

## Validación reproducible

Desde `apps/web`:

```powershell
node ../../node_modules/typescript/bin/tsc -p tsconfig.hyperframes-test.json
node --test .tmp/hyperframes-tests/domains/production/fonts/__tests__/google-font-preparation.test.js .tmp/hyperframes-tests/domains/production/fonts/__tests__/google-font-preparation-handler.test.js .tmp/hyperframes-tests/domains/production/fonts/__tests__/organization-font-upload-policy.test.js .tmp/hyperframes-tests/domains/production/composition-editor/__tests__/composition-generated-deck-fonts.test.js .tmp/hyperframes-tests/domains/production/composition-editor/__tests__/composition-preview-csp.test.js
node ../../node_modules/typescript/bin/tsc --noEmit --incremental --tsBuildInfoFile .tmp/editorial-generation-web.tsbuildinfo
```

Casos: hosts/rutas/query maliciosos, familias diferentes, faces/subsets/pesos,
CSS no permitido, bytes/hash, límites individuales/acumulados, redirect/MIME,
cancelación de streams, firmas/licencia interna restrictiva, tenant/ID diferente,
fuente revocada/ausente y respuesta sin bytes ni autoridad.
El handler se ejecuta con autenticador/repositorio/proveedor inyectados: prueba
401/403/400/413/415/404/409/429/503, ADMIN/SUPERADMIN, cancelación, liberación de
capacidad y ausencia de consultas/descargas antes de superar los gates.

Resultado del corte anterior: 95/95 pruebas en el comando indicado, incluyendo
regresiones del vínculo de fuentes de decks y CSP. Compilación Hyperframes y
tipado web noEmit sin errores; lint de todos los módulos/endpoint/tests de este
corte sin errores ni advertencias. No se hizo descarga real del proveedor,
migración ni despliegue.

Estas pruebas NO acreditan autorización HTTP con una sesión real, respuesta
actual del proveedor, escritura en DB/Storage, glyph coverage ni paridad visual.

La suite actual de `fonts/__tests__` añade persistencia/replay, Storage readback,
cliente y contratos SQL estáticos. `scripts/test-google-font-preparation-control.cjs`
renderiza TSX real con React SSR y verifica controles, lock del host, aviso de
no activación y tokens Engine. No monta efectos/clics en navegador. Los tests
SQL son de contrato textual: no acreditan sintaxis/locks/RLS en PostgreSQL real.

### Corrección de sintaxis reportada al aplicar SQL

El `CASE` de `embeddingCheck` dentro del `IF` requería paréntesis: sin ellos el
parser PL/pgSQL terminaba la condición en el `THEN` interno y producía `42601`.
Se corrigió el archivo original `20261010210000_google_font_candidate_bundles.sql`,
sin cambiar su política de admisión, permisos ni estado PREPARED.

`node --test scripts/test-google-font-candidate-migration.mjs` desde la raíz
reutiliza el runtime PGlite aislado ya disponible en
`apps/web/.tmp/syllabus-sql-runtime`; no añade una dependencia de producción.
Sus **5/5 pruebas de ejecución PostgreSQL** compilan la migración completa,
reproducen el defecto original y comprueban rollback transaccional, grants/RLS
configurados, recibos/replay para los cuatro MIME, rechazo por embedding,
metadata Storage ausente, permisos/registro revocados e inmutabilidad.
Las **3/3 pruebas textuales** existentes también pasaron tras la corrección.
Estas pruebas usan tablas de dependencias mínimas y metadata ficticia: no
acreditan la integración real de Supabase, bytes en Storage ni locks concurrentes.

Para reintentar manualmente: si se ejecutó el archivo completo con BEGIN/COMMIT,
el error abortó esa transacción. Ejecutar el archivo completo corregido; si la
misma sesión sigue en transacción fallida, ejecutar primero `ROLLBACK;`. No
reaplicar el ancla inicial si ya fue exitosa. Si se ejecutaron solo fragmentos
del archivo, revisar primero qué objetos quedaron creados; no eliminarlos ni
reaplicar DDL ciegamente. No se ejecutó SQL sobre Supabase desde esta conversación.

Resultado de esta iteración: **266/266 pruebas aprobadas**: 151 de fuentes y
regresiones de vínculo/CSP, 112 de generación/preparación/lectura/renderizador
de decks y preprocesador animado, y 3 del control TSX mediante SSR. También
pasaron compilaciones Hyperframes/Remotion, tipado web noEmit y lint de fuentes
y endpoint sin errores ni advertencias. No se ejecutó SQL, DB/Storage reales,
descarga de Google, generación pagada, QA de navegador ni despliegue.

Para repetir las 151 pruebas de fuentes desde `apps/web`, después de compilar:

```powershell
$taskFontTests = @(rg --files .tmp/hyperframes-tests/domains/production/fonts/__tests__ -g '*.test.js')
$taskFontTests += @('.tmp/hyperframes-tests/domains/production/composition-editor/__tests__/composition-generated-deck-fonts.test.js', '.tmp/hyperframes-tests/domains/production/composition-editor/__tests__/composition-preview-csp.test.js')
node --test @taskFontTests
```

Desde la raíz: `node scripts/test-google-font-preparation-control.cjs`.
Las pruebas de lectura incluyen un stream sin Content-Length, otro con longitud
falsa, JSON fragmentado, UTF-8 inválido y cancelación de una lectura detenida
incluso cuando la cancelación del productor no termina. Los fixtures tipográficos
son estructurales: no acreditan descompresión ni cobertura de glifos.

## Continuidad: decodificación, admisión y lectura de variantes fijadas

Esta parte sigue siendo **implementación parcial**, no cierre del objetivo de
generación → edición. No se habilita el consumo nativo simplemente guardando el
candidato. No se modifican CAP-025, el worker de render ni borradores existentes.

- Se incorpora `fontkit` 2.0.4 como decoder fijado y externalizado del lado
  servidor; `@types/fontkit` 2.0.9 es solo desarrollo. No hay flags nuevos.
- `google-font-decoding.server.ts` ejecuta un programa fijo en un worker Node
  terminable: 5 s por archivo, heap 96 MiB, datos declarados descomprimidos 32 MiB,
  256 tablas, 65.535 glifos y 2 millones de comandos de contorno. La admisión usa
  la cuota compartida de preparación (2 activas + 2 en cola), con deadline de
  petición de 20 s. Estos son límites por instancia, no capacidad horizontal ni
  aislamiento de proceso del sistema operativo.
- Fuerza lectura de tablas, contornos y cmap; valida familia, estilo, peso/eje,
  cobertura no vacía y flags de embedding editables. Rechaza una WOFF2 que solo
  tiene cabecera. La cobertura son intervalos Unicode escalares ordenados; no
  representa uso real de glifos, aprobación de render ni todas las condiciones
  legales de una licencia externa.
- Los rangos CSS admiten los comodines finales acotados especificados por
  [CSS Fonts](https://www.w3.org/TR/css3-fonts/#descdef-unicode-range), sin permitir
  caracteres CSS arbitrarios ni rangos superiores a U+10FFFF.
- `admitPreparedGoogleFont` solo lee bytes privados del candidato exacto,
  comprueba hash/tamaño y los decodifica; no consulta Google ni escribe archivos.
  Después revalida registro y envía prueba al RPC que reautoriza actor/tenant y
  bloquea metadatos vigentes antes de registrar todas las variantes atómicamente.
- La migración de admisión conserva el bundle PREPARED y la procedencia Google.
  Crea una admisión independiente READY, revocable e inmutable, y UUIDs por
  variante. No convierte Google a uploaded. Recibo de alcance
  `DECODED_FONT_FILES_NOT_RENDER_ATTESTATION`.
- El POST administrativo existente acepta tres acciones excluyentes: `{}` para
  consultar, `persist:true` para conservar, `admit:true` para validar. Las dos
  últimas exigen hash revisado, actor servidor y permisos administrativos. No se
  acepta actor, URL, metadata ni prueba de decoder desde el navegador.
- El control Engine ofrece «Validar variantes» tras guardar. Una respuesta
  incierta conserva el mismo conjunto y ofrece comprobación explícita; no hay
  reenvíos automáticos. No descarga ni valida en mount/cambio de selección.
- `readReadyGoogleFontFaces` usa un RPC de servicio para leer UUIDs explícitos o
  un pin `{fontId,bundleId,candidateSha256}`. Valida en una transacción tenant,
  fuente/admisión/bundle vigentes y objetos privados. Rechaza conjuntos parciales
  o revocados y no selecciona una versión mutable «latest». El lector TypeScript
  también limita/valida la respuesta completa y comprueba la identidad pedida.

### Pendientes al cierre del corte anterior (resueltos en la integración siguiente)

1. Fijar la admisión Google elegida en la nueva generación y en su spec/artefacto,
   antes de importar, sin cambiar la tipografía ni elegir otra versión al leer.
2. Transportar las variantes con peso/estilo/rango/procedencia en referencias,
   manifiestos, `@font-face`, preview nativo/editorial, snapshots y reconstrucción.
   El contrato actual de consumidores todavía bloquea Google; no se relajó el
   rechazo de familias ambiguas para eludirlo.
3. Extender los guards transaccionales de recursos HTML/narrativos para esas
   identidades inmutables sin alterar stores/políticas CAP-025.
4. Probar el flujo integrado de nueva generación y primer cambio con los módulos
   reales. DB/Storage/proveedor/browser/render reales quedan para QA posterior,
   como pidió el usuario; las integraciones anteriores no son meramente QA.

### SQL preparados y orden incremental

Después de las migraciones previas del editor, ejecutar solo los pendientes:

1. `20261010200000_initial_html_editing_anchor.sql`.
2. `20261010210000_google_font_candidate_bundles.sql` (corregido).
3. `20261010220000_google_font_native_admission.sql`.
4. `20261010230000_google_font_native_face_read.sql`.
5. `20261011000000_google_font_html_resource_bindings.sql` (integración siguiente).

No se aplicaron sobre Supabase. Los archivos de admisión y lectura no sustituyen
el quinto archivo de guards HTML. No reaplicar archivos ya registrados ni borrar
objetos para reintentar.

### Evidencia reproducible de esta continuidad

`scripts/test-google-font-admission-migration.mjs` ejecuta las tres migraciones
Google consecutivas en PostgreSQL aislado: 12/12 pruebas pasaron. Dependencias
relacionales/metadata Storage mínimas y prueba de decoder sintética exclusivamente
para SQL; los binarios reales se verifican en las pruebas del decoder. No acredita
concurrencia entre conexiones ni autorización de una sesión Supabase real.

Las pruebas de decoder usan la TTF Geist instalada con Next y la WOFF2 Space Mono
del corpus controlado local. Esta última requiere las dependencias ya fijadas en
`apps/web/tools/controlled-hyperframes`; no se descarga nada durante la prueba.
23/23 pruebas de decoder/admisión de dominio pasaron antes de conectar HTTP.
Se añadieron además pruebas de lectura por pin, respuestas malformadas, separación
de acciones HTTP y validación de recibos cliente. Las pruebas TSX SSR no acreditan
clics ni QA visual.

Comandos desde raíz: `node --test scripts/test-google-font-admission-migration.mjs`
y `node scripts/test-google-font-preparation-control.cjs`. Desde `apps/web`,
compilar `tsconfig.hyperframes-test.json` y ejecutar las suites fonts existentes.

Resultado verificado del corte: **181/181** pruebas de fuentes y regresiones
generadas/CSP, **12/12** SQL locales y **3/3** SSR del control. Compilación
Hyperframes, tipado completo web noEmit y lint dirigido de fuentes/endpoint:
exit 0, sin nuevos errores ni advertencias. `git diff --check`: exit 0.
La prueba de Unicode detectó que la política y el parser diferían sobre los
comodines; se alinearon con el contrato CSS acotado y se repitió el grupo completo.

## Integración siguiente: consumidores y generación conectados

El pin elegido se guarda en la plantilla/spec/preparación y se verifica antes
de generación y nuevamente antes de publicar el artefacto. Sus variantes ahora
viajan con UUID, peso, estilo, rango Unicode y procedencia en referencias,
manifiestos, compiladores, previews, snapshots/ZIP y reconstrucción. La familia
puede contener variantes no conflictivas de la misma admisión; no se permite
mezclar conjuntos ni quitar metadata para simular una fuente uploaded.

El preview publicado coteja la admisión/descriptores además de los bytes. Los
archivos capturan profundamente la metadata antes de sus awaits. El SQL
`20261011000000_google_font_html_resource_bindings.sql` añade autoridad Google
transaccional al guard HTML conservando su OID y el validador uploaded/media.
DECK sigue fuera del contrato de extracción narrativa: no se amplió ese canal ni
los stores/políticas CAP-025.

Verificación nueva: **292/292** fuentes/integración/editor seleccionados,
**112/112** productor/reader/regresiones separados, **14/14** SQL de admisión/
lectura/HTML y **3/3** SSR del control Google. Las nuevas pruebas congelan y
extraen ZIP reales de un deck generado y de su primer cambio usando WOFF2 locales
400/700; comprueban ambos HTML y manifiestos. DB/Storage/provider siguen simulados
en el grupo de integración; QA real se mantiene pendiente. El decoder tiene
dependencias trazables (122 archivos, incluye fontkit; cero warnings), no un
deploy acreditado. Tipado y lint dirigidos sin errores.

El cierre global, límites y seguimiento por unidad están en
`SOFLIA_ENGINE_GENERATED_SLIDES_EDITING_INTEGRATION.md`: continúa pendiente la
activación/registro integrado del deck completo. No declarar el objetivo listo
solo por tener fuentes funcionando. No hay nuevas variables de entorno.
