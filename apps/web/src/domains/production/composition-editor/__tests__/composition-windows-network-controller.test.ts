import assert from "node:assert/strict";
import test from "node:test";
import {buildWindowsNetworkPlan, type WindowsNetworkPlan} from "../qa/composition-windows-network-policy";
import {createWindowsNetworkController, type WindowsNetworkControllerPorts} from "../qa/composition-windows-network-controller";

const scope = {hostId: "isolated-host", organizationId: "00000000-0000-4000-8000-000000000001",
  executionId: "00000000-0000-4000-8000-000000000002", appContainerSid: "S-1-15-2-1-2-3-4-5-6-7"};
const endpoint = {address: "127.0.0.1" as const, port: 49152, protocol: "TCP" as const};

function backend() {
  let stored: {leaseId: string; generation: number; planSha256: string; persistent: true} | undefined;
  const plans: WindowsNetworkPlan[] = [];
  const ports: WindowsNetworkControllerPorts = {
    acquireAndDenyAll: async (_scope, leaseId, plan) => {
      plans.push(plan); stored = {leaseId, generation: 1, planSha256: plan.sha256, persistent: true}; return {...stored};
    },
    readEffectivePolicy: async () => ({...stored}),
    resolveOriginalServer: async () => ({...endpoint}),
    replaceAtomically: async (_scope, leaseId, previousGeneration, plan) => {
      assert.equal(stored?.leaseId, leaseId); assert.equal(stored.generation, previousGeneration);
      plans.push(plan); stored = {...stored, generation: previousGeneration + 1, planSha256: plan.sha256}; return {...stored};
    },
    confirmOwnedJobStopped: async (scope, leaseId) => ({executionId: scope.executionId, leaseId, activeProcesses: 0, jobClosed: true}),
  };
  return {ports, plans, controller: createWindowsNetworkController(scope, ports)};
}

test("network rule plan blocks each disallowed predicate separately in both address families", () => {
  for (const address of ["127.0.0.1", "::1"] as const) {
    const plan = buildWindowsNetworkPlan(scope, {...endpoint, address});
    assert.equal(plan.rules.length, 9);
    assert.ok(plan.rules.every(rule => rule.action === "BLOCK" && rule.conditions[0].value === scope.appContainerSid));
    for (const direction of ["ALE_AUTH_CONNECT", "ALE_AUTH_RECV_ACCEPT"]) {
      const layer = `${direction}_${address === "::1" ? "V6" : "V4"}`;
      const rules = plan.rules.filter(rule => rule.layer === layer);
      const outbound = direction.endsWith("CONNECT");
      for (const protocol of [6, 17, 1]) for (const port of [endpoint.port, 80]) for (const peer of [address, "external"]) {
        const fields: Record<string, string | number> = {PACKAGE_ID: scope.appContainerSid, PROTOCOL: protocol,
          REMOTE_ADDRESS: peer, LOCAL_ADDRESS: peer, LOCAL_PORT: port, REMOTE_PORT: port};
        const blocked = rules.some(rule => rule.conditions.every(condition => condition.comparison === "EQUAL"
          ? fields[condition.field] === condition.value : fields[condition.field] !== condition.value));
        assert.equal(blocked, protocol !== 6 || port !== endpoint.port || peer !== address);
      }
      if (!outbound) assert.ok(rules.some(rule => rule.conditions.some(condition => condition.field === "REMOTE_ADDRESS")));
    }
    assert.equal(plan.lifetime, "PERSISTENT_UNTIL_EXPLICIT_RECONCILIATION");
    assert.equal(buildWindowsNetworkPlan(scope, {...endpoint, address}).sha256, plan.sha256);
  }
  assert.equal(buildWindowsNetworkPlan(scope).rules.length, 4);
  assert.throws(() => buildWindowsNetworkPlan(scope, {...endpoint, address: "localhost" as "127.0.0.1"}));
  assert.throws(() => buildWindowsNetworkPlan({...scope, appContainerSid: "S-1-1-0"}));
});

