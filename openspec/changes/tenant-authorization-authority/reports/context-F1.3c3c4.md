# Continuidad F1.3.c.3.c.4 — 2026-11-05

Base 96eb6ddd, staging. Unidad cerrada localmente; F1.3 y TD-26 siguen abiertos.
El objetivo global conserva íntegro el plan de remediación. No hay bloqueo de
unidades independientes por la aceptación externa pendiente.

## Alcance y cambio

Doce rutas/diecinueve métodos bajo api/production/heygen:

- assets GET/POST; platform GET/POST/PATCH; presets GET/PATCH.
- scenes GET/POST/PATCH/DELETE; speech POST; sync POST; videos POST.
- clips/generate POST, clips/status GET, clips/voice POST.
- jobs GET y jobs/[jobId] GET.

Producción solo añade doce imports y trece guards (38 líneas). Las clases
AuthIdentityLookupError y TenantContextLookupError usan el mapper existente antes
de errores genéricos o de proveedor. Assets/platform/scenes lo centralizan en su
formatter. En sync el guard queda después de compensar una reserva existente:
no se omite esa escritura de recuperación al devolver 503. Los catches internos
de despacho de clips y sincronización opcional del editor permanecen iguales.

Sin cambios de autoridad, schemas, DTO, actores/tenants, firmas, límites,
parámetros de servicios, proveedor, Storage, formatos, motion, tiempos o SQL.
Las rutas dedicadas standalone y automatización no forman parte del lote.

## Caracterización y pruebas

Los handlers, parser, schemas, NextResponse y declaraciones de error se cargan
desde las fuentes reales. Los módulos de errores de servicios se evalúan con
imports aislados; no se instancian clientes o servicios reales. DB, SDK,
credenciales, medios, firma y workers son dobles registrados por efecto.
El loader incorpora URLSearchParams y crypto nativos que usan estos handlers.

Primer intento: 26 fallos con fixtures incompletas. Se corrigieron aliases de
dependencias y comparaciones de objetos entre realms mediante structuredClone,
sin cambiar expectativas funcionales. La base verificada, todavía sin guards,
registró 20 fallos esperados y 165 aprobadas en el grupo de 185: diecinueve métodos
devuelven 500 ante la primera caída inyectada y sync también devuelve 500 después
de reservar/compensar. Después se añadió el caso de autoridad ajena en payload.

Los 51 tests nuevos contienen 134 combinaciones de caída: 19 métodos × tres
fronteras × dos clases, más diez métodos con ownership de componente × dos clases.
Exigen 503/retryable/correlación/no-store/Vary Cookie, cero efectos posteriores y
sin detalle sensible en respuesta o log de error genérico. Las denegaciones
401/403/404 conservan su semántica; un Error con name/code falsificados no pasa
por clase interna. El payload no concede actor/organización.

La compatibilidad cubre respuestas válidas de los diecinueve métodos; JSON
inválido/413; paginación y prepare/complete de assets; consultas y settings de
plataforma; presets no encontrados/default; recuperación de escenas y draft;
advertencia de sync opcional; preflight/queue/firma/despacho 202; voice_only;
marcado de clips fallidos; reserva/compensación y conflicto de catálogo; voz
standalone y ruta Storage por tenant; DTO/autoPromote y exposición de voz solo
tras SUCCEEDED; errores de servicio/credencial, proveedor 401/429/503 y Retry-After.

## Evidencia

Salidas completas locales en .tmp/module-graph.

| Comando / observación | Resultado | Archivo |
|---|---|---|
| Caracterización inicial | 1; 26 fallos, antes de corregir soporte de fixtures | f1-3c3c4-before.log |
| Caracterización verificada | 1; grupo 165/185, 20 fallos esperados; contrato previo 15/15 | f1-3c3c4-before-verified.log |
| npm run test:auth-bridge -w apps/web | 0; grupo 186/186 y contrato previo 15/15 | f1-3c3c4-auth.log |
| Nuevos tests compilados con Node 22 en caché | 0; 51/51 | f1-3c3c4-node22.log |
| npm run test:remotion -w apps/web | 0; script completo, incluye suites de cliente, catálogo, credenciales, repositorio y guion HeyGen | f1-3c3c4-domain.log |
| npm run verify:pr autorizado | 0; arnés 39/39, OpenSpec 48/48, lint cero errores/572 warnings sin diferencias, tipos y producto completos | f1-3c3c4-gate.log |
| Grafo dentro de verify:pr | 2.291 módulos, 8.952 aristas, cero ciclos/desconocidos, dos casos de bundler comprobados | f1-3c3c4-gate.log |
| docs:check final | 0; 324 documentos | f1-3c3c4-docs.log |
| openspec:validate final | 0; 48/48 | f1-3c3c4-openspec.log |

## Revisión propia y límites

Revisión propia, sin independencia: imports y guards son los únicos cambios de
producción; sync conserva la compensación y no se mueven catches de efectos ya
iniciados. Se revisaron todos los métodos y consumidores del lote. Las pruebas
usan clases de error reales compartidas con sus mocks de importación, por lo que
instanceof conserva identidad; no se aceptan códigos o nombres serializados.

Las pruebas de ownership HTTP simulan el helper; la suite existente conserva
además sus pruebas de autoridad/tenancy. Esto no acredita permisos SQL/RLS o
Storage efectivos. Se capturan argumentos y efectos simulados, no se prueba
idempotencia, HMAC real de este despacho, entrega con ACK perdido o ejecución
cloud. El test 413 no prueba consumo incremental/cancelación de transporte;
TD-27 y las demás fases siguen pendientes. No se leyó .env o claves reales ni se
consultó un proveedor, generó medios, publicó o ejecutó SQL remoto.

No hay cambio de contrato de proveedor: la fuente canónica recibe solo semántica
HTTP y evidencia; no corresponde alterar compliance, motion o el bundle enviado.
Sin CI, build o QA visual nuevos. Los procesos de tests/verificación terminaron;
no deben reiniciarse por falta de un handle viejo. Reversión por commit local.
Los cinco documentos y auditoría heredados se preservan fuera de este commit.

## Continuidad

Próxima unidad F1.3.c.3.c.5: slides y open-design, con fixtures por frontera antes
de normalizar. Quedan automatización/standalone, soportes HTTP HyperFrames y
aceptación de permisos/ambiente de TD-26. El plan principal también conserva
datos, publicación, transporte, operación, CI, editor y cobertura final.
