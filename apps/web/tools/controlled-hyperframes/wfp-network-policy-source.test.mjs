import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";

// Source invariants only. No native compilation, SDK loading, WFP calls or kernel proof.
const root = new URL("./windows/network-controller/", import.meta.url);
const source = await readFile(new URL("WfpNetworkPolicy.cpp", root), "utf8");
const header = await readFile(new URL("WfpNetworkPolicy.h", root), "utf8");
const build = await readFile(new URL("CMakeLists.txt", root), "utf8");

test("native network artifacts are Windows SDK libraries with no automatic activation", () => {
  assert.match(header, /#include <fwpmu\.h>/);
  assert.match(build, /add_library\(courseforge_network_policy STATIC/);
  assert.match(build, /add_library\(courseforge_network_bridge SHARED/);
  assert.match(build, /NOT WIN32 OR NOT MSVC/);
  assert.match(build, /CMAKE_SIZEOF_VOID_P EQUAL 8/);
  assert.doesNotMatch(build, /add_executable\(|install\(/);
  assert.doesNotMatch(source, /\bmain\s*\(|CreateService|FwpmProviderAdd|FwpmSubLayerAdd|FWPM_SESSION_FLAG_DYNAMIC/);
});

test("replacement verifies exact ownership before deleting only prior keys in the transaction", () => {
  const replacement = source.slice(source.indexOf("PolicyResult ReplaceOwnedPolicy("), source.indexOf("PolicyResult ReadOwnedPolicy("));
  for (const bound of ["provider", "sublayer", "lease", "packageSid", "generation"]) assert.ok(replacement.includes(`identity.${bound}`));
  const ordered = ["Transaction transaction", "ReadExact(engine.value, previous", "AddExact(engine.value, next",
    "FwpmFilterDeleteByKey0", "ReadExact(engine.value, next", "transaction.Commit()"];
  let cursor = 0;
  for (const anchor of ordered) {const index = replacement.indexOf(anchor, cursor); assert.ok(index >= cursor, anchor); cursor = index + anchor.length;}
  assert.match(replacement, /for \(const auto& key : previous\.filterKeys\)/);
  assert.match(source, /~Transaction\(\) \{ if \(open\) FwpmTransactionAbort0/);
});

test("readback checks persistent filter content, SID, generation metadata and four ALE layers", () => {
  for (const layer of ["ALE_AUTH_CONNECT_V4", "ALE_AUTH_CONNECT_V6", "ALE_AUTH_RECV_ACCEPT_V4", "ALE_AUTH_RECV_ACCEPT_V6"])
    assert.ok(source.includes(`FWPM_LAYER_${layer}`));
  for (const invariant of ["observed.flags == FWPM_FILTER_FLAG_PERSISTENT", "observed.action.type == FWP_ACTION_BLOCK",
    "observed.providerData.size == sizeof(Metadata)", "observed.numFilterConditions == rule.conditions.size()",
    "EqualSid(left.sid, right.sid)", "GetSidSubAuthorityCount(parsedSid) == 8"])
    assert.ok(source.includes(invariant), invariant);
  assert.doesNotMatch(source, /FWP_ACTION_PERMIT/);
});
