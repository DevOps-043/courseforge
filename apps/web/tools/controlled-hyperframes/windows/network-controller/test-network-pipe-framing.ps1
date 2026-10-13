$ErrorActionPreference = 'Stop'
# Managed framing only: never ServeOnceAsync, OpenProcess, pipe creation or WFP.
Add-Type -Path @((Join-Path $PSScriptRoot 'AuthenticatedNetworkPipe.cs'), (Join-Path $PSScriptRoot 'AuthenticatedNetworkPipeClient.cs'))
$channelType = [Courseforge.ControlledNetwork.AuthenticatedNetworkPipe]
function Assert-Rejected([scriptblock] $Operation) {
  $rejected = $false
  try { & $Operation } catch { $rejected = $true }
  if (-not $rejected) { throw 'Expected framing rejection' }
}
$payload = [System.Text.Encoding]::UTF8.GetBytes('{"mensaje":"acción 🌎"}')
$frame = $channelType::EncodeFrame($payload)
if ($channelType::DecodeLength($frame[0..3]) -ne $payload.Length) { throw 'Wrong UTF8 byte length' }
if ([System.Text.Encoding]::UTF8.GetString($frame[4..($frame.Length - 1)]) -ne '{"mensaje":"acción 🌎"}') { throw 'Wrong payload' }
Write-Output 'PASS managed roundtrip'
Assert-Rejected { $channelType::DecodeLength([byte[]](0,0,0,0)) }
Assert-Rejected { $channelType::DecodeLength([byte[]](1,128,0,0)) }
Assert-Rejected { $channelType::DecodeLength([byte[]](1,0,0)) }
Write-Output 'PASS length bounds'
Assert-Rejected { $channelType::ValidatePayload([byte[]](255)) }
Assert-Rejected { $channelType::ValidatePayload([byte[]](123,0,125)) }
Assert-Rejected { $channelType::ValidatePayload([byte[]]@()) }
Write-Output 'PASS UTF8 and NUL rejection'
$maximum = [byte[]]::new($channelType::MaximumPayloadBytes)
[Array]::Fill[byte]($maximum, [byte]65)
$maximumFrame = $channelType::EncodeFrame($maximum)
if ($channelType::DecodeLength($maximumFrame[0..3]) -ne $maximum.Length) { throw 'Wrong maximum boundary' }
Write-Output 'PASS exact maximum'
Assert-Rejected { $channelType::DecodeLength([byte[]](0,0,0,128)) }
Write-Output 'PASS unsigned overflow rejection'
