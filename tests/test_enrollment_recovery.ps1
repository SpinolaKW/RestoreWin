#Requires -Version 5.1
#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$scriptPath = Join-Path $PSScriptRoot '../tools/Reset-RestoreWinEnrollment.ps1'
$root = Join-Path ([IO.Path]::GetTempPath()) ('restorewin-recovery-test-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $root
$passed = 0
function New-Fixture([string] $Name) {
    $path = Join-Path (Join-Path $root $Name) 'restorewin-desktop'
    $null = New-Item -ItemType Directory -Path $path -Force
    [IO.File]::WriteAllBytes((Join-Path $path 'accounts.initialized'), [byte[]]@())
    [IO.File]::WriteAllText((Join-Path $path 'settings.json'), '{"preserve":true}')
    return $path
}
function Assert-True([bool] $Condition, [string] $Message) {
    if (-not $Condition) { throw $Message }
}
function Assert-Refused([string] $Path) {
    $refused = $false
    try { & $scriptPath -DataDirectory $Path -Apply | Out-Null }
    catch { $refused = $true }
    Assert-True $refused 'Recovery unexpectedly accepted an invalid fixture.'
    Assert-True (Test-Path -LiteralPath $Path) 'Rejected profile was changed.'
}
try {
    $path = New-Fixture 'preview'
    & $scriptPath -DataDirectory $path | Out-Null
    Assert-True (Test-Path -LiteralPath (Join-Path $path 'accounts.initialized')) 'Preview changed the profile.'
    $passed++

    & $scriptPath -DataDirectory $path -Apply -WhatIf | Out-Null
    Assert-True (Test-Path -LiteralPath $path) 'WhatIf changed the profile.'
    $passed++

    $path = New-Fixture 'existing'
    [IO.File]::WriteAllText((Join-Path $path 'accounts.json'), 'original credentials fixture')
    Assert-Refused $path
    Assert-True ([IO.File]::ReadAllText((Join-Path $path 'accounts.json')) -ceq 'original credentials fixture') 'Existing account contents changed.'
    $passed++

    $path = New-Fixture 'temporary'
    [IO.File]::WriteAllText((Join-Path $path 'accounts.fixture.tmp'), 'possibly recoverable')
    Assert-Refused $path
    $passed++

    $path = New-Fixture 'marker'
    [IO.File]::WriteAllText((Join-Path $path 'accounts.initialized'), 'unexpected')
    Assert-Refused $path
    $passed++

    $path = New-Fixture 'directory'
    $null = New-Item -ItemType Directory -Path (Join-Path $path 'accounts.json')
    Assert-Refused $path
    $passed++

    $path = New-Fixture 'running'
    $fixtureExe = Join-Path $root 'RestoreWin.exe'
    $fixtureSource = Join-Path $root 'ProcessFixture.cs'
    [IO.File]::WriteAllText($fixtureSource, 'class ProcessFixture { static void Main() { System.Threading.Thread.Sleep(30000); } }')
    & "$env:SystemRoot\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:exe "/out:$fixtureExe" $fixtureSource
    if ($LASTEXITCODE -ne 0) { throw 'Could not build disposable process fixture.' }
    $process = Start-Process -FilePath $fixtureExe -PassThru
    try { Assert-Refused $path }
    finally { if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force } }
    $passed++

    $path = New-Fixture 'backup'
    $null = New-Item -ItemType Directory -Path (Join-Path $path 'Cache')
    [IO.File]::WriteAllBytes((Join-Path $path 'Cache/blob'), [byte[]]@(0, 1, 128, 255))
    & $scriptPath -DataDirectory $path -Apply | Out-Null
    Assert-True (-not (Test-Path -LiteralPath $path)) 'Source still exists after backup.'
    $backups = @(Get-ChildItem -LiteralPath (Split-Path $path) -Directory)
    Assert-True ($backups.Count -eq 1 -and $backups[0].Name -like 'restorewin-desktop-backup-*') 'Expected exactly one backup.'
    Assert-True ([IO.File]::ReadAllText((Join-Path $backups[0].FullName 'settings.json')) -ceq '{"preserve":true}') 'Settings not preserved.'
    Assert-True (([IO.File]::ReadAllBytes((Join-Path $backups[0].FullName 'Cache/blob')) -join ',') -eq '0,1,128,255') 'Cache contents not preserved.'
    Assert-True (Test-Path -LiteralPath (Join-Path $backups[0].FullName 'accounts.initialized')) 'Marker not preserved.'
    $passed++
    Write-Output "$passed recovery checks passed. Only disposable test profiles were used."
}
finally { Remove-Item -LiteralPath $root -Recurse -Force }
