# Etapas de implementación

Ampliación para documentos largos: [ruta de implementación y recuperación por lotes](long-source-plan.md).

Estado: fases 1–4 implementadas y verificadas localmente; migraciones remotas, despliegue y fases 5–6 pendientes. Evidencia de F4 en `reports/phase-4.md`. Completar en orden, con cambios pequeños y recuperables en el checkout principal. No crear worktrees.

## F0. Alcance y línea base
- [x] Contrastar cargador de Temario, registro PDF, filtros de curación y consumo de Materiales con código vigente.
- [x] Registrar contexto, propuesta, diseño y criterios observables.
- [x] Incorporar decisión del usuario: elección explícita entre modo exclusivo y mixto en cada curso documental, sin predeterminado.
- [x] Inventariar consumidores: Base, Temario, Plan, curación automática/manual, materiales estándar/video/sincrónicos, reintentos, regeneración parcial, QA y publicación.
- [ ] Registrar límites efectivos de plataforma, esquema/buckets/grants y contratos de creación de borrador. Solo introspección remota autorizada, sin secretos ni contenido de cursos en evidencia.

Salida: matriz de consumidores, política y límites cerrados; riesgos de compatibilidad identificados.

## F1. Dominio, persistencia y contratos
- [x] Crear schemas/tipos y servicios del dominio `course-sources`, separado de UI/HTTP/repositorios.
- [x] Diseñar tablas/versiones/fragmentos/asociaciones/snapshots; mapear vínculos con `curation_rows` y requisitos/citas de Materiales sin duplicar texto. El adaptador de consumo se implementará en F4; ver contrato canónico.
- [x] Especificar rutas, schemas, errores, idempotencia, versiones esperadas y estados de procesamiento. F1 expone borrador/listado/reserva/confirmación; política/asociaciones/aprobación versionadas permanecen contratos futuros F3/F4.
- [x] Añadir migración aditiva, RLS, grants, índices, cuotas y guardas transaccionales; probar con roles no propietarios y sin superusuario.
- [x] Implementar borrador previo a Base y reserva/confirmación de upload privado; garantizar que no inicia IA.

Salida: contratos y aislamiento probados; ningún consumidor de generación requiere todavía activar la capacidad.

## F2. Ingesta documental y biblioteca
- [x] Extraer/reutilizar parsers de PDF/DOCX/PPTX/TXT con límites y versión explícita de extracción.
- [x] Implementar verificación de bytes reales, MIME, estructura, hash, cuotas y protección de ZIP Office; sin recursos remotos ni ejecución de contenido.
- [x] Implementar job firmado, leases, reintentos acotados, recuperación, cancelación y confirmación atómica de fragmentos.
- [x] Crear UI para selección/arrastre, progreso persistente, original privado y texto interpretado, errores, reutilización, reemplazo y retirada lógica.
- [x] Conectar biblioteca a Base/Temario/Fuentes, manteniendo importación de temario explícito independiente.
- [x] Añadir conciliación de cargas huérfanas, retención y procedimiento de purga separado/autorizado.

Salida: cuatro formatos recuperables tras recarga; archivos inválidos o excesivos rechazados; fuentes nunca públicas.

## F3. Política y cobertura curricular
- [x] Implementar resolver de política compartido y adaptación explícita de cursos históricos.
- [x] Mostrar ambas opciones sin preselección en cursos documentales nuevos; bloquear generación sin elección, persistirla y recuperarla al reabrir el curso.
- [x] Proponer asociaciones por objetivo/tema con evidencia; permitir corrección y aprobación versionada por revisor.
- [x] Sustituir exclusiones incondicionales de manual/PDF por reglas según política en UI, API y workers. La rama documental usa evidencia de biblioteca y URL revisada; el adaptador de PDF legados continúa en F4.
- [x] Mantener cuota web histórica; permitir un manual suficiente para muchas lecciones y bloquear vacíos documentales sin exigir duplicados.
- [x] Implementar modo mixto con vacíos/conflictos visibles y procedencia separada.
- [x] Hacer atómicos los cambios de política/fuentes/asociaciones y la invalidación de dependencias.

Salida: un solo criterio de cobertura decide en todos los consumidores, sin saltarse aprobaciones.

## F4. Integración de generación de extremo a extremo
- [x] Sustituir las guardas temporales F3 que bloquean generación documental por validación de snapshot/contexto vigente, sin habilitar motores antiguos sin sus fuentes.
- [x] Consumir la selección documental READY desde Base, Temario y Plan; exigir revisión curricular aprobada para Materiales, sin dependencia circular; desactivar investigación y herramientas web en modo exclusivo.
- [x] Sustituir contexto basado solo en extractos por fragmentos aprobados seleccionados para Materiales, con presupuesto y snapshot reproducible.
- [x] Aplicar política/contexto a todos los proveedores y fallback, jobs, reanudaciones, regeneración parcial, videos y variantes de entrega activas.
- [x] Validar IDs/localizadores, correspondencia con lección y snapshot, citas textuales y respaldo semántico; detener componentes sin sustento.
- [x] Rechazar resultados de jobs con versiones vencidas; conservar borradores y evitar regeneraciones pagadas implícitas.
- [x] Integrar vigencia de fuentes con QA, producción/ensamble y publicación; impedir fuga de referencias privadas.
- [x] Añadir adaptadores de documentos de Temario/PDF históricos y diagnóstico de originales ausentes.

