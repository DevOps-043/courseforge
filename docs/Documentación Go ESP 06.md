Documento técnico de integración — Paso 6 (GO-Op-06) “Slides en Gamma + Export PNG”
1) Propósito

Transformar insumos textuales (guion + storyboard validados por video) en un soporte visual estructurado: slides completas en Gamma, listas para producción de video. 

SOP´s - Guías operativas V1

2) Alcance: Start / End (condiciones duras)

Start conditions (todas):

Plan instruccional (Fase 1) validado.

Curaduría de fuentes (Fase 2) completa y registrada.

Por cada lección/video existe guion final + storyboard asociado. 

SOP´s - Guías operativas V1

End conditions (todas):

Cada lección/video del módulo tiene su deck creado (1 por video).

Slides revisadas vs guion + storyboard y cumplen DoD.

Slides exportadas a PNG y organizadas.

Tramo marcado “Completo” en Coda. 

SOP´s - Guías operativas V1

3) Inputs / Outputs (contrato de datos)
Inputs mínimos (por video)

script_final (texto) — guion validado por video.

SOP´s - Guías operativas V1

SOP´s - Guías operativas V1

storyboard (texto estructurado) — textos literales + notas por toma/slide.

SOP´s - Guías operativas V1

master_matrix_ref — lista oficial de lecciones del módulo.

SOP´s - Guías operativas V1

course_branding — tipografías + paleta del curso (tema/branding).

SOP´s - Guías operativas V1

Outputs mínimos (por video)

gamma_deck (URL/ID + metadata) — deck en Gamma nombrado por convención.

png_export_path — ruta/carpeta final de PNG.

tracking_record — registro en Coda con links/estado/observaciones. 

SOP´s - Guías operativas V1

4) Reglas duras (DoD + naming + configuración)
4.1 Naming (obligatorio)

Un deck por video.

Nombre del deck: Tn – Mn – Vn (ej: T1 – M1 – V1).

SOP´s - Guías operativas V1

4.2 Configuración obligatoria en Gamma (antes de generar)

Idioma: español latinoamericano.

Estilo: texto mínimo (títulos claros + bullets cortos).

Imágenes: DESACTIVADAS (“sin imágenes”).

No usar párrafos extensos (la narración vive en el guion, no en slides).

SOP´s - Guías operativas V1

SOP´s - Guías operativas V1

4.3 Checklist DoD (mínimo automatizable + HITL)

Debe cumplirse:

Cobertura completa: todo video tiene su deck (1:1).

SOP´s - Guías operativas V1

Alineación guion–storyboard–slides (orden, coherencia, sin segmentos faltantes).

SOP´s - Guías operativas V1

Uso correcto de Gamma: texto mínimo, idioma correcto, sin imágenes.

SOP´s - Guías operativas V1

Consistencia visual (paleta/tipografías; formato consistente).

SOP´s - Guías operativas V1

Preparación para producción: export PNG + organización en carpetas + trazabilidad en Coda.

SOP´s - Guías operativas V1

5) Roles / HITL

Operador/a de slides: configura Gamma, carga insumos, genera/ajusta slides, exporta PNG, actualiza tracking en Coda. 

SOP´s - Guías operativas V1

QA/Coordinación: verifica coherencia guion–storyboard–slides, asegura DoD, registra observaciones y aprueba. 

SOP´s - Guías operativas V1

Escalamiento: responsable de guion/storyboard si el storyboard está incompleto o el guion es confuso (no se “corrige” desde slides).

SOP´s - Guías operativas V1

SOP´s - Guías operativas V1

6) Flujo operativo integrable (lo que tu sistema debe orquestar)
A) Preparación del módulo (una vez por módulo)

Abrir insumos en Coda; confirmar matriz + guiones + storyboards. 

SOP´s - Guías operativas V1

Inicializar tracking en Coda (tabla/lista por video con campos obligatorios). 

SOP´s - Guías operativas V1

Crear carpeta del curso en Gamma (centraliza assets). 

SOP´s - Guías operativas V1

Registrar modalidad operativa (A por video / B por módulo y luego segmentar). 

SOP´s - Guías operativas V1

B) Producción por video (loop)

Seleccionar video pendiente desde Coda.

Crear deck en Gamma y nombrar Tn–Mn–Vn.

SOP´s - Guías operativas V1

Revisar guion + storyboard para extraer texto literal en pantalla y orden. 

SOP´s - Guías operativas V1

Generar/ajustar slides hasta cumplir DoD.

Exportar PNG y guardar ruta en Coda.

En QA: aprobar o rechazar con observaciones; si rechaza, re-trabajo y reexport. 

SOP´s - Guías operativas V1

7) Errores típicos + acciones (para validaciones y retries)

Orden incorrecto vs storyboard → reordenar; si storyboard incompleto, escalar. 

SOP´s - Guías operativas V1

Aparecen imágenes → corregir “sin imágenes” y regenerar/limpiar slides afectadas. 

SOP´s - Guías operativas V1

Texto cambia el sentido del guion → comparar linealmente guion vs slides y corregir; si guion confuso, escalar (no arreglar desde slides).

SOP´s - Guías operativas V1

Errores de idioma/registro → corregir a español LATAM; ajustar prompt/config si se repite. 

SOP´s - Guías operativas V1

8) Especificación implementable (YAML)
step_id: GO-OP-06
name: "Slides en Gamma + Export PNG (1 deck por video)"
start_conditions:
  - "Fase 1 validada (plan instruccional)"
  - "Fase 2 completa (fuentes curadas registradas)"
  - "Por cada video existe guion final + storyboard"
