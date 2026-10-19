# Diseño y compatibilidad

Base: staging, 2660223e. Rama: codex/heygen-external-import-v3.

La ruta conserva autenticación y autorización del componente antes de resolver
el origen. Para consultas por ID, obtiene la organización activa del servidor y
llama al resolver con allowGlobalFallback=false y timeout de 15 segundos.
HeygenClient mantiene respuestas acotadas y consulta GET /v3/videos/{id}.

La decisión URL/ID y clasificación del estado viven en un módulo de dominio
con consulta inyectada. Una URL en videoId conserva su precedencia histórica;
videoUrl explícito evita ahora la consulta incluso si hay un ID. No se recupera
un fallo del proveedor con otra cuenta ni se lo convierte en pendiente.

Se mantienen 202 pendiente, 422 generación fallida, 502 error HTTP del proveedor;
sin credencial tenant se devuelve 409 y sin contexto tenant, 403. Un video marcado
completed sin URL permanece pendiente. La descarga sigue validando SSRF, MIME,
redirecciones y máximo 150 MiB. No cambia persistencia ni se hacen mutaciones remotas.

Riesgo: consumidores antiguos que dependían únicamente de la clave global deben
configurar la credencial de su empresa o proporcionar URL directa.
Reversión: revertir los cambios locales; no requiere SQL. Restaurar v2 deja de ser
una alternativa operativa tras el retiro del proveedor.
