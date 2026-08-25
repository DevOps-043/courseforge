# Registro de cumplimiento: HeyGen y HyperFrames

Estado: activo  
Última verificación: 2026-08-25  
Alcance: repositorio `courseforge`, `HEAD` revisado el 2026-08-25.

Este registro contiene hechos técnicos comprobados y decisiones pendientes; no
es asesoría legal ni sustituye los contratos Enterprise que puedan aplicar.

## Inventario confirmado

| Componente | Versión / tipo | Uso confirmado | Fuente y condición | Acción actual |
| --- | --- | --- | --- | --- |
| `@hyperframes/studio` | dependencia directa `0.7.106` | Declarada en `apps/web/package.json`; su presencia debe revisarse en cada build cliente | [Apache-2.0 upstream](https://github.com/heygen-com/hyperframes/blob/main/LICENSE) | Aviso y copia de licencia incluidos. |
| `@hyperframes/studio-server` | dependencia directa `0.7.106` | Declarada en `apps/web/package.json` | Apache-2.0 upstream | Aviso y copia de licencia incluidos. |
| `@hyperframes/core`, `parsers`, `player`, `sdk` | transitivas `0.7.106` | Resueltas por `npm ls` desde las dependencias anteriores | Apache-2.0 upstream | Cubiertas por el aviso HyperFrames; revalidar con cada lockfile. |
| HyperFrames Cloud | API remota de HeyGen | Cliente server-side `hyperframes-cloud.client.ts`, claves por organización o variable global server-side | [Términos de HeyGen](https://www.heygen.com/terms) y [API key](https://developers.heygen.com/docs/api-key) | No es licencia OSS; controlar plan, términos y secretos. |
| HeyGen Avatar/Video | API remota de HeyGen | Credenciales por organización y fallback opcional `HEYGEN_API_KEY` | Términos de HeyGen | Mantener controles de consentimiento, plan y datos. |

No se encontró un archivo `NOTICE` en la raíz del upstream HyperFrames al
verificar el 2026-08-25. Esta ausencia debe volver a comprobarse contra la
versión concreta antes de cada actualización. Si aparece, se incorpora de
forma legible al artefacto distribuido.

## Hechos de implementación verificados

- El cliente de HyperFrames Cloud usa `https://api.heygen.com`, el encabezado
  `X-Api-Key` y una clave de idempotencia.
- Las credenciales se obtienen del almacenamiento cifrado por organización;
  `HYPERFRAMES_CLOUD_API_KEY` y `HEYGEN_API_KEY` son fallbacks de entorno
  server-side. No se encontraron variables públicas `NEXT_PUBLIC_*` para esas
  claves.
- El webhook `supabase/functions/heygen-hyperframes-webhook/index.ts` valida
  HMAC-SHA256 sobre el body crudo, timestamp, identificador de evento y
  deduplicación antes de actualizar el estado.
- Courseforge es actualmente un servicio web y consume HyperFrames Cloud. No
  se identificó un fork ni archivos de código fuente de HyperFrames copiados
  al repositorio.

## Brechas y decisiones abiertas

1. El pipeline no genera aún un SBOM ni verifica automáticamente que
   `THIRD_PARTY_NOTICES.md` se entregue junto al artefacto de producción.
2. Debe confirmarse en un build de producción si `@hyperframes/studio` se
   incluye efectivamente en un chunk enviado al navegador o sólo permanece en
   dependencias instaladas. Hasta entonces, el aviso se mantiene por
   precaución.
3. Las dependencias no HyperFrames —incluidas las de Remotion y sus posibles
   condiciones comerciales— requieren un inventario y revisión independiente
   antes de declarar cumplimiento global de todo el producto.
4. El responsable de la cuenta, el plan de HeyGen aplicable y el mecanismo de
   conservación del consentimiento de avatar/voz/contenido no se verifican
   sólo desde el repositorio; producto y legal deben registrarlos por
   organización.

## Reglas de entrega

Si se distribuye una imagen Docker, bundle, aplicación de escritorio, paquete,
SDK o código fuente que contenga HyperFrames, se entrega con
`THIRD_PARTY_NOTICES.md` y `licenses/Apache-2.0.txt`. Si se modifica código
upstream de HyperFrames, se conservan sus avisos y se añade una nota prominente
en cada archivo modificado con autor y fecha del cambio. No se requiere logo,
watermark ni crédito dentro de los videos por Apache-2.0.

Para cambios posteriores, seguir
[`protocolo-actualizacion-heygen-hyperframes.md`](protocolo-actualizacion-heygen-hyperframes.md).
