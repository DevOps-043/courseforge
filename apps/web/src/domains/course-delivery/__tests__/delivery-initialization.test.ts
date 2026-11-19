import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../../../app/login/__tests__/source-test-loader";
import { deliveryConfigSchema, emptyDeliveryDocument, type DeliveryWorkspace } from "../types/delivery.schemas";
import * as policy from "../lib/delivery-initialization-policy";
import { deliveryHash } from "../lib/delivery-hash";
import * as videoPolicy from "../../video-duration/video-duration-policy";

const workspace = (): DeliveryWorkspace => ({artifact_id:"course",organization_id:"organization",revision:0,document:emptyDeliveryDocument()});

test("modalidades válidas conservan Nexus anterior y no admiten valores inválidos ni sesiones apagadas", () => {
  assert.equal(policy.validateInitialDeliveryConfig(undefined,false).mode,"NEXUS");
  assert.equal(policy.validateInitialDeliveryConfig({mode:"HYBRID",sessionCount:2,sessionMinutes:60},true).mode,"HYBRID");
  assert.throws(()=>policy.validateInitialDeliveryConfig({mode:"SYNCHRONOUS"},false),error=>error instanceof policy.DeliveryInitializationError && error.status===403);
  for(const value of [{mode:"OTHER"},{mode:"HYBRID",sessionCount:0},{mode:"HYBRID",sessionMinutes:14},{mode:"HYBRID",organizationId:"foreign"}]) assert.throws(()=>policy.validateInitialDeliveryConfig(value,true));
  assert.equal(policy.validateInitialDeliveryConfig({mode:"NEXUS",sessionMinutes:0},false).sessionMinutes,90);
});

test("inicializar no muta el documento anterior ni sobrescribe contenido guardado", () => {
  const previous=workspace();
  const config=deliveryConfigSchema.parse({mode:"SYNCHRONOUS",sessionCount:2,sessionMinutes:60});
  const document=policy.initialDeliveryDocument(previous,config)!;
  assert.equal(previous.document.config.mode,"NEXUS");
  assert.equal(document.config.sessionCount,2);
  const saved={...previous,revision:1,document};
  assert.equal(policy.initialDeliveryDocument(saved,config),null);
  assert.throws(()=>policy.initialDeliveryDocument(saved,deliveryConfigSchema.parse({mode:"HYBRID"})),error=>error instanceof policy.DeliveryInitializationError && error.status===409);
});

test("persistencia inicial conserva organización y revisión y propaga el fallo sin confirmar", async () => {
  const effects: string[]=[];
  const current=workspace();
  const admin={};
  let fail=false;
  const service=load<{initializeArtifactDelivery:(admin:object,id:string,org:string,config:unknown)=>Promise<void>}>("src/domains/course-delivery/services/delivery-initialization.ts",{
    "../config/delivery-enabled":{deliveryEnabled:()=>true},
    "../lib/delivery-initialization-policy":policy,
    "./delivery-repository":{
      readDeliveryWorkspace:async(client:object,id:string,org:string)=>{assert.equal(client,admin);assert.equal(id,current.artifact_id);assert.equal(org,current.organization_id);effects.push("read");return current;},
      saveDeliveryWorkspace:async(client:object,previous:DeliveryWorkspace,document:DeliveryWorkspace["document"])=>{assert.equal(client,admin);assert.equal(previous.revision,0);assert.equal(document.config.mode,"SYNCHRONOUS");effects.push("save");if(fail)throw new Error("CONFLICT");},
    },
  });
  await service.initializeArtifactDelivery(admin,"course","organization",{mode:"NEXUS"});
  assert.deepEqual(effects,[]);
  await service.initializeArtifactDelivery(admin,"course","organization",{mode:"SYNCHRONOUS"});
  assert.deepEqual(effects,["read","save"]);
  fail=true;
  await assert.rejects(service.initializeArtifactDelivery(admin,"course","organization",{mode:"SYNCHRONOUS"}),/CONFLICT/);
});

