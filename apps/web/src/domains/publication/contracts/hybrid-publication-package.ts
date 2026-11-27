import { z } from 'zod';
import { HYBRID_PUBLICATION_LIMITS } from './hybrid-publication-route';
import {
  hybridPublicationPreparationFields,
  validateHybridPublicationPreparation,
} from './hybrid-publication-preparation';

export const HYBRID_PUBLICATION_MAX_BYTES = 8 * 1024 * 1024;

const id = z.string().trim().min(1).max(200);
const title = z.string().trim().min(1).max(500);
const uuid = z.string().uuid();
const body = z.string().max(256 * 1024);
const slug = z.string().max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const content = { id, title };
const video = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('youtube'), video_id: z.string().regex(/^[\w-]{11}$/) }).strict(),
  z.object({ provider: z.literal('vimeo'), video_id: z.string().regex(/^\d{1,20}$/) }).strict(),
  z.object({ provider: z.literal('file'), asset_id: uuid }).strict(),
]);
const quizQuestion = z.object({
  id,
  question: title,
  options: z.array(title).min(2).max(20),
  correct_answer: z.string().trim().min(1).max(500),
  explanation: body.optional(),
  points: z.number().positive().max(1000),
}).strict().superRefine(({ options, correct_answer }, context) => {
  if (new Set(options).size !== options.length || !options.includes(correct_answer)) {
    context.addIssue({ code: 'custom', path: ['correct_answer'], message: 'La respuesta debe identificar una opción única.' });
  }
});
const activity = z.discriminatedUnion('type', [
  z.object({ ...content, type: z.literal('reading'), body }).strict(),
  z.object({ ...content, type: z.literal('exercise'), body }).strict(),
  z.object({ ...content, type: z.literal('quiz'), questions: z.array(quizQuestion).min(1).max(100),
    passing_score: z.number().min(0).max(100) }).strict(),
  // La variante usa el contrato runtime del producto. El receptor debe validarlo
  // antes de aprobar, sin la conversión automática de diálogos legacy.
  z.object({ ...content, type: z.literal('ai_chat'),
    configuration: z.object({ interactionType: z.literal('soflia_dialogue') }).passthrough() }).strict(),
]);

export const hybridPublicationPackageSchema = hybridPublicationPreparationFields.extend({
  course: z.object({
    title, slug, description: body,
    instructor_id: uuid,
    category: z.string().trim().min(1).max(100),
    level: z.enum(['beginner', 'intermediate', 'advanced']),
  }).strict(),
  lessons: z.array(z.object({
    lesson_id: id,
    duration_seconds: z.number().int().min(1).max(86_400),
    video,
    summary: body,
    transcription: body,
    activities: z.array(activity).max(30),
    attachments: z.array(z.object({ ...content, asset_id: uuid }).strict()).max(30),
  }).strict()).min(1).max(HYBRID_PUBLICATION_LIMITS.lessons),
}).superRefine((publication, context) => {
  try {
    if (new TextEncoder().encode(JSON.stringify(publication)).byteLength > HYBRID_PUBLICATION_MAX_BYTES) {
      context.addIssue({ code: 'custom', message: 'El JSON supera el límite del paquete híbrido.' });
    }
  } catch {
    context.addIssue({ code: 'custom', message: 'El paquete híbrido debe poder serializarse como JSON.' });
  }
  const missing = new Set(publication.delivery.academy_lesson_ids);
  const assetIds: string[] = [];
  const assets = new Map(publication.assets.map(asset => [asset.id, asset]));
  for (const [index, lesson] of publication.lessons.entries()) {
    const path = ['lessons', index];
    if (!missing.delete(lesson.lesson_id)) {
      context.addIssue({ code: 'custom', path, message: 'La lección debe pertenecer a Academy y aparecer una sola vez.' });
    }
    for (const content of [lesson.activities, lesson.attachments]) {
      if (new Set(content.map(item => item.id)).size !== content.length) {
        context.addIssue({ code: 'custom', path, message: 'La lección repite identidades de contenido.' });
      }
    }
    for (const item of lesson.activities) {
      if (item.type === 'quiz' && new Set(item.questions.map(question => question.id)).size !== item.questions.length) {
        context.addIssue({ code: 'custom', path, message: 'La evaluación repite identidades de preguntas.' });
      }
    }
    assetIds.push(...lesson.attachments.map(attachment => attachment.asset_id));
    if (lesson.video.provider === 'file') {
      const assetId = lesson.video.asset_id;
      assetIds.push(assetId);
      if (!assets.get(assetId)?.mime.startsWith('video/')) {
        context.addIssue({ code: 'custom', path: [...path, 'video'], message: 'El recurso de video debe referir un archivo de video del paquete.' });
      }
    }
  }
  if (missing.size) context.addIssue({ code: 'custom', path: ['lessons'], message: 'Falta contenido asíncrono de Academy.' });
  validateHybridPublicationPreparation(publication, context, assetIds);
});

export type HybridPublicationPackage = z.infer<typeof hybridPublicationPackageSchema>;
