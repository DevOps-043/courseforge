"use client";
import { useId, useRef, useState, type FormEvent } from "react";
import type { CourseDeliveryController } from "../hooks/useCourseDelivery";
import { engineTargetsSchema } from "../types/engine-preparation.contract";
import type { z } from "zod";
import styles from "./delivery-ui.module.css";

export function DeliveryLivePanel({controller}:{controller:CourseDeliveryController}){
  const [source,setSource]=useState(""),[destination,setDestination]=useState(""),[targets,setTargets]=useState<z.infer<typeof engineTargetsSchema>>([]),[notice,setNotice]=useState("");
  const pending=useRef(false);
  const fieldId = useId();
  const [phase, setPhase] = useState<"idle" | "loading" | "delivering">("idle");
  const [failed, setFailed] = useState(false);
  const snapshot=controller.snapshot;
  if(!snapshot?.canReview||!snapshot.readiness.materialsReady)return null;
  async function load(){
    if(pending.current)return;pending.current=true;setNotice("");setFailed(false);setPhase("loading");
    try{const response=await controller.command({action:"LIVE_TARGETS"});const items=engineTargetsSchema.parse("targets" in response?response.targets:undefined);setTargets(items);setDestination("");if(!items.length)setNotice("No tienes sesiones programadas en Learning para esta organización.");}
    catch(error){setFailed(true);setNotice(error instanceof Error?error.message:"No se pudieron consultar tus sesiones.");}
    finally{pending.current=false;setPhase("idle");}
  }
  async function deliver(event:FormEvent){
    event.preventDefault();if(pending.current)return;
    const target=targets.find(item=>item.session_id===destination);if(!target)return;
    pending.current=true;setNotice("");setFailed(false);setPhase("delivering");
    try{await controller.command({action:"DELIVER",sourceSessionId:source,target:{organization_slug:snapshot!.organizationSlug,session_id:target.session_id,course_id:target.course_id}});setNotice("Preparación confirmada en Learning. Abre o actualiza el aula en Hub para consultar la revisión recibida.");}
    catch(error){setFailed(true);setNotice(error instanceof Error?error.message:"No se confirmó la entrega.");}
    finally{pending.current=false;setPhase("idle");}
  }
  const busy = controller.busy || phase !== "idle";
  return <form onSubmit={event=>void deliver(event)} className={styles.transfer} aria-busy={phase !== "idle"}>
    <header><p className={styles.eyebrow}>Entrega al aula</p><h3>Prepara tu sesión en Hub</h3>
    <p>Envía a Learning la preparación aprobada para consultarla en Hub. Las notas y respuestas reservadas estarán disponibles solo para instructores autorizados.</p></header>
    <ol className={styles.transferSteps} aria-label="Recorrido de la preparación"><li>1. Architect · Preparar</li><li>2. Learning · Validar</li><li>3. Hub · Impartir</li></ol>
    <div className={styles.transferFields}>
      <div><label htmlFor={`${fieldId}-source`}>Contenido que impartirás</label><select id={`${fieldId}-source`} required disabled={busy} value={source} onChange={event=>setSource(event.target.value)}><option value="">Elige una sesión del curso</option>{snapshot.workspace.document.agenda.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></div>
      <div><label htmlFor={`${fieldId}-destination`}>Aula de destino</label><select id={`${fieldId}-destination`} required disabled={busy || !targets.length} value={destination} onChange={event=>setDestination(event.target.value)}><option value="">{targets.length ? "Elige una sesión programada" : "Consulta tus sesiones para elegir el aula"}</option>{targets.map(item=><option key={item.session_id} value={item.session_id}>{item.title} · {new Date(item.starts_at).toLocaleString("es-MX")}</option>)}</select></div>
    </div>
    <p>La entrega sustituye la preparación previa de la sesión elegida. Learning valida su estado y protege las respuestas y entregas existentes.</p>
    <div className={styles.actions}>
      <button type="button" disabled={busy} onClick={()=>void load()}>{phase === "loading" ? "Consultando sesiones…" : "Consultar mis sesiones de Learning"}</button>
      <button disabled={busy||!source||!destination} type="submit" className={styles.primary}>{phase === "delivering"?"Entregando…":"Entregar preparación a Learning"}</button>
    </div>
    {phase !== "idle" && <p role="status">{phase === "loading" ? "Buscando las sesiones a las que tienes acceso…" : "Esperando la confirmación de Learning…"}</p>}
    {notice&&<p className={styles.transferNotice} role={failed ? "alert" : "status"}>{notice}</p>}
  </form>;
}
