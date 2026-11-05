# Fase 1 — dominio, persistencia y recepción privada

Fecha: 2026-11-05. Base inspeccionada: `a7da3c51`; checkout principal. Al iniciar solo estaba sin seguimiento la propuesta OpenSpec creada en esta conversación. No se crearon worktrees ni se modificaron secretos/configuraciones personales.

## Resultado

Implementado el dominio `course-sources` y cuatro rutas: crear borrador DRAFT sin IA, listar con paginación, reservar upload privado y confirmar recepción. Los contratos excluyen organización/actor/ruta/estado del payload. API comprueba rol y pertenencia del curso antes de usar service-role; confirmar/firmar requiere el actor de la reserva. Rechaza formularios y solicitudes con origen cruzado.

Migración aditiva `20261105010000_course_owned_document_sources.sql`: siete tablas de contratos documentales, tres RPC ejecutables solo por backend, RLS, índices, cuotas transaccionales, identidad documental inmutable, FK compuestas y bucket privado con política restrictiva frente a políticas permisivas históricas. Fragmentos y snapshots son inmutables para el rol backend según sus grants actuales.

La confirmación comprueba metadata y tamaño antes de descargar, bytes reales, SHA-256 y estructura inicial. Genera `UPLOADED`, nunca `READY`. No extrae texto ni llama IA. PDF/DOCX/PPTX requieren validación/extracción posterior; el test de recepción de PDF usa solo cabecera y no acredita un PDF interpretable. Office verifica límites de directorio antes de JSZip, sin descomprimir XML.

## Contraste y revisión propia

- Se mantiene la ruta histórica que crea y genera un artefacto; el borrador nuevo usa una entrada separada para evitar IA accidental. Su consumo por UI/generación pertenece a fases posteriores.
- La política del curso empieza en `null`: no se impone exclusivo o mixto por defecto. La elección y sus guardas serán F3.
- Registro PDF histórico y fuentes de Temario no se migran ni se convierten automáticamente en fuentes aprobadas.
- Identidad/versiones/fragmentos/asociaciones/snapshots tienen contrato persistente; los adaptadores hacia `curation_rows`, citas y versiones de jobs quedan documentados, sin fingir integración ya ejecutada.
- Rutas genéricas de firma/media no aceptan el bucket nuevo. La política restrictiva SQL protege contra una política permisiva previa sin cambiar otros buckets.
- Reservas vencidas no se renuevan al repetir; siguen contando en cuota. Conciliación, retención y retirada de originales siguen F2.
- Los SQL se probaron como `service_role` no propietario/no superusuario con BYPASSRLS, consistente con el backend; navegador no tiene privilegios. Son pruebas aisladas, sin acreditar las políticas efectivas del despliegue.

Esta revisión fue realizada por el mismo agente; no se afirma revisión independiente.

## Verificación

| Verificación | Resultado |
|---|---|
| Contratos, servicios, Storage simulado y HTTP reales con dependencias sustituidas | 18 pruebas aprobadas; `phase-1-domain.log`. |
| Migración PostgreSQL aislada (PGlite) | Código 0; 9 pruebas aprobadas en `phase-1-sql.log`: idempotencia, cuotas, vencimiento, RLS/grants, FK y política restrictiva de Storage. |
| `npm run test:auth-bridge --workspace=apps/web` | Código 0; contrato inicial 15 pruebas y ejecución posterior 657, sin fallos. |
| `npm run typecheck` | Código 0 en verificación directa previa; la compuerta vuelve a comprobarlo con el diff final. |
| `npm run db:migrations:check` | Código 0; 215 archivos SQL, colisiones históricas congeladas. |
| `npm run docs:audit` | Código 0; auditoría temporal regenerada; README/contexto actualizados solo para el alcance F1. |
| `npm run verify:pr` | Código 0; compuerta completa en `phase-1-gate.log`, incluidos lint (0 errores, sin incremento de warnings), tipos, grafo (0 ciclos y referencias sin resolver), migraciones y suites de producto. Primera ejecución falló por ACL del temporal del sandbox; el reintento usó TEMP/TMP dentro de `.tmp/course-sources-verification`, sin modificar pruebas ni criterios. |

Durante las verificaciones se corrigieron dos defectos en tests nuevos: tipado de un arreglo de headers y comparación textual de timestamps equivalentes en distintas zonas horarias. No se cambiaron reglas para ocultar fallos.

Tras la compuerta se completó la validación del directorio Office contra un contador de entradas falsificado y se repitió la suite de dominio: 18/18, código 0. Esa compilación cubre el guard modificado; no se repitieron suites ajenas por ese ajuste acotado. La suite SQL final terminó 9/9. Total propio de F1: 27 pruebas aprobadas.

## Límites y siguiente fase

Sin aplicación SQL remota, inspección de datos remotos, despliegue, proveedor IA, render o publicación. Tampoco hay UI, extracción, propuesta de cobertura o fuente consumida por Materiales nueva. Las pruebas sustituyen la frontera Storage/HTTP externa; queda validar Supabase Storage real, URLs firmadas y Auth Bridge del despliegue en piloto autorizado.

La documentación canónica es `docs/architecture/course-owned-document-sources.md`; contiene cuotas, contratos, preflight/postflight y rollback. La aceptación de F1 se limita a esta base local. No se archiva OpenSpec porque faltan fases y no se ha integrado en la rama objetivo.
