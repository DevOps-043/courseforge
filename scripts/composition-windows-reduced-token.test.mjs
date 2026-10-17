import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";

test("reduced native route verifies token and uses CreateProcessAsUser without normal-token fallback", async () => {
  const source = await readFile(new URL("../apps/web/tools/controlled-hyperframes/windows/OwnedRenderJob.cs", import.meta.url), "utf8");
  assert.match(source, /CreateRestrictedToken\(original, DisableMaximumPrivilege \| LuaToken,/);
  assert.match(source, /ReadTokenScalar\(reduced, TokenElevationClass\) != 0 \|\| ReadTokenScalar\(reduced, TokenHasRestrictionsClass\) == 0/);
  assert.match(source, /SeChangeNotifyPrivilege/);
  assert.match(source, /TOKEN_PRIVILEGES_NOT_REDUCED/);
  const branch = source.slice(source.indexOf("if (desktop != null)"), source.indexOf("owned.process = new ProcessHandle"));
  assert.match(branch, /startup.Desktop = desktop/);
  assert.match(branch, /using \(var reduced = CreateReducedToken\(restrictingSid\)\)/);
  assert.match(branch, /CreateProcessAsUser\(reduced/);
  assert.match(branch, /REDUCED_PROCESS_CREATE_FAILED/);
  assert.doesNotMatch(branch, /catch|CreateProcessWithToken|CreateProcessWithLogon/);
  assert.ok(source.indexOf("CreateProcessAsUser(reduced") < source.indexOf("if (!AssignProcessToJobObject"));
  assert.ok(source.indexOf("if (!AssignProcessToJobObject") < source.indexOf("if (ResumeThread"));
});

test("operator-only V3 requires reduced policy and uses dedicated native entry", async () => {
  const script = await readFile(new URL("../apps/web/tools/controlled-hyperframes/windows/owned-job-bridge.ps1", import.meta.url), "utf8");
  assert.match(script, /WINDOWS_JOB_CONTROL_CHANNEL_V3/);
  assert.match(script, /WINDOWS_LUA_NO_PRIVILEGES_V1/);
  assert.match(script, /-ieq 'default'/);
  assert.match(script, /::StartReduced/);
  assert.doesNotMatch(script, /catch[^}]*::Start/s);
});

test("restricting SID is read back as exactly one matching SID, before child creation", async () => {
  const source = await readFile(new URL("../apps/web/tools/controlled-hyperframes/windows/OwnedRenderJob.cs", import.meta.url), "utf8");
  assert.match(source, /restrictingSid == null \? 0U : 1U, sidArray/);
  assert.match(source, /Attributes = 0/);
  assert.match(source, /Marshal.ReadInt32\(buffer\) != 1/);
  assert.match(source, /subAuthorities > 15/);
  assert.match(source, /EqualSid\(observed.Sid, expectedSid\)/);
  assert.match(source, /VerifyRestrictingSid\(reduced, sid\)/);
  assert.match(source, /LocalFree\(sid\)/);
  assert.doesNotMatch(source, /WriteRestricted|WRITE_RESTRICTED/);
  const script = await readFile(new URL("../apps/web/tools/controlled-hyperframes/windows/owned-job-bridge.ps1", import.meta.url), "utf8");
  assert.match(script, /WINDOWS_LUA_RESTRICTING_CAPABILITY_V2/);
  assert.match(script, /elseif \(\$withRestrictingSid\) \{\s+\$owned = .*::StartWithRestrictingSid/);
});

test("reduced native route rejects inherited temporary directories before job or process creation", async () => {
  const source = await readFile(new URL("../apps/web/tools/controlled-hyperframes/windows/OwnedRenderJob.cs", import.meta.url), "utf8");
  assert.match(source, /new \[\] \{"TEMP", "TMP", "TMPDIR"\}/);
  assert.match(source, /environment.TryGetValue\(name, out temporaryDirectory\)/);
  assert.match(source, /String.Equals\(temporaryDirectory, directory, StringComparison.OrdinalIgnoreCase\)/);
  assert.ok(source.indexOf('throw Failure("OWNED_TEMP_DIRECTORY_REQUIRED")') < source.indexOf("owned.job = CreateJobObject"));
});
