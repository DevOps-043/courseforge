# Auditoría de BD.sql y migraciones de staging — 9 de octubre de 2026

## 1. Entendimiento del objetivo

Comparar el archivo local BD.sql con las migraciones versionadas de staging, identificar diferencias y establecer un orden de aplicación condicionado por dependencias y estado real de la base. No se ejecutaron migraciones ni se conectó a Supabase.

Referencia Git: staging y origin/staging locales = c3f79e8f9bb20e0aa5d4b31e7075c334b7b2f5f1. No se hizo fetch; esto describe las referencias disponibles al analizar. BD.sql tiene cambios locales previos al análisis: se usó el archivo solicitado, no la versión del commit. Contiene 86 tablas, todas de public, y declara expresamente que es contextual y no ejecutable.

Se revisaron las 185 migraciones versionadas para detectar tablas públicas ausentes y columnas agregadas mediante ALTER TABLE public. El inventario principal comprende 47 migraciones desde 20260929120000, de los tres últimos commits que agregan migraciones: 7e16e8c3 (1/oct), 96a191b9 (6/oct) y 2fdef765 (9/oct). Las fechas del nombre SQL son versiones de orden, no necesariamente la fecha del commit.

## 2. Diagnóstico técnico

**Conclusión:** faltan en el snapshot las dos tablas de receipts narrativos de octubre, la tabla de exclusiones HeyGen y cambios de septiembre para SFX, SCORM, correlación y fuentes. No se puede afirmar que todo el bloque privado esté pendiente: BD.sql omite private, funciones, índices, triggers, RLS, permisos, storage y el historial schema_migrations. La ausencia de esas definiciones en este archivo no es evidencia de ausencia en la base.

### Diferencias públicas constatadas

| Migración | Evidencia y decisión |
|---|---|
| [20260920020000_make_heygen_catalog_visibility_durable.sql](../../../supabase/migrations/20260920020000_make_heygen_catalog_visibility_durable.sql) | Falta public.heygen_catalog_exclusions. Candidata a aplicar tras verificar catálogo e historial. Prerrequisitos HeyGen existentes como tablas; RPCs anteriores aún por verificar. Incluye backfill y cambia estado de presets legacy: revisar impacto funcional. |
| [20261006040000_narrative_extraction_atomic_receipts.sql](../../../supabase/migrations/20261006040000_narrative_extraction_atomic_receipts.sql) | Falta public.narrative_extraction_receipts. Pendiente estructural según snapshot. Requiere append_video_composition_draft_document_v2 y tablas de documentos/drafts; aplicación sujeta a integración del flujo de extracción. |
| [20261006150000_narrative_fragment_atomic_receipts.sql](../../../supabase/migrations/20261006150000_narrative_fragment_atomic_receipts.sql) | Falta public.narrative_fragment_receipts. Pendiente estructural según snapshot. Requiere guards 20261006100000–20261006140000 y append-v2. |
| [20260723170000_create_render_worker_job_recovery_states.sql](../../../supabase/migrations/20260723170000_create_render_worker_job_recovery_states.sql) | Ausencia histórica adicional: public.render_worker_job_recovery_states. El backend aún la consulta en apps/web/src/lib/server/desktop-worker-control-plane.ts. Requiere render_workers y organizations, presentes. El SQL no habilita RLS ni define permisos; evaluar acceso tenant antes de incorporarlo. |
| [20260611144100_create_user_google_credentials.sql](../../../supabase/migrations/20260611144100_create_user_google_credentials.sql) | Ausencia histórica de tabla legacy. Existe user_cloud_storage_credentials y la migración del 12/jun contempla migrar Google opcionalmente. No reinstalar automáticamente la tabla antigua: verificar si se retiró deliberadamente y confirmar consumidores activos. |

### Columnas ausentes constatadas (orden por versión)