test("controller requires persistent readback before each transition and never deletes policy", async () => {
  const f = backend(), signal = new AbortController().signal;
  assert.equal(f.controller.status(), "NEW");
  await f.controller.denyBeforeStart(signal); assert.equal(f.controller.status(), "DENIED");
  await f.controller.allowOriginalServer(signal); assert.equal(f.controller.status(), "LOCAL_ONLY");
  await f.controller.sealAfterStop(signal); assert.equal(f.controller.status(), "SEALED");
  assert.deepEqual(f.plans.map(plan => plan.mode), ["DENY_ALL", "EXACT_LOOPBACK", "DENY_ALL"]);
  await assert.rejects(f.controller.allowOriginalServer(signal), /STATE_INVALID/);
});

test("lost write ACK retains policy and forbids retries or permissive fallback", async () => {
  const f = backend(), signal = new AbortController().signal;
  const acquire = f.ports.acquireAndDenyAll;
  f.ports.acquireAndDenyAll = async (...args) => {await acquire(...args); throw new Error("private broker details");};
  await assert.rejects(f.controller.denyBeforeStart(signal), {message: "CONTROLLED_RENDER_NETWORK_CONTROLLER_RECOVERY_REQUIRED"});
  assert.equal(f.controller.status(), "RECOVERY_REQUIRED"); assert.equal(f.plans.length, 1);
  await assert.rejects(f.controller.denyBeforeStart(signal), /STATE_INVALID/);
  await assert.rejects(f.controller.allowOriginalServer(signal), /STATE_INVALID/);
});

test("foreign, nonpersistent or stale readback cannot authorize worker start", async () => {
  for (const changed of [{leaseId: scope.executionId}, {generation: 2}, {planSha256: "f".repeat(64)}, {persistent: false}]) {
    const f = backend(), read = f.ports.readEffectivePolicy;
    f.ports.readEffectivePolicy = async (...args) => ({...await read(...args) as object, ...changed});
    await assert.rejects(f.controller.denyBeforeStart(new AbortController().signal), /RECOVERY_REQUIRED/);
    assert.equal(f.controller.status(), "RECOVERY_REQUIRED"); assert.equal(f.plans.length, 1);
  }
});

test("invalid original-server attestation cannot widen deny-all", async () => {
  const f = backend(), signal = new AbortController().signal;
  await f.controller.denyBeforeStart(signal);
  f.ports.resolveOriginalServer = async () => ({...endpoint, address: "192.168.1.1"});
  await assert.rejects(f.controller.allowOriginalServer(signal), /RECOVERY_REQUIRED/);
  assert.equal(f.plans.length, 1); assert.equal(f.controller.status(), "RECOVERY_REQUIRED");
});

test("concurrent start on one controller is rejected synchronously before a second acquisition", async () => {
  const f = backend(), acquire = f.ports.acquireAndDenyAll;
  let release!: () => void; const gate = new Promise<void>(resolve => {release = resolve;});
  f.ports.acquireAndDenyAll = async (...args) => {await gate; return acquire(...args);};
  const signal = new AbortController().signal, started = f.controller.denyBeforeStart(signal);
  await assert.rejects(f.controller.denyBeforeStart(signal), /STATE_INVALID/);
  release(); await started; assert.equal(f.plans.length, 1);
});

test("sealing retains deny-all and requires an exact closed-job observation", async () => {
  const f = backend(), signal = new AbortController().signal;
  await f.controller.denyBeforeStart(signal); await f.controller.allowOriginalServer(signal);
  f.ports.confirmOwnedJobStopped = async () => ({executionId: scope.executionId, activeProcesses: 1, jobClosed: false});
  await assert.rejects(f.controller.sealAfterStop(signal), /RECOVERY_REQUIRED/);
  assert.equal(f.plans.at(-1)?.mode, "DENY_ALL"); assert.equal(f.controller.status(), "RECOVERY_REQUIRED");
});

test("abort returns without waiting for a noncooperative adapter and rejects its late ACK", async () => {
  const f = backend(), acquire = f.ports.acquireAndDenyAll, abort = new AbortController();
  let release!: () => void; const gate = new Promise<void>(resolve => {release = resolve;});
  f.ports.acquireAndDenyAll = async (...args) => {await gate; return acquire(...args);};
  const started = f.controller.denyBeforeStart(abort.signal);
  const rejected = assert.rejects(started, /RECOVERY_REQUIRED/); abort.abort(); await rejected;
  assert.equal(f.controller.status(), "RECOVERY_REQUIRED");
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.controller.status(), "RECOVERY_REQUIRED"); assert.equal(f.plans.length, 1);
});
