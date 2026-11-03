// Generado desde Learning; mantener sincronizado con su contrato de preparación.
import { z } from 'zod';

const id=z.string().uuid();
const text=(max:number)=>z.string().trim().min(1).max(max);
const scene=z.object({id,name:text(60),kind:z.enum(['slide','screen','image','video']),title:text(160),description:z.string().max(500),asset_path:z.string().max(500).optional()}).strict();
const material=z.object({id,name:text(160),kind:z.enum(['file','reading','quiz']),asset_path:text(500),mime:text(100),bytes:z.number().int().min(1).max(25*1024*1024)}).strict();
const quiz=z.object({id,question:text(300),options:z.array(text(120)).min(2).max(6),correct:z.number().int().min(0).max(5)}).strict().refine(item=>item.correct<item.options.length&&new Set(item.options).size===item.options.length);
export const engineSessionManifestSchema=z.object({
  version:z.literal(1),course_id:id,revision:text(100),scenes:z.array(scene).max(12),materials:z.array(material).max(20),
  quizzes:z.array(quiz).max(20),practices:z.array(z.object({id,title:text(160),instructions:text(2000)}).strict()).max(20),
}).strict();
export const enginePreparationSchema=z.object({
  version:z.literal(1),actor_id:id,artifact_id:id,source_session_id:id,source_revision:z.number().int().positive(),
  organization_slug:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100),session_id:id,
  manifest:engineSessionManifestSchema,
}).strict().refine(value=>value.manifest.revision===enginePreparationRevision(value.artifact_id,value.source_session_id,value.source_revision));
export type EnginePreparation=z.infer<typeof enginePreparationSchema>;
export const engineTargetsRequestSchema=z.object({type:z.literal('catalog'),actor_id:id,organization_slug:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100)}).strict();
export const engineTargetsSchema=z.array(z.object({session_id:id,course_id:id,title:text(160),starts_at:z.string()}).strict()).max(100);
export function enginePreparationRevision(artifact:string,session:string,revision:number){return `engine:${artifact}:${session}:${revision}`;}
