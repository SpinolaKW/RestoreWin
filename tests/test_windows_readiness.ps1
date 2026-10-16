#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../tools/Get-RestoreWinReadiness.ps1')
function Assert-True([bool] $Condition, [string] $Message) {
    if (-not $Condition) { throw $Message }
}
$passed = 0
foreach ($edition in @('Core', 'Professional', 'ProfessionalEducation', 'ProfessionalWorkstation')) {
    foreach ($build in @('19045', '26200')) {
        $report = New-RestoreWinReadinessReport @{Edition=$edition; Build=$build; InstallationType='Client'; Warnings=@()}
        Assert-True ($report.protection.candidateImplementation -eq 'own-driver-required') 'Home/Pro was routed to UWF.'
        Assert-True (-not $report.protection.restoreWinActivationAvailable) 'Activation was enabled.'
        $passed++
    }
}
foreach ($edition in @('Enterprise', 'Education', 'IoTEnterprise', 'EnterpriseS')) {
    $report = New-RestoreWinReadinessReport @{Edition=$edition; Build='26200'; InstallationType='Client'; UwfCurrent=$true; UwfNext=$false; Warnings=@()}
    Assert-True ($report.protection.candidateImplementation -eq 'review-native-uwf') 'Enterprise routing failed.'
    Assert-True ($report.uwf.currentEnabled -and -not $report.uwf.nextEnabled) 'Current and next UWF state confused.'
    Assert-True (-not $report.protection.restoreWinActivationAvailable) 'Existing global UWF enabled RestoreWin activation.'
    $passed++
}
foreach ($facts in @(
    @{},
    @{Edition='Professional'; Build='unknown'; InstallationType='Client'},
    @{Edition='Enterprise'; Build='26200'; InstallationType='Server'},
    @{Edition='UnknownEdition'; Build='26200'; InstallationType='Client'},
    @{Edition='Enterprise'; Build='7601'; InstallationType='Client'}
)) {
    $report = New-RestoreWinReadinessReport $facts
    Assert-True ($report.protection.candidateImplementation -eq 'undetermined') 'Unknown/server/old Windows was classified as supported.'
    Assert-True ($null -eq $report.uwf.currentEnabled -and $null -eq $report.domainJoined) 'Missing probe data was treated as false.'
    $passed++
}
$report = New-RestoreWinReadinessReport @{Edition='Enterprise'; Build='26200'; InstallationType='Client'; UwfCurrent='true'; UwfNext='false'; DomainJoined=$false; Warnings=@('uwf-unreadable-or-not-installed')}
Assert-True ($report.uwf.queryStatus -eq 'unknown' -and $null -eq $report.uwf.nextEnabled) 'Invalid CIM types were trusted.'
Assert-True ($report.domainJoined -eq $false -and $report.corporatePolicyAssessment -eq 'not-assessed') 'Domain state was treated as a policy assessment.'
$passed++

# Real read-only Windows probe; Windows Server CI must never become a supported client.
$report = Get-RestoreWinReadiness
$json = $report | ConvertTo-Json -Depth 6
$parsed = $json | ConvertFrom-Json
Assert-True ($parsed.mode -eq 'inspection-only' -and $parsed.schemaVersion -eq 1) 'Real report could not be serialized.'
Assert-True (-not $parsed.protection.restoreWinActivationAvailable) 'Real probe allowed activation.'
Assert-True ($parsed.protection.bootValidation -eq 'not-performed') 'Probe claimed boot validation.'
Assert-True ($parsed.windows.installationType -match 'Server' -and $parsed.protection.candidateImplementation -eq 'undetermined') 'Windows Server runner classified as client.'
$passed++

# Verify this standalone tool contains only the documented command surface.
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../tools/Get-RestoreWinReadiness.ps1'), [ref]$tokens, [ref]$errors)
Assert-True ($errors.Count -eq 0) 'PowerShell syntax errors.'
$allowed = @('Get-ItemProperty', 'Get-CimInstance', 'New-RestoreWinReadinessReport', 'Get-RestoreWinReadiness', 'ConvertTo-Json')
foreach ($command in $ast.FindAll({param($node) $node -is [Management.Automation.Language.CommandAst]}, $true)) {
    Assert-True ($command.GetCommandName() -cin $allowed) ('Unexpected command: ' + $command.GetCommandName())
}
$passed++
Write-Output "$passed readiness checks passed; live probes were read-only. No reboot/driver protection was tested."
