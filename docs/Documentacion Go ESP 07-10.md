Documento de integración — Pasos 7 a 10 (Manual en plataforma: guía + tracking + evidencias)
1) Propósito

Implementar en la plataforma un módulo de “Producción (Manual)” que permita:

Ver instrucciones operativas por lección/video para los tramos 7–10.

Gestionar checklists por DoD y estados (pendiente / en progreso / QA / aprobado / bloqueado).

Capturar evidencias (links Drive/HeyGen, notas, responsables, timestamps).

Mantener trazabilidad (audit log) para handoff entre Operador ↔ QA ↔ Arquitecto/Owner.

No genera clips ni edita videos: solo orquesta y registra.

2) Alcance
Entra

Curso + módulo + lección/video (Tn/Mn/Vn) ya existentes en el sistema (por pasos previos).

Insumos ya producidos hasta Tramo 1/2/3/4 cuando aplique (guion, storyboard, slides PNG, etc.).

Sale

Registro por lección/video de:

estado por tramo (7/8/9/10)

evidencias (URLs + ruta Drive)

aprobación QA o “bloqueado con escalamiento”

notas y decisiones (p. ej. avatar/voz, cambios tardíos)

3) Reglas duras (DoD + naming + validaciones)
3.1. Estados mínimos por tarea manual

NOT_STARTED → IN_PROGRESS → READY_FOR_QA → APPROVED
Ramas: BLOCKED (con razón + escalamiento), REWORK (si QA devuelve).

3.2. Naming que sí está definido en SOP

Screencast (GO-Op-08): exportar MP4 y nombrar/organizar/registrar para handoff

SOP´s - Guías operativas V1

.

Naming exacto para MP4 no aparece completo en el snippet recuperado del SOP; si en tu PDF está más abajo, extraeremos esa sección y lo convertimos a regex. Por ahora: guardar el naming como “policy configurable”.

HeyGen (GO-Op-09): nombre del proyecto debe ser:
Tn - Mn - Vn - {Título del video} (siempre con Mn)

SOP´s - Guías operativas V1


Render obligatorio: 25 fps, 1080p, sin marca de agua

SOP´s - Guías operativas V1

Postproducción (GO-Op-10): objetivo + cierre: exportar estandarizado y revisar errores evidentes, consolidar en carpeta final y handoff

SOP´s - Guías operativas V1

3.3. Validaciones que puede hacer la plataforma (automáticas)

Si task.step_id == GO-Op-09:

validar que heygen_project_name contenga Tn, Mn, Vn (string includes) y que esté completo. 

SOP´s - Guías operativas V1

validar que render_profile.fps == 25 y render_profile.resolution == 1080p y watermark == false. 

SOP´s - Guías operativas V1

Si task.step_id == GO-Op-10:

no permitir “APPROVED” sin evidencia de carpeta final Drive + QA checklist final marcado. 

SOP´s - Guías operativas V1

Para cualquier paso:

no permitir “READY_FOR_QA” si faltan evidencias obligatorias definidas por template.

si BLOCKED, exigir blocked_reason + escalated_to_role.

4) Roles / HITL

Basado en SOP:

GO-Op-08 (Screencast): Operador/a Screencast + QA/Coordinación (aprueba o bloquea)

SOP´s - Guías operativas V1

GO-Op-09 (HeyGen): Operador integra; Arquitecto define/aprueba avatar y voz

SOP´s - Guías operativas V1

GO-Op-10 (Postproducción): Editor ejecuta; QA básico revisa final; líder de contenido resuelve dudas conceptuales

SOP´s - Guías operativas V1

En plataforma:

Permisos por rol (ya tienes user_roles)

DOCUMENTACION_DESARROLLO

:

OPERATOR_PROD

QA_PROD

ARCHITECT

CONTENT_OWNER (si aplica)

5) Diseño implementable (DB + tipos + APIs)
5.1. Tablas nuevas (Supabase)

Tu doc de desarrollo ya contempla pipeline_events y roles; agregamos tablas para tareas manuales.

DOCUMENTACION_DESARROLLO

Tabla: production_tasks

id (uuid)

course_id (uuid)

module_id (uuid, nullable si no existe aún como entidad)

lesson_id (uuid) o video_id (uuid) — según tu modelo actual

step_id enum: GO-Op-07|08|09|10

state enum: NOT_STARTED|IN_PROGRESS|READY_FOR_QA|APPROVED|REWORK|BLOCKED

owner_user_id (uuid)

