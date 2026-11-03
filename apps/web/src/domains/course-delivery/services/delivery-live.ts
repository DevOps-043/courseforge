import { createHmac } from "node:crypto";
import { getOptionalServerEnvValue } from "../../../lib/server/env";
import { requireDeliveryAccess } from "./delivery-access";
import { readDeliveryContext,readDeliveryWorkspace } from "./delivery-repository";
import { deliveryReadiness } from "./delivery-readiness";
import { deliveryEnabled } from "../config/delivery-enabled";
import { buildEnginePreparation } from "./delivery-live-payload";
import { engineTargetsSchema } from "../types/engine-preparation.contract";

async function requestLearning(payload:unknown){
  const base=getOptionalServerEnvValue("SOFLIA_API_URL"),key=getOptionalServerEnvValue("SOFLIA_API_KEY");
  if(typeof base!=="string"||typeof key!=="string"||!key)throw new Error("Configura la conexión de servidor con Learning para entregar la preparación.");
  const endpoint=new URL("/api/internal/jobs/live-engine-preparation",base);
  if(endpoint.protocol!=="https:"||endpoint.username||endpoint.password||endpoint.port)throw new Error("La conexión con Learning requiere un origen HTTPS válido.");
  const body=JSON.stringify(payload);
  if(Buffer.byteLength(body)>32768)throw new Error("La preparación supera 32 KiB. Reduce su contenido antes de entregar.");
  const timestamp=String(Date.now());
  const signature=createHmac("sha256",key).update(`live-preparation:v1:${timestamp}:${body}`).digest("hex");
  const response=await fetch(endpoint,{method:"POST",redirect:"error",cache:"no-store",signal:AbortSignal.timeout(30000),headers:{"Content-Type":"application/json","X-Soflia-Timestamp":timestamp,"X-Soflia-Signature":`v1=${signature}`},body});
  if(!response.ok)throw new Error(response.status===409?"Learning rechazó la entrega: comprueba que la sesión siga programada, sin respuestas, y que la revisión esté vigente.":response.status===403?"Tu identidad no tiene permiso docente sobre el curso y la organización de destino.":"No se confirmó la entrega en Learning. Revisa la conexión y reintenta con la misma preparación.");
  const reader=response.body?.getReader();if(!reader)throw new Error("Learning no devolvió la confirmación.");
  const chunks:Uint8Array[]=[];let length=0;
  try{for(let part=await reader.read();!part.done;part=await reader.read()){length+=part.value.byteLength;if(length>65536)throw new Error("Learning devolvió una respuesta demasiado grande.");chunks.push(part.value);}}
  finally{await reader.cancel().catch(()=>{});}
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export async function livePreparationTargets(artifactId:string){
  const {tenant}=await requireDeliveryAccess(artifactId,true);
  if(!deliveryEnabled())throw new Error("La autoría sincrónica no está habilitada.");
  const response=await requestLearning({type:"catalog",actor_id:tenant.userId,organization_slug:tenant.organizationSlug});
  return {targets:engineTargetsSchema.parse(response.targets)};
}

export async function deliverLivePreparation(artifactId:string,revision:number,sourceSessionId:string,target:{organization_slug:string;session_id:string;course_id:string}){
  const {admin,tenant}=await requireDeliveryAccess(artifactId,true);
  if(!deliveryEnabled())throw new Error("La autoría sincrónica no está habilitada.");
  const workspace=await readDeliveryWorkspace(admin,artifactId,tenant.organizationId);
  const context=await readDeliveryContext(admin,artifactId,tenant.organizationId);
  if(workspace.document.config.mode==="NEXUS")throw new Error("El curso utiliza publicación Nexus. Selecciona una modalidad con sesiones antes de entregar.");
  if(workspace.revision!==revision||!deliveryReadiness(workspace.document,context).materialsReady)throw new Error("Aprueba y actualiza los materiales vigentes antes de entregar.");
  if(target.organization_slug!==tenant.organizationSlug)throw new Error("Elige una sesión de la organización activa.");
  const payload=buildEnginePreparation(workspace,sourceSessionId,target,tenant.userId);
  const result=await requestLearning(payload);
  if(result.delivered!==true||result.session_id!==target.session_id||result.engine_revision!==payload.manifest.revision)throw new Error("Learning devolvió una confirmación incompatible.");
  return {delivered:true,sessionId:target.session_id};
}
