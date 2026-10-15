import assert from "node:assert/strict";
import test from "node:test";
import {resolve} from "node:path";
import {windowsReducedTokenSchema, windowsRestrictingSidSchema, windowsAppContainerSidSchema} from "../qa/composition-windows-reduced-token-policy";

const sid = "S-1-15-3-1024-1-2-3-4-5-6-7-4294967295";
test("AppContainer accepts only a canonical private package SID and no requested capabilities or downgrade", () => {
  const appContainerSid = "S-1-15-2-1-2-3-4-5-6-4294967295";
  const policy = {policy: "WINDOWS_APPCONTAINER_NO_NETWORK_V5", desktop: "winsta0\\isolated", appContainerSid,
    readOnlyPaths: [resolve("apps/web/.tmp/install")], deniedPaths: [resolve("apps/web/.tmp/secrets")],
    treeAudit: {maximumEntries: 4096, maximumDepth: 16, timeoutMilliseconds: 10000}};
  assert.deepEqual(windowsReducedTokenSchema.parse(policy), policy);
  for (const candidate of [sid, "S-1-15-2-1", appContainerSid + "\n", appContainerSid + "-1",
    appContainerSid.replace("4294967295", "4294967296"), appContainerSid.replace("-1-2-3", "-01-2-3")])
    assert.equal(windowsAppContainerSidSchema.safeParse(candidate).success, false);
  for (const mutation of [{capabilities: ["internetClient"]}, {appContainerSid: undefined}, {restrictingSid: sid},
    {policy: "WINDOWS_LUA_ACL_TREE_PREFLIGHT_V4"}, {treeAudit: undefined}, {deniedPaths: policy.readOnlyPaths}])
    assert.equal(windowsReducedTokenSchema.safeParse({...policy, ...mutation}).success, false);
});
test("restrictor accepts only canonical capability SID with eight uint32 components", () => {
  assert.equal(windowsRestrictingSidSchema.parse(sid), sid);
  for (const candidate of ["S-1-1-0", "S-1-5-32-545", "S-1-5-21-1-2-3-1000",
    sid + "\n", sid.replace("4294967295", "4294967296"), sid.replace("-1-2", "-01-2"),
    sid.replace("-1-2", "-2"), sid + "-1", sid.toLowerCase()])
    assert.equal(windowsRestrictingSidSchema.safeParse(candidate).success, false, candidate);
});

test("ACL preflight policy requires bounded canonical operator paths and cannot degrade to SID-only", () => {
  const policy = {policy: "WINDOWS_LUA_ACL_PREFLIGHT_V3", desktop: "winsta0\\isolated", restrictingSid: sid,
    readOnlyPaths: [resolve("apps/web/.tmp/install")], deniedPaths: [resolve("apps/web/.tmp/secrets")]};
  assert.deepEqual(windowsReducedTokenSchema.parse(policy), policy);
  for (const mutation of [{readOnlyPaths: []}, {deniedPaths: []}, {deniedPaths: ["relative"]},
    {readOnlyPaths: Array(33).fill(policy.readOnlyPaths[0])}, {deniedPaths: [policy.deniedPaths[0], policy.deniedPaths[0].toUpperCase()]},
    {policy: "WINDOWS_LUA_RESTRICTING_CAPABILITY_V2"}, {deniedPaths: ["\\\\server\\share"]},
    {deniedPaths: policy.readOnlyPaths}, {fallback: true}])
    assert.equal(windowsReducedTokenSchema.safeParse({...policy, ...mutation}).success, false);
});

test("tree auditing requires explicit bounds and cannot downgrade to root-only policy", () => {
  const policy = {policy: "WINDOWS_LUA_ACL_TREE_PREFLIGHT_V4", desktop: "winsta0\\isolated", restrictingSid: sid,
    readOnlyPaths: [resolve("apps/web/.tmp/install")], deniedPaths: [resolve("apps/web/.tmp/secrets")],
    treeAudit: {maximumEntries: 4096, maximumDepth: 16, timeoutMilliseconds: 10000}};
  assert.deepEqual(windowsReducedTokenSchema.parse(policy), policy);
  for (const mutation of [{maximumEntries: 0}, {maximumEntries: 50001}, {maximumDepth: 65},
    {maximumDepth: 0}, {timeoutMilliseconds: 99}, {timeoutMilliseconds: 60001}, {maximumEntries: "4096"}, {skip: true}])
    assert.equal(windowsReducedTokenSchema.safeParse({...policy, treeAudit: {...policy.treeAudit, ...mutation}}).success, false);
  assert.equal(windowsReducedTokenSchema.safeParse({...policy, treeAudit: undefined}).success, false);
  assert.equal(windowsReducedTokenSchema.safeParse({...policy, policy: "WINDOWS_LUA_ACL_PREFLIGHT_V3"}).success, false);
});
test("V2 requires restricting SID, rejects unknown fields and leaves V1 explicit", () => {
  const policy = {policy: "WINDOWS_LUA_RESTRICTING_CAPABILITY_V2", desktop: "winsta0\\isolated", restrictingSid: sid};
  assert.deepEqual(windowsReducedTokenSchema.parse(policy), policy);
  assert.equal(windowsReducedTokenSchema.safeParse({...policy, restrictingSid: undefined}).success, false);
  assert.equal(windowsReducedTokenSchema.safeParse({...policy, fallback: true}).success, false);
  assert.equal(windowsReducedTokenSchema.safeParse({...policy, desktop: "winsta0\\default"}).success, false);
  assert.equal(windowsReducedTokenSchema.safeParse({...policy, policy: "WINDOWS_LUA_NO_PRIVILEGES_V1"}).success, false);
  assert.equal(windowsReducedTokenSchema.safeParse({policy: "WINDOWS_LUA_NO_PRIVILEGES_V1", desktop: policy.desktop}).success, true);
});
