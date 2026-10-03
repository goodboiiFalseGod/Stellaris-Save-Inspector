param([string]$SavePath = 'D:/Documents/Paradox Interactive/Stellaris/save games/mpmireeshmireesh_1014498793/2200.01.04.sav')
$ErrorActionPreference = 'Stop'
Add-Type -Path @((Join-Path $PSScriptRoot 'ProcessMemory.cs'), (Join-Path $PSScriptRoot 'LiveGalaxy.cs'))
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($SavePath)
try {
    $reader = [IO.StreamReader]::new($archive.GetEntry('gamestate').Open())
    try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
} finally { $archive.Dispose() }
$section = [regex]::Match($text, '(?ms)^galactic_object=\s*\{.*?^\}')
$records = [regex]::Matches($section.Value, '(?ms)^\t(\d+)=\s*\{.*?^\t\}')
$game = @(Get-Process stellaris)
if ($game.Count -ne 1) { throw 'Expected one game.' }
$snapshot = [StellarisLive.LiveGalaxy]::Capture($game[0].Id)
$addresses = [StellarisLive.LiveGalaxy].GetField('_addresses', [Reflection.BindingFlags]'NonPublic,Static').GetValue($null)
if ($snapshot.systems.Count -ne $records.Count) { throw "Count mismatch: RAM $($snapshot.systems.Count), save $($records.Count)" }
$memory = [StellarisLive.ProcessMemory]::new($game[0].Id)
$samples = @()
try {
    foreach ($record in $records) {
        $id = [uint32]$record.Groups[1].Value
        $bytes = $memory.Read($addresses[$id], 5040)
        $x = [double]::Parse([regex]::Match($record.Value, '(?m)^\t\t\tx=([-\d.]+)').Groups[1].Value, [Globalization.CultureInfo]::InvariantCulture)
        $y = [double]::Parse([regex]::Match($record.Value, '(?m)^\t\t\ty=([-\d.]+)').Groups[1].Value, [Globalization.CultureInfo]::InvariantCulture)
        if ([BitConverter]::ToUInt32($bytes,8) -ne $id -or [Math]::Abs([BitConverter]::ToInt64($bytes,1040)/100000.0-$x) -gt 0.00001 -or [Math]::Abs([BitConverter]::ToInt64($bytes,1048)/100000.0-$y) -gt 0.00001) { throw "Coordinates mismatch $id" }
        $starbase = [regex]::Match($record.Value, '(?ms)^\t\tstarbases=\s*\{\s*(\d+)')
        $starClass = [regex]::Match($record.Value, '(?m)^\t\tstar_class="([^"]+)"').Groups[1].Value
        $samples += [pscustomobject]@{ Id=$id; Bytes=$bytes; Starbase=if($starbase.Success){[uint32]$starbase.Groups[1].Value}else{[uint32]::MaxValue}; StarClass=$starClass }
    }
    "Verified $($samples.Count) systems"
    $classVerified=0
    $baseVerified=0
    foreach($sample in $samples) {
        $definition=$memory.Read([BitConverter]::ToUInt64($sample.Bytes,1072),64)
        $length=[BitConverter]::ToUInt64($definition,48)
        $capacity=[BitConverter]::ToUInt64($definition,56)
        if($length -gt 64 -or $capacity -lt $length) { throw 'Invalid class string' }
        $nameBytes=if($capacity -le 15){$definition[32..(31+[int]$length)]}else{$memory.Read([BitConverter]::ToUInt64($definition,32),[int]$length)}
        if([Text.Encoding]::UTF8.GetString($nameBytes) -cne $sample.StarClass){throw "Class mismatch $($sample.Id)"}
        $classVerified++
        $count=[BitConverter]::ToUInt32($sample.Bytes,1404)
        if($count -ne 1){throw "Base count differs $($sample.Id): $count"}
        $baseBytes=$memory.Read([BitConverter]::ToUInt64($sample.Bytes,1392),4)
        if([BitConverter]::ToUInt32($baseBytes,0) -ne $sample.Starbase){throw "Base mismatch $($sample.Id)"}
        $baseVerified++
    }
    "Verified classes $classVerified and starbase vectors $baseVerified"
    foreach ($sample in $samples | Where-Object Starbase -ne ([uint32]::MaxValue)) { "Base $($sample.Id): $($sample.Starbase), $($sample.StarClass)" }
    for ($offset=0; $offset -le 5036; $offset+=4) {
        $matches = @($samples | Where-Object { [BitConverter]::ToUInt32($_.Bytes,$offset) -eq $_.Starbase }).Count
        if ($matches -ge $samples.Count-2) { "Base offset $offset matches $matches/$($samples.Count)" }
    }
    $groups = @($samples | Group-Object StarClass)
    'Class counts: ' + (($groups | ForEach-Object { "$($_.Name):$($_.Count)" }) -join ', ')
    for ($offset=0; $offset -le 5036; $offset+=4) {
        $values=@{}
        $valid=$true
        foreach($group in $groups) {
            $distinct=@($group.Group | ForEach-Object { [BitConverter]::ToUInt32($_.Bytes,$offset) } | Select-Object -Unique)
            if($distinct.Count -ne 1 -or $values.ContainsKey($distinct[0])) { $valid=$false; break }
            $values[$distinct[0]]=$group.Name
        }
        if($valid -and $groups.Count -gt 1) { "Class offset $offset : " + (($values.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ', ') }
    }
} finally { $memory.Dispose() }
