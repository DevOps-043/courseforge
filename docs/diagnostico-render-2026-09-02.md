# Diagnóstico del render detenido — 2 de septiembre de 2026

## Evidencia consultada (solo lectura)

- Solicitud: `0575e316-cf9b-4440-b23a-7207d3fc13da`.
- Creación: 18:02:53 UTC (12:02:53, Ciudad de México).
- Primer registro de finalización del proveedor: 18:28:41 UTC (12:28:41 local), aproximadamente 25 min 48 s después. Es el momento de detección, no necesariamente la hora exacta de finalización en HeyGen.
- Estado del proveedor: `COMPLETED`. Consulta directa posterior a HeyGen: HTTP 200, `completed`, duración 230.479 s, URL de video disponible.
- Estado de importación: `RETRY_SCHEDULED`; error persistido: `{"source":"hyperframes_import","message":"Unauthorized","retryable":true}`.
- Archivo ZIP enviado: 51,741 bytes. El intento del 25 de agosto, con un ZIP de 136,998,947 bytes, terminó con el mismo error de importación.
- Las funciones de reconciliación e importación están desplegadas: responden HTTP 405 a GET, como exige su contrato POST. El historial acredita que el importador sí se ejecuta.

## Conclusión

**Incidente corregido en producción a las 20:30:30 UTC (14:30:30, Ciudad de México).** El trabajo terminó en `SUCCEEDED`, con importación `COMPLETED` y video final vinculado a la lección.

La causa confirmada fue una versión desactualizada de las Edge Functions. El código desplegado del importador y reconciliador todavía importaba `getOrganizationHeygenApiKey` y consultaba `provider = 'heygen'`. Ambas funciones habían sido desplegadas el 21 de agosto, antes de separar las credenciales. El repositorio ya utilizaba `getOrganizationHyperframesApiKey` y `provider = 'hyperframes_cloud'`, pero ese cambio no había llegado a Supabase.

Se consultó el mismo render con las credenciales de la organización, sin imprimir secretos: `heygen` devolvió HTTP 401, `heygen_avatar` devolvió HTTP 404 y `hyperframes_cloud` devolvió HTTP 200 con el video completado. No se rotó ninguna clave ni se modificó la configuración de avatares.

El bloqueo ocurrió durante la importación posterior al render. El ZIP de 51,741 bytes y el MP4 de 3,969,741 bytes descartan el límite de 200 MiB como causa de este incidente. La duración interna del render de HeyGen no puede explicarse con estos registros.

## Fallos de observabilidad y control encontrados

1. La API de recuperación devuelve estados, pero omite `provider_error`, tiempos e historial de progreso.
2. La interfaz descarta errores de actualización con `catch(() => undefined)` y confunde `UPLOADING` de importación con subida del ZIP; `QUEUED` también es ambiguo.
3. El importador reintenta errores de autorización hasta nueve fallos, con esperas crecientes; recargar puede volver a encolar y alterar esos plazos.
4. Faltan cancelación durable y protección frente a callbacks o workers que lleguen después de cancelar.
5. El cliente de envío a HeyGen carece de límites explícitos de tiempo HTTP.

## Implementación prevista

- Cronómetro desde la creación persistida, conservado al recargar y detenido al finalizar/cancelar.
- Consola con etapa real, errores, historial, bytes importados, intentos y próxima ejecución, con datos sensibles excluidos.
- Cancelación transaccional del proceso Courseforge: revocar leases, detener reintentos y evitar publicación tardía. La cancelación local no garantiza detener cómputo ya aceptado por HeyGen; su CLI documenta eliminación lógica, no cancelación del cómputo: https://github.com/heygen-com/hyperframes/blob/main/docs/packages/cli.mdx.
- Detener reintentos ante HTTP 401/403 del proveedor; registrar fase, código y contexto. Reintentar únicamente errores transitorios con tiempos limitados.
- Pruebas de terminalidad, aislamiento por organización, cronómetro, errores y recuperación.

El diagnóstico inicial fue de solo lectura. Posteriormente se desplegó la reparación y se recuperó el intento existente, según el registro de resolución siguiente.

## Implementación entregada

