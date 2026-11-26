// Generado desde Learning; mantener sincronizado con su contrato de preparación.
import { z } from 'zod';

export const ENGINE_PREPARATION_MAX_BYTES = 256 * 1024;
export const ENGINE_DOCUMENT_LABELS = {
  course_plan: 'Plan instruccional del curso',
  agenda: 'Agenda general',
  session_plan: 'Plan detallado de sesión',
  assessment: 'Instrumentos de evaluación',
  participant_material: 'Material del participante',
  presentation: 'Presentación con notas',
  facilitator_guide: 'Guía del ponente',
  contingencies: 'Plan de contingencias',
  record_template: 'Formato de registro',
  sources: 'Fuentes y referencias',
  quick_guide: 'Ficha de conducción',
  job_aid: 'Ayuda de trabajo',
  follow_up: 'Aplicación y refuerzo posterior',
  absence_activity: 'Alternativa por ausencia',
} as const;
export const engineDocumentKindSchema = z.enum([
  'course_plan', 'agenda', 'session_plan', 'assessment', 'participant_material',
  'presentation', 'facilitator_guide', 'contingencies', 'record_template',
  'sources', 'quick_guide', 'job_aid', 'follow_up', 'absence_activity',
]);
const text = (max: number) => z.string().trim().min(1).max(max);
export const engineDocumentSectionSchema = z.object({ heading: text(160), body: text(ENGINE_PREPARATION_MAX_BYTES) }).strict();
const publicKinds = new Set(['agenda', 'assessment', 'participant_material', 'presentation', 'sources', 'job_aid', 'follow_up', 'absence_activity']);
export const engineSessionDocumentSchema = z.object({
  id: text(200),
  kind: engineDocumentKindSchema,
  title: text(160),
  applicable: z.boolean(),
  reason: z.string().max(2400),
  block_ids: z.array(text(200)).max(30),
  source_refs: z.array(text(200)).max(200),
  participant_sections: z.array(engineDocumentSectionSchema).max(200),
  facilitator_sections: z.array(engineDocumentSectionSchema).max(200),
}).strict().superRefine((document, context) => {
  if (!document.applicable && !['job_aid', 'follow_up', 'absence_activity'].includes(document.kind)) {
    context.addIssue({ code: 'custom', message: 'El entregable base es obligatorio.' });
  }
  if (!document.applicable && (!document.reason.trim() || document.participant_sections.length || document.facilitator_sections.length)) {
    context.addIssue({ code: 'custom', message: 'Justifica el entregable que no aplica y omite su contenido.' });
  }
  if (document.applicable && !document.participant_sections.length && !document.facilitator_sections.length) {
    context.addIssue({ code: 'custom', message: 'El documento aplicable requiere contenido.' });
  }
  if (document.participant_sections.length && !publicKinds.has(document.kind)) {
    context.addIssue({ code: 'custom', message: 'Este tipo de documento es exclusivo del instructor.' });
  }
  if (new Set(document.block_ids).size !== document.block_ids.length || new Set(document.source_refs).size !== document.source_refs.length) {
    context.addIssue({ code: 'custom', message: 'Las referencias del documento deben ser únicas.' });
  }
});
export type EngineSessionDocument = z.infer<typeof engineSessionDocumentSchema>;
export const publishedSessionDocumentSchema = z.object({
  id: text(200), kind: engineDocumentKindSchema, title: text(160),
  sections: z.array(engineDocumentSectionSchema).min(1).max(200),
}).strict();
