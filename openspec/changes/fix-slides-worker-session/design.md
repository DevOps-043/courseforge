# Autorización de slides sin sesión de navegador

Confirmación recibida: el log de Netlify del 23 de noviembre a las 17:02:17
muestra AUTH_LOOKUP_UNAVAILABLE desde getAuthBridgeSession, invocado por
getAuthorizedMaterialComponentAdminForTenant en slides-generation-background.
El helper resuelve membresías a partir de cookies de Next.js; ese contexto no
existe en la función background invocada con una solicitud firmada.

La ruta HTTP sigue autorizando al usuario antes de reservar y firmar. El worker
verifica firma y nonce, exige jobId y contrasta en DB creador, organización,
componente, tipo y proveedor. Después consulta membresías activas en el servicio
existente de autoridad, el rol de autoría vigente y el componente limitado al
artefacto y tenant de la reserva. No usa una sesión ficticia ni omite checks.

Los fallos después de verificar la reserva y antes de preparar el componente se
registran como FAILED sólo si el job sigue PENDING/QUEUED. Una reserva ajena no
se modifica. Una excepción dentro de generación conserva el manejo existente.
Se agregan eventos correlacionados por job/componente para delimitar la fase.

No se cambia QA, fuentes, cuota de B-roll, duración, modelos, esquema DB o payload
del documento. No se despliega ni se generan assets reales como verificación.
Rollback: revertir el diff. La reserva vieja en cola requiere reintento explícito
tras desplegar el arreglo; el error de sondeo por sí solo no ejecuta el worker.
