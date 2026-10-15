# CAP-029 — cierre de contextos de preview I04

Fecha:2026-10-10. Implementación preparada; ambiente y QA manual pendientes.
Alcance autorizado: integración HTML de propuestas/presets. No se modificaron
stores/política CAP025, CAP022, gates/ABI SDK, SQL, flags o despliegue.

## Contextos y consumidores comprobados

| Contexto | Fuente / autoridad | Transporte y límites |
| --- | --- | --- |
| Current/saved | Hash del payload cargado; reader RPC exacto y pointers/versiones | Selector de canal existente, página aislada/capabilities; sin fallback legacy |
| Baseline/publicado | Hash/revisionId exactos, pin de publicación y portfolio actuales | Sesión/nonce propios; no confundir READY de baseline con primaria |
| Propuesta | Registro propio PENDING/no expirado, base vigente; simulador existente | Query proposalId en issuer común; no store/allow-list nuevos ni documento desde HTTP |
| Preset | Aplicación propia PENDING/no expirada, base vigente y proposed_document_hash | Query applicationId en issuer común; no lectura mutante del store para recursos |
| Snapshot/publicación | Documento guardado y paquete/pins autorizados, no hash transitorio | Flujo existente; candidato de preview no concede permiso de publicación/append |

La lectura nueva selecciona id/draft/org/created_by/status/expiry/base explícitos,
limita una fila y bytes/tiempo; exige creador autenticado, no delegación implícita.
Comprueba latest document hash y entra al RPC autorizado para la base exacta.
Propuesta reutiliza prepareCompositionAgentProposalApplication, revalida envelope
y simula; preset valida el documento/hash almacenados. El candidato debe coincidir
con el hash esperado. No actualiza status/expiry, guarda documentos ni aplica operaciones.

La proyección conserva solo referencias sobrevivientes idénticas y source íntegro.
No acepta nuevos pointers/HTML/manifests/grants. Freeze y compilador compartidos
verifican el contexto contra el hash del candidato, usando autoridad vigente de
la base. Contexto proyectado es derivación host-only; ningún objeto del request lo
puede reemplazar. Estado/hash/owner/base cambiados durante preparación invalidan
las relecturas; no se reutiliza una respuesta anterior como permiso.

## Página, canal y recursos

PAGE y RENEWAL usan el mismo issuer autenticado, tenant/rol actuales y cuotas.
Selectors son routing hints UUID, mutuamente exclusivos entre sí y con revisionId.
Capabilities HMAC incluyen selector y pins del bundle/portfolio/sesión; tokens
anteriores sin selector siguen representando exactamente su flujo anterior.
Cada GET binario reconstruye el candidato autorizado y portfolio antes y después
de adquisición. Dismiss/expiry/actor/base/grant/resource drift bloquean entrega o
renovación; no se fabrican permisos desde un DTO o hash.

UI calcula el hash de la simulación con el mismo formato canónico del host y
WebCrypto; extracción del serializador conserva el algoritmo existente. Preset
conserva el hash propuesto del server. El hook no escribe ni hace fetch/retry:
cancelación impide publicar una URL vieja y un input cambiado la oculta antes
de ejecutar effects. Mientras calcula/falla, el frame queda about:blank, no en
preview genérico/anterior. La ruta generica devuelve conflicto explícito para HTML.

NativeCompositionPreview conecta el frame activo y propaga el selector a host /
controller / consulta de renovación. Owner incluye actor/tenant y URL exacta del
frame: un canal anterior no puede revivir estado o cerrar la navegación nueva.
CompositionPreviewViewport conserva sandbox="allow-scripts" sin same-origin;
se ignoran mensajes window públicos del frame HTML. Edición directa y staging
editorial siguen bloqueados por agentProposal/presetPreview/previewPending.

Sin HTML editable, las rutas y navegación nativas siguen existentes. No se crean
otro renderer, engine de IA, worker, transporte, journal o fuente de autoridad.

## Evidencia y límites

- Regresión CAP029/contratos1050/1050, sin fail/skipped/cancelled.
- Dirigidas73/73: candidatos/browser hash/issuer/recursos y compilador nativo.
- Tipado web, worker y compilación de tests aprobados; lint dirigido aprobado.
- Prueba integrada de página→renovación→binario: bundle/sesión exactos, PNG real
  adquirido por fetch/Storage simulados, cierre por status/creator cambiado.
- Reader prueba owner/tenant/draft/fecha/base/hash/envelope corruptos, pointers /
  source alterados, referencia eliminada y ausencia de mutación original.
- Montaje UI: inspección del consumidor real y tipado; no interacción de navegador.
  No PostgreSQL/RLS, proveedores/Storage reales, render o QA manual ejecutados.

No se declara CAP025 completo: ownership/delegación/replay durable y consumidores
generales del compañero mantienen los hallazgos de su revisión. El reader propio
solo evita heredar esas brechas en la emisión HTML read-only, sin cambiar su política.
I04 queda implementado/preparado; I02/I05 todavía impiden cierre integral CAP029.
Métrica por entregables≈90%±10, +5 por cerrar este consumer, no por sumar tests.
No SQL nuevo: [orden manual1→29](SOFLIA_ENGINE_CAP029_SQL_MANUAL_ORDER.md).

## QA necesaria, no recomendaciones adicionales

Probar propuesta/preset con cambios nativos sobre HTML editable y compare con la
base: source original intacto, candidate hash exacto y edición inhabilitada. Dismiss /
nueva propuesta durante digest/load/renewal no debe revivir canal viejo ni cerrar
el nuevo. Revocar creador/status/expiry/base/grants entre page/resource/renewal;
repetir cambio actor/tenant y comprobar ausencia de bytes, fallback y nuevas writes.
No permitir publicar/aplicar un candidato solo por poseer su URL/capability.
