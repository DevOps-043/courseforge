# Evidencia de implementación

Fecha: 2026-10-31. Entorno local Windows, checkout principal.
Base inspeccionada: `60868a73ea8cbfdc2a78b87a0eb802c1c9d55572`.
Al iniciar solo existía el informe sin seguimiento de la revisión de esta conversación; se conservó.

## Resultado

Se incorporó `nativeCaptions?: boolean` al contrato validado y tipado de producción,
con control general y por componente. Ausente significa desactivado. Un override
`false` prevalece sobre el perfil. La UI diferencia esta opción de los captions
del avatar y ofrece «Actualizar estado» sin descartar el perfil no guardado.

El refresco de runs aprobados/no cancelados evalúa assets, prepara el borrador y
añade una capa desde timestamps actuales por escena. El job refresca también tras
el despacho para cubrir assets que ya estaban disponibles. Un error posterior
al envío no repite jobs pagados. Se mantiene el reconciliador periódico existente.

El caso de uso tiene puertos de preparación, lectura y append; el adaptador usa
los servicios existentes con organización y hash esperado. Comprueba coincidencia
de guion, timestamps y UUID del asset de voz entre Producción y el borrador.
No modifica fuentes ni tablas para fabricar esa coincidencia.

La creación es idempotente por ID de item y contenido esperado. No se regeneran
capas existentes. Ediciones, otras capas, recortes, eliminación registrada,
faltantes y conflictos impiden declarar el item listo. Su estado queda en
readiness y los cambios de estado se registran sin texto transcrito ni URLs.

## Validaciones ejecutadas

- `npm run test:composition-caption-presets --workspace=apps/web`: código 0,
  TypeScript y 47 pruebas aprobadas (12 nuevas). Incluyen fondo transparente,
  origen y tiempos, HTML de preview/render, reintento sin append adicional,
  tiempos faltantes/desactualizados, fuentes no coincidentes, capas manuales/SRT/VTT,
  edición/división/eliminación, conflicto y respuesta perdida tras guardar.
- `npm run typecheck`: código 0.
- `npm run test:remotion --workspace=apps/web`: código 0.
- `npm run test:security-boundaries`: código 0. Los tests nuevos de puertos verifican
  propagación de ámbito y que un rechazo de preparación no alcanza el append;
  no son una prueba remota de RLS.
- `npm run test:hyperframes --workspace=apps/web`: código 1; se detiene en
  `composition-agent-model-output.test.js` por `Cannot find module '@/lib/server/outbound-http'`.
  El fallo ya figura en la evidencia anterior de `caption-animation-presets`;
  no se modificó el módulo que falla ni se relajó el runner.
- `npm run verify:pr`: código 1. Adaptadores, arnés estructural y docs pasan;
  OpenSpec informa 29 items válidos (incluido este cambio) y falla en el cambio
  existente `diagnose-font-catalog`. La cadena no llega a los pasos posteriores.
  Su validación individual confirma que carece de deltas de especificación.
- ESLint focalizado: código 0, sin errores. Dos warnings `no-explicit-any`
  corresponden a la firma preexistente de Supabase en el servicio de runs.
  Se eliminó la declaración nueva de `any` del adaptador de captions reutilizando
  el tipo del servicio documental.
- `npm run db:migrations:check`: código 0 (213 archivos SQL, sin SQL nuevo).
- `npm run docs:check` final: código 0, 209 documentos.
- `npx openspec validate automatic-transparent-captions --type change --strict --no-interactive`:
  código 0.
- `git diff --check`: código 0.
- `npm run architecture:cycles`: código 1, detecta 11 ciclos en módulos de
  composition-editor/QA/HTTP no modificados por este cambio; ninguno de los
  servicios nuevos participa en los ciclos listados. No se afirma aprobación
  global ni se modifican esos módulos para ocultar el hallazgo.
- `npm run docs:audit`: interrumpido con código 1 después de varios minutos sin
  salida. El script recorre recursivamente código, dependencias y salidas dentro
  de apps. Se ejecutó una copia temporal en `.tmp/automatic-captions-audit.ps1`
  con el mismo inventario Git/rutas/jobs y un escaneo `rg` de variables limitado
  al código no ignorado: código 0, informe generado en `docs/documentation-audit.md`.
  El script versionado no se modificó. README/contexto se contrastaron con los
  servicios, schemas y pruebas del alcance; el informe temporal deja esa decisión
  y las limitaciones registradas. No equivale a aprobación del script original.

## Revisión adversarial propia y límites

- La autorización HTTP existente exige usuario, rol revisor y organización antes
  de acceder con service role. El refresco comprueba pertenencia del componente
  mediante su artifact; composición/borrador/append se consultan con organización.
- Un run cancelado no entra al flujo. Items SKIPPED/FAILED/IN_ASSEMBLY se conservan.
  Cancelación simultánea y append no son una transacción distribuida: una escritura
  ya iniciada puede terminar. No se promete cancelación instantánea.
- Si se pierde la respuesta de append, el siguiente refresco lee el ID determinista
  y confirma sin duplicar. La identidad de capa confirmada se conserva durante
  faltantes y desactivación para proteger eliminaciones posteriores.
- `WAITING_TIMESTAMPS`, `REVIEW_REQUIRED` y `FAILED` con assets completos producen
  item STALE, nunca un nuevo despacho pagado. La revisión se retoma con actualización
  explícita del estado; los runs NEEDS_ATTENTION no entran al cron existente.
- No se ha probado persistencia en Supabase real, interfaz en navegador, cron
  desplegado ni render cloud. Las pruebas HTML no certifican el MP4 final.
- No se incorporó transcripción de archivos arbitrarios ni soporte nuevo para
  `single_video`; falta definir proveedor, costos y contrato de ese alcance.
- Reversión: desactivar la opción detiene nuevos intentos y conserva capas;
  no hay SQL que revertir. Mantener el lector V3 para documentos con captions.

Esta revisión fue realizada por el mismo agente que implementó el cambio;
no se presenta como revisión independiente ni despliegue observado.