qa_user_id (uuid, nullable)

blocked_reason (text, nullable)

escalated_to_role (text, nullable)

checklist_json (jsonb) — respuestas checkbox + notas

metadata_json (jsonb) — p. ej. heygen_project_name, render_profile, etc.

created_at, updated_at

Tabla: production_evidence

id (uuid)

task_id (uuid fk)

type enum: DRIVE_FOLDER|DRIVE_FILE|HEYGEN_PROJECT|HEYGEN_RENDER|LINK|NOTE

url (text)

label (text)

captured_by (uuid)

captured_at (timestamp)

5.2. Audit log (reusar pipeline_events)

Registrar eventos cada vez que cambie estado/evidencias:

event_type: PROD_TASK_STATE_CHANGED, PROD_EVIDENCE_ADDED, PROD_QA_DECISION

payload: {task_id, from_state, to_state, step_id, course_id, ...}

6) UI/UX (mínimo viable)
Ruta sugerida

Sin romper tu estructura actual, agrega un tab en /artifacts/:id o una nueva ruta:

Opción A: (/dashboard)/artifacts/[id] → Tab “Producción (7–10)”

Opción B: nueva ruta (/dashboard)/production/[courseId]

Tu app ya usa rutas tipo /artifacts/:id y /qa

DOCUMENTACION_DESARROLLO

, así que el patrón encaja.

Componentes clave

ProductionChecklistPanel

selector de lección/video

acordeón por paso (7/8/9/10)

checklist + campos de evidencias

botón “Enviar a QA” (pasa a READY_FOR_QA)

ProductionQAQueue (similar a /qa)

filtra por state=READY_FOR_QA

QA aprueba (APPROVED) o devuelve (REWORK) o bloquea (BLOCKED)

7) Plantillas de checklist (por paso)
GO-Op-07 — Tramo 2: Clips narrativos (Flow/Veo3)

Base SOP (resumen): producir clips narrativos listos para alimentar screencast y/o producción posterior (Tramo 3 arranca cuando Tramo 2 está completo)

SOP´s - Guías operativas V1

.

Checklist sugerido (en plataforma)

 Guion/storyboard final disponible (link)

 Clips narrativos generados (link Drive carpeta “Narrativos”)

 QA revisó “utilizable” o marcado como bloqueado (nota + razón)

Evidencias obligatorias: DRIVE_FOLDER (carpeta), LINK (nota de versión del guion)

OPEN_QUESTION: el SOP no expone aquí el naming/format exacto de estos clips. Decide estándar (mp3/wav/mp4, bitrate, naming). (Impacto: validación automática y ordenamiento).

GO-Op-08 — Tramo 3: Screencast (Demo/Guía)

Propósito/DoD: grabar conforme al flujo del guion, recorte mínimo, exportar MP4, nombrar, organizar, registrar y obtener aprobación QA (o bloquear con escalamiento)

SOP´s - Guías operativas V1

.

Checklist sugerido

 Backlog oficial de demos/guías por lección/video (link)

 Grabación realizada (OBS o equivalente)

SOP´s - Guías operativas V1

 Recorte mínimo aplicado

 Exportado MP4

 Archivo nombrado según policy del curso (campo)

 Organizado en Drive (ruta)

 Registrado para handoff

Evidencias obligatorias: DRIVE_FILE (mp4), DRIVE_FOLDER (ruta), NOTE (observaciones)

GO-Op-09 — Tramo 4: Integración en HeyGen

Procedimiento base: proyecto HeyGen nombrado con Tn/Mn/Vn, integrar guion por escenas, storyboard, transiciones, slides PNG, B-roll, screencast, reglas de dinamismo de avatar, render 25fps 1080p sin watermark, validar y re-render si hay errores

SOP´s - Guías operativas V1

.

Checklist sugerido

 Proyecto HeyGen creado con nombre Tn - Mn - Vn - Título (campo + validación)

SOP´s - Guías operativas V1

 Guion pegado y estructurado por escenas

SOP´s - Guías operativas V1

 Slides PNG integradas

SOP´s - Guías operativas V1

 B-roll integrado

SOP´s - Guías operativas V1

 Screencast integrado (si aplica)

SOP´s - Guías operativas V1

 Avatar/voz definidos por Arquitecto y documentados

SOP´s - Guías operativas V1

 Render con perfil obligatorio: 25fps, 1080p, sin watermark

SOP´s - Guías operativas V1

 Validación post-render (sin errores evidentes) y re-render si aplica

