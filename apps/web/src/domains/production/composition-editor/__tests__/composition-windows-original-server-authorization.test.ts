import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createWindowsOriginalServerAuthorization} from "../qa/composition-windows-original-server-authorization";
import {createWindowsNetworkCommandClient} from "../qa/composition-windows-network-command-client";
import {buildWindowsNetworkPlan} from "../qa/composition-windows-network-policy";

const root = {pid: 123, creationFileTime: "133000000000000001"};
const candidate = {serverUrl: "http://localhost:43210", address: "127.0.0.1" as const, port: 43210};
const signal = () => new AbortController().signal;
function fixture(changedAfterAllow = false) {
  const binding = {channelId: randomUUID(), operationNonce: randomUUID(), scope: {hostId: "host",
    organizationId: randomUUID(), executionId: randomUUID(), appContainerSid: "S-1-15-2-1-2-3-4-5-6-7"}};
  const commands: string[] = []; let observations = 0;
  const client = createWindowsNetworkCommandClient(binding, async bytes => {
    const request = JSON.parse(bytes.toString()); commands.push(request.command);
    const plan = buildWindowsNetworkPlan(binding.scope, request.sequence === 2 ? {address: candidate.address, port: candidate.port, protocol: "TCP"} : undefined);
    return Buffer.from(JSON.stringify({...request, receipt: {leaseId: "00000000-0000-4000-8000-000000000001",
      generation: request.sequence, planSha256: plan.sha256, persistent: true}}));
  });
  const authorize = createWindowsOriginalServerAuthorization(root, {observeOriginalListener: async port => {
    observations++;
    return {address: "127.0.0.1", port, rootIdentity: changedAfterAllow && observations > 1 ? {...root, pid: 999} : root};
  }}, client);
  return {client, authorize, commands, observations: () => observations};
}

test("candidate needs prior deny ACK and two independent listener observations around broker allow", async () => {
  const f = fixture(); await f.client.denyBeforeStart(signal());
  assert.deepEqual(await f.authorize(candidate, signal()), {status: "AUTHORIZED", address: candidate.address, port: candidate.port});
  assert.equal(f.observations(), 2); assert.equal(f.client.status(), "LOCAL_ONLY");
  await f.authorize(candidate, signal()); assert.equal(f.observations(), 4);
  assert.deepEqual(f.commands, ["DENY_BEFORE_START", "ALLOW_ORIGINAL_SERVER"]);
});

test("changed owner during broker transaction cannot grant producer ACK or retry", async () => {
  const f = fixture(true); await f.client.denyBeforeStart(signal());
  await assert.rejects(f.authorize(candidate, signal()), /RECOVERY_REQUIRED/);
  await assert.rejects(f.authorize(candidate, signal()), /RECOVERY_REQUIRED/);
  assert.equal(f.observations(), 2); assert.equal(f.commands.length, 2);
});

test("unprepared client and noncanonical candidate fail without implicit network grant", async () => {
  for (const input of [candidate, {...candidate, serverUrl: "http://evil.test:43210"}, {...candidate, port: 43211}]) {
    const f = fixture(); await assert.rejects(f.authorize(input, signal()), /RECOVERY_REQUIRED/);
    assert.equal(f.commands.length, 0);
  }
});
