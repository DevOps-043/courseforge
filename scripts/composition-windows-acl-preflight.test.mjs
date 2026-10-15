import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";

test("ACL preflight uses an impersonation clone of the reduced token and fails closed on API errors", async () => {
  const source = await readFile(new URL("../apps/web/tools/controlled-hyperframes/windows/OwnedRenderAccess.cs", import.meta.url), "utf8");
  assert.match(source, /DuplicateToken\(primary, SecurityImpersonationLevel, out impersonation\)/);
  assert.match(source, /GetNamedSecurityInfo\(path, FileObjectType, OwnerGroupDacl/);
  assert.match(source, /AccessCheck\(descriptor, impersonation, desired/);
  assert.match(source, /allowed != expectedAllowed/);
  assert.match(source, /ACL_PREFLIGHT_CHECK_FAILED/);
  assert.match(source, /FileAttributes.ReparsePoint/);
  assert.doesNotMatch(source, /SetNamedSecurityInfo|SetAccessControl|SetFileSecurity/);
});
test("denied paths check individual rights, and preflight precedes suspended process creation", async () => {
  const source = await readFile(new URL("../apps/web/tools/controlled-hyperframes/windows/OwnedRenderAccess.cs", import.meta.url), "utf8");
  assert.match(source, /AssertFileAccess\(impersonation, path, ReadData, false\)/);
  assert.match(source, /AssertFileAccess\(impersonation, path, Execute, false\)/);
  assert.match(source, /foreach \(uint right in FileModificationRights\)/);
  const job = await readFile(new URL("../apps/web/tools/controlled-hyperframes/windows/OwnedRenderJob.cs", import.meta.url), "utf8");
  assert.ok(job.indexOf("VerifyFileAccessPreflight(reduced") < job.indexOf("if (!CreateProcessAsUser(reduced"));
  const bridge = await readFile(new URL("../apps/web/tools/controlled-hyperframes/windows/owned-job-bridge.ps1", import.meta.url), "utf8");
  assert.match(bridge, /WINDOWS_LUA_ACL_PREFLIGHT_V3/);
  assert.match(bridge, /elseif \(\$withAclPreflight\) \{\s+\$owned = .*::StartWithAclPreflight/);
  assert.match(bridge, /OwnedRenderAccess.cs/);
});

test("explicit tree audit traverses both roles, rejects reparse points and bounds entries/depth/deadline", async () => {
  const source = await readFile(new URL("../apps/web/tools/controlled-hyperframes/windows/OwnedRenderAccess.cs", import.meta.url), "utf8");
  assert.match(source, /depth > MaximumDepth \|\| entries >= MaximumEntries \|\| !visited.Add\(path\)/);
  assert.match(source, /Directory.EnumerateFileSystemEntries\(directory\)/);
  assert.match(source, /ACL_TREE_DEADLINE_EXCEEDED/);
  assert.match(source, /AuditAclTree\(impersonation, path, true, 0, treeAudit\)/);
  assert.match(source, /AuditAclTree\(impersonation, path, false, 0, treeAudit\)/);
  assert.match(source, /foreach \(var child in before\) AuditAclTree\(token, child, readOnly, depth \+ 1, audit\)/);
  assert.match(source, /string\[\] after = audit.Enumerate\(path\)/);
  assert.match(source, /ACL_TREE_CHANGED/);
  const walk = source.indexOf("private static void AuditAclTree(");
  assert.ok(walk >= 0 && source.indexOf("ValidateAclProbePath(path);", walk) < source.indexOf("string[] before = audit.Enumerate(path)", walk));
  const script = await readFile(new URL("../apps/web/tools/controlled-hyperframes/windows/owned-job-bridge.ps1", import.meta.url), "utf8");
  assert.match(script, /if \(\$withAclTree\) \{\s+\$owned = .*::StartWithAclTreePreflight/);
  assert.match(script, /Assert-IntegerBound \$audit.maximumEntries 1 50000/);
});
