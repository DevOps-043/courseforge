import assert from "node:assert/strict";
import test from "node:test";
import { computeGeneratedDeckInitializationRequestSha256 } from "../composition-generated-deck-initialization.server";
import { computeGeneratedDeckInitializationRequestSha256InBrowser, sendGeneratedDeckInitialization,
  consultGeneratedDeckInitialization, consultCurrentGeneratedDeckInitialization } from "../composition-generated-deck-initialization.client";
import { beginGeneratedDeckInitializationJournal, readGeneratedDeckInitializationJournal,
  recordGeneratedDeckInitializationReceipt, closeVerifiedGeneratedDeckInitializationJournal } from "../composition-generated-deck-initialization-journal.client";
import type { HtmlSnapshotLocatorStorage } from "../composition-html-snapshot-locator.client";

function fixture() {
  const uuid="00000000-0000-4000-8000-000000000001", operationId="00000000-0000-4000-8000-000000000002";
  const scope={actorId:uuid,organizationId:uuid,draftId:uuid}, expectedDocumentHash="a".repeat(64);
  const body={operationId,expectedDocumentHash,requestSha256:computeGeneratedDeckInitializationRequestSha256(expectedDocumentHash)};
  const receipt={scope:"GENERATED_DECK_INITIALIZATION_RECEIPT_NOT_CURRENT_STATE_OR_RENDERED" as const,owner:scope,...body,
    documentHash:"b".repeat(64),documentVersion:2,items:[{clipId:"deck-slide-one",revisionVersion:1,revisionSha256:"c".repeat(64),
      templateId:"owned-template",templateVersion:1,sourceSha256:"d".repeat(64),manifestSha256:"e".repeat(64),created:true}]};
  const values=new Map<string,string>(), storage:HtmlSnapshotLocatorStorage={getItem:key=>values.get(key)??null,
    setItem:(key,value)=>{values.set(key,value);},removeItem:key=>{values.delete(key);}};
  const envelope=(data:unknown)=>Response.json({success:true,requestId:uuid,correlationId:uuid,data});
  return {scope,body,receipt,storage,values,envelope,signal:new AbortController().signal};
}

test("journal persists only bounded owner/identity/receipt metadata and cannot close an unknown intent",()=>{
  const f=fixture();
  assert.ok(beginGeneratedDeckInitializationJournal(f.storage,{scope:f.scope,request:f.body,createdAt:1}));
  const pending=readGeneratedDeckInitializationJournal(f.storage,f.scope);
  assert.equal(pending.status,"PENDING"); if(pending.status!=="PENDING") throw new Error();
  assert.equal(closeVerifiedGeneratedDeckInitializationJournal(f.storage,f.scope,pending.entry),false);
  assert.equal(beginGeneratedDeckInitializationJournal(f.storage,{scope:f.scope,request:f.body,createdAt:2}),false);
  assert.ok(recordGeneratedDeckInitializationReceipt(f.storage,f.scope,pending.entry,f.receipt));
  assert.equal(recordGeneratedDeckInitializationReceipt(f.storage,f.scope,pending.entry,f.receipt),false);
  const recorded=readGeneratedDeckInitializationJournal(f.storage,f.scope);
  if(recorded.status!=="PENDING") throw new Error();
  assert.ok(closeVerifiedGeneratedDeckInitializationJournal(f.storage,f.scope,recorded.entry));
  assert.equal(readGeneratedDeckInitializationJournal(f.storage,f.scope).status,"EMPTY");
  assert.doesNotMatch(JSON.stringify(pending.entry),/sourceHtml|grantedAssetIds|storagePath/);
});

test("missing/corrupt/foreign/quota-failed storage stays unavailable, never automatically cleared",()=>{
  const f=fixture(); assert.equal(readGeneratedDeckInitializationJournal(null,f.scope).status,"UNAVAILABLE");
  const unavailable:HtmlSnapshotLocatorStorage={...f.storage,setItem:()=>{throw new Error("quota");}};
  assert.equal(beginGeneratedDeckInitializationJournal(unavailable,{scope:f.scope,request:f.body,createdAt:1}),false);
  assert.ok(beginGeneratedDeckInitializationJournal(f.storage,{scope:f.scope,request:f.body,createdAt:1}));
  const [key,raw]=[...f.values][0]; f.values.set(key,"{");
  assert.equal(readGeneratedDeckInitializationJournal(f.storage,f.scope).status,"UNAVAILABLE"); assert.equal(f.values.get(key),"{");
  f.values.set(key,JSON.stringify({...JSON.parse(raw),scope:{...f.scope,actorId:f.body.operationId}}));
  assert.equal(readGeneratedDeckInitializationJournal(f.storage,f.scope).status,"UNAVAILABLE");
});

