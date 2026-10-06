$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object Text.UTF8Encoding($false, $true)
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$executionId = $null
$owned = $null
function Send-State($state) {
  [Console]::Out.WriteLine(($state | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
}
try {
  if (-not ('Courseforge.ControlledRender.OwnedRenderJob' -as [type])) {
    Add-Type -Path (Join-Path $PSScriptRoot 'OwnedRenderJob.cs')
  }
  # Operator-only command channel. No shell interpolation, scripts or environment from a document.
  $line = [Courseforge.ControlledRender.OwnedRenderJob]::ReadControlLine(65536).GetAwaiter().GetResult()
  if ($null -eq $line -or [Text.Encoding]::UTF8.GetByteCount($line) -gt 65536) { throw 'INVALID_START' }
  $request = $line | ConvertFrom-Json
  $properties = @($request.PSObject.Properties.Name | Sort-Object)
  if (($properties -join ',') -ne 'arguments,command,directory,executable,executionId,policy') { throw 'INVALID_START' }
  if ($request.policy -ne 'WINDOWS_JOB_CONTROL_CHANNEL_V1' -or $request.command -ne 'START') { throw 'INVALID_START' }
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
  $owned = [Courseforge.ControlledRender.OwnedRenderJob]::Start($request.executable,
    [string[]]$request.arguments, $request.directory, $environment, 64, 2147483648, 4294967296, 600)
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
