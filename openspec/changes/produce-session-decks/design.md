# Diseño

- Adaptador de materiales de sesión al contrato visual compartido, con identidad explícita de sesión y sin componente Academy ficticio. La entrada Academy de 24 slides no cambia; el adaptador permite hasta 400 páginas derivadas de las 40 slides síncronas. El exceso devuelve diagnóstico de contrato.
- Paginar puntos por presupuesto conservando palabras, orden y referencias. No incluir notas, respuestas ni preparación. El QA visual compartido conserva todos sus errores y advertencias, incluida explicación insuficiente.
- Producción local determinista en petición breve, sin proveedor ni cola. Persistir HTML, spec y QA en `production_assets`, con tipo existente `SLIDE_DECK_HTML`, sin migración. UUID derivado de tenant, curso, sesión, slides, aprobación y versión de compilación. Inserción inmutable con conflicto ignorado permite reintentos concurrentes sin duplicados.
- Cada lectura y escritura autoriza curso y tenant y vuelve a comprobar aprobación y entradas vigentes. Cambiar materiales impide reutilizar el asset anterior; una edición durante producción no se confirma como vigente. Recompilar al leer impide servir HTML manipulado desde la tabla de assets.
- UI por sesión: producir, recuperar, diagnóstico, iframe aislado y descarga autenticada. `FAIL` bloquea preview/descarga; `WARN` permanece visible. Un PASS técnico no crea una aprobación humana.
- El deck es un asset visual HTML. No crea un documento de composición, timeline, motion ni render HyperFrames. No sustituye las guías o cuadernos imprimibles.

Rollback: retirar la vista y ruta nuevas; los assets quedan como historial sin modificar el agregado ni sus aprobaciones. Un cambio futuro de compilación exige incrementar `SESSION_DECK_VERSION`.
