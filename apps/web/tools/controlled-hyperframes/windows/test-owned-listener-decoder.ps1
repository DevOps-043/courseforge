$ErrorActionPreference = 'Stop'
Add-Type -Path @(
  (Join-Path $PSScriptRoot 'OwnedRenderJob.cs'),
  (Join-Path $PSScriptRoot 'OwnedRenderAccess.cs'),
  (Join-Path $PSScriptRoot 'OwnedRenderAppContainer.cs')
)
# Only managed decoder calls. No process, Job Object, TCP table or security API is invoked.
$decoder = [Courseforge.ControlledRender.OwnedRenderJob].GetMethod(
  'ContainsExclusiveRootListener', [Reflection.BindingFlags]'NonPublic,Static')
if ($null -eq $decoder) { throw 'Decoder not found' }
function New-ListenerRow([uint32]$ownerPid = 123, [uint32]$port = 43210, [byte[]]$address = @(127,0,0,1), [uint32]$state = 2) {
  $row = New-Object byte[] 24
  [BitConverter]::GetBytes($state).CopyTo($row, 0)
  $address.CopyTo($row, 4)
  $row[8] = [byte](($port -shr 8) -band 255)
  $row[9] = [byte]($port -band 255)
  [BitConverter]::GetBytes($ownerPid).CopyTo($row, 20)
  return ,$row
}
function New-ListenerTable([byte[]]$rows) {
  if ($rows.Length % 24 -ne 0) { throw 'Invalid fixture row length' }
  $table = New-Object byte[] (4 + $rows.Length)
  [BitConverter]::GetBytes([uint32]($rows.Length / 24)).CopyTo($table, 0)
  $rows.CopyTo($table, 4)
  return ,$table
}
function Assert-Listener([byte[]]$table, [bool]$expected, [string]$label) {
  $actual = $decoder.Invoke($null, @($table, [uint32]123, [uint32]43210))
  if ($actual -ne $expected) { throw "Unexpected decoder result: $label" }
}
function Assert-InvalidTable([byte[]]$table) {
  try { $null = $decoder.Invoke($null, @($table, [uint32]123, [uint32]43210)) }
  catch {
    if ($_.Exception.ToString().Contains('CONTROLLED_RENDER_WINDOWS_LISTENER_TABLE_INVALID')) { return }
    throw
  }
  throw 'Malformed table accepted'
}
$ownedRow = New-ListenerRow
Assert-Listener (New-ListenerTable @($ownedRow)) $true 'exact owned listener'
Assert-Listener (New-ListenerTable @()) $false 'no listener'
Assert-Listener (New-ListenerTable @((New-ListenerRow -ownerPid 999))) $false 'wrong PID'
Assert-Listener (New-ListenerTable @((New-ListenerRow -port 43211))) $false 'wrong port'
Assert-Listener (New-ListenerTable @((New-ListenerRow -address @(0,0,0,0)))) $false 'wildcard'
Assert-Listener (New-ListenerTable @((New-ListenerRow -address @(127,0,0,2)))) $false 'different loopback'
Assert-Listener (New-ListenerTable @((New-ListenerRow -state 5))) $false 'not listening'
Assert-Listener (New-ListenerTable ($ownedRow + $ownedRow)) $false 'duplicate socket'
Assert-Listener (New-ListenerTable ($ownedRow + (New-ListenerRow -ownerPid 999))) $false 'shared port'
Assert-Listener (New-ListenerTable ($ownedRow + (New-ListenerRow -ownerPid 999 -port 43211))) $true 'unrelated listener'
Assert-InvalidTable ([byte[]]@(1,0,0,0))
Assert-InvalidTable ([BitConverter]::GetBytes([uint32]65537))
Write-Output '12/12 managed listener-decoder checks passed; no native socket or Job Object API invoked.'