| Migración | Commit | Campos ausentes en tablas existentes |
|---|---|---|
| [20260905100000_harden_sound_effect_asset_integrity.sql](../../../supabase/migrations/20260905100000_harden_sound_effect_asset_integrity.sql) | d1107f8d | video_composition_sound_effect_assets.source_storage_bucket |
| [20260910120000_durable_scorm_import_jobs.sql](../../../supabase/migrations/20260910120000_durable_scorm_import_jobs.sql) | 05287141 | scorm_imports.processing_attempt, scorm_imports.processing_started_at, scorm_imports.processing_heartbeat_at, scorm_imports.lease_expires_at, scorm_imports.updated_at |
| [20260910140000_add_operational_correlation_ids.sql](../../../supabase/migrations/20260910140000_add_operational_correlation_ids.sql) | 05287141 | scorm_imports.correlation_id, publication_requests.correlation_id |
| [20260919120000_harden_organization_fonts_for_video.sql](../../../supabase/migrations/20260919120000_harden_organization_fonts_for_video.sql) | 3389c706 | organization_slide_fonts.checksum_sha256, organization_slide_fonts.file_size_bytes, organization_slide_fonts.mime_type, organization_slide_fonts.status, organization_slide_fonts.storage_bucket |

Las cuatro migraciones de septiembre con columnas ausentes deben resolverse antes de habilitar código que las consume. El endurecimiento SFX valida FKs compuestas y hace backfill antes de exigir NOT NULL; comprobar registros sin activo fuente del mismo tenant. El endurecimiento de fuentes añade checksum/status/storage_bucket consumidos por los guards HTML y de fragmentos: es un prerrequisito real del bloque de octubre, y deja archivos subidos sin checksum en LEGACY hasta verificarlos.

### Las siete migraciones del último commit 2fdef765

| Orden del archivo | Resultado |
|---|---|
| [20261008100000_html_editing_legacy_adoption.sql](../../../supabase/migrations/20261008100000_html_editing_legacy_adoption.sql) | NO DETERMINABLE con BD.sql; PREPARED ONLY |
| [20261008190000_bind_selected_event_measurements.sql](../../../supabase/migrations/20261008190000_bind_selected_event_measurements.sql) | NO DETERMINABLE con BD.sql; PREPARED ONLY |
| [20261008200000_support_silent_conformance_reports.sql](../../../supabase/migrations/20261008200000_support_silent_conformance_reports.sql) | NO DETERMINABLE con BD.sql; PREPARED ONLY |
| [20261008210000_reserve_conformance_render_inputs.sql](../../../supabase/migrations/20261008210000_reserve_conformance_render_inputs.sql) | NO DETERMINABLE con BD.sql; PREPARED ONLY |
| [20261008220000_defer_conformance_render_reservations.sql](../../../supabase/migrations/20261008220000_defer_conformance_render_reservations.sql) | NO DETERMINABLE con BD.sql; PREPARED ONLY |
| [20261009010000_provided_syllabus_imports.sql](../../../supabase/migrations/20261009010000_provided_syllabus_imports.sql) | ESTRUCTURA PUBLIC PRESENTE; RPC/triggers/RLS por verificar |
| [20261009090000_fix_voice_audio_processing_compatibility.sql](../../../supabase/migrations/20261009090000_fix_voice_audio_processing_compatibility.sql) | COLUMNA PRESENTE; RPC/MIME por verificar |

El temario **ya está reflejado estructuralmente**: tres tablas nuevas, syllabus.input_mode/content_version/active_import_id y syllabus_content_version en instructional_plans, curation, materials y publication_requests. No repetir 20261009010000: usa CREATE TABLE/FUNCTION y ADD CONSTRAINT sin protección integral contra repetición. Falta confirmar transition_syllabus_import, diez triggers, índices, constraints compuestas y permisos.

La migración de audio **también tiene evidencia parcial**: audio_processing_attempts ya existe, pero eso no demuestra el RPC actualizado ni los MIME de buckets. Verificar que complete_audio_processing_job guarde duration_milliseconds y que claim_audio_processing_jobs_by_profile incremente audio_processing_attempts. Puede reaplicarse técnicamente por CREATE OR REPLACE/ADD COLUMN IF NOT EXISTS y unión de MIME, si se confirma necesidad y compatibilidad.

La documentación local de temario describe una migración aún pendiente, mientras el BD.sql modificado ya contiene su estructura. Son evidencias de momentos distintos o una actualización manual; el catálogo e historial del ambiente objetivo deben resolverlo.

## 3. Plan de implementación y orden

