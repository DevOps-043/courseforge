$ErrorActionPreference = 'Stop'
Add-Type -Path @((Join-Path $PSScriptRoot 'NetworkPolicyLibrary.cs'), (Join-Path $PSScriptRoot 'NetworkPolicyInvocation.cs'))
# Managed owner/codec validation only. No LoadApproved, Invoke, pipe or WFP.
$provider = [Guid]::NewGuid(); $sublayer = [Guid]::NewGuid(); $lease = [Guid]::NewGuid()
$sid = 'S-1-15-2-1-2-3-4-5-6-7'; $sidBytes = [Text.Encoding]::ASCII.GetBytes($sid)
$record = [byte[]]::new(100 + $sidBytes.Length + 4 * 16)
$record[0] = 1
[Array]::Copy($provider.ToByteArray(), 0, $record, 4, 16)
[Array]::Copy($sublayer.ToByteArray(), 0, $record, 20, 16)
[Array]::Copy($lease.ToByteArray(), 0, $record, 36, 16)
$record[52] = 1; $record[96] = $sidBytes.Length
[Array]::Copy($sidBytes, 0, $record, 98, $sidBytes.Length)
$record[98 + $sidBytes.Length] = 4
for ($index = 0; $index -lt 4; $index++) { [Array]::Copy([Guid]::NewGuid().ToByteArray(), 0, $record, 100 + $sidBytes.Length + $index * 16, 16) }
$invocation = [Courseforge.ControlledNetwork.NetworkPolicyInvocation]
$invocation::ValidateOwnedOperation(1, $null, $record, $provider, $sublayer, $lease, $sid)
Write-Output 'PASS canonical owner record'
$rejected = $false
try { $invocation::ValidateOwnedOperation(1, $null, $record, $provider, $sublayer, [Guid]::NewGuid(), $sid) } catch { $rejected = $true }
if (-not $rejected) { throw 'Foreign lease accepted' }
Write-Output 'PASS foreign lease rejection'
$changed = [byte[]]$record.Clone(); $changed[52] = 2
$rejected = $false
try { $invocation::ValidateOwnedOperation(1, $null, $changed, $provider, $sublayer, $lease, $sid) } catch { $rejected = $true }
if (-not $rejected) { throw 'Noncanonical generation accepted' }
Write-Output 'PASS mode/generation rejection'
