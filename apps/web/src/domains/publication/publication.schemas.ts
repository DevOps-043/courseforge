import { z } from "zod";

const lessonVideoSchema = z.object({
  lesson_id: z.string().min(1).max(200),
  lesson_title: z.string().min(1).max(500),
  module_title: z.string().min(1).max(500),
  video_provider: z.enum(["youtube", "vimeo", "direct"]),
  video_id: z.string().min(1).max(4_000),
  duration: z.number().finite().nonnegative().max(24 * 60 * 60),
}).strict();

export const publicationDraftSchema = z.object({
  category: z.string().trim().min(1).max(120),
  level: z.enum(["beginner", "intermediate", "advanced"]),
  instructor_email: z.string().email().max(320),
  slug: z.string().trim().min(1).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  price: z.number().finite().nonnegative().max(1_000_000),
  thumbnail_url: z.string().url().max(4_000).optional().or(z.literal("")),
  lesson_videos: z.record(z.string().max(200), lessonVideoSchema),
  selected_lessons: z.array(z.string().min(1).max(200)).max(1_000).nullable().optional(),
  status: z.enum(["DRAFT", "READY"]),
}).strict();

export const savePublicationDraftRequestSchema = z.object({
  artifactId: z.string().uuid(),
  data: publicationDraftSchema,
}).strict();

export const publishRequestSchema = z.object({
  artifactId: z.string().uuid(),
}).strict();
