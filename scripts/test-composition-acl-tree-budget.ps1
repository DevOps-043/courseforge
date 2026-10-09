$ErrorActionPreference = 'Stop'
# Managed unit checks only. No AccessCheck, token/process API, ACL mutation or render.
$nativeRoot = Join-Path $PSScriptRoot '..\apps\web\tools\controlled-hyperframes\windows'
Add-Type -Path @((Join-Path $nativeRoot 'OwnedRenderJob.cs'), (Join-Path $nativeRoot 'OwnedRenderAccess.cs'), (Join-Path $nativeRoot 'OwnedRenderAppContainer.cs'))
$auditType = [Courseforge.ControlledRender.OwnedRenderJob].GetNestedType('AclTreeAudit', [Reflection.BindingFlags]::NonPublic)
$constructor = $auditType.GetConstructor(@([uint32], [uint32], [uint32]))
function New-Audit([uint32]$entries, [uint32]$depth) {
  return $constructor.Invoke(@($entries, $depth, [uint32]60000))
}
function Assert-AuditError($audit, [string]$method, [object[]]$arguments, [string]$code) {
  $matched = $false
  try { $auditType.GetMethod($method).Invoke($audit, $arguments) | Out-Null }
  catch {
    $errorObject = $_.Exception
    while ($null -ne $errorObject.InnerException) { $errorObject = $errorObject.InnerException }
    $matched = $errorObject.Message -ceq ('CONTROLLED_RENDER_WINDOWS_' + $code)
  }
  if (-not $matched) { throw 'ACL_TREE_MANAGED_ASSERTION_FAILED' }
}
$entryAudit = New-Audit 1 2
$auditType.GetMethod('Visit').Invoke($entryAudit, @('first', [uint32]0)) | Out-Null
Assert-AuditError $entryAudit 'Visit' @('second', [uint32]1) 'ACL_TREE_LIMIT_EXCEEDED'
$depthAudit = New-Audit 10 1
Assert-AuditError $depthAudit 'Visit' @('too-deep', [uint32]2) 'ACL_TREE_LIMIT_EXCEEDED'
$duplicateAudit = New-Audit 10 2
$auditType.GetMethod('Visit').Invoke($duplicateAudit, @('CASE-PATH', [uint32]0)) | Out-Null
Assert-AuditError $duplicateAudit 'Visit' @('case-path', [uint32]1) 'ACL_TREE_LIMIT_EXCEEDED'
$enumerationAudit = New-Audit 1 2
Assert-AuditError $enumerationAudit 'Enumerate' @([IO.Path]::GetFullPath($nativeRoot)) 'ACL_TREE_LIMIT_EXCEEDED'
# Deterministic expiry without sleeping: alter only the private timer limit on this test instance.
$deadlineAudit = $constructor.Invoke(@([uint32]10, [uint32]2, [uint32]100))
$auditType.GetField('TimeoutMilliseconds').SetValue($deadlineAudit, [uint32]0)
Assert-AuditError $deadlineAudit 'CheckBudget' @() 'ACL_TREE_DEADLINE_EXCEEDED'
Write-Output '5/5 managed ACL tree budget checks passed; no native API invoked'
