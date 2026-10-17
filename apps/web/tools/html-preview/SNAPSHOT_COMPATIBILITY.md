# Diagnóstico offline de snapshots HTML

Solo lectura de un archivo local explícito. No extrae ZIPs, consulta DB/Storage,
renderiza, migra, publica, activa flags ni otorga permisos. Requiere Node y el build
local actualizado del inspector. Ejecutar desde `apps/web`:

```powershell
node ../../node_modules/typescript/bin/tsc -p tsconfig.hyperframes-test.json --outDir .tmp/cap029-tests
node tools/html-preview/inspect-snapshot-compatibility.mjs --bundle "D:/ruta-autorizada/html-editing-revisions.json" --sha256 "SHA256_ESPERADO" --organization "UUID_ORGANIZACION" --document "UUID_DRAFT" --document-hash "HASH_DOCUMENTO_ESPERADO"
```

Los valores de SHA/scope/document hash deben obtenerse de metadata autorizada
independiente, no copiarlos de las afirmaciones del bundle. La ruta debe ser
absoluta a un archivo regular, no symlink. Máximo16MiB; fd/size/timestamps rechecked,
bytes brutos SHA verificados antes de decodificar UTF8. No imprimir source, URLs,
tokens ni paths en el resultado. El acceso al archivo sigue siendo responsabilidad
del operador; diagnóstico offline NO acredita acceso vigente a sus recursos.

| Estado JSON | Interpretación y siguiente paso |
| --- | --- |
| CURRENT_PROFILE_REQUIRES_CONTENT_AND_AUTHORITY_CHECKS | Envelope/perfil actual; aún verificar native pointers, contenido/fragment hashes y grants actuales mediante consumidores existentes |
| PROFILE_MISMATCH_REQUIRES_REVIEW | No ejecutar con el compilador actual. Revisar ejecutor histórico fijado o republicación explícita con autorización y paridad |
| LEGACY_V1_REQUIRES_REVIEW | No tiene pins de compilación V2; mismo procedimiento histórico, sin upgrade automático |
| REJECTED | Pin/scope/estructura/archivo inválido o inspector compilado no disponible; detener y obtener evidencia correcta |

Exit0 solo identifica perfil actual, no PASS de render ni autorización. Los demás
estados usan exit1. Antes de cada inventario recompilar; un build viejo diagnostica
contra su propio perfil, no certifica el source/deploy actual. Conservar fecha,
versión del checkout/inspector, pins independientes y resultado por revisión en
el expediente autorizado del operador. No almacenar contenidos privados en Git.
La herramienta inspecciona un bundle, no demuestra exhaustividad del inventario.

Pruebas locales (después de compilar):

```powershell
node --test tools/html-preview/inspect-snapshot-compatibility.test.mjs
```

I03 no se cierra con este diagnóstico: falta inventario real autorizado y resolver
continuidad para cada revisión histórica afectada. No se instaló ningún ejecutor
histórico ni se realizó republicación en este cambio.

## Preparación explícita de republicación histórica

`prepareCompositionHtmlEditingSnapshotRepublication` es una función de dominio,
no una opción automática del CLI ni una ruta de instalación. Recibe los bytes/pin
históricos, documento nativo exacto, scope independiente y autoridades vigentes.
Acepta V1 o V2 con perfil anterior; rechaza perfil actual, contenido sustituido,
pointers discordantes o recursos revocados. Compila un bundle V2 candidato
separado con el perfil actual, sin modificar source, overrides, versiones nativas
ni el bundle original. Si la política actual rechaza el contenido, no se prepara
un candidato: se requiere revisión de contenido o un ejecutor histórico seguro.

Resultado `PREPARED_REPUBLICATION_NOT_COMMITTED`: pins de origen/candidato,
perfiles y comparación por clip (`OUTPUT_PIN_EQUAL`, `OUTPUT_PIN_CHANGED`,
`NO_PRIOR_OUTPUT_PIN`), incluyendo pins previos sin clip correspondiente. Un hash
igual no demuestra igualdad visual: el perfil anterior no se ejecuta aquí y el
entorno/recursos pueden diferir. V1 no tiene salida anterior fijada.

Las revisiones `HISTORICAL_VISUAL_COMPARISON`, `CURRENT_CONTENT_AND_ACCESSIBILITY`
y `AUTHORIZED_REPUBLICATION` son obligatorias; el resultado no las aprueba.
No entregar este candidato al consumidor como reemplazo del original antes de
la publicación explícita autorizada y auditable. El restore normal sigue rechazando
el bundle histórico. Falta conectar revisión, retención, publicación y recovery
en el flujo autorizado; esta preparación por sí sola no cierra I03.
