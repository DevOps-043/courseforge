param(
  [Parameter(Mandatory=$true)][string]$DotnetPath,
  [Parameter(Mandatory=$true)][string]$DotnetSha256,
  [Parameter(Mandatory=$true)][string]$DotnetSdkVersion,
  [Parameter(Mandatory=$true)][string]$CMakePath,
  [Parameter(Mandatory=$true)][string]$CMakeSha256,
  [Parameter(Mandatory=$true)][string]$CMakeVersion,
  [Parameter(Mandatory=$true)][string]$WindowsSdkVersion,
  [Parameter(Mandatory=$true)][string]$MsvcToolsetVersion,
  [Parameter(Mandatory=$true)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
# Build only, invoked by the operator in a provisioned x64 VS developer shell.
# Never installs SDKs, loads output DLLs, opens a pipe or changes WFP/security.
function Assert-LocalPath([string]$Path, [bool]$Directory) {
  if (-not [IO.Path]::IsPathRooted($Path) -or [IO.Path]::GetFullPath($Path) -cne $Path -or $Path.StartsWith('\\')) {
    throw 'Noncanonical local path'
  }
  $current = Get-Item -LiteralPath $Path -Force
  if ($current.PSIsContainer -ne $Directory) { throw 'Unexpected path type' }
  while ($null -ne $current) {
    if (($current.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse point rejected' }
    if ($current.PSIsContainer) { $current = $current.Parent } else { $current = $current.Directory }
  }
}
function Hash([string]$Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Run([string]$Program, [string[]]$Arguments) {
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) { throw 'Controlled network build failed' }
}
Assert-LocalPath $DotnetPath $false
Assert-LocalPath $CMakePath $false
Assert-LocalPath $PSScriptRoot $true
Assert-LocalPath ([IO.Path]::GetDirectoryName($OutputDirectory)) $true
if ([IO.Path]::GetFullPath($OutputDirectory) -cne $OutputDirectory -or $OutputDirectory.StartsWith('\\') -or
  (Test-Path -LiteralPath $OutputDirectory)) { throw 'Fresh absolute output directory required' }
foreach ($value in @($DotnetSha256, $CMakeSha256)) { if ($value -cnotmatch '^[a-f0-9]{64}$') { throw 'Invalid tool pin' } }
foreach ($value in @($DotnetSdkVersion, $CMakeVersion, $WindowsSdkVersion, $MsvcToolsetVersion)) {
  if ($value -notmatch '^\d+\.\d+(?:\.\d+){0,2}$') { throw 'Exact numeric tool version required' }
}
if ((Hash $DotnetPath) -cne $DotnetSha256 -or (Hash $CMakePath) -cne $CMakeSha256) { throw 'Tool pin mismatch' }
if ($env:VSCMD_ARG_TGT_ARCH -cne 'x64') { throw 'Provisioned x64 VS developer shell required' }
$sourceNames = @('CMakeLists.txt','WfpNetworkPolicy.h','WfpNetworkPolicy.cpp','NetworkPolicyExports.cpp',
  'AuthenticatedNetworkPipe.cs','AuthenticatedNetworkPipeClient.cs','NetworkPipeManagedEntry.cs',
  'NetworkPolicyLibrary.cs','NetworkPolicyInvocation.cs','Courseforge.NetworkClient.csproj','Courseforge.NetworkPolicy.csproj')
$sourcePins = @{}
foreach ($name in $sourceNames) {
  $path = Join-Path $PSScriptRoot $name
  Assert-LocalPath $path $false
  $sourcePins[$name] = Hash $path
}
$null = New-Item -ItemType Directory -Path $OutputDirectory
$results = @()
foreach ($iteration in @('first','second')) {
  $buildRoot = Join-Path $OutputDirectory $iteration
  $sourceRoot = Join-Path $buildRoot 'source'
  $null = New-Item -ItemType Directory -Path $sourceRoot
  foreach ($name in $sourceNames) {
    $copied = Join-Path $sourceRoot $name
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $copied
    if ((Hash $copied) -cne $sourcePins[$name]) { throw 'Source copy pin mismatch' }
  }
  # Own SDK selector: no parent global.json or roll-forward, no SDK download.
  $selector = @{sdk=@{version=$DotnetSdkVersion; rollForward='disable'; allowPrerelease=$false}} | ConvertTo-Json -Compress
  [IO.File]::WriteAllText((Join-Path $buildRoot 'global.json'), $selector, [Text.UTF8Encoding]::new($false))
  $nugetConfiguration = Join-Path $buildRoot 'NuGet.Config'
  [IO.File]::WriteAllText($nugetConfiguration, '<configuration><packageSources><clear /></packageSources></configuration>', [Text.UTF8Encoding]::new($false))
  Push-Location -LiteralPath $buildRoot
  try {
    $actualSdk = & $DotnetPath --version
    if ($LASTEXITCODE -ne 0 -or $actualSdk.Trim() -cne $DotnetSdkVersion) { throw 'SDK version mismatch' }
    $actualCmake = @(& $CMakePath --version)
    if ($LASTEXITCODE -ne 0 -or $actualCmake[0] -cne "cmake version $CMakeVersion") { throw 'CMake version mismatch' }
    foreach ($project in @('Client','Policy')) {
      $destination = Join-Path $buildRoot $project
      Run $DotnetPath @('build', (Join-Path $sourceRoot "Courseforge.Network$project.csproj"), '--configuration','Release',
        '--output',$destination,'-p:ImportDirectoryBuildProps=false','-p:ImportDirectoryBuildTargets=false',
        "-p:RestoreConfigFile=$nugetConfiguration",'-p:RestoreSources=','-p:RestoreIgnoreFailedSources=false','-p:NuGetAudit=false')
    }
    $nativeRoot = Join-Path $buildRoot 'native'
    Run $CMakePath @('-S',$sourceRoot,'-B',$nativeRoot,'-G','Visual Studio 17 2022','-A','x64',
      '-T',"version=$MsvcToolsetVersion", "-DCMAKE_SYSTEM_VERSION=$WindowsSdkVersion")
    Run $CMakePath @('--build',$nativeRoot,'--config','Release','--target','courseforge_network_bridge')
    $artifacts = @{
      client = Join-Path $buildRoot 'Client/Courseforge.NetworkClient.dll'
      policy = Join-Path $buildRoot 'Policy/Courseforge.NetworkPolicy.dll'
      native = Join-Path $nativeRoot 'Release/courseforge_network_bridge.dll'
    }
    $pins = @{}
    foreach ($role in $artifacts.Keys) {
      Assert-LocalPath $artifacts[$role] $false
      $artifactSize = (Get-Item -LiteralPath $artifacts[$role]).Length
      if ($artifactSize -lt 1 -or $artifactSize -gt 33554432) { throw 'Artifact size outside broker admission bounds' }
      $pins[$role] = @{sha256=Hash $artifacts[$role]; sizeBytes=$artifactSize}
    }
    $results += ,$pins
  } finally { Pop-Location }
}
foreach ($role in @('client','policy','native')) {
  if ($results[0][$role].sha256 -cne $results[1][$role].sha256 -or $results[0][$role].sizeBytes -ne $results[1][$role].sizeBytes) {
    throw 'Reproducibility mismatch: partial build retained without receipt'
  }
}
foreach ($name in $sourceNames) { if ((Hash (Join-Path $PSScriptRoot $name)) -cne $sourcePins[$name]) { throw 'Source changed' } }
if ((Hash $DotnetPath) -cne $DotnetSha256 -or (Hash $CMakePath) -cne $CMakeSha256) { throw 'Tools changed' }
$receipt = @{policy='WINDOWS_NETWORK_TWO_BUILD_MATCH_V1'; scope='BUILD_OUTPUT_NOT_RUNTIME_ADMISSION_OR_ENFORCEMENT';
  sources=$sourcePins; artifacts=$results[0]; toolchain=@{dotnetSdk=$DotnetSdkVersion; cmake=$CMakeVersion;
    windowsSdk=$WindowsSdkVersion; msvc=$MsvcToolsetVersion; dotnetSha256=$DotnetSha256; cmakeSha256=$CMakeSha256}}
$serialized = [Text.UTF8Encoding]::new($false).GetBytes(($receipt | ConvertTo-Json -Depth 8))
$marker = [IO.File]::Open((Join-Path $OutputDirectory 'build-receipt.json'), [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
try { $marker.Write($serialized,0,$serialized.Length); $marker.Flush($true) } finally { $marker.Dispose() }
Write-Output 'Two build outputs matched; no runtime activation or release approval performed'