1. Ejecutar verificar-migraciones.sql en el ambiente objetivo y consultar el historial si existe. Inventariar public, private y storage. Si figura una migración aplicada pero falta su objeto, tratarlo como drift; no marcar ni repetir versiones a ciegas.
2. Conciliar primero las ausencias públicas, en orden conservador: 20260723170000 recovery (revisar seguridad) → 20260905100000 SFX → 20260910120000 SCORM → 20260910140000 correlación → 20260919120000 fuentes → 20260920020000 HeyGen. Son módulos independientes salvo sus prerrequisitos explícitos; pueden planificarse por despliegue funcional. Para HeyGen verificar primero 20260919140000 → 20260920004500 → 20260920011500. No repetir prerrequisitos aplicados. Google legacy requiere decisión de compatibilidad, no es parte del bloque reciente.
3. Para el bloque de producción visual, aplicar únicamente los archivos comprobados pendientes en el orden de la siguiente tabla. Es un orden lineal conservador; no significa que todas las filas estén pendientes, ni que todas dependan inmediatamente de la fila anterior. El temario y el ajuste de audio son flujos independientes del bloque HTML/render.
4. Mantener las funciones nuevas deshabilitadas en UI/host cuando los archivos requieren opt-in o revisión. Migrar y habilitar funcionalidades son operaciones distintas.

### Orden completo del bloque reciente

