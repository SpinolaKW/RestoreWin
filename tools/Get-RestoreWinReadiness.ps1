#Requires -Version 5.1
<#
.SYNOPSIS
Diagnostico somente de leitura para planejar protecao da instalacao fisica.
.DESCRIPTION
Nao instala recursos, nao executa metodos UWF, nao altera o boot ou politicas.
Nao inclui nomes de usuarios, dominio, numero de serie ou chaves BitLocker.
Sem parametros, escreve JSON na saida. -AsObject retorna o objeto PowerShell.
#>
[CmdletBinding()]
param([switch] $AsObject)

function New-RestoreWinReadinessReport {
    param([Parameter(Mandatory = $true)][hashtable] $Facts)
    $edition = [string] $Facts.Edition
    $isClient = $Facts.InstallationType -ceq 'Client'
    $build = 0
    $buildKnown = [int]::TryParse([string] $Facts.Build, [ref] $build) -and $build -gt 0
    $windowsFamily = 'unknown'
    if ($isClient -and $buildKnown -and $build -ge 10240) {
        $windowsFamily = if ($build -ge 22000) { 'windows-11-or-later' } else { 'windows-10' }
    }
    # This is a routing hint, never a support/activation decision.
    $uwfEditions = @('Enterprise', 'EnterpriseN', 'EnterpriseS', 'EnterpriseSN',
        'Education', 'EducationN', 'IoTEnterprise', 'IoTEnterpriseS')
    $homeProEditions = @('Core', 'CoreN', 'CoreSingleLanguage', 'CoreCountrySpecific',
        'Professional', 'ProfessionalN', 'ProfessionalEducation', 'ProfessionalEducationN',
        'ProfessionalWorkstation', 'ProfessionalWorkstationN')
    $candidate = 'undetermined'
    if ($windowsFamily -ne 'unknown') {
        if ($edition -cin $uwfEditions) { $candidate = 'review-native-uwf' }
        elseif ($edition -cin $homeProEditions) { $candidate = 'own-driver-required' }
    }
    $uwfReadable = $Facts.UwfCurrent -is [bool] -and $Facts.UwfNext -is [bool]
    [pscustomobject][ordered]@{
        schemaVersion = 1
        collectedAtUtc = [DateTime]::UtcNow.ToString('o')
        mode = 'inspection-only'
        windows = [ordered]@{
            edition = $edition
            displayVersion = [string] $Facts.DisplayVersion
            build = if ($buildKnown) { $build } else { $null }
            installationType = [string] $Facts.InstallationType
            familyHint = $windowsFamily
        }
        domainJoined = if ($Facts.DomainJoined -is [bool]) { $Facts.DomainJoined } else { $null }
        corporatePolicyAssessment = 'not-assessed'
        uwf = [ordered]@{
            queryStatus = if ($uwfReadable) { 'readable' } else { 'unknown' }
            currentEnabled = if ($uwfReadable) { $Facts.UwfCurrent } else { $null }
            nextEnabled = if ($uwfReadable) { $Facts.UwfNext } else { $null }
        }
        protection = [ordered]@{
            restoreWinActivationAvailable = $false
            implementationStatus = 'not-implemented'
            candidateImplementation = $candidate
            bootValidation = 'not-performed'
            note = 'O candidato nao comprova compatibilidade. UWF global nao confirma volumes protegidos, exclusoes ou instalacao do RestoreWin.'
        }
        warnings = @($Facts.Warnings)
    }
}

function Get-RestoreWinReadiness {
    if ([Environment]::OSVersion.Platform -ne 'Win32NT') { throw 'Este diagnostico requer Windows.' }
    $facts = @{ Warnings = @() }
    try {
        $cv = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -ErrorAction Stop
        $facts.Edition = $cv.EditionID
        $facts.DisplayVersion = $cv.DisplayVersion
        $facts.Build = $cv.CurrentBuildNumber
        $facts.InstallationType = $cv.InstallationType
    } catch { $facts.Warnings += 'windows-version-unreadable' }
    try {
        $system = Get-CimInstance -ClassName Win32_ComputerSystem -OperationTimeoutSec 10 -ErrorAction Stop
        $facts.DomainJoined = $system.PartOfDomain
    } catch { $facts.Warnings += 'domain-membership-unreadable' }
    try {
        $filter = @(Get-CimInstance -Namespace 'root\standardcimv2\embedded' -ClassName UWF_Filter -OperationTimeoutSec 10 -ErrorAction Stop)
        if ($filter.Count -eq 1) {
            $facts.UwfCurrent = $filter[0].CurrentEnabled
            $facts.UwfNext = $filter[0].NextEnabled
        }
        if ($facts.UwfCurrent -isnot [bool] -or $facts.UwfNext -isnot [bool]) { throw 'State unknown' }
    } catch { $facts.Warnings += 'uwf-unreadable-or-not-installed' }
    New-RestoreWinReadinessReport -Facts $facts
}

# Dot-sourcing exposes the pure classifier for tests without running probes.
if ($MyInvocation.InvocationName -ne '.') {
    $report = Get-RestoreWinReadiness
    if ($AsObject) { $report } else { $report | ConvertTo-Json -Depth 6 }
}
