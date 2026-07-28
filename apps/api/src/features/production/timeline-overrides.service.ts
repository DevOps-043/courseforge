import { z } from 'zod';

export const TIMELINE_OVERRIDE_MANIFEST_VERSION = 1;

const timelineTrackKindSchema = z.enum(['slides', 'broll']);
const timelineFrameSchema = z.number().int().min(0).max(24 * 60 * 60 * 240);

export const timelineOverrideSegmentSchema = z.object({
  id: z.string().trim().min(1).max(120),
  trackKind: timelineTrackKindSchema,
  layerId: z.string().trim().min(1).max(80).optional(),
  startFrame: timelineFrameSchema,
  endFrame: timelineFrameSchema,
  sourceStartFrame: timelineFrameSchema.optional(),
  sourceEndFrame: timelineFrameSchema.optional(),
  loopMode: z.enum(['loop', 'freeze', 'none']).default('loop'),
}).strict().refine(
  (segment) => segment.endFrame > segment.startFrame,
  { message: 'Timeline segment endFrame must be greater than startFrame' },
).refine(
  (segment) =>
    segment.trackKind !== 'slides' ||
    (segment.sourceStartFrame === undefined && segment.sourceEndFrame === undefined),
  { message: 'Slide timeline overrides cannot trim source frames' },
).refine(
  (segment) =>
    segment.sourceStartFrame === undefined ||
    segment.sourceEndFrame === undefined ||
    segment.sourceEndFrame > segment.sourceStartFrame,
  { message: 'Timeline sourceEndFrame must be greater than sourceStartFrame' },
);

export const timelineOverrideManifestSchema = z.object({
  version: z.literal(TIMELINE_OVERRIDE_MANIFEST_VERSION),
  templateId: z.string().trim().min(1).max(160).optional(),
  templateVersionId: z.string().trim().min(1).max(160).nullable().optional(),
  componentId: z.string().trim().min(1).max(160).optional(),
  timeline: z.object({
    fps: z.number().int().positive().max(240),
    durationInFrames: z.number().int().positive().max(24 * 60 * 60 * 240),
  }).strict(),
  segments: z.array(timelineOverrideSegmentSchema).max(300).default([]),
}).strict();

export const timelineOverrideManifestListSchema = z
  .array(timelineOverrideManifestSchema)
  .max(20)
  .default([]);

export type TimelineOverrideSegment = z.infer<typeof timelineOverrideSegmentSchema>;
export type TimelineOverrideManifest = z.infer<typeof timelineOverrideManifestSchema>;
export type TimelineOverrideManifestList = z.infer<typeof timelineOverrideManifestListSchema>;

export function parseTimelineOverrideManifests(raw: unknown): TimelineOverrideManifestList {
  return timelineOverrideManifestListSchema.parse(raw ?? []);
}
