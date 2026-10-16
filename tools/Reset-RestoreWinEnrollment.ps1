#Requires -Version 5.1
#Requires -RunAsAdministrator
<#
.SYNOPSIS
Preserva o perfil inteiro para reiniciar um cadastro cujo accounts.json sumiu.
.DESCRIPTION
Execute primeiro sem -Apply para conferir. Exige RestoreWin encerrado e somente
accounts.initialized vazio; nunca remove arquivos, altera ACLs ou recupera senhas.
O novo cadastro e as configuracoes serao criados pelo aplicativo ao reabrir.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)]
    [string] $DataDirectory,
    [switch] $Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne 'Win32NT') {
    throw 'Este procedimento requer Windows.'
}

function Get-OptionalItem([string] $LiteralPath) {
    try { Get-Item -LiteralPath $LiteralPath -Force -ErrorAction Stop }
    catch [System.Management.Automation.ItemNotFoundException] { return $null }
    # Acesso negado e outros erros interrompem; nao significam arquivo ausente.
}

function Assert-RecoveryState([string] $Directory) {
    if (@(Get-Process -ErrorAction Stop | Where-Object { $_.ProcessName -ieq 'RestoreWin' }).Count -gt 0) {
        throw 'Encerre todos os processos RestoreWin no Gerenciador de Tarefas. Fechar a janela apenas oculta o aplicativo.'
    }
    $profile = Get-Item -LiteralPath $Directory -Force -ErrorAction Stop
    if (-not $profile.PSIsContainer -or $profile.Name -ine 'restorewin-desktop') {
        throw 'Escolha a pasta de dados restorewin-desktop, nunca a pasta de instalacao.'
    }
    $ancestor = $profile
    while ($null -ne $ancestor) {
        if (($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'A pasta ou um ancestral usa um link/junction. Revisao manual necessaria.'
        }
        $ancestor = $ancestor.Parent
    }
    if ($null -ne (Get-OptionalItem (Join-Path $Directory 'accounts.json'))) {
        throw 'accounts.json existe. Cadastro preservado: este procedimento nao se aplica.'
    }
    $marker = Get-Item -LiteralPath (Join-Path $Directory 'accounts.initialized') -Force -ErrorAction Stop
    if ($marker.PSIsContainer -or $marker.Length -ne 0 -or
        ($marker.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'Marcador inesperado. Nenhuma alteracao realizada.'
    }
    $otherAccounts = @(Get-ChildItem -LiteralPath $Directory -Force -ErrorAction Stop |
        Where-Object { $_.Name -like 'accounts*' -and $_.Name -ine 'accounts.initialized' })
    if ($otherAccounts.Count -ne 0) {
        throw 'Existem outros arquivos de cadastro. Preserve-os para investigar recuperacao.'
    }
    return $profile
}

if (-not [IO.Path]::IsPathRooted($DataDirectory) -or $DataDirectory -notmatch '^[A-Za-z]:\\') {
    throw 'Informe o caminho absoluto local da pasta de dados, com letra de unidade.'
}
$directory = [IO.Path]::GetFullPath($DataDirectory).TrimEnd('\')
$profile = Assert-RecoveryState $directory
$suffix = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N')
$backupName = 'restorewin-desktop-backup-' + $suffix
$backupPath = Join-Path $profile.Parent.FullName $backupName
Write-Output "Origem: $directory"
Write-Output "Backup planejado: $backupPath"
if (-not $Apply) {
    Write-Output 'Somente verificacao. Para executar, repita com -Apply. Nao ha recuperacao das senhas anteriores.'
    return
}
if ($PSCmdlet.ShouldProcess($directory, "Renomear a pasta inteira para $backupName e permitir novo cadastro")) {
    $null = Assert-RecoveryState $directory
    if ($null -ne (Get-OptionalItem $backupPath)) { throw 'Destino de backup ja existe.' }
    Rename-Item -LiteralPath $directory -NewName $backupName -ErrorAction Stop
    $backup = Get-Item -LiteralPath $backupPath -Force -ErrorAction Stop
    if (-not $backup.PSIsContainer -or $null -ne (Get-OptionalItem $directory)) {
        throw "Verificacao inconclusiva. Nao abra o aplicativo; preserve $backupPath para revisao."
    }
    Write-Output "Backup preservado em: $backupPath"
    Write-Output 'Reabra o RestoreWin normalmente pelo atalho e crie o novo administrador. As configuracoes tambem comecam do zero.'
    Write-Output 'Este procedimento nao identifica a causa do desaparecimento de accounts.json. Nao apague o backup.'
}
