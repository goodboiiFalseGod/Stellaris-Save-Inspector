Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -Path (Join-Path $PSScriptRoot 'ProcessMemory.cs')
$memoryInfoType = [StellarisLive.ProcessMemory].GetNestedType('MemoryInfo', [Reflection.BindingFlags]::NonPublic)
if ([Runtime.InteropServices.Marshal]::SizeOf([Activator]::CreateInstance($memoryInfoType)) -ne 48) { throw 'Unexpected x64 MEMORY_BASIC_INFORMATION layout.' }
if ([Runtime.InteropServices.Marshal]::OffsetOf($memoryInfoType, 'RegionSize').ToInt32() -ne 24) { throw 'RegionSize offset must be 24 on x64.' }
$encodingApi = [Text.Encoding]::UTF8
$matchesFound = [StellarisLive.ProcessMemory]::FindOffsets($encodingApi.GetBytes('Sol Sol Solaris'), $encodingApi.GetBytes('Sol'))
if (($matchesFound -join ',') -ne '0,4,8') { throw 'Pattern offsets are incorrect.' }
$matchesFound = [StellarisLive.ProcessMemory]::FindOffsets($encodingApi.GetBytes('aaa'), $encodingApi.GetBytes('aa'))
if (($matchesFound -join ',') -ne '0,1') { throw 'Overlapping matches are incorrect.' }
$matchesFound = [StellarisLive.ProcessMemory]::FindOffsets($encodingApi.GetBytes('Sol'), $encodingApi.GetBytes('Solaris'))
if ($matchesFound.Count -ne 0) { throw 'Long pattern should not match.' }
$rejectedOtherProcess = $false
try {
    $unexpectedReader = [StellarisLive.ProcessMemory]::new($PID)
    $unexpectedReader.Dispose()
} catch { $rejectedOtherProcess = $_.Exception.ToString().Contains('Stellaris') }
if (-not $rejectedOtherProcess) { throw 'Other processes must be rejected.' }
Write-Output 'PASS: native reader loads, exact offsets, overlapping matches, long pattern, other-process rejection. No game memory was read.'
