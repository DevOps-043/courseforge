# Diseño

`URL` identifica el sitio principal, no el deploy que ejecuta el request. Además,
Netlify solo garantiza URL/SITE_NAME/SITE_ID en runtime; DEPLOY_URL se captura en
build. Fuentes: https://docs.netlify.com/build/functions/environment-variables/
y https://docs.netlify.com/build/configure-builds/environment-variables/.

El build escribe un JSON importado estáticamente por un resolver puro y compartido.
Su origen tiene precedencia sobre DEPLOY_URL del runtime. Nunca se recurre a URL,
NEXT_PUBLIC_APP_URL, DEPLOY_PRIME_URL ni headers controlables por el cliente.
Se exige origen HTTPS sin credenciales/ruta/query/hash. Desarrollo directo usa
localhost; producción sin metadatos falla antes del envío. La URL general pública
y sus consumidores permanecen iguales. No se amplían permisos ni se alteran firmas.

El punto compartido cubre los despachos desde API y los jobs que usan bootstrap.
No se añaden reintentos automáticos ni se reactivan jobs fallidos como efecto del
cambio. La invocación remota ya registra el destino y no registra el payload.

Reversión: revertir este cambio y reconstruir (recupera el comportamiento anterior
con el riesgo conocido de cruce de entornos). No hay migraciones ni backfill.
