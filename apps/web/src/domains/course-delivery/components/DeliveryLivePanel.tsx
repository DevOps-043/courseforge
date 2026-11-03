"use client";
import { useRef,useState,type FormEvent } from "react";
import type { CourseDeliveryController } from "../hooks/useCourseDelivery";
import { engineTargetsSchema } from "../types/engine-preparation.contract";
import type { z } from "zod";

export function DeliveryLivePanel({controller}:{controller:CourseDeliveryController}){
  const [source,setSource]=useState(""),[destination,setDestination]=useState(""),[targets,setTargets]=useState<z.infer<typeof engineTargetsSchema>>([]),[notice,setNotice]=useState("");
  const pending=useRef(false);
  const snapshot=controller.snapshot;
  if(!snapshot?.canReview||!snapshot.readiness.materialsReady)return null;
  async function load(){
    if(pending.current)return;pending.current=true;setNotice("");
    try{const response=await controller.command({action:"LIVE_TARGETS"});const items=engineTargetsSchema.parse("targets" in response?response.targets:undefined);setTargets(items);setDestination("");if(!items.length)setNotice("No tienes sesiones programadas en Learning para esta organización.");}
    catch(error){setNotice(error instanceof Error?error.message:"No se pudieron consultar tus sesiones.");}
    finally{pending.current=false;}
  }
  async function deliver(event:FormEvent){
    event.preventDefault();if(pending.current)return;
    const target=targets.find(item=>item.session_id===destination);if(!target)return;
    pending.current=true;setNotice("");
    try{await controller.command({action:"DELIVER",sourceSessionId:source,target:{organization_slug:snapshot!.organizationSlug,session_id:target.session_id,course_id:target.course_id}});setNotice("Preparación confirmada en Learning. El aula recibirá las láminas y prácticas al actualizar.");}
    catch(error){setNotice(error instanceof Error?error.message:"No se confirmó la entrega.");}
    finally{pending.current=false;}
  }
  return <form onSubmit={event=>void deliver(event)} className="space-y-3 rounded border p-4">
    <h3 className="font-semibold">Preparar una sesión en Learning</h3>
    <p>Envía las láminas y consignas aprobadas. La guía, notas y respuestas del facilitador se conservan en Engine. La preparación anterior de la sesión elegida será reemplazada.</p>
    <label className="block">Contenido que impartirás<select required value={source} onChange={event=>setSource(event.target.value)} className="block w-full rounded border bg-transparent p-2"><option value="">Elige una sesión del curso</option>{snapshot.workspace.document.agenda.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
    <button type="button" disabled={controller.busy} onClick={()=>void load()} className="rounded border px-3 py-2">Consultar mis sesiones de Learning</button>
    {targets.length>0&&<label className="block">Aula de destino<select required value={destination} onChange={event=>setDestination(event.target.value)} className="block w-full rounded border bg-transparent p-2"><option value="">Elige una sesión programada</option>{targets.map(item=><option key={item.session_id} value={item.session_id}>{item.title} · {new Date(item.starts_at).toLocaleString("es-MX")}</option>)}</select></label>}
    <button disabled={controller.busy||!source||!destination} type="submit" className="rounded bg-cyan-700 px-4 py-2 text-white">{controller.busy?"Entregando…":"Entregar preparación a Learning"}</button>
    {notice&&<p role="status">{notice}</p>}
  </form>;
}
