import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const native = await readFile(new URL("../apps/web/tools/controlled-hyperframes/windows/OwnedRenderAppContainer.cs", import.meta.url), "utf8");
const job = await readFile(new URL("../apps/web/tools/controlled-hyperframes/windows/OwnedRenderJob.cs", import.meta.url), "utf8");
const bridge = await readFile(new URL("../apps/web/tools/controlled-hyperframes/windows/owned-job-bridge.ps1", import.meta.url), "utf8");

test("AppContainer startup requests no capabilities and never provisions or downgrades", () => {
  assert.match(native, /var security = new SecurityCapabilities\(\); security.PackageSid = sid;/);
  assert.match(native, /new UIntPtr\(0x00020009\)/);
  assert.match(native, /Suspended \| UnicodeEnvironment \| NoWindow \| ExtendedStartup/);
  assert.match(native, /APPCONTAINER_PROCESS_CREATE_FAILED/);
  assert.doesNotMatch(native, /security\.(Count|Capabilities)\s*=/);
  assert.doesNotMatch(native, /CreateAppContainerProfile|CheckNetIsolation|CreateProcess\(/);
  assert.match(bridge, /WINDOWS_APPCONTAINER_NO_NETWORK_V5/);
  assert.match(bridge, /StartInAppContainer/);
});

test("actual child package SID, empty capabilities, non-elevation and ACL are checked before resume", () => {
  assert.match(native, /TokenIsAppContainerClass\) != 1/);
  assert.match(native, /TokenElevationClass\) != 0/);
  assert.match(native, /TokenCapabilitiesClass/);
  assert.match(native, /Marshal.ReadInt32\(buffer\) != 0/);
  assert.match(native, /TokenAppContainerSidClass/);
  assert.match(native, /EqualSid\(actual, sid\)/);
  assert.match(native, /TokenIntegrityLevelClass/);
  assert.match(native, /LowIntegritySid = "S-1-16-4096"/);
  assert.match(native, /VerifyFileAccessPreflight\(token,/);
  assert.ok(job.indexOf("AssignProcessToJobObject(owned.job, owned.process)") < job.indexOf("VerifyAppContainerChild(owned.process"));
  assert.ok(job.indexOf("VerifyAppContainerChild(owned.process") < job.indexOf("ResumeThread(thread)"));
});

test("attribute buffers and token handles are released and SID pointers are bounded before native use", () => {
  assert.match(native, /if \(initialized\) DeleteProcThreadAttributeList\(attributes\)/);
  assert.match(native, /Marshal.FreeHGlobal\(capabilities\)/);
  assert.match(native, /using \(token\)/);
  assert.match(native, /offset < headerBytes \|\| offset > returned - 8/);
  assert.match(native, /offset \+ 8 \+ components \* 4 > returned/);
  assert.match(native, /bytes.ToUInt64\(\) > 65536/);
});