| Posición | Migración | Commit | Estado según snapshot |
|---:|---|---|---|
| 1 | [20260929120000_record_hyperframes_final_video_checksum.sql](../../../supabase/migrations/20260929120000_record_hyperframes_final_video_checksum.sql) | 7e16e8c3 | NO DETERMINABLE con BD.sql |
| 2 | [20260930120000_queue_hyperframes_video_integrity.sql](../../../supabase/migrations/20260930120000_queue_hyperframes_video_integrity.sql) | 7e16e8c3 | NO DETERMINABLE con BD.sql |
| 3 | [20260930130000_persist_visual_conformance_evidence.sql](../../../supabase/migrations/20260930130000_persist_visual_conformance_evidence.sql) | 7e16e8c3 | NO DETERMINABLE con BD.sql |
| 4 | [20260930140000_read_visual_conformance_evidence.sql](../../../supabase/migrations/20260930140000_read_visual_conformance_evidence.sql) | 7e16e8c3 | NO DETERMINABLE con BD.sql |
| 5 | [20260930150000_persist_audio_conformance_evidence.sql](../../../supabase/migrations/20260930150000_persist_audio_conformance_evidence.sql) | 7e16e8c3 | NO DETERMINABLE con BD.sql |
| 6 | [20260930160000_queue_full_conformance_reports.sql](../../../supabase/migrations/20260930160000_queue_full_conformance_reports.sql) | 7e16e8c3 | NO DETERMINABLE con BD.sql |
| 7 | [20261001120000_extend_chunked_audio_evidence.sql](../../../supabase/migrations/20261001120000_extend_chunked_audio_evidence.sql) | 7e16e8c3 | NO DETERMINABLE con BD.sql |
| 8 | [20261001130000_persist_playback_audio_evidence.sql](../../../supabase/migrations/20261001130000_persist_playback_audio_evidence.sql) | 7e16e8c3 | NO DETERMINABLE con BD.sql |
| 9 | [20261001140000_persist_event_visual_conformance_evidence.sql](../../../supabase/migrations/20261001140000_persist_event_visual_conformance_evidence.sql) | 7e16e8c3 | NO DETERMINABLE con BD.sql |
| 10 | [20261001150000_persist_event_batch_measurements.sql](../../../supabase/migrations/20261001150000_persist_event_batch_measurements.sql) | 7e16e8c3 | NO DETERMINABLE con BD.sql |
| 11 | [20261001160000_bind_event_summary_to_job_finalization.sql](../../../supabase/migrations/20261001160000_bind_event_summary_to_job_finalization.sql) | 96a191b9 | NO DETERMINABLE con BD.sql |
| 12 | [20261002160000_bind_controlled_execution_summary.sql](../../../supabase/migrations/20261002160000_bind_controlled_execution_summary.sql) | 96a191b9 | NO DETERMINABLE con BD.sql |
| 13 | [20261003160000_bind_conformance_report_attempt.sql](../../../supabase/migrations/20261003160000_bind_conformance_report_attempt.sql) | 96a191b9 | NO DETERMINABLE con BD.sql |
| 14 | [20261003170000_composition_render_execution_authority.sql](../../../supabase/migrations/20261003170000_composition_render_execution_authority.sql) | 96a191b9 | NO DETERMINABLE con BD.sql |
| 15 | [20261004160000_recover_consumed_render_execution.sql](../../../supabase/migrations/20261004160000_recover_consumed_render_execution.sql) | 96a191b9 | NO DETERMINABLE con BD.sql |
| 16 | [20261004170000_finalize_controlled_composition_render.sql](../../../supabase/migrations/20261004170000_finalize_controlled_composition_render.sql) | 96a191b9 | NO DETERMINABLE con BD.sql |
| 17 | [20261005160000_controlled_render_upload_sessions.sql](../../../supabase/migrations/20261005160000_controlled_render_upload_sessions.sql) | 96a191b9 | NO DETERMINABLE con BD.sql |
| 18 | [20261005170000_check_controlled_render_video_authority.sql](../../../supabase/migrations/20261005170000_check_controlled_render_video_authority.sql) | 96a191b9 | NO DETERMINABLE con BD.sql |
| 19 | [20261005180000_controlled_render_worker_queue.sql](../../../supabase/migrations/20261005180000_controlled_render_worker_queue.sql) | 96a191b9 | NO DETERMINABLE con BD.sql |
| 20 | [20261005190000_controlled_render_worker_fences.sql](../../../supabase/migrations/20261005190000_controlled_render_worker_fences.sql) | 96a191b9 | NO DETERMINABLE con BD.sql |
| 21 | [20261005200000_html_editing_revision_store.sql](../../../supabase/migrations/20261005200000_html_editing_revision_store.sql) | 96a191b9 | NO DETERMINABLE con BD.sql |
| 22 | [20261005210000_append_html_editing_native_document.sql](../../../supabase/migrations/20261005210000_append_html_editing_native_document.sql) | 96a191b9 | NO DETERMINABLE con BD.sql |
| 23 | [20261005220000_read_exact_html_editing_compilation.sql](../../../supabase/migrations/20261005220000_read_exact_html_editing_compilation.sql) | 96a191b9 | NO DETERMINABLE con BD.sql |
| 24 | [20261005230000_controlled_html_editing_authority.sql](../../../supabase/migrations/20261005230000_controlled_html_editing_authority.sql) | 96a191b9 | NO DETERMINABLE con BD.sql |
| 25 | [20261006000000_html_snapshot_resource_validation.sql](../../../supabase/migrations/20261006000000_html_snapshot_resource_validation.sql) | 96a191b9 | NO DETERMINABLE con BD.sql |
| 26 | [20261006010000_commit_html_editing_snapshot.sql](../../../supabase/migrations/20261006010000_commit_html_editing_snapshot.sql) | 96a191b9 | NO DETERMINABLE con BD.sql |
| 27 | [20261006020000_read_html_snapshot_operation.sql](../../../supabase/migrations/20261006020000_read_html_snapshot_operation.sql) | 96a191b9 | NO DETERMINABLE con BD.sql |
| 28 | [20261006030000_html_snapshot_durable_intents.sql](../../../supabase/migrations/20261006030000_html_snapshot_durable_intents.sql) | 96a191b9 | NO DETERMINABLE con BD.sql |
| 29 | [20261006040000_narrative_extraction_atomic_receipts.sql](../../../supabase/migrations/20261006040000_narrative_extraction_atomic_receipts.sql) | 96a191b9 | AUSENCIA en public: public.narrative_extraction_receipts |
| 30 | [20261006050000_html_editing_bootstrap_registration.sql](../../../supabase/migrations/20261006050000_html_editing_bootstrap_registration.sql) | 96a191b9 | NO DETERMINABLE con BD.sql |
| 31 | [20261006060000_read_html_editing_bootstrap_context.sql](../../../supabase/migrations/20261006060000_read_html_editing_bootstrap_context.sql) | 96a191b9 | NO DETERMINABLE con BD.sql |
| 32 | [20261006070000_read_html_editing_restore_revision.sql](../../../supabase/migrations/20261006070000_read_html_editing_restore_revision.sql) | 96a191b9 | NO DETERMINABLE con BD.sql |
| 33 | [20261006080000_html_editing_operation_receipts.sql](../../../supabase/migrations/20261006080000_html_editing_operation_receipts.sql) | 96a191b9 | NO DETERMINABLE con BD.sql |
| 34 | [20261006090000_html_editing_initialization_receipts.sql](../../../supabase/migrations/20261006090000_html_editing_initialization_receipts.sql) | 96a191b9 | NO DETERMINABLE con BD.sql |
| 35 | [20261006100000_narrative_fragment_resource_guards.sql](../../../supabase/migrations/20261006100000_narrative_fragment_resource_guards.sql) | 96a191b9 | NO DETERMINABLE con BD.sql |
| 36 | [20261006110000_narrative_fragment_caption_guard.sql](../../../supabase/migrations/20261006110000_narrative_fragment_caption_guard.sql) | 96a191b9 | NO DETERMINABLE con BD.sql |
| 37 | [20261006120000_narrative_fragment_clip_guard.sql](../../../supabase/migrations/20261006120000_narrative_fragment_clip_guard.sql) | 96a191b9 | NO DETERMINABLE con BD.sql |
| 38 | [20261006130000_narrative_fragment_selection_guard.sql](../../../supabase/migrations/20261006130000_narrative_fragment_selection_guard.sql) | 96a191b9 | NO DETERMINABLE con BD.sql |
| 39 | [20261006140000_narrative_fragment_document_delta.sql](../../../supabase/migrations/20261006140000_narrative_fragment_document_delta.sql) | 96a191b9 | NO DETERMINABLE con BD.sql |
| 40 | [20261006150000_narrative_fragment_atomic_receipts.sql](../../../supabase/migrations/20261006150000_narrative_fragment_atomic_receipts.sql) | 96a191b9 | AUSENCIA en public: public.narrative_fragment_receipts |
| 41 | [20261008100000_html_editing_legacy_adoption.sql](../../../supabase/migrations/20261008100000_html_editing_legacy_adoption.sql) | 2fdef765 | NO DETERMINABLE con BD.sql |
| 42 | [20261008190000_bind_selected_event_measurements.sql](../../../supabase/migrations/20261008190000_bind_selected_event_measurements.sql) | 2fdef765 | NO DETERMINABLE con BD.sql |
| 43 | [20261008200000_support_silent_conformance_reports.sql](../../../supabase/migrations/20261008200000_support_silent_conformance_reports.sql) | 2fdef765 | NO DETERMINABLE con BD.sql |
| 44 | [20261008210000_reserve_conformance_render_inputs.sql](../../../supabase/migrations/20261008210000_reserve_conformance_render_inputs.sql) | 2fdef765 | NO DETERMINABLE con BD.sql |
| 45 | [20261008220000_defer_conformance_render_reservations.sql](../../../supabase/migrations/20261008220000_defer_conformance_render_reservations.sql) | 2fdef765 | NO DETERMINABLE con BD.sql |
| 46 | [20261009010000_provided_syllabus_imports.sql](../../../supabase/migrations/20261009010000_provided_syllabus_imports.sql) | 2fdef765 | ESTRUCTURA PUBLIC PRESENTE; RPC/triggers/RLS por verificar |
| 47 | [20261009090000_fix_voice_audio_processing_compatibility.sql](../../../supabase/migrations/20261009090000_fix_voice_audio_processing_compatibility.sql) | 2fdef765 | COLUMNA PRESENTE; RPC/MIME por verificar |

