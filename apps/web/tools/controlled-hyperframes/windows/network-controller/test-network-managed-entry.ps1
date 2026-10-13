$ErrorActionPreference = 'Stop'
# Compilation and managed capture/cancel only. Never invoke an uncancelled exchange.
Add-Type -Path @((Join-Path $PSScriptRoot 'AuthenticatedNetworkPipe.cs'),
  (Join-Path $PSScriptRoot 'AuthenticatedNetworkPipeClient.cs'), (Join-Path $PSScriptRoot 'NetworkPipeManagedEntry.cs'))
function New-Request {
  $request = [System.Collections.Generic.Dictionary[string,object]]::new()
  $request.Add('channelId', '70000000-0000-4000-8000-000000000001')
  $request.Add('expectedServerPid', '123')
  $request.Add('expectedClientPid', '456')
  $request.Add('expectedServerCreationFileTime', '18446744073709551615')
  $request.Add('expectedClientCreationFileTime', '133000000000000001')
  $request.Add('expectedServerSid', 'S-1-5-21-1-2-3-1001')
  $request.Add('expectedClientSid', 'S-1-5-21-1-2-3-1002')
  $request.Add('expectedServerLogonSid', 'S-1-5-5-1-2')
  $request.Add('expectedClientLogonSid', 'S-1-5-5-1-3')
  $request.Add('payload', [System.Text.Encoding]::UTF8.GetBytes('{}'))
  return ,$request
}
function Assert-Rejected([scriptblock] $Operation) {
  $rejected = $false
  try { & $Operation } catch { $rejected = $true }
  if (-not $rejected) { throw 'Expected managed entry rejection' }
}
foreach ($kind in @('extra', 'pid-number', 'overflow', 'leading-zero', 'same-peer', 'sid-overflow', 'payload')) {
  $request = New-Request
  switch ($kind) {
    'extra' { $request.Add('command', 'arbitrary') }
    'pid-number' { $request['expectedClientPid'] = 456 }
    'overflow' { $request['expectedServerCreationFileTime'] = '18446744073709551616' }
    'leading-zero' { $request['expectedServerPid'] = '0123' }
    'same-peer' { $request['expectedClientPid'] = '123' }
    'sid-overflow' { $request['expectedClientSid'] = 'S-1-5-21-1-2-3-4294967296' }
    'payload' { $request['payload'] = [byte[]](255) }
  }
  $entry = [Courseforge.ControlledNetwork.NetworkPipeManagedEntry]::new()
  Assert-Rejected { $entry.Invoke($request).GetAwaiter().GetResult() }
}
Write-Output 'PASS seven strict managed input rejection cases'
$entry = [Courseforge.ControlledNetwork.NetworkPipeManagedEntry]::new()
$lease = $entry.Invoke((New-Request)).GetAwaiter().GetResult()
if ($lease.Count -ne 2 -or -not $lease.ContainsKey('exchange') -or -not $lease.ContainsKey('cancel')) { throw 'Invalid lease' }
Assert-Rejected { $entry.Invoke((New-Request)).GetAwaiter().GetResult() }
Write-Output 'PASS exact lease and concurrent preparation rejection'
$null = $lease['cancel'].Invoke($null).GetAwaiter().GetResult()
Assert-Rejected { $lease['exchange'].Invoke($null).GetAwaiter().GetResult() }
$null = $lease['cancel'].Invoke($null).GetAwaiter().GetResult()
Write-Output 'PASS pre-start cancellation, no native call and idempotent cancellation'
$next = $entry.Invoke((New-Request)).GetAwaiter().GetResult()
Assert-Rejected { $next['cancel'].Invoke('unexpected').GetAwaiter().GetResult() }
$null = $next['cancel'].Invoke($null).GetAwaiter().GetResult()
Write-Output 'PASS released lease permits next preparation and rejects cancellation arguments'
