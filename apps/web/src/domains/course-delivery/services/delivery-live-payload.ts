import { createHash } from "node:crypto";
import { enginePreparationSchema,enginePreparationRevision } from "../types/engine-preparation.contract";
import type { DeliveryWorkspace } from "../types/delivery.schemas";

const stableId=(key:string)=>{
  const value=createHash("sha256").update(key).digest("hex");
  return `${value.slice(0,8)}-${value.slice(8,12)}-5${value.slice(13,16)}-a${value.slice(17,20)}-${value.slice(20,32)}`;
};
export function buildEnginePreparation(workspace:DeliveryWorkspace,sourceSessionId:string,target:{organization_slug:string;session_id:string;course_id:string},actorId:string){
  if(workspace.document.config.mode==="NEXUS")throw new Error("El curso utiliza publicación Nexus.");
  const material=workspace.document.materials[sourceSessionId];
  if(!workspace.document.agenda.some(session=>session.id===sourceSessionId)||!material)throw new Error("Elige una sesión con materiales completos.");
  const revision=enginePreparationRevision(workspace.artifact_id,sourceSessionId,workspace.revision);
  const result=enginePreparationSchema.safeParse({
    version:1,actor_id:actorId,artifact_id:workspace.artifact_id,source_session_id:sourceSessionId,source_revision:workspace.revision,
    organization_slug:target.organization_slug,session_id:target.session_id,
    manifest:{version:1,course_id:target.course_id,revision,
      scenes:material.slides.map((slide,index)=>({id:stableId(`${sourceSessionId}:slide:${index}`),name:`Lámina ${index+1}`,kind:"slide",title:slide.title,description:slide.points.join("\n")})),
      practices:material.activities.map(activity=>({id:stableId(`${sourceSessionId}:activity:${activity.id}`),title:activity.title,instructions:activity.instructions+"\n\n"+activity.template})),
      materials:[],quizzes:[],
    },
  });
  if(!result.success)throw new Error("Adapta la preparación al aula: hasta 12 láminas (título 160 y contenido 500 caracteres) y 20 prácticas (título 160 e instrucciones 2000). Revisa también las referencias de destino. No se envió contenido parcial.");
  return result.data;
}
