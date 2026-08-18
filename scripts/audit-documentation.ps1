param(
  [string]$BaseRef = "HEAD~5",
  [string]$OutputPath = "docs/documentation-audit.md"
)

$ErrorActionPreference = "Stop"

function Get-GitLines([string[]]$Arguments) {
  $result = & git @Arguments 2>$null
  if ($LASTEXITCODE -ne 0) { return @() }
  return @($result)
}

$head = (Get-GitLines @("rev-parse", "--short", "HEAD")) -join ""
$resolvedBase = (Get-GitLines @("rev-parse", "--short", $BaseRef)) -join ""
if (-not $resolvedBase) { throw "No se pudo resolver BaseRef: $BaseRef" }

$changedFiles = Get-GitLines @("diff", "--name-status", "$resolvedBase...HEAD")
$migrations = Get-GitLines @("diff", "--name-only", "$resolvedBase...HEAD", "--", "supabase/migrations")
$apiRoutes = Get-ChildItem "apps/web/src/app/api" -Recurse -Filter "route.ts" -ErrorAction SilentlyContinue |
  ForEach-Object { $_.FullName.Replace((Get-Location).Path + "\\", "") }
$functions = Get-ChildItem "apps/web/netlify/functions" -Filter "*.ts" -ErrorAction SilentlyContinue |
  ForEach-Object { $_.Name }
$envNames = Get-ChildItem -Path "apps","scripts" -Recurse -File -Include "*.ts","*.tsx","*.js","*.mjs" -ErrorAction SilentlyContinue |
  Select-String -Pattern "process\.env\.([A-Z][A-Z0-9_]+)" -AllMatches |
  ForEach-Object { $_.Matches | ForEach-Object { $_.Groups[1].Value } } |
  Sort-Object -Unique
$dirty = Get-GitLines @("status", "--short")
$generatedAt = Get-Date -Format "yyyy-MM-dd HH:mm:ss K"

$content = (@(
  "# Auditoria documental",
  "",
  "Generada: $generatedAt",
  "Rango: ``$resolvedBase...$head`` (solicitado: ``$BaseRef``)",
  "",
  "Este archivo es evidencia generada. Siga ``docs/PROTOCOLO_DE_INVESTIGACION_Y_SINCRONIZACION.md`` para decidir cambios en ``README.md`` y ``CLAUDE.md``.",
  "",
  "## Cambios Git",
  "",
  $(if ($changedFiles.Count) { $changedFiles | ForEach-Object { "- ``$_``" } } else { "- Sin cambios versionados en el rango." }),
  "",
  "## Migraciones modificadas",
  "",
  $(if ($migrations.Count) { $migrations | ForEach-Object { "- ``$_``" } } else { "- Ninguna." }),
  "",
  "## Rutas API detectadas",
  "",
  $(if ($apiRoutes.Count) { $apiRoutes | ForEach-Object { "- ``$_``" } } else { "- Ninguna detectada." }),
  "",
  "## Netlify Functions detectadas",
  "",
  $(if ($functions.Count) { $functions | ForEach-Object { "- ``$_``" } } else { "- Ninguna detectada." }),
  "",
  "## Variables de entorno referenciadas en codigo",
  "",
  $(if ($envNames.Count) { $envNames | ForEach-Object { "- ``$_``" } } else { "- Ninguna detectada por patron estatico." }),
  "",
  "## Estado del arbol de trabajo",
  "",
  $(if ($dirty.Count) { $dirty | ForEach-Object { "- ``$_``" } } else { "- Limpio." }),
  "",
  "## Decision de sincronizacion",
  "",
  "- [ ] Revisar cada cambio funcional contra README.md.",
  "- [ ] Revisar cada dependencia, variable y regla operativa contra CLAUDE.md.",
  "- [ ] Registrar evidencia y pendientes antes de cerrar."
) | ForEach-Object {
  if ($_ -is [System.Array]) { $_ } else { $_ }
}) -join [Environment]::NewLine

Set-Content -Path $OutputPath -Value $content -Encoding utf8
Write-Output "Auditoria creada en $OutputPath"