SOP´s - Guías operativas V1

Evidencias obligatorias: HEYGEN_PROJECT (link), HEYGEN_RENDER (link), DRIVE_FOLDER (renderizados)

GO-Op-10 — Tramo 5: Postproducción (CapCut)

Objetivo: ajustes finales, exportación estandarizada, revisión final y consolidación para handoff a LMS

SOP´s - Guías operativas V1

.

Checklist sugerido

 Insumos listos: videos base renderizados y validados (Tramo 4 completo)

SOP´s - Guías operativas V1

 Edición final en CapCut (cortes mínimos, audio, overlays/branding si aplica)

SOP´s - Guías operativas V1

 Exportación estandarizada (perfil del lote)

 Revisión final: audio–imagen, typos, cortes, overlays/activos

SOP´s - Guías operativas V1

 Consolidado en carpeta final del curso + handoff a carga LMS

SOP´s - Guías operativas V1

 Tracking actualizado (mecanismo definido)

Evidencias obligatorias: DRIVE_FOLDER (final), DRIVE_FILE (mp4 final), NOTE (QA final)

8) Contrato de integración (Drive + Tracker)

El SOP exige evidencia en Drive + reflejo en un tracker; si tracker no existe, usar registro interino en Drive (CSV/XLSX)

SOP´s - Guías operativas V1

.

Reglas en plataforma

Campo obligatorio por tarea: drive_folder_url

Al “APPROVED” en GO-Op-09 y GO-Op-10:

exigir drive_folder_url + drive_file_url (o lista)

opcionalmente generar/exportar una fila para el registro interino

OPEN_QUESTION (del SOP, debe resolverse en producto)

Tracking oficial: ¿Coda o Linear y quién lo define?

SOP´s - Guías operativas V1

Exportación: ¿cuándo 720p vs 1080p?

SOP´s - Guías operativas V1

Política de cambio tardío de guion: versionado/re-QA

SOP´s - Guías operativas V1

9) Especificación implementable (YAML por pasos 7–10)
manual_production_module:
  name: "Producción (Pasos 7–10)"
  storage:
    tables: [production_tasks, production_evidence]
    audit_log: pipeline_events

  task_state_machine:
    states: [NOT_STARTED, IN_PROGRESS, READY_FOR_QA, APPROVED, REWORK, BLOCKED]
    transitions:
      - from: NOT_STARTED
        to: IN_PROGRESS
      - from: IN_PROGRESS
        to: READY_FOR_QA
        requires: [required_evidence_complete]
      - from: READY_FOR_QA
        to: APPROVED
        actor_role: QA_PROD
      - from: READY_FOR_QA
        to: REWORK
        actor_role: QA_PROD
      - from: [NOT_STARTED, IN_PROGRESS, READY_FOR_QA]
        to: BLOCKED
        requires: [blocked_reason, escalated_to_role]

  steps:
    - step_id: GO-Op-07
      name: "Clips narrativos"
      required_evidence_types: [DRIVE_FOLDER]
      validations:
        - rule: "drive_folder_url present"
          severity: ERROR

    - step_id: GO-Op-08
      name: "Screencast demo/guía"
      required_evidence_types: [DRIVE_FILE, DRIVE_FOLDER]
      validations:
        - rule: "mp4_link present"
          severity: ERROR

    - step_id: GO-Op-09
      name: "Integración HeyGen + render"
      required_evidence_types: [HEYGEN_PROJECT, HEYGEN_RENDER, DRIVE_FOLDER]
      validations:
        - rule: "heygen_project_name includes Tn, Mn, Vn"
          severity: ERROR
        - rule: "render_profile == {fps:25,resolution:'1080p',watermark:false}"
          severity: ERROR

    - step_id: GO-Op-10
      name: "Postproducción + export final"
      required_evidence_types: [DRIVE_FOLDER, DRIVE_FILE]
      validations:
        - rule: "final_mp4_link present"
          severity: ERROR
        - rule: "qa_final_checklist == true"
          severity: ERROR

10) Qué le falta / qué lograrás con esto

Con este módulo, aunque 7–10 sean manuales, tu plataforma sí garantiza:

que nadie “cierre” una lección sin evidencias mínimas,

que QA tenga cola clara,

que decisiones de Arquitecto queden registradas,

que el handoff a LMS no sea caótico,

y que el tema de “links que no existen / rutas rotas” se detecte temprano (porque el sistema obliga a registrar rutas reales en Drive/HeyGen antes de aprobar).