Salida: curso nuevo basado en archivos llega a Materiales revisables y al flujo de entrega vigente, con procedencia e invalidación demostrables.

## F5. QA, seguridad y documentación
- [ ] Unitarias de políticas, cobertura documental/web/mixta, fragmentación, selección de contexto y validación de citas.
- [ ] Integración HTTP/Storage/jobs con archivo real por formato, persistencia, duplicados, errores y recuperación tras timeout.
- [ ] Fixtures con secciones relevantes después de los primeros 12,000 caracteres, tablas/listas, acentos y orden de diapositivas; verificar evidencia utilizada, no solo respuesta exitosa.
- [ ] Negativas: PDF escaneado/corrupto, ZIP expansivo, MIME falso, payload grande, texto UTF-8 inválido, prompt injection y citas inventadas.
- [ ] Autorización: anónimo, usuario sin permisos, otra organización, otro curso de la misma organización, rutas manipuladas y firma expirada/repetida.
- [ ] Concurrencia: doble confirmación, reemplazo durante extracción/generación, cambio de política, cancelación, aprobación obsoleta y retry tras aceptación incierta.
- [ ] Verificar con espías que `DOCUMENTS_ONLY` no llama buscadores/URL context en ninguna etapa o fallback; distinguir búsquedas web de llamadas IA autorizadas.
- [ ] Regresión de cursos sin documentos, web histórico, PDF manual, importación de temario, SCORM y modalidades activas.
- [ ] Medir memoria/tiempo con límites configurados y concurrencia acotada; fijar umbrales de aceptación antes de ejecutar el piloto.
- [ ] Aplicar revisión adversarial y actualizar contratos/documentación canónica, guía operativa, límites, troubleshooting y rollback.
- [ ] Ejecutar suites pertinentes y compuertas reales; guardar comandos, códigos de salida y limitaciones en `reports/verification.md`.

Comandos de partida: `npm run test:syllabus-duration --workspace=apps/web`, `npm run test:syllabus-import-flow --workspace=apps/web`, `npm run test:curation --workspace=apps/web`, `npm run test:materials-generation --workspace=apps/web`, `npm run test:security-boundaries`, `npm run test:auth-bridge --workspace=apps/web`, `npm run db:migrations:check`, `npm run typecheck`, `npm run verify:pr`. Añadir suites propias al runner real del repositorio. No ejecutar proveedores pagados ni SQL remoto como parte de pruebas aisladas.

## F6. Activación y aceptación operativa
- [ ] Preparar SQL/migraciones, preflight/postflight, despliegue y rollback para revisión antes de solicitar la autorización de ejecución remota.
- [ ] Tras autorización, aplicar cambios y desplegar aplicación/jobs coordinadamente con habilitación limitada por organización.
- [ ] Ejecutar piloto con documentos de prueba no sensibles, proveedor real autorizado y revisión humana de contenido. Registrar curso, versiones, entorno y resultado sin divulgar texto privado.
- [ ] Probar recarga, archivo por formato, curso con un solo manual, vacíos y acceso denegado entre organizaciones en el despliegue real.
- [ ] Verificar disponibilidad del flujo de publicación sin publicar automáticamente; prueba de publicación solo con autorización expresa, conservando fuentes privadas.
- [ ] Confirmar métricas, límites y reversión; ampliar disponibilidad únicamente después de aceptación.
- [ ] Integrar en rama objetivo y archivar OpenSpec después de la integración; no antes.

## Matriz mínima de aceptación

| Caso | Resultado exigido |
|---|---|
| Un manual suficiente | Curso documental completa cobertura sin dos archivos artificiales por lección. |
| Cuatro formatos | PDF textual/DOCX/PPTX/TXT se cargan, persisten y aportan evidencia a materiales. |
| Contenido al final | Material recupera sección relevante posterior a 12,000 caracteres con localizador correcto. |
| Sin web | Cero búsqueda/URL context en Base, Temario y demás consumidores, incluidos retries y fallback. |
| Falta de información | Vacío visible; bloqueo del componente afectado sin inventar respaldo ni navegar implícitamente. |
| Fuentes mixtas | Documentos priorizados y búsqueda externa explícita, con conflictos revisables. |
| Edición concurrente | Job anterior no aprueba ni sobrescribe el resultado de una nueva versión. |
| Reapertura | Documentos, asociaciones, progreso y errores siguen disponibles tras recargar. |
| Aislamiento | Ningún original, fragmento o cita privada es accesible sin permiso por curso/organización. |
| Publicación | Guardas de vigencia activas y ausencia de URLs/rutas/documentos privados en recursos públicos. |
| Histórico | Cursos web, sin fuente, importados y SCORM mantienen su comportamiento compatible. |

“100% operativo” exige F0–F6 y evidencia de aceptación desplegada. Tener migraciones locales, un botón de carga o suites verdes no satisface por sí solo esa condición.
