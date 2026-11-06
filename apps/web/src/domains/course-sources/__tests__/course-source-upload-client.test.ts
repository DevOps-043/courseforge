import assert from "node:assert/strict";
import test from "node:test";
import { load } from "../../../app/login/__tests__/source-test-loader";

test("transferencia informa porcentaje y cancelar interrumpe XHR sin confirmar recepción", async () => {
  let aborted=false; let sent=false;
  class FakeXHR {
    upload:{onprogress:(event:{lengthComputable:boolean;loaded:number;total:number})=>void}={onprogress:()=>{}};
    onabort=()=>{}; status=200; onload=()=>{}; onerror=()=>{}; timeout=0; ontimeout=()=>{};
    open(method:string,url:string){assert.equal(method,"PUT");assert.equal(url,"/privado");}
    setRequestHeader(name:string,type:string){assert.equal(name,"Content-Type");assert.equal(type,"text/plain");}
    send(){sent=true;this.upload.onprogress({lengthComputable:true,loaded:50,total:100});}
    abort(){aborted=true;this.onabort();}
  }
  const client=load<{uploadSourceBytes:(url:string,file:File,mime:string,progress:(percent:number)=>void,signal:AbortSignal)=>Promise<void>}>(
    "src/domains/course-sources/course-source.client.ts",{}, {XMLHttpRequest:FakeXHR});
  const controller=new AbortController();const progress:number[]=[];
  const pending=client.uploadSourceBytes("/privado",new File(["texto"],"manual.txt"),"text/plain",percent=>progress.push(percent),controller.signal);
  controller.abort();await assert.rejects(pending,/cancelada/);
  assert.equal(sent,true);assert.equal(aborted,true);assert.deepEqual(progress,[50]);
});
