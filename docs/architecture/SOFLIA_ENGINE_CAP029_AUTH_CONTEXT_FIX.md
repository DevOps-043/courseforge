# CAP-029 — identidad del cliente e inspector HTML

Fecha: 2026-10-10. Corrección local; pendiente de deploy y validación en staging.

## Causa comprobada

La inspección de staging confirmó que el componente editorial estaba desplegado,
el flag público de inspector estaba activo y el identificador de organización era
válido. La validación fallaba únicamente en `actorId`, que llegaba vacío. El panel
devolvía `null` y dejaba visibles solo las propiedades generales del clip.

El backend reconoce sesiones Auth Bridge mediante `cf_access_token`, pero el store
del navegador solo consultaba GoTrue (`supabase.auth.getUser()`). Una sesión válida
en servidor podía, por tanto, no producir identidad en el cliente.

## Corrección y límites

- `GET /api/auth/session` reutiliza la verificación Auth Bridge existente; consulta
  GoTrue solo si no hay identidad Bridge. Proyecta campos de usuario explícitos,
  nunca JWT, cookies, permisos ni objetos de sesión del proveedor.
- Las respuestas 200/401/500 usan `Cache-Control: private, no-store`, `Vary: Cookie`
  y el contrato de respuesta/correlación existente. No se agrega CORS permisivo.
- El cliente valida UUID y contrato, utiliza credenciales same-origin, evita caché
  y acota la espera a diez segundos. Los fallos dejan la identidad vacía, con error
  genérico y posibilidad de reintentar; no utilizan cookies decodificadas como autoridad.
- El store comparte la consulta concurrente y descarta resultados anteriores al
  logout. El cierre de sesión reutiliza la acción existente que limpia Auth Bridge
  y Supabase, en lugar de cerrar solo GoTrue.
- El inspector conserva la validación de usuario/organización/borrador/clip y los
  flags. Ante contexto inválido muestra estado de carga, error y reintento cuando
  falta el usuario; no permite consultar ni escribir con identidad incompleta.
- Las APIs editoriales siguen verificando autorización y tenant en servidor. Esta
  identidad es contexto de UI, no un permiso nuevo ni una habilitación de mutaciones.

No cambia políticas/stores CAP-025, worker CAP-027, fuentes HTML, catálogo,
migraciones, configuración Netlify, variables de entorno ni contenido del curso.
No agrega dependencias. No sustituye la inicialización/adopción explícita del HTML.

## Validación reproducible

Desde la raíz: `npm run test:auth-bridge -w apps/web`.
Incluye las quince pruebas anteriores y catorce nuevas: identidad Bridge sin
GoTrue, compatibilidad legacy, sesión ausente, error operacional, proyección sin
secretos, UUID inválido, contrato HTTP/cache, petición cliente acotada,
deduplicación, logout concurrente, expiración y reintento. El caso de aviso del
inspector es una comprobación de código fuente, no una prueba visual end-to-end.

Resultado local: 29/29 pruebas correctas; lint de los nueve archivos TypeScript
afectados sin errores ni warnings; comprobación TypeScript de la ruta, el store y
el inspector con sus dependencias sin diagnósticos; `git diff --check` correcto.
La comprobación global TypeScript se interrumpió por duración y se sustituyó por
la de los tres entrypoints. No se certifica build completo ni QA visual en staging.

Tras desplegar en **staging**, recargar la aplicación y seleccionar un DECK_SLIDE
en Propiedades. Debe aparecer «Contenido HTML editable». En Network, la consulta
de sesión debe devolver 200 con una identidad mínima; 401 significa ausencia o
expiración y 500 un fallo de comprobación. No compartir cookies ni tokens.
Después consultar los campos HTML: cualquier bloqueo de catálogo, plantilla,
adopción o inicialización es una etapa distinta, no resuelta por esta corrección.

## Entrega y rollback

Cambios en `features/auth` (contrato, servicio, HTTP, cliente y estado testeable),
su adaptador `core/stores/authStore.ts`, la nueva ruta de sesión y el aviso del
inspector. Pruebas incorporadas al comando existente de Auth Bridge.
Rollback: revertir exclusivamente este cambio y desplegar de nuevo; no requiere
rollback de datos. **SQL necesario: ninguno. Variables nuevas: ninguna.**

## Ajuste frontend — claridad y estética Engine (2026-10-10)

La captura posterior al deploy ya muestra los paneles HTML, pero sus controles
carecían de una jerarquía visual propia del inspector. La edición habitual quedaba
debajo de acciones técnicas de inicialización y adopción por UUID.

Se incorpora `CompositionHtmlPanel`, exclusivamente presentacional, y un CSS
Module local basado en tokens de Studio/Engine, con fallback, tema oscuro,
controles de al menos 40 px y foco de teclado visible. No cambia estilos globales.
El orden ahora es edición, preparación y adopción avanzada; las dos últimas
secciones son desplegables. El seguimiento global de inicialización no se oculta
en un desplegable, y la adopción con seguimiento pendiente/no disponible se abre.
La consulta sigue siendo explícita: desplegar una sección no consulta ni escribe.

Los textos explican cargar campos, preparar cambios y guardar una revisión. Los
valores/límites técnicos quedan en un detalle opcional; errores, estados vacíos y
falta de permisos siguen visibles. Un fallo de lectura no se diagnostica como
falta de plantilla de forma concluyente. Los flags, autorización, CAS, recursos,
confirmaciones y coordinadores de guardado permanecen intactos.

Validación local:

- `node --test scripts/test-composition-html-panel.cjs`: 6 pruebas, con render
  React real del marco y editor escalar; servicios sustituidos, sin persistencia.
- Auth Bridge: 29 pruebas. Inspector: 11. Catálogo de plantillas: 12. Comandos de
  campos: 9. Total: 67/67 correctas. Las tres suites editoriales se compilan con
  `tsc -p apps/web/tsconfig.hyperframes-test.json` y se ejecutan desde
  `apps/web/.tmp/hyperframes-tests/domains/production/composition-editor/__tests__/`.
- ESLint de los cinco componentes modificados y TypeScript de esos entrypoints
  con `next-env.d.ts` y dependencias: sin diagnósticos.
- Vista aislada local de los componentes reales, con servicios inertes y datos
  ficticios: panel de 300 px, temas claro/oscuro, despliegue de preparación y campo
  de texto. Esta vista no certifica integración, guardado ni QA en staging.

Tras desplegar: comprobar selección de diapositiva, foco de teclado, scroll del
inspector, campos de cada plantilla, preparación explícita, guardado/undo y avisos
de recuperación. Pendientes el QA integral en staging y el build completo; no se
han ejecutado mutaciones ni se ha cambiado contenido del curso para esta revisión.
**SQL necesario para este ajuste: ninguno. Variables nuevas: ninguna.**