- Panel `RenderDiagnosticsPanel` integrado en Entrega: tiempo total `HH:MM:SS`, recuperación desde la fecha persistida, consola descargable, error actual, intentos, fallos, próxima ejecución y bytes importados. Avisos a partir de 5 minutos sin actividad o 30 minutos totales; no se presupone que un render largo haya fallado.
- API autenticada por organización para consultar diagnósticos y cancelar. La cancelación es transaccional; revoca el lease de importación y deja el trabajo `CANCELLED`. Triggers impiden que escrituras tardías reviertan esa decisión. La operación no borra videos completados anteriores ni asegura detener cómputo externo ya aceptado.
- Historial de hasta 100 transiciones/errores persistido en la solicitud. Se excluyen URLs de descarga y credenciales del diagnóstico que recibe el cliente.
- HTTP con límites de tiempo para el cliente de HeyGen. Edge registra fase y código HTTP; rechazos permanentes de HeyGen/Storage dejan de reintentarse. Descargas/subidas guardan un checkpoint por bloque y conservan el destino de subida antes de transferir bytes.
- Consultar o recargar ya no reinicia la cola de importación ni su espera. La interfaz deja de silenciar los fallos de consulta.

## Activación y seguimiento del incidente

1. **Aplicada** la migración `20260902195000_hyperframes_render_diagnostics_and_cancellation.sql`, dentro de una transacción mediante el editor SQL de la sesión autenticada de Supabase. Se verificaron las columnas y el RPC de diagnóstico mediante consultas posteriores.
2. **Desplegadas** `import-hyperframes-video` y `reconcile-hyperframes-renders` con todo su código local y módulos compartidos actualizados. La CLI no tenía sesión; se usó el editor de funciones de Supabase. Para publicar todos los módulos juntos, esbuild generó un único archivo ESM por función, manteniendo externos los imports `npm:*` y `jsr:*`. Antes de publicar se comparó el contenido completo del editor con el archivo generado. La autenticación mediante `x-courseforge-worker-key` se conservó.
3. **Recuperado** únicamente el intento `0575e316-cf9b-4440-b23a-7207d3fc13da`, sin enviar otra solicitud de render. Una transacción comprobó organización, proveedor completado, error `Unauthorized`, ausencia de cancelación, ausencia de un render posterior y ausencia de un video final para ese trabajo. Conservó el error previo en el historial, restableció el contador de fallos y reencoló la importación.
4. El worker programado inició la transferencia a las **20:30:28.488 UTC** y la completó a las **20:30:30.917 UTC**, unos **2.43 segundos** después. Transfirió exactamente **3,969,741 bytes** y registró el asset `86242f0c-82f7-4ec9-861f-f36b329f5cf0`. Trabajo `c215ff4d-d501-44ac-b9ce-1bb944ca0c5f`: `SUCCEEDED`; importación: `COMPLETED`; error actual: ninguno.
5. Se verificó HTTP 200, `video/mp4`, longitud correcta y coincidencia entre la URL del asset y `material_components.assets.final_video_url`. La duración almacenada es 230 s (el proveedor informó 230.479 s).
6. **Pendiente únicamente el despliegue de la aplicación web** para mostrar el nuevo cronómetro, consola y botón de cancelación. Su código está implementado y probado; la CLI de Netlify no tiene sesión en este entorno. La corrección del importador y la recuperación del video ya están activas, independientemente de ese despliegue.

Para futuros despliegues, publicar también las Edge Functions cuando cambien sus módulos `_shared`; desplegar la web por sí sola no las actualiza. Comando habitual con una sesión de Supabase configurada: `npx supabase functions deploy --project-ref emsjctbdevufloxntjll` (o indicar cada función para limitar el alcance).

## Verificación

- TypeScript de la aplicación y pruebas específicas de diagnóstico, recuperación y cliente HTTP aprobados.
- Comprobación de tipos Deno de ambos workers y dos pruebas de clasificación de errores/backoff aprobadas (14 pruebas JavaScript/TypeScript en total, además de las verificaciones SQL).
- Migración ejecutada en PostgreSQL aislado (PGlite): aislamiento por organización, cancelación repetida, escrituras tardías, rechazo del finalizador con lease revocado, conservación del backoff, historial de errores y permisos de RPC aprobados.
- Panel real montado con API de prueba local: error visible, cancelación y cronómetro detenido conservado al recargar. Esta prueba visual no utiliza la API de producción.
- Pruebas de regresión de selección de credenciales: consulta exclusivamente `hyperframes_cloud`, organización indicada y estado `ACTIVE`; sin fallback a `heygen` ni a `heygen_avatar`.
- Verificación real posterior al despliegue: ambas funciones responden HTTP 200 al worker autorizado; el cron recuperó el video y la descarga desde Storage devuelve HTTP 200 con el tamaño exacto.

Comandos reproducibles:

```powershell
npm run test:render-diagnostics -w apps/web
npm install --prefix .tmp/render-diagnostics-qa --no-save --package-lock=false @electric-sql/pglite
node scripts/test-hyperframes-cancellation.mjs
```