test("journal rejects foreign receipts and replacement of a confirmed receipt",()=>{
  const f=fixture(); beginGeneratedDeckInitializationJournal(f.storage,{scope:f.scope,request:f.body,createdAt:1});
  const pending=readGeneratedDeckInitializationJournal(f.storage,f.scope); if(pending.status!=="PENDING") throw new Error();
  assert.equal(recordGeneratedDeckInitializationReceipt(f.storage,f.scope,pending.entry,{...f.receipt,owner:{...f.scope,draftId:f.body.operationId}}),false);
  assert.ok(recordGeneratedDeckInitializationReceipt(f.storage,f.scope,pending.entry,f.receipt));
  const recorded=readGeneratedDeckInitializationJournal(f.storage,f.scope); if(recorded.status!=="PENDING") throw new Error();
  assert.equal(recordGeneratedDeckInitializationReceipt(f.storage,f.scope,recorded.entry,{...f.receipt,documentVersion:3}),false);
});

test("browser/server request digests agree and POST transport performs one bounded same-origin nonretrying send",async()=>{
  const f=fixture(); assert.equal(await computeGeneratedDeckInitializationRequestSha256InBrowser(f.body.expectedDocumentHash),f.body.requestSha256);
  let calls=0;
  const receipt=await sendGeneratedDeckInitialization({...f,fetcher:async(url,options)=>{
    calls++; assert.match(String(url),/generated-deck-initialization$/); assert.equal(options?.method,"POST");
    assert.equal(options?.redirect,"error"); assert.equal(options?.cache,"no-store"); assert.equal(options?.credentials,"same-origin");
    assert.deepEqual(JSON.parse(String(options?.body)),f.body); return f.envelope(f.receipt);
  }});
  assert.deepEqual(receipt,f.receipt); assert.equal(calls,1);
  calls=0; await assert.rejects(sendGeneratedDeckInitialization({...f,fetcher:async()=>{calls++;throw new Error("lost ACK");}}));
  assert.equal(calls,1);
});

test("recovery GET and current-state GET are independent, readonly and owner/digest/hash/correlation verified",async()=>{
  const f=fixture(), identity={operationId:f.body.operationId,requestSha256:f.body.requestSha256}; let calls=0;
  const found=await consultGeneratedDeckInitialization({...f,identity,fetcher:async(_url,options)=>{calls++;assert.equal(options?.method,"GET");return f.envelope({status:"NOT_FOUND"});}});
  assert.equal(found.status,"NOT_FOUND"); assert.equal(calls,1);
  const current={scope:"GENERATED_DECK_CURRENT_INITIAL_REFERENCES_VERIFIED_NOT_RENDERED",receipt:f.receipt,documentHash:f.receipt.documentHash,documentVersion:2,fieldCount:1};
  assert.deepEqual(await consultCurrentGeneratedDeckInitialization({...f,identity,documentHash:f.receipt.documentHash,
    fetcher:async(url,options)=>{assert.match(String(url),/\/current\?/);assert.equal(options?.method,"GET");return f.envelope(current);}}),current);
  await assert.rejects(consultCurrentGeneratedDeckInitialization({...f,identity,documentHash:f.receipt.documentHash,
    fetcher:async()=>f.envelope({...current,documentVersion:3})}));
  await assert.rejects(consultGeneratedDeckInitialization({...f,identity,
    fetcher:async()=>f.envelope({status:"RECORDED",receipt:{...f.receipt,requestSha256:"f".repeat(64)}})}));
  await assert.rejects(sendGeneratedDeckInitialization({...f,fetcher:async()=>Response.json({success:true,requestId:f.scope.actorId,correlationId:f.body.operationId,data:f.receipt})}));
});
