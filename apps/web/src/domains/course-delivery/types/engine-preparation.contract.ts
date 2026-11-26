// Generado desde Learning; mantener sincronizado con su contrato de preparación.
import { engineSessionDocumentSchema } from './engine-session-documents.contract';
import { z } from 'zod';

const id = z.string().uuid();
const text = (max: number) => z.string().trim().min(1).max(max);
const scene = z.object({ id, name: text(60), kind: z.enum(['slide', 'screen', 'image', 'video']), title: text(160), description: z.string().max(500), asset_path: z.string().max(500).optional() }).strict();
const material = z.object({ id, name: text(160), kind: z.enum(['file', 'reading', 'quiz']), asset_path: text(500), mime: text(100), bytes: z.number().int().min(1).max(25 * 1024 * 1024) }).strict();
const quiz = z.object({ id, question: text(300), options: z.array(text(120)).min(2).max(6), correct: z.number().int().min(0).max(5) }).strict().refine(item => item.correct < item.options.length && new Set(item.options).size === item.options.length);

export const engineConductionSchema = z.object({
  documents: z.array(engineSessionDocumentSchema).length(14).optional(),
  minutes: z.number().int().min(15).max(480),
  blocks: z.array(z.object({
    id: text(200),
    purpose: text(8000),
    minutes: z.number().int().positive().max(480),
    explanation: text(8000),
    activity: text(8000),
    criteria: z.array(text(8000)).min(1).max(10),
    practice_ids: z.array(id).max(20),
  }).strict()).min(1).max(30),
  speaker_notes: z.array(z.object({ scene_id: id, content: text(1800) }).strict()).max(12),
}).strict().superRefine((value, context) => {
  if (value.documents) {
    const blocks = new Set(value.blocks.map(block => block.id));
    if (new Set(value.documents.map(document => document.id)).size !== value.documents.length ||
      new Set(value.documents.map(document => document.kind)).size !== value.documents.length ||
      value.documents.some(document => document.block_ids.some(id => !blocks.has(id)))) {
      context.addIssue({ code: 'custom', path: ['documents'], message: 'Los documentos repiten identidad o refieren bloques ajenos.' });
    }
  }
  if (value.blocks.reduce((sum, block) => sum + block.minutes, 0) !== value.minutes) {
    context.addIssue({ code: 'custom', path: ['blocks'], message: 'Los tiempos de los bloques deben coincidir con la duración de la sesión.' });
  }
  if (new Set(value.blocks.map(block => block.id)).size !== value.blocks.length) {
    context.addIssue({ code: 'custom', path: ['blocks'], message: 'Los bloques deben tener identificadores únicos.' });
  }
  if (new Set(value.speaker_notes.map(note => note.scene_id)).size !== value.speaker_notes.length) {
    context.addIssue({ code: 'custom', path: ['speaker_notes'], message: 'Cada escena admite una sola nota del ponente.' });
  }
});

export const engineSessionManifestSchema = z.object({
  version: z.literal(1), course_id: id, revision: text(100),
  scenes: z.array(scene).max(12),
  materials: z.array(material).max(20),
  quizzes: z.array(quiz).max(20),
  practices: z.array(z.object({ id, title: text(160), instructions: text(2000) }).strict()).max(20),
  preparation: engineConductionSchema.optional(),
}).strict().superRefine((manifest, context) => {
  for (const field of ['scenes', 'materials', 'quizzes', 'practices'] as const) {
    if (new Set(manifest[field].map(item => item.id)).size !== manifest[field].length) {
      context.addIssue({ code: 'custom', path: [field], message: 'El manifiesto tiene identificadores duplicados' });
    }
  }
  if (!manifest.preparation) return;
  const sceneIds = new Set(manifest.scenes.map(item => item.id));
  const practiceIds = new Set(manifest.practices.map(item => item.id));
  if (manifest.preparation.speaker_notes.some(note => !sceneIds.has(note.scene_id))) {
    context.addIssue({ code: 'custom', path: ['preparation', 'speaker_notes'], message: 'La nota debe pertenecer a una escena de la preparación.' });
  }
  if (manifest.preparation.blocks.some(block => new Set(block.practice_ids).size !== block.practice_ids.length || block.practice_ids.some(key => !practiceIds.has(key)))) {
    context.addIssue({ code: 'custom', path: ['preparation', 'blocks'], message: 'La práctica debe pertenecer a la preparación y aparecer una sola vez por bloque.' });
  }
});
export const enginePreparationSchema = z.object({
  version: z.literal(1), actor_id: id, artifact_id: id, source_session_id: id, source_revision: z.number().int().positive(),
  organization_slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100), session_id: id,
  manifest: engineSessionManifestSchema,
}).strict().refine(value => value.manifest.revision === enginePreparationRevision(value.artifact_id, value.source_session_id, value.source_revision));
export type EnginePreparation = z.infer<typeof enginePreparationSchema>;
export const engineTargetsRequestSchema = z.object({ type: z.literal('catalog'), actor_id: id, organization_slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100) }).strict();
export const engineTargetsSchema = z.array(z.object({ session_id: id, course_id: id, title: text(160), starts_at: z.string() }).strict()).max(100);
export function enginePreparationRevision(artifact: string, session: string, revision: number) { return `engine:${artifact}:${session}:${revision}`; }
