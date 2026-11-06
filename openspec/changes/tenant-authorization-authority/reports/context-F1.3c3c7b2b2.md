# Continuidad F1.3.c.3.c.7.b.2.b.2 — 2026-11-05

Base c3b101d8. Alcance previo: contener excepciones de observabilidad en los
handlers de publicación y recuperación de snapshots. Sus catches llaman
logFailure sin protección; el callback puede impedir el 503 neutral y sin
reintento. Preservar resultado incierto, correlación, cabeceras y unicidad del
envío. No introducir una recuperación automática ni cambiar lógica de dominio.

Reproducir antes de corregir con errores de autoridad reales y fallos de dominio,
combinados con logger que lanza. Extender fixtures existentes; usar handlers y
schemas reales y dobles explícitos de DB/host. Ambos archivos se compilan pero
no se ejecutan desde test:hyperframes en la base; añadir su ejecución al script
canónico para que la regresión no quede huérfana (TD-31).

## Diagnóstico y cambio

Antes del cambio, compilación correcta; ejecución explícita de ambas suites:
código 1, 31 tests, 22 pasan y las nueve regresiones nuevas fallan con
CANARIO_PRIVADO_LOGGER saliendo del catch. Log:
.tmp/module-graph/f1-3c3c7b2b2-before.log. No se cambió producto antes de esa
reproducción. El fallo existe tanto en autoridad como después de dominio.

Se protege únicamente logFailure con try/catch local en ambos handlers. El
callback tiene contrato síncrono void; esta corrección contiene sus excepciones
síncronas. No añade efectos, reintentos o log secundario que pueda fallar otra vez.
La respuesta previa conserva formato, cabeceras, correlación y retryable false.

Nueve tests nuevos: identidad, tenant y error desconocido antes del cliente en
cada handler (seis), error de publish y error de recover posterior al publish
(dos), error de recover en consulta (uno). Todos combinan fallo del logger;
los casos posteriores cuentan exactamente una invocación del dominio relevante.
Las fixtures y schemas son reales salvo authenticate, consultas Supabase,
publish/recover y logger simulados. No prueban transacción, almacenamiento o
composición del route Next con cookies reales.

Las 22 pruebas anteriores permanecen y se incorporan junto a las nueve nuevas
al primer grupo node --test de test:hyperframes; TD-31 no se cierra por activar
solo estos dos archivos. El primer grupo ahora ejecuta 53 tests sin fallos,
incluidos los otros cinco archivos ya existentes. Script test:hyperframes completo:
código 0. Ejecución offline de ambas suites con Node 22: código 0, 31/31.
docs:check: código 0, 333 documentos; OpenSpec estricto: código 0, 48/48.
Logs locales prefijo f1-3c3c7b2b2-. verify:pr completo: código 0. Lint: cero
errores y 570 advertencias sin diferencias con baseline; grafo 2310 módulos,
9063 aristas, cero ciclos, dos referencias de bundler justificadas y ninguna
sin resolver. diff --check correcto. El gate conserva sus comprobaciones de
migraciones locales, seguridad, audio y entrega; no acredita servicios externos.

## Continuidad y límites

Revisión propia, no independiente. No se cambia motion, schemas, CAS, cuotas,
filtros de organización, recibos, host, Storage o payloads de proveedor. Reversión
mediante commit local. Cinco documentos heredados y auditorías fuera del commit.
Sin acceso a servicios reales, credenciales, SQL remoto, publicación o generación
pagada; sin aceptación de CI, build o QA visual. No cierra todos los adaptadores
ni TD-26. Siguiente unidad: observabilidad del command narrativo compartido y
fragment-plan; probar fallos del callback y del logger por defecto preservando
semántica de commit incierto. Después protocolos restantes y emisores post-contexto.
