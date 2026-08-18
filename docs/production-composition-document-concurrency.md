# Control de concurrencia del documento de composición

## Diagnóstico

El endpoint afectado es `PUT /api/production/hyperframes/drafts/:draftId/document`.
Su respuesta `428` se produce antes de consultar Supabase, exclusivamente cuando el request no contiene un `If-Match` válido. Por tanto, no corresponde a RLS, una migración, una sesión ni a un conflicto de edición.

El código fuente revisado ya construía el header en el editor. Sin embargo, el mensaje anterior agrupaba dos casos distintos: header ausente y token malformado. Además, el cliente confiaba solo en `data.documentHash`, sin verificar que coincidiera con el ETag HTTP. En producción eso impedía diferenciar una mezcla de artefactos cliente/servidor, un token runtime corrupto, o una transformación por un intermediario.

`netlify.toml` no contiene redirects, proxies ni middleware que alcancen `/api`. Sus reglas de headers son de respuesta. La causa inmediata confirmada es que producción recibió un `If-Match` ausente o inválido; la causa de infraestructura exacta debe confirmarse en el primer despliegue corregido con el evento `composition_document_precondition_rejected` y los Request Headers de DevTools. Una mezcla de bundle cliente antiguo y función nueva es la hipótesis principal si el evento informa `MISSING_IF_MATCH`.

## Contrato canónico

La fuente oficial de versión es `video_composition_draft_documents.document_hash`: el SHA-256 del documento canónico persistido. `version` es un contador de auditoría y no es el precondicionador.

| Operación | Requisito | Respuesta exitosa |
| --- | --- | --- |
| GET documento | Ninguno | `data.documentHash`, `data.version`, `ETag: "<sha256>"`, `Cache-Control: private, no-store` |
| PUT documento | `If-Match: "<sha256>"` fuerte y exacto | Nueva versión y el ETag actualizado |
| Aplicar/deshacer propuesta | Mismo `If-Match` | Nueva versión y el ETag actualizado |

No se aceptan ETags débiles (`W/`), listas de ETags, `*`, valores sin comillas o hashes que no sean SHA-256. El frontend no permite guardar si el hash del cuerpo y el ETag de lectura/respuesta no coinciden.

## Semántica de errores

| Situación | Estado | Código |
| --- | --- | --- |
| No llegó `If-Match` | 428 | `COMPOSITION_IF_MATCH_REQUIRED` |
| Llegó con formato inválido | 428 | `COMPOSITION_IF_MATCH_INVALID` |
| La versión ya no es la actual | 409 | `COMPOSITION_VERSION_CONFLICT` |
| Fallo inesperado | 500 | `COMPOSITION_PERSISTENCE_FAILED` |

El contrato existente usa 409 para conflictos y devuelve la versión actual; el editor reemplaza su preview por esa versión y conserva el patch fallido para que el usuario decida reintentarlo. Nunca se reintenta automáticamente un cambio sobre una versión ajena.

## Cambio aplicado

- Se creó un módulo único para formatear, analizar y validar el ETag fuerte.
- El editor toma el ETag de GET/PUT/aplicar/deshacer como token canónico, verificándolo contra el cuerpo antes de actualizar su estado.
- Las rutas devuelven un ETag formateado mediante el mismo módulo.
- Los 428 ahora incluyen un código accionable y generan un log estructurado con `documentId`, causa y solo el prefijo no sensible de la versión recibida.
- Se añadieron pruebas unitarias del contrato de ETag.

## Verificación y despliegue seguro

1. Ejecutar `npm run test:hyperframes -w apps/web` y el build de producción.
2. Desplegar primero como deploy preview. Abrir el editor y verificar que GET retorna un ETag citado de 64 hexadecimales.
3. En DevTools, editar una propiedad: el PUT debe llevar exactamente el mismo `If-Match` que el ETag de GET y devolver un ETag nuevo.
4. Simular ausencia de header: debe devolver 428 con `COMPOSITION_IF_MATCH_REQUIRED`.
5. Simular un hash distinto en una segunda sesión: debe devolver 409, actualizar el preview y no sobrescribir el cambio remoto.
6. Promover a producción y vigilar `composition_document_precondition_rejected`. Cualquier evento indica un cliente desactualizado, un token corrupto o una transformación de request que debe investigarse con su `documentId` y `rejectionReason`.

No requiere migración ni mutación de documentos existentes. El rollback consiste en restaurar el deploy previo; los documentos ya agregados son inmutables y compatibles.
