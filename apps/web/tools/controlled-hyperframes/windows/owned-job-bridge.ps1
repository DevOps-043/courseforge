$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object Text.UTF8Encoding($false, $true)
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$executionId = $null
$owned = $null
function Send-State($state) {
  [Console]::Out.WriteLine(($state | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
}
function Assert-IntegerBound($value, [long]$minimum, [long]$maximum) {
  if (($value -isnot [int] -and $value -isnot [long] -and $value -isnot [double] -and $value -isnot [decimal]) -or
    [double]::IsNaN([double]$value) -or [double]::IsInfinity([double]$value) -or
    $value -lt $minimum -or $value -gt $maximum -or [Math]::Truncate([double]$value) -ne $value) { throw 'INVALID_RESOURCE_LIMITS' }
}
try {
  if (-not ('Courseforge.ControlledRender.OwnedRenderJob' -as [type])) {
    Add-Type -Path @((Join-Path $PSScriptRoot 'OwnedRenderJob.cs'), (Join-Path $PSScriptRoot 'OwnedRenderAccess.cs'), (Join-Path $PSScriptRoot 'OwnedRenderAppContainer.cs'))
  }
  # Operator-only command channel. No shell interpolation, scripts or environment from a document.
  $line = [Courseforge.ControlledRender.OwnedRenderJob]::ReadControlLine(65536).GetAwaiter().GetResult()
  if ($null -eq $line -or [Text.Encoding]::UTF8.GetByteCount($line) -gt 65536) { throw 'INVALID_START' }
  $request = $line | ConvertFrom-Json
  $properties = @($request.PSObject.Properties.Name | Sort-Object)
  $withReducedToken = $request.policy -ceq 'WINDOWS_JOB_CONTROL_CHANNEL_V3'
  $withResources = $withReducedToken -or $request.policy -ceq 'WINDOWS_JOB_CONTROL_CHANNEL_V2'
  $expectedProperties = 'arguments,command,directory,executable,executionId,policy'
  if ($withReducedToken) { $expectedProperties += ',reducedToken' }
  if ($withResources) { $expectedProperties += ',resourceLimits' }
  if (($properties -join ',') -cne $expectedProperties) { throw 'INVALID_START' }
  if (($request.policy -cne 'WINDOWS_JOB_CONTROL_CHANNEL_V1' -and -not $withResources) -or $request.command -cne 'START') { throw 'INVALID_START' }
  if ($withReducedToken) {
    $security = $request.reducedToken
    $withAppContainer = $security.policy -ceq 'WINDOWS_APPCONTAINER_NO_NETWORK_V5'
    $withAclTree = $withAppContainer -or $security.policy -ceq 'WINDOWS_LUA_ACL_TREE_PREFLIGHT_V4'
    $withAclPreflight = $withAclTree -or $security.policy -ceq 'WINDOWS_LUA_ACL_PREFLIGHT_V3'
    $withRestrictingSid = -not $withAppContainer -and ($withAclPreflight -or $security.policy -ceq 'WINDOWS_LUA_RESTRICTING_CAPABILITY_V2')
    $expectedSecurityFields = 'desktop,policy'
    if ($withAclPreflight) { $expectedSecurityFields = 'deniedPaths,desktop,policy,readOnlyPaths' }
    if ($withRestrictingSid) { $expectedSecurityFields += ',restrictingSid' }
    if ($withAppContainer) { $expectedSecurityFields = 'appContainerSid,' + $expectedSecurityFields }
    if ($withAclTree) { $expectedSecurityFields += ',treeAudit' }
    if ((@($security.PSObject.Properties.Name | Sort-Object) -join ',') -cne $expectedSecurityFields -or
      ($security.policy -cne 'WINDOWS_LUA_NO_PRIVILEGES_V1' -and -not $withRestrictingSid -and -not $withAppContainer) -or $security.desktop -isnot [string] -or
      $security.desktop -cnotmatch '\A[a-zA-Z0-9_-]{1,80}\\[a-zA-Z0-9_-]{1,80}\z' -or
      ($security.desktop.Split('\')[1]) -ieq 'default') { throw 'INVALID_REDUCED_TOKEN' }
    if ($withAppContainer) {
      if ($security.appContainerSid -isnot [string] -or $security.appContainerSid.Length -gt 90 -or
        $security.appContainerSid -cnotmatch '\AS-1-15-2(?:-(?:0|[1-9][0-9]{0,9})){7}\z') { throw 'INVALID_APPCONTAINER_SID' }
      foreach ($part in $security.appContainerSid.Substring(9).Split('-')) {
        $sidPart = [uint32]0
        if (-not [uint32]::TryParse($part, [ref]$sidPart)) { throw 'INVALID_APPCONTAINER_SID' }
      }
    }
    if ($withRestrictingSid) {
      if ($security.restrictingSid -isnot [string] -or $security.restrictingSid.Length -gt 184 -or
        $security.restrictingSid -cnotmatch '\AS-1-15-3-1024(?:-(?:0|[1-9][0-9]{0,9})){8}\z') { throw 'INVALID_RESTRICTING_SID' }
      foreach ($part in $security.restrictingSid.Substring(14).Split('-')) {
        $sidPart = [uint32]0
        if (-not [uint32]::TryParse($part, [ref]$sidPart)) { throw 'INVALID_RESTRICTING_SID' }
      }
    }
    if ($withAclPreflight) {
      foreach ($paths in @($security.readOnlyPaths, $security.deniedPaths)) {
        if ($paths -isnot [Array] -or $paths.Count -lt 1 -or $paths.Count -gt 32) { throw 'INVALID_ACL_PREFLIGHT' }
        foreach ($path in $paths) { if ($path -isnot [string] -or $path.Length -gt 4096) { throw 'INVALID_ACL_PREFLIGHT' } }
      }
    }
    if ($withAclTree) {
      $audit = $security.treeAudit
      if ((@($audit.PSObject.Properties.Name | Sort-Object) -join ',') -cne 'maximumDepth,maximumEntries,timeoutMilliseconds') { throw 'INVALID_ACL_TREE' }
      Assert-IntegerBound $audit.maximumEntries 1 50000
      Assert-IntegerBound $audit.maximumDepth 1 64
      Assert-IntegerBound $audit.timeoutMilliseconds 100 60000
    }
  }
  if ($withResources) {
    $limits = $request.resourceLimits
    if ((@($limits.PSObject.Properties.Name | Sort-Object) -join ',') -cne
      'cpuRatePercent,jobMemoryBytes,maximumProcesses,policy,processMemoryBytes,userCpuSeconds' -or
      $limits.policy -cne 'WINDOWS_JOB_RESOURCE_LIMITS_V1') { throw 'INVALID_RESOURCE_LIMITS' }
    Assert-IntegerBound $limits.maximumProcesses 1 64
    Assert-IntegerBound $limits.processMemoryBytes 67108864 4294967296
    Assert-IntegerBound $limits.jobMemoryBytes 67108864 4294967296
    Assert-IntegerBound $limits.userCpuSeconds 1 600
    Assert-IntegerBound $limits.cpuRatePercent 1 100
    if ($limits.processMemoryBytes -gt $limits.jobMemoryBytes) { throw 'INVALID_RESOURCE_LIMITS' }
  }
  $executionId = [string]$request.executionId
  $parsedId = [Guid]::Empty
  if (-not [Guid]::TryParseExact($executionId, 'D', [ref]$parsedId)) { throw 'INVALID_BINDING' }
  if ($request.executable -isnot [string] -or $request.directory -isnot [string]) { throw 'INVALID_PATH' }
  if ($request.arguments -isnot [Array] -or $request.arguments.Count -gt 64) { throw 'INVALID_ARGUMENTS' }
  foreach ($argument in $request.arguments) { if ($argument -isnot [string]) { throw 'INVALID_ARGUMENTS' } }
  $environment = New-Object 'System.Collections.Generic.Dictionary[string,string]'
  foreach ($key in @('PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL')) {
    $value = [Environment]::GetEnvironmentVariable($key)
    if ($null -ne $value) { $environment.Add($key, $value) }
  }
  # Native helper starts suspended, assigns the job and verifies quotas before resuming.
  if ($withReducedToken) {
    if ($withAppContainer) {
      $owned = [Courseforge.ControlledRender.OwnedRenderJob]::StartInAppContainer($request.executable,
        [string[]]$request.arguments, $request.directory, $environment, [uint32]$limits.maximumProcesses,
        [uint64]$limits.processMemoryBytes, [uint64]$limits.jobMemoryBytes, [uint32]$limits.userCpuSeconds,
        [uint32]$limits.cpuRatePercent, [string]$security.desktop, [string]$security.appContainerSid,
        [string[]]$security.readOnlyPaths, [string[]]$security.deniedPaths,
        [uint32]$audit.maximumEntries, [uint32]$audit.maximumDepth, [uint32]$audit.timeoutMilliseconds)
    } elseif ($withAclTree) {
      $owned = [Courseforge.ControlledRender.OwnedRenderJob]::StartWithAclTreePreflight($request.executable,
        [string[]]$request.arguments, $request.directory, $environment, [uint32]$limits.maximumProcesses,
        [uint64]$limits.processMemoryBytes, [uint64]$limits.jobMemoryBytes, [uint32]$limits.userCpuSeconds,
        [uint32]$limits.cpuRatePercent, [string]$security.desktop, [string]$security.restrictingSid,
        [string[]]$security.readOnlyPaths, [string[]]$security.deniedPaths,
        [uint32]$audit.maximumEntries, [uint32]$audit.maximumDepth, [uint32]$audit.timeoutMilliseconds)
    } elseif ($withAclPreflight) {
      $owned = [Courseforge.ControlledRender.OwnedRenderJob]::StartWithAclPreflight($request.executable,
        [string[]]$request.arguments, $request.directory, $environment, [uint32]$limits.maximumProcesses,
        [uint64]$limits.processMemoryBytes, [uint64]$limits.jobMemoryBytes, [uint32]$limits.userCpuSeconds,
        [uint32]$limits.cpuRatePercent, [string]$security.desktop, [string]$security.restrictingSid,
        [string[]]$security.readOnlyPaths, [string[]]$security.deniedPaths)
    } elseif ($withRestrictingSid) {
      $owned = [Courseforge.ControlledRender.OwnedRenderJob]::StartWithRestrictingSid($request.executable,
        [string[]]$request.arguments, $request.directory, $environment, [uint32]$limits.maximumProcesses,
        [uint64]$limits.processMemoryBytes, [uint64]$limits.jobMemoryBytes, [uint32]$limits.userCpuSeconds,
        [uint32]$limits.cpuRatePercent, [string]$security.desktop, [string]$security.restrictingSid)
    } else {
      $owned = [Courseforge.ControlledRender.OwnedRenderJob]::StartReduced($request.executable,
      [string[]]$request.arguments, $request.directory, $environment, [uint32]$limits.maximumProcesses,
      [uint64]$limits.processMemoryBytes, [uint64]$limits.jobMemoryBytes, [uint32]$limits.userCpuSeconds,
      [uint32]$limits.cpuRatePercent, [string]$security.desktop)
    }
  } elseif ($withResources) {
    $owned = [Courseforge.ControlledRender.OwnedRenderJob]::StartWithCpuRate($request.executable,
      [string[]]$request.arguments, $request.directory, $environment, [uint32]$limits.maximumProcesses,
      [uint64]$limits.processMemoryBytes, [uint64]$limits.jobMemoryBytes, [uint32]$limits.userCpuSeconds,
      [uint32]$limits.cpuRatePercent)
  } else {
    $owned = [Courseforge.ControlledRender.OwnedRenderJob]::Start($request.executable,
      [string[]]$request.arguments, $request.directory, $environment, 64, 2147483648, 4294967296, 600)
  }
  Send-State ([ordered]@{status='READY'; executionId=$executionId})
  $stopRead = [Courseforge.ControlledRender.OwnedRenderJob]::ReadControlLine(4096)
  $clock = [Diagnostics.Stopwatch]::StartNew()
  $rootReported = $false
  while ($clock.ElapsedMilliseconds -lt 600000) {
    if ($stopRead.IsCompleted) {
      $stopLine = $stopRead.GetAwaiter().GetResult()
      if ($null -eq $stopLine -or [Text.Encoding]::UTF8.GetByteCount($stopLine) -gt 4096) { throw 'CONTROL_CHANNEL_CLOSED' }
      $stop = $stopLine | ConvertFrom-Json
      if ((@($stop.PSObject.Properties.Name | Sort-Object) -join ',') -ne 'command,executionId' -or
        $stop.command -ne 'STOP' -or $stop.executionId -cne $executionId) { throw 'INVALID_STOP' }
      $owned.StopAndConfirm(4000)
      if ($owned.ActiveProcesses() -ne 0) { throw 'PROCESS_TREE_NOT_EMPTY' }
      Send-State ([ordered]@{status='STOPPED'; executionId=$executionId; activeProcesses=0})
      $owned.Dispose(); $owned = $null
      exit 0
    }
    if (-not $rootReported -and $owned.WaitRoot(0)) {
      $rootReported = $true
      Send-State ([ordered]@{status='ROOT_EXITED'; executionId=$executionId; exitCode=$owned.RootExitCode()})
    }
    Start-Sleep -Milliseconds 10
  }
  throw 'WALL_DEADLINE_EXCEEDED'
} catch {
  # Never disclose exception details, content, paths or command arguments on the protocol.
  if ($null -ne $executionId) { Send-State ([ordered]@{status='FAILED'; executionId=$executionId}) }
  exit 1
} finally {
  if ($null -ne $owned) { $owned.Dispose() }
}
