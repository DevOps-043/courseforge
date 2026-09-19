# Texto y captions nativos en el editor de composición

## Estado de la decisión

Aceptada e implementada para texto/captions nativos y tipografías privadas de organización. El documento editable es la fuente de verdad y HyperFrames conserva únicamente la responsabilidad de render determinista.

## Contrato

- `courseforge-composition-v3` identifica documentos que contienen clips `TEXT` o `CAPTION`.
- Un clip `TEXT` usa una fuente `NATIVE_TEXT`; un clip `CAPTION` usa `NATIVE_CAPTIONS`.
- Contenido, estilo, layout y timing se persisten en el documento versionado. No dependen del store interno de HyperFrames Studio.
- Texto, fondo y capa tienen opacidades independientes.
- Los captions son cues relativos al clip, ordenados y sin solapamiento. El renderer los sincroniza en el único timeline GSAP pausado de la composición.
- El preset inicial de captions es transparente y recupera contraste mediante stroke y sombra.

## Tipografías

El editor mantiene familias incluidas (`Inter`, `Montserrat`, `Roboto`, `Arial` y `Georgia`) y ofrece fuentes privadas de la organización mediante el dominio compartido `organization-fonts`:

- El bucket `organization-fonts` es privado y no expone políticas directas al cliente.
- La API aplica autenticación, aislamiento por `organization_id` y rol administrativo para mutaciones. Cualquier editor autorizado de la organización puede leer el catálogo.
- El archivo se limita a 10 MB y se valida por extensión, firma binaria y límites estructurales antes de almacenarse.
- TTF/OTF requieren tabla `name` válida y no pueden declarar embedding restringido en `OS/2.fsType`. Solo esas fuentes quedan `READY` para video.
- WOFF/WOFF2 se aceptan como `LEGACY` para conservar el flujo de diapositivas, pero no aparecen como elegibles en el editor de video porque su licencia interna no se inspecciona todavía.
- Google Fonts guardadas continúan disponibles para diapositivas. No son elegibles para video mientras dependan de una URL remota mutable.

El documento persiste `fontAssetId` y la familia esperada, nunca una URL firmada. El preview resuelve temporalmente la fuente por organización; el snapshot vuelve a descargarla, verifica tamaño y SHA-256, y la copia a `assets/fonts/<sha256>.<ext>`. El HTML final usa esa ruta local y el manifest registra exactamente los binarios incluidos.

## Evolución del flujo

1. Añadir un proceso aislado de normalización WOFF/WOFF2 que limite CPU/memoria, inspeccione `OS/2.fsType` y produzca WOFF2 canónico.
2. Modelar pesos y estilos como variantes de una familia cuando el producto requiera selección tipográfica avanzada.
3. Migrar gradualmente las filas `LEGACY` que tengan procedencia y licencia verificables; no promoverlas automáticamente.

## Rollout

1. Completado: texto/captions con fuentes deterministas incluidas en runtime.
2. Completado: dominio compartido de fuentes, compatibilidad del flujo de diapositivas y empaquetado inmutable en snapshots.
3. Pendiente: importación SRT/VTT y generación desde transcript hacia el mismo contrato de cues.
4. Pendiente: normalización segura de fuentes comprimidas.
5. Opcional: edición avanzada por palabra únicamente si existe una necesidad real; no adoptar el modelo disperso de overrides de Studio como formato persistente de Courseforge.

## Validación mínima

- El contenido HTML se escapa antes de renderizar.
- Los cues no pueden solaparse ni exceder la duración del clip.
- Las mutaciones pasan por operaciones allow-listed y respetan tracks bloqueados.
- Preview y render reciben el mismo HTML y el mismo timeline.
- Una fuente no resuelta, ajena a la organización o cuyo checksum cambió bloquea preview/snapshot en lugar de aplicar fallback silencioso.
- Documentos V1/V2 permanecen legibles y solo se promueven a V3 al incorporar texto o captions nativos.
