param([int]$TargetProcessId = 0)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not ('StellarisLive.LiveGalaxy' -as [type])) {
    Add-Type -Path @((Join-Path $PSScriptRoot 'ProcessMemory.cs'), (Join-Path $PSScriptRoot 'LiveGalaxy.cs'))
}
if ($TargetProcessId -eq 0) {
    $gameProcesses = @(Get-Process -Name stellaris -ErrorAction SilentlyContinue)
    try {
        if ($gameProcesses.Count -ne 1) { throw 'Запустите одну копию Stellaris или укажите TargetProcessId.' }
        $TargetProcessId = $gameProcesses[0].Id
    } finally { foreach ($gameProcess in $gameProcesses) { $gameProcess.Dispose() } }
}
[StellarisLive.LiveGalaxy]::Capture($TargetProcessId) | ConvertTo-Json -Depth 8
