import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {mkdtemp, readdir, rm, rmdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {CompositionWindowsNetworkJournal} from "../qa/composition-windows-network-journal";
import {buildWindowsNetworkPlan} from "../qa/composition-windows-network-policy";
import {createWindowsOwnedNetworkPolicyInvoker} from "../qa/composition-windows-network-owned-policy-invoker";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "owned-network-invoke-")), journal = new CompositionWindowsNetworkJournal(directory);
  const scope = {hostId: "host", organizationId: randomUUID(), executionId: randomUUID(), appContainerSid: "S-1-15-2-1-2-3-4-5-6-7"};
  const intent = await journal.acquire(scope, randomUUID(), buildWindowsNetworkPlan(scope), new AbortController().signal);
  return {journal, intent, authority: {providerId: randomUUID(), sublayerId: randomUUID()},
    cleanup: async () => {for (const file of await readdir(directory)) await rm(join(directory, file)); await rmdir(directory);}};
}
test("managed operation receives frozen journal projection and result remains explicitly owned-only", async () => {
  const f = await fixture(), signal = new AbortController().signal; const operations: number[] = [];
  try {
    const invoker = createWindowsOwnedNetworkPolicyInvoker(f.authority, f.journal, async call => {
      operations.push(call.operation); assert.equal(call.previous, null); assert.equal(call.leaseId, f.intent.leaseId);
      assert.equal(call.packageSid, f.intent.scope.appContainerSid); assert.equal(call.providerId, f.authority.providerId);
      assert.equal(call.next.readBigUInt64LE(52), 1n);
      return {Scope: "OWNED_FILTERS_MATCH_NOT_EFFECTIVE_NETWORK_POLICY", Operation: call.operation,
        RecordSha256: createHash("sha256").update(call.next).digest("hex")};
    });
    const installed = await invoker.installInitialDenyAll(f.intent, signal);
    const observed = await invoker.readOwnedPolicy(f.intent, signal);
    assert.equal(installed.Scope, "OWNED_FILTERS_MATCH_NOT_EFFECTIVE_NETWORK_POLICY"); assert.equal(observed.Scope, installed.Scope);
    assert.deepEqual(operations, [1, 3]); assert.equal(invoker.isQuarantined(), false);
  } finally {await f.cleanup();}
});
test("foreign record result cannot be promoted or retried", async () => {
  const f = await fixture(), signal = new AbortController().signal; let calls = 0;
  try {
    const invoker = createWindowsOwnedNetworkPolicyInvoker(f.authority, f.journal, async call => {
      calls++; return {Scope: "OWNED_FILTERS_MATCH_NOT_EFFECTIVE_NETWORK_POLICY", Operation: call.operation, RecordSha256: "f".repeat(64)};
    });
    await assert.rejects(invoker.installInitialDenyAll(f.intent, signal), /RECOVERY_REQUIRED/);
    await assert.rejects(invoker.readOwnedPolicy(f.intent, signal), /RECOVERY_REQUIRED/);
    assert.equal(calls, 1); assert.equal(invoker.isQuarantined(), true);
  } finally {await f.cleanup();}
});
test("changed journal identity is rejected before managed effects", async () => {
  const f = await fixture(); let calls = 0;
  try {
    const invoker = createWindowsOwnedNetworkPolicyInvoker(f.authority, f.journal, async () => {calls++; return {};});
    const changed = structuredClone(f.intent); changed.filterKeys[0] = randomUUID();
    await assert.rejects(invoker.installInitialDenyAll(changed, new AbortController().signal), /RECOVERY_REQUIRED/);
    assert.equal(calls, 0);
  } finally {await f.cleanup();}
});
