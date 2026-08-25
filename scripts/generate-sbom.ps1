$ErrorActionPreference = "Stop"

$outputDirectory = Join-Path $PSScriptRoot "..\compliance\sbom"
$outputPath = Join-Path $outputDirectory "courseforge.cdx.json"

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$sbom = npm sbom --package-lock-only --sbom-format cyclonedx --sbom-type application --workspaces
if ($LASTEXITCODE -ne 0) { throw "npm sbom no pudo generar el SBOM." }

$parsed = $sbom | ConvertFrom-Json
if ($parsed.bomFormat -ne "CycloneDX") { throw "npm no devolvió un SBOM CycloneDX válido." }

$sbom | Set-Content -Path $outputPath -Encoding utf8
Write-Output "SBOM actualizado: $outputPath"
