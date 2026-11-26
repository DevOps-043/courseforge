import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { executeDeliveryRun } from "../services/delivery-generation";
import { emptyDeliveryDocument } from "../types/delivery.schemas";
import { deliveryHash } from "../lib/delivery-hash";
import { materialGenerationError } from "../../../lib/material-generation-error";
import type { DeliveryRunUnit } from "../services/delivery-commands";

function fixture(t: TestContext) {
  const previous=process.env.SYNCHRONOUS_COURSES_ENABLED;
  process.env.SYNCHRONOUS_COURSES_ENABLED="true";
  t.after(()=>{if(previous===undefined)delete process.env.SYNCHRONOUS_COURSES_ENABLED;else process.env.SYNCHRONOUS_COURSES_ENABLED=previous;});
  const modules = [{ title: "Módulo", lessons: [{ id: "lesson", title: "Lección", objective_specific: "Aplicar" }] }];
  const document=emptyDeliveryDocument(); document.config.mode="SYNCHRONOUS"; document.syllabusHash=deliveryHash(modules);
  document.agenda=[1,2,3].map(n=>({id:`10000000-0000-4000-8000-00000000000${n}`,title:`Sesión ${n}`,minutes:90,objectives:["Aplicar"],evidence:"Caso",coverage:[{lessonId:"lesson",scope:"Caso",review:false}]}));
  const workspace={artifact_id:"course",organization_id:"org",revision:1,document};
  const run={id:"run",artifact_id:"course",organization_id:"org",expected_revision:1,operation:"MATERIALS",status:"QUEUED",lease_token:null as string|null,units:document.agenda.map(session=>({id:session.id,ready:false})) as DeliveryRunUnit[],
    snapshot:{document,context:{title:"Curso",modules,lessons:[],syllabusHash:deliveryHash(modules),nexusHash:deliveryHash(null),sourcesHash:deliveryHash([]),sources:[]},settings:{model:{model_name:"gpt-4o",fallback_model:null},settingType:"SYNCHRONOUS_MATERIALS",prompt:{content:"Fijado",version:"1"}}}};
  const retries:string[]=[];
  const db={
    from(table:string) {
      let patch:Record<string,unknown>|undefined; const filters:Record<string,unknown>={};
      const result=()=>{
        if(patch) { const matches=Object.entries(filters).every(([key,value])=>(run as unknown as Record<string,unknown>)[key]===value); if(matches)Object.assign(run,structuredClone(patch)); return {data:matches?{id:run.id}:null,error:null}; }
        const records:Record<string,unknown>={artifacts:{id:"course",organization_id:"org",idea_central:"Curso"},syllabus:{modules,state:"STEP_APPROVED"},course_delivery_workspaces:workspace,course_delivery_runs:run};
        return {data:structuredClone(records[table]||null),error:null};
      };
      const query={select(){return query;},eq(key:string,value:unknown){filters[key]=value;return query;},update(value:Record<string,unknown>){patch=value;return query;},async single(){return result();},async maybeSingle(){return result();},then(resolve:(value:unknown)=>unknown){return Promise.resolve(result()).then(resolve);}};
      return query;
    },
    async rpc(name:string,args:Record<string,unknown>) {
      if(name==="claim_course_delivery_run") {run.status="RUNNING";run.lease_token=String(args.p_token);return {data:true,error:null};}
      if(name==="take_delivery_material_retry")return {data:retries.shift()||null,error:null};
      if(name==="finish_delivery_material_run") {if(run.status!=="RUNNING")return {data:"NOT_CLAIMED",error:null};run.status=String(args.p_status);return {data:run.status,error:null};}
      throw new Error(`RPC inesperada: ${name}`);
    },
  } as unknown as SupabaseClient;
  return {run,retries,db};
}
test("Materiales continúa tras fallos y prioriza un reintento solicitado durante otra sesión",async t=>{
  const {run,retries,db}=fixture(t); const calls:string[]=[];
  const result=await executeDeliveryRun(db,"run",async(_admin,_run,unit)=>{
    calls.push(unit.id);
    if(unit.id===run.units[1].id) retries.push(run.units[0].id);
    throw new DOMException("contenido privado","TimeoutError");
  });
  assert.equal(result.status,"FAILED");
  assert.deepEqual(calls,[run.units[0].id,run.units[1].id,run.units[0].id,run.units[2].id]);
  assert.ok(run.units.every(unit=>!unit.ready));
  assert.doesNotMatch(JSON.stringify(run.units),/contenido privado/);
});
test("cancelar durante generación impide guardar progreso o continuar otras unidades",async t=>{
  const {run,db}=fixture(t);let calls=0;
  const result=await executeDeliveryRun(db,"run",async()=>{calls++;run.status="CANCELLED";run.lease_token=null;throw new DOMException("privado","TimeoutError");});
  assert.equal(result.status,"NOT_CLAIMED");assert.equal(run.status,"CANCELLED");assert.equal(calls,1);
});
test("reanudar Materiales conserva los rechazos que requieren revisión y continúa las demás sesiones",async t=>{
  const {run,db}=fixture(t);const calls:string[]=[];
  run.units[0].error="UNSUPPORTED_OUTPUT";run.units[0].retryable=false;
  const result=await executeDeliveryRun(db,"run",async(_admin,_run,unit)=>{calls.push(unit.id);throw new DOMException("privado","TimeoutError");});
  assert.deepEqual(calls,[run.units[1].id,run.units[2].id]);
  assert.equal(run.units[0].error,"UNSUPPORTED_OUTPUT");
  assert.equal(result.status,"FAILED");
});
test("el manejador clasifica recuperación sin exponer datos del proveedor",()=>{
  for(const [error,stage,code,retryable] of [
    [new DOMException("privado","TimeoutError"),"GENERATION","TIMEOUT",true],
    [{statusCode:429,message:"privado"},"GENERATION","PROVIDER_LIMIT",true],
    [{status:401,message:"privado"},"GENERATION","PROVIDER_CONFIGURATION",false],
    [{groundingReason:"QUOTE_NOT_IN_SOURCE"},"GROUNDING","QUOTE_NOT_IN_SOURCE",false],
    [{status:409,message:"referencia privada"},"GROUNDING","GROUNDING_CONFLICT",false],
    [{message:"DELIVERY_STALE_RUN privado"},"PERSISTENCE","INPUT_CHANGED",false],
    [new Error("privado"),"PERSISTENCE","PERSISTENCE_UNCERTAIN",false],
  ] as const) {
    const diagnostic=materialGenerationError(error,stage);assert.equal(diagnostic.code,code);assert.equal(diagnostic.retryable,retryable);assert.doesNotMatch(diagnostic.message,/privado/);
  }
});
