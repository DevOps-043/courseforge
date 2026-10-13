import assert from "node:assert/strict";
import {mkdtemp, readdir, rm, rmdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {CompositionWindowsNetworkJournal} from "../qa/composition-windows-network-journal";
import {buildWindowsNetworkPlan} from "../qa/composition-windows-network-policy";
import {encodeWindowsNetworkNativeRecord} from "../qa/composition-windows-network-native-record";

test("native record binds journal bytes and serializes bounded Windows GUID and LE fields without native pointers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "native-network-record-"));
  const scope = {hostId: "host", organizationId: randomUUID(), executionId: randomUUID(), appContainerSid: "S-1-15-2-1-2-3-4-5-6-7"};
  const config = {providerId: "00112233-4455-4677-8899-aabbccddeeff", sublayerId: randomUUID()};
  try {
    const intent = await new CompositionWindowsNetworkJournal(directory).acquire(scope, randomUUID(), buildWindowsNetworkPlan(scope), new AbortController().signal);
    const record = encodeWindowsNetworkNativeRecord(intent, config);
    assert.equal(record.readUInt32LE(0), 1);
    assert.equal(record.subarray(4, 20).toString("hex"), "33221100554477468899aabbccddeeff");
    assert.equal(record.readBigUInt64LE(52), 1n); assert.equal(record.subarray(60, 92).toString("hex"), intent.plan.sha256);
    assert.equal(record[92], 0); assert.equal(record[93], 0); assert.equal(record.readUInt16LE(94), 0);
    const sidLength = record.readUInt16LE(96);
    assert.equal(record.subarray(98, 98 + sidLength).toString("ascii"), scope.appContainerSid);
    assert.equal(record.readUInt16LE(98 + sidLength), 4); assert.equal(record.length, 100 + sidLength + 4 * 16);
    const changed = structuredClone(intent); changed.filterKeys[0] = randomUUID();
    assert.throws(() => encodeWindowsNetworkNativeRecord(changed, config), /RECOVERY_REQUIRED/);
    assert.throws(() => encodeWindowsNetworkNativeRecord(intent, {...config, providerId: "invalid"}), /RECOVERY_REQUIRED/);
  } finally {for (const file of await readdir(directory)) await rm(join(directory, file)); await rmdir(directory);}
});
