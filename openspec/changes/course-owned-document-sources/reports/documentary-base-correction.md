# Corrección de extracción e inicio de Base

El reporte del 7 de noviembre de 2026 mostró un archivo en estado fallido y un borrador sin contenido de Base. El parser podía cortar un par UTF-16 y generar JSON rechazado por PostgreSQL. Además, el formulario general creaba un artefacto independiente y faltaba una acción para iniciar Base sobre el borrador documental.

La corrección conserva caracteres completos, registra un diagnóstico seguro por intento y concede una recuperación adicional a fallos genéricos históricos agotados. Una publicación previa puede marcarse como desactualizada sin revertir el guardado de la extracción. La guarda sigue exigiendo fuentes vigentes para avanzar el envío.

«Generar Base» está disponible al crear y al retomar un borrador documental. La acción valida acceso, política y al menos un documento READY. Reserva una ejecución con la versión observada del artefacto y reutiliza el worker. La misma solicitud y un intento concurrente conservan el identificador del borrador. Si la política deja de ser documental antes de que el worker obtenga el contexto, el job termina antes de investigar en la web.

## Verificación local

- Suite de fuentes: 55 pruebas TypeScript y 22 de PostgreSQL aislado. La suite SQL incluye la recuperación limitada y el bloqueo de envío obsoleto tras una extracción.
- Reproducción aislada en PostgreSQL: el corte anterior devuelve `22P02`. Los fragmentos actuales pasan por `jsonb` y reconstruyen íntegro el texto.
- TXT y DOCX con Storage y RPC simulados llegan al commit documental con el carácter completo. La prueba de navegador local con la acción simulada comprueba el error visible cuando falta un archivo listo, el reintento y la conservación del borrador con doble clic.
- La prueba del worker con proveedores simulados verifica que el contexto documental omite búsquedas también en el fallback.

No se confirmó la causa exacta del archivo reportado. El piloto con Storage, Netlify y un proveedor real sigue pendiente.

## Activación

En una base con F1–F4 aplicadas, ejecutar únicamente `supabase/migrations/20261107010000_course_source_extraction_diagnostics.sql` y desplegar la aplicación y los workers de la corrección juntos. En el piloto, retomar un borrador previo, reprocesar su documento si conserva intentos, generar Base y verificar que el ID del curso no cambia. Si el entorno aún carece de alguna migración anterior, aplicar primero las faltantes en orden.
