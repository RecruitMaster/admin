# Windows PowerShell 5.1+ launcher. Server-side installer is pinned and mail stays disabled.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^root@[A-Za-z0-9][A-Za-z0-9.-]*$')]
    [string]$Target,

    [ValidateSet('deploy', 'rollback')]
    [string]$Action = 'deploy',

    [string]$BackupPath = '',

    [switch]$PlanOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$installerSha = '56a521071390a7d7196df30cff41cc2206342144'
$releaseSha = '1b0e6e0b8a332225152e11523c13528380e9f663'
$rawBase = "https://raw.githubusercontent.com/RecruitMaster/admin/$installerSha/scripts"
$tag = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$unique = [Guid]::NewGuid().ToString('N').Substring(0, 8)
$remoteDir = "/root/rm-admin-deploy-$tag-$unique"

if ($Action -eq 'rollback') {
    if ($BackupPath -notmatch '^/home/rm/admin-deployments/[0-9]{8}T[0-9]{6}Z-[a-f0-9]{12}$') {
        throw 'For rollback supply the exact backup folder printed by the installer.'
    }
    $operation = "rollback '$BackupPath'"
} else {
    if ($BackupPath) { throw 'BackupPath is only valid with -Action rollback.' }
    $operation = "deploy '$releaseSha'"
}

# No secret values, passwords or private settings are read by this launcher.
# Commands after && run in the remote Linux shell, not in Windows PowerShell.
$remoteCommand = "umask 077; mkdir -m 700 '$remoteDir' && " +
    "curl -fsSL --retry 2 --connect-timeout 15 --max-time 120 '$rawBase/deploy-admin.sh' -o '$remoteDir/deploy-admin.sh' && " +
    "curl -fsSL --retry 2 --connect-timeout 15 --max-time 120 '$rawBase/deploy-admin.py' -o '$remoteDir/deploy-admin.py' && " +
    "bash '$remoteDir/deploy-admin.sh' $operation"

Write-Host "Action: $Action; application release: $releaseSha"
Write-Host "Remote installer folder: $remoteDir"
if ($PlanOnly) {
    Write-Output $remoteCommand
    return
}

$sshCommand = Get-Command ssh.exe -CommandType Application -ErrorAction SilentlyContinue
if (-not $sshCommand) {
    throw 'Windows OpenSSH client (ssh.exe) is required. No deployment was attempted.'
}
Write-Host 'Connecting by SSH. Enter a password only at the SSH prompt if requested.'
& $sshCommand.Source -t $Target $remoteCommand
if ($LASTEXITCODE -ne 0) {
    throw 'Remote command failed. Deployment is not confirmed. Read the STOPPED/rollback result above; do not share private logs.'
}
Write-Host 'Remote command completed. Confirm the INSTALLED or ROLLED BACK line and retain the backup path.'
