import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";

// Structural checks do not prove Win32 resource enforcement; physical QA remains separate.
test("native CPU hard cap is configured and read back before process creation or resume", async () => {
  const native = await readFile(new URL("../apps/web/tools/controlled-hyperframes/windows/OwnedRenderJob.cs", import.meta.url), "utf8");
  assert.match(native, /CpuRateControlClass = 15/);
  assert.match(native, /cpu.Flags = CpuRateEnable \| CpuRateHardCap; cpu.Rate = cpuRatePercent \* 100/);
  const configure = native.indexOf("SetInformationJobObject(owned.job, CpuRateControlClass");
  const readback = native.indexOf("observedCpu.Flags != cpu.Flags || observedCpu.Rate != cpu.Rate");
  const create = native.indexOf("if (!CreateProcess(");
  const resume = native.indexOf("if (ResumeThread(");
  assert.ok(configure > 0 && readback > configure && create > readback && resume > create);
  assert.match(native, /CPU_RATE_CONFIGURE_FAILED/);
  assert.match(native, /CPU_RATE_READBACK_FAILED/);
  assert.match(native, /CPU_RATE_READBACK_MISMATCH/);
});

test("PowerShell V2 validates exact quota fields and calls the hard-cap entry, with no V2 fallback", async () => {
  const bridge = await readFile(new URL("../apps/web/tools/controlled-hyperframes/windows/owned-job-bridge.ps1", import.meta.url), "utf8");
  assert.match(bridge, /WINDOWS_JOB_CONTROL_CHANNEL_V2/);
  assert.match(bridge, /cpuRatePercent,jobMemoryBytes,maximumProcesses,policy,processMemoryBytes,userCpuSeconds/);
  assert.match(bridge, /Assert-IntegerBound \$limits.cpuRatePercent 1 100/);
  assert.match(bridge, /\$limits.processMemoryBytes -gt \$limits.jobMemoryBytes/);
  assert.ok(bridge.indexOf("Assert-IntegerBound $limits.cpuRatePercent") < bridge.indexOf("::StartWithCpuRate("));
  assert.match(bridge, /if \(\$withResources\) \{\s+\$owned = .*::StartWithCpuRate/);
  assert.doesNotMatch(bridge, /catch[^}]*::Start\(/s);
});
