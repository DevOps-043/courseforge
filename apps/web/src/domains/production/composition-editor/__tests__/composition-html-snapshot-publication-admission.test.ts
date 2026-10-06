import assert from "node:assert/strict";
import test from "node:test";
import {resolveHtmlSnapshotPublicationAdmission} from "../composition-html-snapshot-publication-admission";
import {htmlEditingFixtureId as uuid} from "./composition-html-editing-test-fixtures";
import {canCloseHtmlSnapshotTracking,type HtmlSnapshotRecoverySummary} from "../composition-html-snapshot-recovery.contract";

function fixture() {return {enabled:true,trackingReady:true,trackingPending:false,storageAvailable:true,lockAvailable:true,
  context:{documentHash:"a".repeat(64) as string | null,hasHtmlEditing:true,snapshotHistoryLoaded:true,
    expectedActiveRevisionId:null as string | null,renderProfileId:"balanced" as const,saving:false,otherWorkPending:false,previewPending:false}};}
test("saved HTML document and known null or UUID active revision are eligible, not authorization", () => {
  const f=fixture();assert.equal(resolveHtmlSnapshotPublicationAdmission(f),"READY");
  f.context.expectedActiveRevisionId=uuid;assert.equal(resolveHtmlSnapshotPublicationAdmission(f),"READY");
});
test("disabled feature or native-only document never offers HTML publication", () => {
  const f=fixture();f.enabled=false;assert.equal(resolveHtmlSnapshotPublicationAdmission(f),"DISABLED");
  f.enabled=true;f.context.hasHtmlEditing=false;assert.equal(resolveHtmlSnapshotPublicationAdmission(f),"NOT_HTML");
});
test("unknown tracking or active-revision history is not equivalent to no prior revision", () => {
  for (const configure of [(f:ReturnType<typeof fixture>) => {f.trackingReady=false;},
    (f:ReturnType<typeof fixture>) => {f.context.snapshotHistoryLoaded=false;}]) {
    const f=fixture();configure(f);assert.equal(resolveHtmlSnapshotPublicationAdmission(f),"NOT_READY");
  }
});
test("pending locator blocks new registration even when previous HTTP attempt is finished", () => {
  const f=fixture();f.trackingPending=true;assert.equal(resolveHtmlSnapshotPublicationAdmission(f),"PENDING_OPERATION");
});
test("storage and cooperative cross-tab lock are both required without insecure fallback", () => {
  for (const patch of [{storageAvailable:false},{lockAvailable:false}]) {
    assert.equal(resolveHtmlSnapshotPublicationAdmission({...fixture(),...patch}),"BROWSER_UNAVAILABLE");
  }
});
test("save queues, staged previews and assembly/render work block publication", () => {
  for (const patch of [{saving:true},{previewPending:true}]) {
    const f=fixture();Object.assign(f.context,patch);assert.equal(resolveHtmlSnapshotPublicationAdmission(f),"SAVE_OR_PREVIEW_PENDING");
  }
  const f=fixture();f.context.otherWorkPending=true;assert.equal(resolveHtmlSnapshotPublicationAdmission(f),"OTHER_WORK_PENDING");
});
test("missing or malformed saved hash and active identity fail closed", () => {
  for (const patch of [{documentHash:null},{documentHash:"optimistic-local-hash"},{expectedActiveRevisionId:"unknown"}]) {
    const f=fixture();Object.assign(f.context,patch);assert.equal(resolveHtmlSnapshotPublicationAdmission(f),"INVALID_SAVED_IDENTITY");
  }
});
test("terminal response cannot clear a locator replaced by another operation", () => {
  const summary:HtmlSnapshotRecoverySummary={operationId:uuid,status:"COMMITTED_ACTIVE",revisionId:uuid,revisionNumber:1,currentActiveRevisionId:uuid,
    automaticRetryAllowed:false,scope:"DATABASE_REGISTRATION_NOT_STORAGE_OR_RENDER_ATTESTATION"};
  assert.equal(canCloseHtmlSnapshotTracking(uuid,summary),true);
  assert.equal(canCloseHtmlSnapshotTracking("22222222-2222-4222-8222-222222222222",summary),false);
  assert.equal(canCloseHtmlSnapshotTracking(null,summary),false);
  assert.equal(canCloseHtmlSnapshotTracking(uuid,null),false);
  assert.equal(canCloseHtmlSnapshotTracking(uuid,{operationId:uuid,status:"INTENT_ONLY",automaticRetryAllowed:false,scope:summary.scope}),false);
});
