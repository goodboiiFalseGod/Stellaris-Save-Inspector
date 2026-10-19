param(
    [ValidateSet('Info', 'Regions', 'FindString', 'Read')][string]$Action = 'Info',
    [int]$TargetProcessId = 0,
    [string]$Pattern = '',
    [ValidateSet('UTF8', 'UTF16')][string]$TextEncoding = 'UTF8',
    [ValidateRange(1, 512)][int]$MaxMegabytes = 64,
    [ValidateRange(1, 100)][int]$MaxMatches = 20,
    [string]$Address = '',
    [string]$StartAddress = '0x0',
    [ValidateRange(1, 4096)][int]$Length = 64
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not [Environment]::Is64BitProcess) { throw 'Run in 64-bit PowerShell.' }
if (-not ('StellarisLive.ProcessMemory' -as [type])) { Add-Type -Path (Join-Path $PSScriptRoot 'ProcessMemory.cs') }
$gameProcesses = @(Get-Process -Name stellaris -ErrorAction SilentlyContinue)
if ($TargetProcessId -ne 0) { $gameProcesses = @($gameProcesses | Where-Object { $_.Id -eq $TargetProcessId }) }
if ($gameProcesses.Count -eq 0) { throw 'Stellaris is not running. Start the game and load a save first.' }
if ($gameProcesses.Count -ne 1) { throw 'Multiple Stellaris processes found. Specify -TargetProcessId.' }
$gameProcess = $gameProcesses[0]
$memoryReader = $null
try {
    $memoryReader = [StellarisLive.ProcessMemory]::new($gameProcess.Id)
    $gameModule = $gameProcess.MainModule
    $identity = [ordered]@{
        schemaVersion = 1
        processId = $gameProcess.Id
        executable = $gameModule.FileName
        sha256 = (Get-FileHash -LiteralPath $gameModule.FileName -Algorithm SHA256).Hash
        moduleBase = ('0x{0:X}' -f $gameModule.BaseAddress.ToInt64())
        moduleSize = $gameModule.ModuleMemorySize
        capturedAt = [DateTime]::UtcNow.ToString('o')
        readOnly = $true
        gameObjectsDecoded = $false
    }
    switch ($Action) {
        'Info' {
            $regions = @($memoryReader.Regions())
            $readableRegions = @($regions | Where-Object Readable)
            $identity.regionCount = $regions.Count
            $identity.readableRegionCount = $readableRegions.Count
            $identity.readableBytes = ($readableRegions | Measure-Object -Property Size -Sum).Sum
        }
        'Regions' {
            $identity.regions = @($memoryReader.Regions() | Where-Object Readable | ForEach-Object {
                @{ address = ('0x{0:X}' -f $_.Address); size = $_.Size; protection = ('0x{0:X}' -f $_.Protection); type = ('0x{0:X}' -f $_.Type) }
            })
        }
        'FindString' {
            if ([string]::IsNullOrWhiteSpace($Pattern) -or $Pattern.Length -lt 3) { throw 'Supply -Pattern with a known system/empire name (at least 3 characters).' }
            $encodingApi = if ($TextEncoding -eq 'UTF16') { [Text.Encoding]::Unicode } else { [Text.Encoding]::UTF8 }
            if ($StartAddress -notmatch '^0x[0-9a-fA-F]+$') { throw 'StartAddress must be hex.' }
            $search = $memoryReader.Find($encodingApi.GetBytes($Pattern), $MaxMegabytes, $MaxMatches, [Convert]::ToUInt64($StartAddress.Substring(2), 16))
            $identity.addresses = @($search.Addresses | ForEach-Object { '0x{0:X}' -f $_ })
            $identity.bytesAttempted = $search.BytesRead
            $identity.failedReads = $search.FailedReads
            $identity.limited = $search.Limited
            $identity.nextAddress = ('0x{0:X}' -f $search.NextAddress)
            $identity.note = 'String matches are candidates, not verified game-object addresses. No surrounding memory is exported.'
        }
        'Read' {
            if ($Address -notmatch '^0x[0-9a-fA-F]+$') { throw 'Supply an explicit hex address, e.g. -Address 0x12345678.' }
            $numericAddress = [Convert]::ToUInt64($Address.Substring(2), 16)
            $data = $memoryReader.Read($numericAddress, $Length)
            $identity.address = $Address
            $identity.hex = [BitConverter]::ToString($data).Replace('-', ' ')
        }
    }
    $identity | ConvertTo-Json -Depth 5
} finally {
    if ($null -ne $memoryReader) { $memoryReader.Dispose() }
    $gameProcess.Dispose()
}
