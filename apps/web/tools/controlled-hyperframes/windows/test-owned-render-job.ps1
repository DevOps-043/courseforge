param([Parameter(Mandatory=$true)][string]$NodePath)
$ErrorActionPreference = 'Stop'
if (-not ('Courseforge.ControlledRender.OwnedRenderJob' -as [type])) {
  Add-Type -Path @((Join-Path $PSScriptRoot 'OwnedRenderJob.cs'), (Join-Path $PSScriptRoot 'OwnedRenderAccess.cs'), (Join-Path $PSScriptRoot 'OwnedRenderAppContainer.cs'))
}
$fixturePath = Join-Path $PSScriptRoot 'job-fixture.mjs'
$taskParent = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..\..\..\.tmp'))
if (-not (Test-Path -LiteralPath $taskParent)) { New-Item -ItemType Directory -Path $taskParent | Out-Null }
$taskDirectory = Join-Path $taskParent ('cap027-native-job-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskDirectory | Out-Null
$environment = New-Object 'System.Collections.Generic.Dictionary[string,string]'
foreach ($key in @('PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP')) {
  $value = [Environment]::GetEnvironmentVariable($key)
  if ($null -ne $value) { $environment.Add($key, $value) }
}
$owned = $null
$previousSyntheticSecret = [Environment]::GetEnvironmentVariable('CAP027_TEST_SECRET')
try {
  $owned = [Courseforge.ControlledRender.OwnedRenderJob]::Start($NodePath, @($fixturePath, 'root', $taskDirectory),
    $taskDirectory, $environment, 8, 536870912, 1073741824, 10)
  $clock = [Diagnostics.Stopwatch]::StartNew()
  while (-not (Test-Path -LiteralPath (Join-Path $taskDirectory 'grandchild.json'))) {
    if ($clock.ElapsedMilliseconds -ge 5000) { throw 'NATIVE_JOB_FIXTURE_START_TIMEOUT' }
    Start-Sleep -Milliseconds 20
  }
  $membersBefore = $owned.ActiveProcesses()
  if ($membersBefore -lt 3) { throw 'NATIVE_JOB_DESCENDANTS_NOT_ASSIGNED' }
  $childId = (Get-Content -LiteralPath (Join-Path $taskDirectory 'child.json') -Raw | ConvertFrom-Json).pid
  $grandchildId = (Get-Content -LiteralPath (Join-Path $taskDirectory 'grandchild.json') -Raw | ConvertFrom-Json).pid
  $childProcess = [Diagnostics.Process]::GetProcessById($childId)
  $grandchildProcess = [Diagnostics.Process]::GetProcessById($grandchildId)
  # Acquire stable process handles before termination; never target cleanup by a recycled PID.
  $null = $childProcess.Handle; $null = $grandchildProcess.Handle
  if (-not $owned.WaitRoot(5000)) { throw 'NATIVE_JOB_ROOT_DID_NOT_EXIT' }
  $membersAfterRoot = $owned.ActiveProcesses()
  if ($membersAfterRoot -lt 2) { throw 'NATIVE_JOB_ORPHAN_FIXTURE_MISSING' }
  $owned.StopAndConfirm(5000)
  if (-not $childProcess.WaitForExit(5000) -or -not $grandchildProcess.WaitForExit(5000)) { throw 'NATIVE_JOB_DESCENDANTS_SURVIVED' }
  $membersAfterStop = $owned.ActiveProcesses()
  $childProcess.Dispose(); $grandchildProcess.Dispose()
  $owned.Dispose(); $owned = $null
  $closeDirectory = Join-Path $taskDirectory 'close'
  New-Item -ItemType Directory -Path $closeDirectory | Out-Null
  $owned = [Courseforge.ControlledRender.OwnedRenderJob]::Start($NodePath, @($fixturePath, 'root', $closeDirectory),
    $closeDirectory, $environment, 8, 536870912, 1073741824, 10)
  $clock.Restart()
  while (-not (Test-Path -LiteralPath (Join-Path $closeDirectory 'grandchild.json'))) {
    if ($clock.ElapsedMilliseconds -ge 5000) { throw 'NATIVE_JOB_CLOSE_FIXTURE_TIMEOUT' }
    Start-Sleep -Milliseconds 20
  }
  $closeRoot = [Diagnostics.Process]::GetProcessById($owned.ProcessId)
  $closeChild = [Diagnostics.Process]::GetProcessById((Get-Content -LiteralPath (Join-Path $closeDirectory 'child.json') -Raw | ConvertFrom-Json).pid)
  $closeGrandchild = [Diagnostics.Process]::GetProcessById((Get-Content -LiteralPath (Join-Path $closeDirectory 'grandchild.json') -Raw | ConvertFrom-Json).pid)
  $null = $closeRoot.Handle; $null = $closeChild.Handle; $null = $closeGrandchild.Handle
  $owned.Dispose(); $owned = $null
  if (-not $closeRoot.WaitForExit(5000) -or -not $closeChild.WaitForExit(5000) -or -not $closeGrandchild.WaitForExit(5000)) {
    throw 'NATIVE_JOB_KILL_ON_CLOSE_FAILED'
  }
  $closeRoot.Dispose(); $closeChild.Dispose(); $closeGrandchild.Dispose()
  $arguments = @('space value', 'quote"value', 'trailing\', '', ('unicode-' + [char]0x00e1))
  $env:CAP027_TEST_SECRET = 'synthetic-secret-not-a-credential'
  $owned = [Courseforge.ControlledRender.OwnedRenderJob]::Start($NodePath, (@($fixturePath, 'arguments', $taskDirectory) + $arguments),
    $taskDirectory, $environment, 2, 536870912, 1073741824, 10)
  if (-not $owned.WaitRoot(5000)) { throw 'NATIVE_JOB_ARGUMENT_FIXTURE_TIMEOUT' }
  if ($owned.RootExitCode() -ne 0) { throw 'NATIVE_JOB_ARGUMENT_FIXTURE_FAILED' }
  $observed = Get-Content -LiteralPath (Join-Path $taskDirectory 'arguments.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if ((ConvertTo-Json -Compress @($observed.arguments)) -ne (ConvertTo-Json -Compress $arguments) -or $observed.hasSecret) {
    throw 'NATIVE_JOB_ARGUMENT_OR_ENVIRONMENT_MISMATCH'
  }
  $owned.StopAndConfirm(5000); $owned.Dispose(); $owned = $null
  $owned = [Courseforge.ControlledRender.OwnedRenderJob]::Start($NodePath, @($fixturePath, 'cpu', $taskDirectory),
    $taskDirectory, $environment, 2, 536870912, 1073741824, 1)
  if (-not $owned.WaitRoot(10000)) { throw 'NATIVE_JOB_CPU_LIMIT_NOT_ENFORCED' }
  $cpuExitCode = $owned.RootExitCode()
  if ($cpuExitCode -eq 0) { throw 'NATIVE_JOB_CPU_UNEXPECTED_SUCCESS' }
  $owned.StopAndConfirm(5000)
  $owned.Dispose(); $owned = $null
  $owned = [Courseforge.ControlledRender.OwnedRenderJob]::Start($NodePath, @($fixturePath, 'count', $taskDirectory),
    $taskDirectory, $environment, 6, 536870912, 1073741824, 10)
  $configuredMaximum = $owned.ConfiguredMaximumProcesses()
  $peakMembers = 0; $peakAccountingMembers = 0; $violationKinds = $null; $clock.Restart()
  while (-not $owned.WaitRoot(20)) {
    $peakAccountingMembers = [Math]::Max($peakAccountingMembers, $owned.ActiveProcesses())
    $peakMembers = [Math]::Max($peakMembers, $owned.LiveMembers())
    if ($peakMembers -gt 6 -and $null -eq $violationKinds) { $violationKinds = $owned.LiveMemberKinds() }
    if ($clock.ElapsedMilliseconds -ge 5000) { throw 'NATIVE_JOB_PROCESS_LIMIT_TIMEOUT' }
  }
  $owned.StopAndConfirm(5000)
  $owned.Dispose(); $owned = $null
  $owned = [Courseforge.ControlledRender.OwnedRenderJob]::Start($NodePath, @($fixturePath, 'memory', $taskDirectory),
    $taskDirectory, $environment, 2, 268435456, 536870912, 10)
  if (-not $owned.WaitRoot(10000) -or -not (Test-Path -LiteralPath (Join-Path $taskDirectory 'memory-start.json'))) {
    throw 'NATIVE_JOB_MEMORY_LIMIT_NOT_OBSERVED'
  }
  $memoryExitCode = $owned.RootExitCode()
  $peakCommittedBytes = $owned.PeakJobCommittedBytes()
  if ($memoryExitCode -eq 0 -or $peakCommittedBytes -gt 536870912) { throw 'NATIVE_JOB_MEMORY_UNEXPECTED_RESULT' }
  $owned.StopAndConfirm(5000)
  [ordered]@{scope='SYNTHETIC_WINDOWS_JOB_MEMBERS_NOT_RENDER_SANDBOX'; membersBefore=$membersBefore;
    membersAfterRoot=$membersAfterRoot; membersAfterStop=$membersAfterStop;
    argumentsAndEnvironment='PASS'; userCpuLimit='PASS'; cpuExitCode=$cpuExitCode;
    memoryLimit='OBSERVED_PROCESS_EXIT'; memoryExitCode=$memoryExitCode; peakJobCommittedBytes=$peakCommittedBytes;
    treeTermination='PASS'; killOnClose='PASS'; processLimitLivePeak=$peakMembers; processAccountingPeak=$peakAccountingMembers;
    configuredMaximumProcesses=$configuredMaximum;
    violationKinds=$violationKinds;
    processLimitStatus=$(if ($peakMembers -gt 6) {'FAIL'} else {'OBSERVED_WITHIN_LIMIT'})} | ConvertTo-Json -Compress
  if ($peakMembers -gt 6) { throw ('NATIVE_JOB_PROCESS_LIMIT_EXCEEDED_' + $peakMembers) }
  if (-not (Test-Path -LiteralPath (Join-Path $taskDirectory 'count-start.json'))) { throw 'NATIVE_JOB_COUNT_FIXTURE_NOT_STARTED' }
} finally {
  if ($null -ne $owned) { $owned.Dispose() }
  [Environment]::SetEnvironmentVariable('CAP027_TEST_SECRET', $previousSyntheticSecret)
  # Retain the small diagnostic workspace; no recursive cleanup of computed paths.
}