### Dependencias que impiden saltar directamente al último commit

- Integridad: 20260929120000 → 20260930120000. La cola usa el RPC de checksum.
- Evidencias y conformidad: 20260930130000 → 20260930140000; 20260930150000 → extensiones 20261001120000/130000; 20260930160000 crea la cola/finisher base. Eventos: 20261001140000/150000 → 20261001160000 → 20261002160000 → 20261003160000. Los wrappers preservan gates anteriores.
- Autoridad de render: 20261003170000 → 20261004160000/170000 → 20261005160000/170000 → 20261005180000 → 20261005190000. Fences traslada funciones originales a private y crea firmas con lease de worker; una repetición puede colisionar.
- HTML: 20261005200000 → 20261005210000 → 20261005220000 → 20261005230000 → 20261006000000 → 20261006010000 → 20261006020000/030000. Bootstrap: 20261006050000 → 06060000 → 06070000; receipts de operaciones/inicialización: 06080000/06090000.
- Extracción de voz: 20261006040000 requiere public.append_video_composition_draft_document_v2 de 20260815010000 y el modelo de documentos/drafts existente. No requiere aplicar todo el bloque privado de HTML para crear receipts.
- Fragmentos: 20261006100000, 06110000, 06120000, 06130000 → 06140000 → 06150000; además append-v2 y 20260919120000 para columnas de fuentes. Guards de recursos validan activos, fuentes y tenants.
- Adopción legacy: 20261008100000 requiere store/actor/autoridad/bootstrap HTML y append-v2; no se resuelve aplicando sólo esta migración.
- Referencias seleccionadas: 20261008190000 requiere RPCs/tabla de event batch y private.verify_hyperframes_event_summary de 20261001160000. Parcha una definición exacta con pg_get_functiondef.
- Silencio: 20261008200000 parcha private.finish_hyperframes_conformance_job_before_events, creado al mover el finisher base en 20261001160000. Aborta si la definición instalada no contiene los fragmentos esperados.
- Reservas: 20261008210000 requiere private.hyperframes_conformance_jobs y private.composition_render_executions; envuelve el finisher público existente. 20261008220000 requiere la reserva/RPC anterior y añade outbox/trigger. Aplicarlas tras validar host y workers compatibles.
- Temario: 20261009010000 requiere los campos upstream_dirty de fases dependientes; están reflejados en BD.sql. No depende de las cinco migraciones visuales del 8/oct.
- Audio: 20261009090000 requiere leases de 20260921120000 y duration_milliseconds de 20260817120000. La ruta por perfil viene de 20260922120000; el archivo de octubre reemplaza ese RPC. Estos campos base están presentes.

