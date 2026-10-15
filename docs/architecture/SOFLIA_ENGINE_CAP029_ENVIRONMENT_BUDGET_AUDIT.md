# CAP-029 — medición y alcance de variables de entorno

Fecha: 2026-10-10. Diagnóstico y herramientas locales; sin cambios de variables,
permisos, Netlify, runtime, despliegues o archivos `.env`. No contiene valores.

## Evidencia y frontera

El log suministrado registra fallo durante deploy con HTTP400 al crear funciones:
el entorno supera4KB en modo compatible con Lambda. Anuncia26 funciones nuevas y
enumera18 nombres de uploads fallidos; no demuestra26 fallos ni falla de TypeScript.
La lista `build.environment` del primer log (12:51) contiene44 claves, no sus valores ni alcances. No es
un inventario certificado del entorno de cada función. El deploy fallido no actualiza
la aplicación al código/configuración esperados.

La consulta remota de metadatos mediante CLI existente no estuvo disponible. No se
ejecutó login/link ni se modificó configuración para obtener acceso. La suma exacta
del entorno remoto de staging sigue pendiente; no inferirla de los archivos locales.

## Segundo corte: deploy de las 13:24

El nuevo log conserva el mismo error HTTP400 por entorno superior a4KB. La lista
de Builds baja de44 a37 claves: salen exactamente los7 flags privados HTML y no
se agrega ninguna clave. Los6 flags públicos HTML siguen en Builds, como corresponde.
Esto acredita el cambio del inventario de build, no los scopes efectivos Functions.
Por tanto, no demuestra que el usuario configurara mal los alcances ni permite
cuantificar cuánto falta por liberar en runtime.

Siguiente ajuste acotado: las3 claves públicas de Google Picker se leen mediante
accesos literales `process.env.NEXT_PUBLIC_*` en el componente de assets; conservar
Builds y retirar Functions. Los nombres privados `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET` y `GOOGLE_REDIRECT_URI` son distintos y deben seguir disponibles
para OAuth servidor. Las4 URLs públicas de descarga del worker siguen siendo
candidatas a conservar solo en Builds: la búsqueda por nombre/prefijo en
`apps/web/src`, `apps/web/netlify/functions`, `apps/api/src` y `scripts` no encontró
consumidores actuales; verificar cualquier consumidor operativo externo antes de
retirarles Functions. No borrar estas variables ni cambiar sus valores.

Medición local repetida: Picker208bytes y URLs640bytes,848bytes adicionales
potenciales si las7 claves estaban en Functions y sus valores remotos coinciden.
No es ahorro remoto medido ni garantía de deploy. Mantener Supabase URL/anon,
`NEXT_PUBLIC_APP_URL`, secretos y controles HTML de servidor en sus scopes necesarios.
Para cerrar la medición falta el inventario efectivo Functions de staging, con
nombres/scopes y tamaños únicamente, incluyendo variables administradas aplicables.
No se modificaron Netlify, runtime ni archivos `.env` en este segundo corte.

## Medición local reproducible

Herramienta: [auditor](../../scripts/audit-environment-budget.mjs), Node con
`node:util.parseEnv` (ejecutado en Node24.19.0), sin dependencias nuevas.
Suma `UTF8(nombre)+UTF8(valor)`; excluye comentarios, comillas de sintaxis y separadores.
No emula expansión de Next/dotenv, scopes, variables administradas ni payload remoto.
Las entradas que requieren expansión se identifican; en este corte no se detectaron
en los archivos locales medidos. Los resultados son metadata, nunca valores/hashes
de secretos. Los tres archivos se miden por separado, no se suman ni se mezclan.

| Fuente | Bytes del archivo | Claves | Bytes nombres+valores | Claves coincidentes con log | Bytes coincidentes |
| --- | ---: | ---: | ---: | ---: | ---: |
| `.env` |3937|31|3035|27|2823|
| `apps/web/.env.local` |3937|31|3035|27|2823|
| `apps/web/.env.development.local` |53|1|51|0|0|

En cada uno de los dos archivos principales faltan17 claves del primer log:13 flags HTML
y4 adicionales (`BACKGROUND_FUNCTION_SECRET`, `NEXT_PUBLIC_SUPABASE_ROLE_KEY`,
`SOFLIA_API_KEY`, `SOFLIA_API_URL`). Esto no significa que falten en Netlify: el log
las enumera. Los13 flags con valor literal `true` suman754bytes:6 públicos383,
7 servidor371. Proyección parcial con valores locales:2823+754=3577bytes; faltan
los4 valores remotos adicionales y las diferencias/variables administradas.
Los519bytes hasta4096 **no son margen remoto disponible**. El fallo confirma
desbordamiento real, pero el log no permite cuantificar cuánto.

## Matriz de alcances recomendada

Clasificación basada en consumidores actuales, no aplicada a Netlify. Scopes
selectivos requieren que el plan permita configurarlos. No se retiran valores;
mantener contexto staging y compatibilidad de producción.

