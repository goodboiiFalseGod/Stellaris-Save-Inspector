param(
    [Parameter(Mandatory = $true)][string]$SavePath,
    [Parameter(Mandatory = $true)][int]$TargetProcessId,
    [Parameter(Mandatory = $true)][string]$FirstSystemAddress
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# Исследовательский профиль конкретной сборки, не готовый источник данных карты.
$expectedHash = '07F8D4551E2C508F8E9A2E80AE52B71A623588CB8C5A5EFB4E30847BB908FC3F'
$targetProcess = Get-Process -Id $TargetProcessId
try {
    if ($targetProcess.ProcessName -ne 'stellaris') { throw 'Разрешён только процесс Stellaris.' }
    if ((Get-FileHash -LiteralPath $targetProcess.MainModule.FileName -Algorithm SHA256).Hash -ne $expectedHash) { throw 'Сборка игры не соответствует исследовательскому профилю.' }
} finally { $targetProcess.Dispose() }
if ($FirstSystemAddress -notmatch '^0x[0-9a-fA-F]+$') { throw 'Адрес должен иметь вид 0x1234.' }
$firstAddress = [Convert]::ToUInt64($FirstSystemAddress.Substring(2), 16)
Add-Type -Path (Join-Path $PSScriptRoot 'ProcessMemory.cs')
Add-Type -AssemblyName System.IO.Compression.FileSystem
$saveArchive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $SavePath).Path)
try {
    $entry = $saveArchive.GetEntry('gamestate')
    if ($null -eq $entry) { throw 'В сохранении отсутствует gamestate.' }
    $streamReader = [IO.StreamReader]::new($entry.Open())
    try { $saveText = $streamReader.ReadToEnd() } finally { $streamReader.Dispose() }
} finally { $saveArchive.Dispose() }
$section = [regex]::Match($saveText, '(?ms)^galactic_object=\s*\{.*?^\}')
$systems = [regex]::Matches($section.Value, '(?ms)^\t(\d+)=\s*\{.*?^\t\}')
if ($systems.Count -lt 2 -or $systems.Count -gt 2000) { throw 'Некорректный список систем в сохранении.' }
if ($systems.Count -ne [regex]::Matches($section.Value, '(?m)^\t\d+=\s*$').Count) { throw 'Не все записи систем удалось разобрать.' }
$seenIds = [Collections.Generic.HashSet[int]]::new()
$memoryReader = [StellarisLive.ProcessMemory]::new($TargetProcessId)
try {
    $firstBytes = $memoryReader.Read($firstAddress, 1536)
    $vtable = [BitConverter]::ToUInt64($firstBytes, 0)
    $verified = 0
    foreach ($system in $systems) {
        $systemId = [int]$system.Groups[1].Value
        if (-not $seenIds.Add($systemId)) { throw "Повторный ID системы $systemId в сохранении." }
        if ($systemId -lt 0 -or $systemId -ge 2000) { throw 'ID системы вне исследовательского лимита.' }
        # Непрерывное размещение наблюдалось только в этой сессии; каждую запись проверяем.
        $bytes = $memoryReader.Read($firstAddress + [ulong]($systemId * 5040), 1536)
        if ([BitConverter]::ToUInt64($bytes, 0) -ne $vtable -or [BitConverter]::ToUInt32($bytes, 8) -ne $systemId) { throw "ID/тип системы $systemId не совпадает. Адрес или размещение изменились." }
        $savedX = [regex]::Match($system.Value, '(?m)^\t\t\tx=([-\d.]+)').Groups[1].Value
        $savedY = [regex]::Match($system.Value, '(?m)^\t\t\ty=([-\d.]+)').Groups[1].Value
        $x = [BitConverter]::ToInt64($bytes, 1040) / 100000.0
        $y = [BitConverter]::ToInt64($bytes, 1048) / 100000.0
        $culture = [Globalization.CultureInfo]::InvariantCulture
        if ([Math]::Abs($x - [double]::Parse($savedX, $culture)) -gt 0.00001 -or [Math]::Abs($y - [double]::Parse($savedY, $culture)) -gt 0.00001) { throw "Координаты системы $systemId не совпадают." }
        $nameLength = [BitConverter]::ToUInt64($bytes, 1120)
        $nameCapacity = [BitConverter]::ToUInt64($bytes, 1128)
        if ($nameLength -lt 1 -or $nameLength -gt 256 -or $nameCapacity -lt $nameLength) { throw "Некорректная строка системы $systemId." }
        if ($nameCapacity -gt 15) { $nameBytes = $memoryReader.Read([BitConverter]::ToUInt64($bytes, 1104), [int]$nameLength) }
        else { $nameBytes = $bytes[1104..(1103 + [int]$nameLength)] }
        $nameKey = [Text.Encoding]::UTF8.GetString($nameBytes)
        $savedName = [regex]::Match($system.Value, '(?ms)^\t\tname=\s*\{\s*key="([^"]+)"').Groups[1].Value
        if ($nameKey -cne $savedName) { throw "Ключ имени системы $systemId не совпадает." }
        $planetCount = [BitConverter]::ToUInt32($bytes, 1188)
        $savedPlanets = @([regex]::Matches($system.Value, '(?m)^\t\tplanet=(\d+)') | ForEach-Object { [uint32]$_.Groups[1].Value })
        if ($planetCount -ne $savedPlanets.Count -or $planetCount -gt 256) { throw "Количество планет системы $systemId не совпадает." }
        if ($planetCount -gt 0) {
            $planetBytes = $memoryReader.Read([BitConverter]::ToUInt64($bytes, 1176), [int]$planetCount * 4)
            for ($planetIndex = 0; $planetIndex -lt $planetCount; $planetIndex++) {
                if ([BitConverter]::ToUInt32($planetBytes, $planetIndex * 4) -ne $savedPlanets[$planetIndex]) { throw "Планеты системы $systemId не совпадают." }
            }
        }
        $laneCount = [BitConverter]::ToUInt32($bytes, 1436)
        $savedLanes = @([regex]::Matches($system.Value, '(?m)^\t\t\t\tto=(\d+)') | ForEach-Object { [uint32]$_.Groups[1].Value })
        if ($laneCount -ne $savedLanes.Count -or $laneCount -gt 64) { throw "Количество гиперлиний системы $systemId не совпадает." }
        if ($laneCount -gt 0) {
            $laneBytes = $memoryReader.Read([BitConverter]::ToUInt64($bytes, 1424), [int]$laneCount * 32)
            for ($laneIndex = 0; $laneIndex -lt $laneCount; $laneIndex++) {
                if ([BitConverter]::ToUInt32($laneBytes, $laneIndex * 32 + 8) -ne $savedLanes[$laneIndex]) { throw "Соседи системы $systemId не совпадают." }
            }
        }
        $verified++
    }
    @{ readOnly = $true; buildHash = $expectedHash; verifiedSystems = $verified; checkedFields = @('id', 'nameKey', 'x', 'y', 'planetIds', 'hyperlaneTargets'); consistentSnapshotGuaranteed = $false; mapIntegration = $false } | ConvertTo-Json
} finally { $memoryReader.Dispose() }