## 4. Implementación propuesta

Se entregan este informe, verificar-migraciones.sql (consultas de catálogo en transacción READ ONLY) e inventario.json (objetos esperados, commit y evidencia estructural). No se alteraron BD.sql, migraciones ni código existente. No se propone un SQL concatenado para ejecutar indiscriminadamente: podría repetir tablas/funciones ya instaladas o activar gates incompatibles con workers activos.

## 5. Riesgos y validaciones

- Confirmar que BD.sql corresponde al ambiente objetivo y representa todas sus tablas públicas. Las ausencias sólo son definitivas respecto al archivo.
- Revisar firmas, cuerpos, search_path y EXECUTE de RPCs, no sólo proname. Los objetos compartidos cambian entre versiones: su presencia no acredita la última migración.
- Validar las funciones SECURITY DEFINER con tenant cruzado, actor sin permisos, lease vencido/reutilizado, CAS concurrente e idempotencia. No dar EXECUTE a anon/authenticated en RPCs reservados a service_role.
- Temario: confirmar diez triggers activos, quotas, fidelidad, invalidación, control de versión y FKs compuestas. BD.sql representa algunas FKs compuestas como constraints duplicadas; esto es una limitación del export contextual, no prueba de una FK rota en PostgreSQL.
- Audio: MIME M4A/AAC/JSON, duración precisa, preservación de acceso público/privado y retry/lease. Los UPDATE de buckets pueden afectar cero filas si los buckets faltan; verificar existencia explícitamente.
- HeyGen: conservar decisiones de archivado, distinguir disponibilidad remota de visibilidad local y revisar backfill de ownership nulo antes de ejecución.
- Algunas migraciones de conformidad no contienen BEGIN/COMMIT y modifican funciones por texto. Ejecutarlas mediante un runner transaccional, con parada/coordinación de workers cuando lo exige el archivo, y evitar estados parciales.
- Rollback: guardar definiciones anteriores antes de sustituciones/SET SCHEMA; deshabilitar escrituras nuevas y conservar receipts/evidencias. No eliminar historial para regresar versión.
- Validación realizada: lectura de los 185 SQL versionados, cotejo de tablas y columnas públicas añadidas por ALTER TABLE public, historial Git y node scripts/check-migration-versions.mjs aprobado (186 archivos SQL; colisiones históricas congeladas). No se ejecutó SQL en PostgreSQL real ni pruebas de carga, integración/RLS del ambiente o migraciones. Los tests PGlite/evidencias que ya existen en el repo acreditan escenarios aislados, no aplicación en Supabase.

## 6. Mejoras adicionales recomendadas

Obligatorio antes de ejecutar: completar el inventario del ambiente, reconciliar historial/objetos y verificar compatibilidad de host/workers para los gates PREPARED ONLY.

Deseable: mantener un dump de esquema reproducible que incluya private, functions, triggers, RLS y grants; separar snapshots contextuales de migraciones ejecutables. Existen colisiones históricas de versión (20240117, 20260721120000, 20260825120000, 20260826120000) toleradas por el guard; no usar un db push global ni renumerarlas sin conciliar schema_migrations de cada ambiente.