| Grupo | Alcance necesario / decisión | Evidencia / ahorro condicionado |
| --- | --- | --- |
| Los6 `NEXT_PUBLIC_COMPOSITION_HTML_EDITING_*` suministrados | Builds, sin Functions | Inspector/inicialización/adopción/host clientes;383bytes si estaban en Functions y coinciden valores |
| Los7 `COMPOSITION_HTML_EDITING_*` booleanos suministrados | Functions; Builds solo si un consumidor build real lo requiere | Rutas servidor/editorial/receipts;371bytes necesarios con configuración actual. No desactivar guards |
| `NEXT_PUBLIC_GOOGLE_APP_ID`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_GOOGLE_DEVELOPER_KEY` | Builds; retirar Functions tras validar render SSR/Picker en staging | Lecturas en ProductionStructuredAssetSections;208bytes con valores locales, ahorro remoto por medir |
| Las4 `NEXT_PUBLIC_SOFLIA_WORKER_DOWNLOAD_*_URL` / fallback `...DOWNLOAD_URL` del log | Candidatas a retirar Functions; conservar Builds mientras se confirma distribución del worker | Sin consumidor aplicativo actual encontrado por nombre/prefijo en fuentes/scripts.640bytes locales; ausencia de referencia literal no acredita dependencias externas |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Builds **y Functions** | Clientes browser/server y bootstrap background; no retirar de Functions por tener prefijo público |
| `NEXT_PUBLIC_APP_URL` | Builds y Functions según uso actual | Server env, política de origen y URLs; no retirar sin validar estos consumidores |
| Secretos Supabase/JWT/IA/OAuth/background y APIs privadas | Functions; evaluar necesidades build individualmente | Backend y jobs reales los consumen. No acortar secretos ni ponerlos en variables públicas |
| `NEXT_PUBLIC_SUPABASE_ROLE_KEY` | Revisión urgente, no tratar como variable pública legítima por su nombre | Log presente, ausente local. scripts/update_bucket_mime.js usa este nombre como fallback de service role. Si contiene credencial privilegiada, no debe estar en cliente/Builds; comprobar exposición y rotar si se confirma. No se afirma una filtración solo por el nombre |

Los primeros tres grupos candidatos suman1231bytes (383+208+640) **con valores
locales y flags suministrados**, solo si todos estaban disponibles en Functions.
No es un ahorro remoto demostrado ni una garantía de deploy. El prefijo público
no determina automáticamente el scope. El auditor no borra ni reclasifica claves.

## Prerrequisitos HTML adicionales no acreditados por el log

No aparecen en las claves de ninguno de los dos logs: catálogo JSON, clave de entrega de preview ni origen
de preview. Su ausencia en `build.environment` no prueba ausencia en Functions.
Revisar `COMPOSITION_HTML_EDITING_CATALOG_JSON`,
`COMPOSITION_HTML_EDITING_PREVIEW_DELIVERY_KEY` y
`COMPOSITION_HTML_EDITING_PREVIEW_PARENT_ORIGIN`, runtime empaquetado, migraciones y
plantilla/adopción revisada. Nunca mostrar claves ni asignarles `NEXT_PUBLIC_*`.
El catálogo contiene fuentes/manifests y admite hasta4MiB en el lector, no cabe
por diseño en un presupuesto agregado4KiB si crece. Su reubicación a configuración
privada autorizada requiere contrato/admisión/tenant/pins y pruebas, no un cambio
ciego de nombres o un JSON público. No implementada en esta auditoría.

## Ruta mínima y criterio de aceptación

1. Obtener inventario **efectivo Functions de branch staging**: solo nombres,
   scopes y tamaños UTF8. No compartir tokens ni export con valores en el chat.
   Si se proporciona un export `.env` privado en este workspace, ejecutarlo con
   el auditor; ese archivo aún necesita evidencia de scopes y variables gestionadas.
2. Confirmar disponibilidad de scopes en Netlify, retirar únicamente grupos
   build-only verificados de Functions, medir ahorro real, mantener settings previos
   para rollback. No eliminar URL/anon Supabase ni secretos de runtime.
3. Establecer margen operativo explícito: objetivo recomendado<=3584bytes para
   presupuesto4096, dejando512bytes. Es margen de ingeniería, no requisito AWS
   ni resultado medido. El cálculo definitivo incluye variables gestionadas aplicables.
4. Si no alcanza, implementar consolidación de flags HTML público/privado con
   parser estricto, controles independientes, prioridad de overrides legacy y
   fail-closed; trasladar catálogo fuera del entorno si su tamaño lo exige.
   Nuevos nombres no funcionarán con código actual. No activar por defaults.
5. Rebuild/deploy staging; comprobar registro/upload de funciones, funcionamiento
   de Auth/Supabase/Picker/background/descargas y disponibilidad del inspector.
   Esto no sustituye QA integral ni habilita producción.

No migrar todos los handlers de Lambda, alterar CAP025/027 ni recortar garantías
para resolver este diagnóstico. Modernizar runtime es alternativa separada, con
impacto real en contratos/background jobs; no acción implícita de esta medición.

## Cómo repetir y validación

```powershell
node scripts/audit-environment-budget.mjs .env apps/web/.env.local apps/web/.env.development.local
node scripts/audit-environment-budget.mjs --deploy-log 'RUTA_AL_LOG.txt' .env
node --test scripts/audit-environment-budget.test.mjs
```

Siete pruebas: UTF8/valor vacío, ausentes, ausencia de valores en salida, duplicados/
expansión, extracción del log, overflow y clasificación potencialmente privilegiada.
CLI falla con mensaje genérico sin volcar errores que puedan contener fuente secreta.
Pruebas locales no acreditan cuota/scopes/entorno efectivo remoto ni deploy real.

Fuentes: [Netlify, variables de Functions](https://docs.netlify.com/build/functions/environment-variables/),
[scopes/contextos](https://docs.netlify.com/build/environment-variables/overview/),
[Next.js, variables públicas en build](https://nextjs.org/docs/app/guides/environment-variables).
El límite4KB sigue aplicando al modo compatible con Lambda; un `.env` grande por
comentarios no equivale a superar la cuota. Cambiar variables públicas exige rebuild.
