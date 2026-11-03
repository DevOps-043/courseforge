import {test} from "node:test";
import assert from "node:assert/strict";
import {buildEnginePreparation} from "../services/delivery-live-payload";
import {emptyDeliveryDocument,type DeliveryWorkspace} from "../types/delivery.schemas";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
function fixture(){
  const document=emptyDeliveryDocument();
  document.config.mode="SYNCHRONOUS";
  document.agenda=[{id:id(2),title:"Sesión",minutes:60,objectives:["Aplicar"],coverage:[{lessonId:"lesson-1",scope:"Completo",review:false}],evidence:"Práctica"}];
  document.materials[id(2)]={concepts:[],preparation:{understand:"PRIVADO",explain:"",conduct:"",deepen:"",expand:""},slides:[{title:"Concepto",points:["Idea pública"],notes:"NOTA PRIVADA",sourceRefs:[]}],activities:[{id:"actividad-1",title:"Práctica",instructions:"Resuelve",template:"Plantilla",answer:"RESPUESTA PRIVADA",criteria:["CRITERIO PRIVADO"],sourceRefs:[]}]};
  return {workspace:{artifact_id:id(1),organization_id:id(3),revision:7,document} satisfies DeliveryWorkspace,target:{organization_slug:"empresa",course_id:id(4),session_id:id(5)}};
}
test("entrega identidad y revisión estables sin notas ni respuestas privadas",()=>{
  const {workspace,target}=fixture();
  const result=buildEnginePreparation(workspace,id(2),target,id(6));
  assert.deepEqual(result,buildEnginePreparation(workspace,id(2),target,id(6)));
  assert.equal(result.manifest.course_id,target.course_id);
  assert.equal(result.manifest.scenes[0].description,"Idea pública");
  assert.match(result.manifest.revision,/:7$/);
  assert.doesNotMatch(JSON.stringify(result),/PRIVAD/);
  workspace.revision++;
  const next=buildEnginePreparation(workspace,id(2),target,id(6));
  assert.equal(next.manifest.scenes[0].id,result.manifest.scenes[0].id);
  assert.notEqual(next.manifest.revision,result.manifest.revision);
});
test("rechaza sesión ajena y exceso de límites sin truncar la preparación",()=>{
  const {workspace,target}=fixture();
  assert.throws(()=>buildEnginePreparation(workspace,id(9),target,id(6)),/sesión/);
  workspace.document.materials[id(2)].slides[0].points=["x".repeat(501)];
  assert.throws(()=>buildEnginePreparation(workspace,id(2),target,id(6)),/500 caracteres/);
  workspace.document.materials[id(2)].slides=Array.from({length:13},()=>({title:"Título",points:["Texto"],notes:"",sourceRefs:[]}));
  assert.throws(()=>buildEnginePreparation(workspace,id(2),target,id(6)),/12 láminas/);
});
test("cambiar a Nexus no permite entregar materiales síncronos anteriores",()=>{
  const {workspace,target}=fixture();workspace.document.config.mode="NEXUS";
  assert.throws(()=>buildEnginePreparation(workspace,id(2),target,id(6)),/Nexus/);
});
