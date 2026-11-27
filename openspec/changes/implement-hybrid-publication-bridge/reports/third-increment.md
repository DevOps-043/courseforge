# Tercer incremento: custodia y recepción autenticada

Fecha: 2026-11-27. [Guía de continuidad](continuation.md).

- Academy expone `POST /api/internal/jobs/hybrid-publication` en su superficie
  de jobs internos. Autentica los bytes originales con HMAC, acota el cuerpo
  y limita peticiones por IP y actor. El RPC vuelve a requerir una membresía
  activa de propietario o admin para el vínculo de organización.
- La migración local `20261126120500` reserva cupo por publicación, crea el
  bucket privado con RLS y registra custodia. El enlace de carga se limita a
  cuarentena, mediante la API de Supabase.
  [Documentación de carga firmada](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl).
- Academy verifica tamaño, SHA-256, firma de archivo y antimalware para
  PDF/Office. Coloca los bytes íntegros en una ruta privada sin sobrescritura.
  Un reintento de un archivo ya verificado recupera la confirmación previa.
  Si se pierde la respuesta de almacenamiento, exige comprobar la copia final
  antes de registrar la custodia.
- El RPC de recepción comprueba que cada declaración coincida con una custodia
  verificada para la misma organización, artefacto y publicación. La ruta
  también ejecuta el validador de diálogo de Academy. El recibo permanece
  separado de la futura aprobación.
- La importación directa legacy valida versión y metadatos antes de
  interpretar el formato anterior o construir su cliente de escritura.

## Verificación local

- Academy, Vitest en Node con un worker y `--pool=threads`: 31 pruebas en ocho
  archivos, código 0. Incluyen firma, cuotas, MIME y hash, escáner indisponible,
  copia perdida, acceso por tenant, rollback y la entrada legacy directa.
  Tipos y lint del alcance modificado completados.
- Architect: `npm run verify:pr` completó con código 0 e incluyó las 101
  pruebas de entrega. También se comprobó la paridad de contratos. El arnés
  omitió la prueba de enlaces simbólicos porque el entorno no los permite.

## Límites

La guarda de Architect sigue activa. Se requieren una instancia Storage
autorizada, verificación de los límites HTTP del hosting y una política de
depuración de cuarentenas antes del piloto. Las pruebas HTTP usan dobles de
Storage y escaneo. Las pruebas SQL usan PostgreSQL local con PGlite. La suite no
acredita concurrencia entre conexiones ni preservación de progreso al aprobar.
Durante la implementación local no se aplicó SQL remoto, se desplegó ni se
publicó el taller.

## Pruebas de navegador después de la ejecución de SQL

El 2026-11-27 el usuario informó que ejecutó las migraciones. En Supabase SOFIA
se observaron las cinco tablas `hybrid_publication_*` y el bucket privado
`hybrid-publication-assets`, vacío y limitado a 25 MB por archivo.

En Architect staging se abrió la fase Publicar del taller de gestión del tiempo
en `pulsehub`. El artefacto figuraba como `APPROVED`. La pantalla mostró la
guarda de compatibilidad de Academy, 20 lecciones sin video final y el botón
«Enviar a SofLIA» deshabilitado. La consulta de aulas ofreció solo la prueba
Video SDK del 10 de noviembre, ajena al taller. En Academy la cola de revisiones
estaba vacía y la búsqueda por título no encontró el taller.

En `soflia.ai` la navegación al receptor devolvió 404 con GET. La solicitud
POST vacía sin firma devolvió 403 antes de emitir un recibo. Esos resultados no
acreditan el despliegue del handler v2 ni una carga con el protocolo firmado.
Quedan pendientes el envío, la aprobación y la comprobación de roles en Hub.
