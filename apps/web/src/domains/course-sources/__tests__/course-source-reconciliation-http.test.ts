import assert from "node:assert/strict";
import test from "node:test";
import { load } from "../../../app/login/__tests__/source-test-loader";
import { CourseSourceError } from "../course-source-error";
import * as contract from "../../../lib/server/api-contract";
import * as responses from "../../../lib/server/api-response";
const id="10000000-0000-4000-8000-000000000001";
function fixture(role="ADMIN", accessStatus?: number) {
  const effects:string[]=[];
  const route=load<{POST:(request:Request,context:{params:Promise<{artifactId:string}>})=>Promise<Response>}>(
    "src/app/api/artifacts/[artifactId]/sources/reconciliation/route.ts",{
      "@/domains/course-sources/course-source-access":{requireCourseSourceAccess:async()=>{
        if(accessStatus)throw new CourseSourceError(accessStatus,"Acceso denegado.");
        return {tenant:{organizationId:id,userId:id,platformRole:role},admin:{}};
      }},
      "@/domains/course-sources/course-source-reconciliation":{
        reconcileCourseUploads:async()=>{effects.push("inspect");return {observations:[]};},
        purgeAbandonedSource:async()=>{effects.push("purge");return {purged:true};},
      },
      "@/domains/course-sources/course-source-error":{CourseSourceError},
      "@/lib/server/api-contract":contract,"@/lib/server/api-response":responses,
      "@/lib/server/authorization-unavailable-response":{authorizationUnavailableResponse:()=>null},
      "@/lib/server/operational-logger":{resolveCorrelationId:()=>"prueba"},
    });
  return {effects,call:(body:object,origin?:string)=>route.POST(new Request("https://example.invalid",{
    method:"POST",headers:{"Content-Type":"application/json",...(origin?{Origin:origin}:{})},body:JSON.stringify(body),
  }),{params:Promise.resolve({artifactId:id})})};
}
test("purga exige revisor, autorización del curso y confirmación exacta antes de Storage",async()=>{
  for(const f of [fixture("CONSTRUCTOR"),fixture("ADMIN",401),fixture("ADMIN",404)]){
    assert.ok([401,403,404].includes((await f.call({action:"purge",documentId:id,confirmDocumentId:id})).status));
    assert.deepEqual(f.effects,[]);
  }
  const mismatch=fixture();assert.equal((await mismatch.call({action:"purge",documentId:id,confirmDocumentId:"20000000-0000-4000-8000-000000000001"})).status,409);
  assert.deepEqual(mismatch.effects,[]);
});
test("inspección no implica purga y el origen cruzado no tiene efectos",async()=>{
  const f=fixture();assert.equal((await f.call({action:"inspect"})).status,200);assert.deepEqual(f.effects,["inspect"]);
  const foreign=fixture();assert.equal((await foreign.call({action:"inspect"},"https://otro.invalid")).status,403);assert.deepEqual(foreign.effects,[]);
});
