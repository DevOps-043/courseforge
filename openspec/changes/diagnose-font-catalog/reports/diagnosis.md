# Fuentes del editor — diagnóstico del 16 de octubre de 2026

## Resultado

El catálogo organizacional tiene un desajuste entre aplicación y esquema. La ruta
consulta cinco columnas que faltan en la definición remota inspeccionada. Es la
causa estructural identificada del fallo; no se trata del decode de una tipografía
ni de una descarga desde Google Fonts.

## Evidencia observada

- El inspector del curso indicado por el usuario muestra exactamente el aviso.
- Un GET autenticado de `/api/admin/fonts` en staging devuelve `success: false`,
  `code: INTERNAL_ERROR`, mensaje «No se pudieron cargar las fuentes.» y
  requestId `b941187a-c1cf-475b-8d76-8ca45a78b1d7`.
- El mensaje corresponde a la rama `if (error)` de la consulta en
  `apps/web/src/app/api/admin/fonts/route.ts`, antes de firmar o descargar archivos.
- `FONT_SELECT` exige `storage_bucket`, `checksum_sha256`, `mime_type`,
  `file_size_bytes` y `status`.
- La vista **SQL Definition (Read only)** de `organization_slide_fonts` del
  proyecto abierto en Supabase solo declara `id`, `organization_id`, `family`,
  `source`, `css_url`, `storage_path`, `created_by` y `created_at`.
- El host de los medios del iframe coincide con el identificador del proyecto
  inspeccionado. No se leyó configuración privada para comprobar la conexión.
- La migración `20260919120000_harden_organization_fonts_for_video.sql` contiene
  exactamente las cinco columnas faltantes y sus controles de integridad.
- La auditoría local de BD del 9 de octubre ya había registrado esas columnas
  ausentes en el snapshot; esta revisión aporta evidencia del esquema remoto.

## Cadena del fallo

`CompositionTextControls` solicita el catálogo → el servidor autoriza usuario y
empresa → SELECT incluye columnas ausentes → la consulta devuelve error → API
normaliza a error interno → la UI conserva el catálogo incluido y muestra el aviso.

El consumidor solo ofrece fuentes `renderEligible`; no corresponde devolver
fuentes legacy como si fueran válidas para render ni quitar los controles del SELECT.

## Corrección preparada para revisión

1. Confirmar proyecto destino e historial de migraciones; ejecutar
   [precheck.sql](precheck.sql) para verificar esquema y políticas antes del cambio.
2. Revisar/aplicar la migración existente del 19 de septiembre con autorización
   para cambios remotos, revisando bucket y políticas actuales. Preferir una
   transacción y no ejecutar nuevamente UPDATEs sobre estados ya evolucionados.
3. Ejecutar [postcheck.sql](postcheck.sql), repetir GET y abrir el inspector:
   respuesta exitosa, sin aviso. Verificar un usuario sin sesión y otro tenant.
4. Las tipografías subidas antes del endurecimiento sin checksum permanecerán
   LEGACY. Deben volver a validarse mediante el flujo de importación; no actualizar
   su estado manualmente para hacerlas visibles.

## Límites

No se ejecutó SQL remoto, se modificaron fuentes ni se aplicó una migración. Las
consultas preparadas no se han ejecutado en el servidor. No se obtuvo el error
PostgREST exacto desde los logs de Netlify porque la pestaña solicita iniciar sesión.
La coincidencia del proyecto se contrastó con los medios, no con variables del
servidor. No se afirma que la corrección esté desplegada ni que el catálogo se
haya recuperado.

La autorización de servidor existente permanece intacta. No se cambió código de
producto ni se requieren pruebas de compilación por esta entrega documental.