function generationFixture(options: { enabled?: boolean; failSetup?: boolean; previousMode?: "NEXUS" | "SYNCHRONOUS" } = {}) {
  const effects: string[]=[];
  const id="10000000-0000-4000-8000-000000000001";
  const database={from:()=>({
    insert:()=>{effects.push("insert");return {select:()=>({single:async()=>options.previousMode
      ? {data:null,error:{code:"23505"}} : {data:{id},error:null}})};},
    select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>({data:{id,state:"GENERATING",generation_metadata:{original_input:{deliveryConfig:{mode:options.previousMode}}}},error:null})})})}),
  })};
  const action=load<{generateArtifactAction:(input:Record<string,unknown>)=>Promise<{success:boolean;error?:string}>}>("src/domains/artifacts/actions/artifact.actions.ts",{
    "@/lib/server/background-function-client":{dispatchBackgroundFunctionJson:async()=>{effects.push("dispatch");}},
    "@/domains/course-sources/course-source-settings":{},"@/domains/course-sources/course-source-error":{},"@/domains/course-sources/course-source-generation":{},
    "../lib/artifact-generation-failure":{markArtifactGenerationFailed:async()=>{effects.push("failed");}},
    "../../course-delivery/actions/delivery-initialization.actions":{configureCreatedArtifactDeliveryAction:async(artifactId:string)=>{assert.equal(artifactId,id);effects.push("configure");if(options.failSetup)throw new Error("No se pudo configurar");}},
    "../../course-delivery/lib/delivery-initialization-policy":policy,
    "../../course-delivery/lib/delivery-hash":{deliveryHash},
    "../../course-delivery/config/delivery-enabled":{deliveryEnabled:()=>options.enabled!==false},
    "@/lib/pipeline-generation-policy":{},"@/lib/errors":{getErrorMessage:(error:Error)=>error.message},
    "@/utils/supabase/server":{createClient:async()=>database},"@/utils/auth/session":{getActiveOrganizationId:async()=>"org"},
    "@/lib/server/tenant-context":{resolveActiveTenantContext:async()=>({organizationId:"org"})},
    "@/lib/server/artifact-action-auth":{getAuthenticatedUser:async()=>({userId:"user"})},"@/lib/server/pipeline-dirty-actions":{},
    "@/domains/video-duration/video-duration-policy":videoPolicy,
  },{console:{...console,error(){}}});
  return {effects,generate:(mode="SYNCHRONOUS")=>action.generateArtifactAction({requestId:id,title:"Taller",description:"Descripción",targetAudience:"Equipo",expectedResults:"Aplicar",deliveryConfig:{mode}})};
}

test("creación guarda modalidad antes de despachar y Nexus conserva el camino anterior",async()=>{
  const live=generationFixture();assert.equal((await live.generate()).success,true);assert.deepEqual(live.effects,["insert","configure","dispatch"]);
  const legacy=generationFixture();assert.equal((await legacy.generate("NEXUS")).success,true);assert.deepEqual(legacy.effects,["insert","dispatch"]);
});

test("configuración inválida o deshabilitada no crea ni genera y un fallo posterior evita despachar",async()=>{
  const disabled=generationFixture({enabled:false});assert.equal((await disabled.generate()).success,false);assert.deepEqual(disabled.effects,[]);
  const invalid=generationFixture();assert.equal((await invalid.generate("INVALID")).success,false);assert.deepEqual(invalid.effects,[]);
  const failed=generationFixture({failSetup:true});assert.equal((await failed.generate()).success,false);assert.deepEqual(failed.effects,["insert","configure","failed"]);
});

test("reintento confirma configuración idéntica sin otro despacho y rechaza cambiar la modalidad del mismo ID",async()=>{
  const same=generationFixture({previousMode:"SYNCHRONOUS"});assert.equal((await same.generate()).success,true);assert.deepEqual(same.effects,["insert","configure"]);
  const different=generationFixture({previousMode:"NEXUS"});assert.equal((await different.generate()).success,false);assert.deepEqual(different.effects,["insert"]);
});

test("la acción de inicialización obtiene organización del acceso autorizado y rechaza antes de escribir",async()=>{
  const id="10000000-0000-4000-8000-000000000001";
  const effects:string[]=[];
  let allowed=true;
  const admin={};
  const action=load<{configureCreatedArtifactDeliveryAction:(id:string,config:unknown)=>Promise<void>}>("src/domains/course-delivery/actions/delivery-initialization.actions.ts",{
    "../services/delivery-access":{requireDeliveryAccess:async(artifactId:string)=>{assert.equal(artifactId,id);effects.push("authorize");if(!allowed)throw new Error("Curso ajeno");return {tenant:{organizationId:"trusted-organization"},admin};}},
    "../services/delivery-initialization":{initializeArtifactDelivery:async(client:object,artifactId:string,org:string)=>{assert.equal(client,admin);assert.equal(artifactId,id);assert.equal(org,"trusted-organization");effects.push("initialize");}},
  });
  await assert.rejects(action.configureCreatedArtifactDeliveryAction("invalid",{}));
  assert.deepEqual(effects,[]);
  await action.configureCreatedArtifactDeliveryAction(id,{mode:"SYNCHRONOUS"});
  assert.deepEqual(effects,["authorize","initialize"]);
  allowed=false;
  await assert.rejects(action.configureCreatedArtifactDeliveryAction(id,{}),/Curso ajeno/);
  assert.deepEqual(effects,["authorize","initialize","authorize"]);
});