end_conditions:
  - "Deck creado por video (1:1) y nombrado Tn–Mn–Vn"
  - "DoD de slides aprobado"
  - "PNG exportado y organizado"
  - "Tramo marcado Completo en Coda"

inputs:
  - { name: course_id, type: string, required: true }
  - { name: module_id, type: string, required: true }
  - { name: video_id, type: string, required: true }
  - { name: tn_mn_vn, type: string, required: true, description: "Ej: T1-M1-V1" }
  - { name: script_final, type: "text/markdown", required: true }
  - { name: storyboard, type: "text/markdown|json", required: true }
  - { name: branding, type: "json", required: true, fields: [palette, fonts, theme_name] }
  - { name: execution_mode, type: enum, required: true, values: ["PER_VIDEO", "PER_MODULE_THEN_SPLIT"] }

outputs:
  - { name: gamma_deck, type: json, fields: [deck_id, deck_url, deck_title, gamma_folder_id] }
  - { name: png_export, type: json, fields: [export_path, file_count, resolution, exported_at] }
  - { name: coda_tracking_row, type: json, fields: [row_id, status, qa_status, notes] }
  - { name: validation_report, type: json }

validations:
  - rule: "deck_title must match ^T\\d+\\s?-\\s?M\\d+\\s?-\\s?V\\d+$"
    severity: error
    message: "Nombre de deck inválido. Debe ser Tn–Mn–Vn."
  - rule: "gamma_config.language == 'es-LATAM'"
    severity: error
    message: "Gamma debe estar en español latinoamericano."
  - rule: "gamma_config.images == 'OFF'"
    severity: error
    message: "Imágenes deben estar desactivadas (sin imágenes)."
  - rule: "dod.coverage_complete == true"
    severity: error
    message: "Falta deck para algún video del módulo."
  - rule: "dod.script_storyboard_alignment == true"
    severity: error
    message: "No hay alineación guion–storyboard–slides."
  - rule: "png_export.export_path not empty"
    severity: error
    message: "No hay ruta de export PNG registrada."

states:
  - { name: PENDING, description: "Video listo para producción de slides" }
  - { name: IN_PROGRESS, description: "Deck en creación/edición" }
  - { name: DECK_READY, description: "Deck cumple DoD interno (pre-QA)" }
  - { name: EXPORTED, description: "PNG exportado y registrado" }
  - { name: QA_REVIEW, description: "En revisión de QA" }
  - { name: QA_APPROVED, description: "Aprobado por QA" }
  - { name: QA_REJECTED, description: "Requiere corrección y re-export" }
  - { name: COMPLETED, description: "Tramo completado en Coda" }

escalation_policy:
  max_iterations: 2
  escalate_to: ["Responsable de guion/storyboard", "Coordinación"]
  escalate_on:
    - "storyboard_incomplete"
    - "meaning_conflict_script_vs_slides"
    - "persistent_config_errors"

audit_log_fields:
  - course_id
  - module_id
  - video_id
  - tn_mn_vn
  - gamma_deck_url
  - gamma_deck_id
  - gamma_config_snapshot
  - export_path
  - qa_decision
  - qa_notes
  - operator_user_id
  - timestamps: [started_at, exported_at, qa_reviewed_at, completed_at]

9) Contrato de integración con tu app (Next.js/Supabase)

Basado en tu documentación de desarrollo, lo más limpio es tratar “Paso 6” como un nuevo tipo de artifact dentro del dominio artifacts + su flujo de QA + pipeline_events.

DOCUMENTACION_DESARROLLO

DOCUMENTACION_DESARROLLO

Entidades sugeridas

artifact_type = "slides_deck"

artifact_payload (JSON):

tn_mn_vn

gamma_deck_url, gamma_deck_id, gamma_folder_id

png_export_path, file_count

dod_checklist (booleans + notes)

qa_status, qa_notes

Eventos sugeridos (pipeline_events)

GO-OP-06_STARTED

GO-OP-06_DECK_CREATED

GO-OP-06_CONFIG_VALIDATED

GO-OP-06_EXPORTED_PNG

GO-OP-06_QA_APPROVED / GO-OP-06_QA_REJECTED

GO-OP-06_COMPLETED

10) OPEN_QUESTION (decisiones de producto necesarias)

¿Gamma será automatizado vía API o RPA (browser automation)?

Opción A: RPA (Playwright) + “config snapshot” verificado antes de generar.

Opción B: HITL obligado (operador confirma config) y el sistema solo trackea + valida DoD.
Impacto: define qué validaciones pueden ser “hard-blocking” vs “checklist humano”.

Estandar de export PNG (resolución, naming de archivos y estructura de carpetas) no está 100% especificado en los fragmentos visibles.
Impacto: sin esto, es difícil validar “organización correcta” automáticamente (solo se valida que exista export_path).

11) Suite de pruebas (Given / When / Then)

Happy path

Dado guion+storyboard válidos, cuando se crea deck con T1-M1-V1, entonces el sistema registra deck_url, corre DoD, exporta PNG, pasa QA y marca COMPLETED.

Casos límite

Dado gamma_config.images=ON, cuando intenta generar, entonces bloquear con error “sin imágenes”.

Dado storyboard incompleto, cuando DoD falla por “segmentos faltantes”, entonces estado QA_REJECTED + escalate_to responsable.

Dado deck creado pero sin png_export_path, cuando intenta cerrar tramo, entonces bloquear cierre (no COMPLETED).

Dado QA por módulo, cuando QA aprueba, entonces set QA_APPROVED en lote/módulo y “COMPLETED” al final. (Tu sistema debe soportar ambas modalidades).

SOP´s - Guías operativas