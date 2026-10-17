param(
  [Parameter(Mandatory=$true)][string]$NodePath,
  [Parameter(Mandatory=$true)][string]$BrowserPath,
  [Parameter(Mandatory=$true)][ValidateSet(24,25,30,60)][int]$Fps,
  [Parameter(Mandatory=$true)][ValidateSet('yes')][string]$TrustedLocalSynthetic,
  [string]$NativeRecipe,
  [string]$Recipe,
  [string]$SourceReceipt
)
$ErrorActionPreference = 'Stop'
# Opt-in authored local corpus only. No endpoint, no untrusted documents, no security-sandbox claim.
if (($Recipe -and -not $SourceReceipt) -or ($SourceReceipt -and -not $Recipe) -or ($NativeRecipe -and $Recipe)) {
  throw 'CONTROLLED_RENDER_WINDOWS_ARGUMENT_INVALID'
}
# Mandatory local capability probe before loading the SDK. There is no skip or cached-green override.
# A failed probe terminates this launcher; it must never silently fall back to a plain child process.
& (Join-Path $PSScriptRoot 'test-owned-render-job.ps1') -NodePath $NodePath
$driver = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\observe-neutral-render.mjs'))
$taskDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$arguments = @($driver, '--browser', $BrowserPath, '--fps', [string]$Fps, '--trusted-local-synthetic', $TrustedLocalSynthetic)
if ($NativeRecipe) { $arguments += @('--native-recipe', $NativeRecipe) }
if ($Recipe) { $arguments += @('--recipe', $Recipe, '--source-receipt', $SourceReceipt) }
$environment = New-Object 'System.Collections.Generic.Dictionary[string,string]'
foreach ($key in @('PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL')) {
  $value = [Environment]::GetEnvironmentVariable($key)
  if ($null -ne $value) { $environment.Add($key, $value) }
}
$owned = $null
try {
  $owned = [Courseforge.ControlledRender.OwnedRenderJob]::Start($NodePath, $arguments, $taskDirectory,
    $environment, 64, 2147483648, 4294967296, 600)
  $clock = [Diagnostics.Stopwatch]::StartNew()
  $completed = $false
  while ($clock.ElapsedMilliseconds -lt 600000) {
    if ($owned.LiveMembers() -gt 64) { throw 'CONTROLLED_RENDER_WINDOWS_PROCESS_LIMIT_EXCEEDED' }
    if ($owned.WaitRoot(100)) { $completed = $true; break }
  }
  # Always terminate remaining job members, including after a nominally successful root exit.
  $owned.StopAndConfirm(5000)
  if (-not $completed) { throw 'CONTROLLED_RENDER_WINDOWS_WALL_DEADLINE_EXCEEDED' }
  $exitCode = $owned.RootExitCode()
  if ($exitCode -ne 0) { throw 'CONTROLLED_RENDER_WINDOWS_ROOT_FAILED' }
  [ordered]@{scope='LOCAL_WINDOWS_JOB_MEMBERS_NOT_SECURITY_SANDBOX_OR_ATTESTATION';
    status='ROOT_EXITED_JOB_EMPTY'; activeProcesses=$owned.ActiveProcesses();
    peakJobCommittedBytes=$owned.PeakJobCommittedBytes()} | ConvertTo-Json -Compress
} finally { if ($null -ne $owned) { $owned.Dispose() } }
