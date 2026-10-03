param([string]$SavePath = 'D:/Documents/Paradox Interactive/Stellaris/save games/mpmireeshmireesh_1014498793/2200.01.04.sav', [string]$Country12Address = '')
$ErrorActionPreference = 'Stop'
Add-Type -Path @((Join-Path $PSScriptRoot 'ProcessMemory.cs'), (Join-Path $PSScriptRoot 'LiveGalaxy.cs'))
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($SavePath)
try {
    $reader = [IO.StreamReader]::new($archive.GetEntry('gamestate').Open())
    try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
} finally { $archive.Dispose() }
function Section([string]$key) { [regex]::Match($text, '(?ms)^'+$key+'=\s*\{.*?^\}').Value }
$countries = [regex]::Matches((Section 'country'), '(?ms)^\t(\d+)=\s*\{.*?^\t\}')
$fleetOwners = @{}
foreach ($country in $countries) {
    $owned = [regex]::Match($country.Value, '(?ms)^\t\t\towned_fleets=\s*\{.*?^\t\t\t\}')
    foreach ($fleet in [regex]::Matches($owned.Value, '(?m)^\t\t\t\t\tfleet=(\d+)')) {
        $fleetOwners[[uint32]$fleet.Groups[1].Value] = [uint32]$country.Groups[1].Value
    }
}
$shipFleets = @{}
foreach ($ship in [regex]::Matches((Section 'ships'), '(?ms)^\t(\d+)=\s*\{.*?^\t\}')) {
    $fleet = [regex]::Match($ship.Value, '(?m)^\t\tfleet=(\d+)')
    if ($fleet.Success) { $shipFleets[[uint32]$ship.Groups[1].Value] = [uint32]$fleet.Groups[1].Value }
}
$baseOwners = @{}
foreach ($base in [regex]::Matches((Section 'starbase_mgr'), '(?ms)^\t\t(\d+)=\s*\{.*?^\t\t\}')) {
    $station = [uint32][regex]::Match($base.Value, '(?m)^\t\t\tstation=(\d+)').Groups[1].Value
    if (!$shipFleets.ContainsKey($station)) { throw "No station ship $station" }
    $fleet = $shipFleets[$station]
    if (!$fleetOwners.ContainsKey($fleet)) { throw "No owner for fleet $fleet" }
    $baseOwners[[uint32]$base.Groups[1].Value] = $fleetOwners[$fleet]
}
$records = [regex]::Matches((Section 'galactic_object'), '(?ms)^\t(\d+)=\s*\{.*?^\t\}')
$game = @(Get-Process stellaris)
if ($game.Count -ne 1) { throw 'Expected one game.' }
# Capture проверяет SHA сборки до любого исследования объектов.
$snapshot = [StellarisLive.LiveGalaxy]::Capture($game[0].Id)
$addresses = [StellarisLive.LiveGalaxy].GetField('_addresses', [Reflection.BindingFlags]'NonPublic,Static').GetValue($null)
if ($snapshot.systems.Count -ne $records.Count) { throw 'Reference count mismatch' }
$memory = [StellarisLive.ProcessMemory]::new($game[0].Id)
function ReadSso([byte[]]$data, [int]$offset) {
    $length=[BitConverter]::ToUInt64($data,$offset+16); $capacity=[BitConverter]::ToUInt64($data,$offset+24)
    if ($length -gt 1024 -or $capacity -lt $length -or $capacity -gt 1048576) { throw 'Invalid SSO' }
    if ($length -eq 0) { return '' }
    $value=if($capacity -le 15){$data[$offset..($offset+[int]$length-1)]}else{$memory.Read([BitConverter]::ToUInt64($data,$offset),[int]$length)}
    [Text.UTF8Encoding]::new($false,$true).GetString($value)
}
$samples = @()
try {
    foreach ($record in $records) {
        $id = [uint32]$record.Groups[1].Value
        $bytes = $memory.Read($addresses[$id],5040)
        $x = [double]::Parse([regex]::Match($record.Value,'(?m)^\t\t\tx=([-\d.]+)').Groups[1].Value,[Globalization.CultureInfo]::InvariantCulture)
        $y = [double]::Parse([regex]::Match($record.Value,'(?m)^\t\t\ty=([-\d.]+)').Groups[1].Value,[Globalization.CultureInfo]::InvariantCulture)
        if ([BitConverter]::ToUInt32($bytes,8) -ne $id -or [Math]::Abs([BitConverter]::ToInt64($bytes,1040)/100000.0-$x) -gt 0.00001 -or [Math]::Abs([BitConverter]::ToInt64($bytes,1048)/100000.0-$y) -gt 0.00001) { throw "Reference mismatch $id" }
        $base = [uint32][regex]::Match($record.Value,'(?ms)^\t\tstarbases=\s*\{\s*(\d+)').Groups[1].Value
        $owner = if ($base -eq [uint32]::MaxValue) { [uint32]::MaxValue } else { $baseOwners[$base] }
        $samples += [pscustomobject]@{ Id=$id; Base=$base; Owner=$owner; Bytes=$bytes }
    }
    "Verified references: $($samples.Count); owned $(@($samples | Where-Object Owner -ne ([uint32]::MaxValue)).Count)"
    foreach ($sample in $samples | Where-Object Base -ne ([uint32]::MaxValue)) { "System $($sample.Id); base $($sample.Base); owner $($sample.Owner); +1412=$([BitConverter]::ToUInt32($sample.Bytes,1412)); address=$($addresses[$sample.Id])" }
    for ($offset=0; $offset -le 5036; $offset+=4) {
        $matches = @($samples | Where-Object { [BitConverter]::ToUInt32($_.Bytes,$offset) -eq $_.Owner }).Count
        if ($matches -ge $samples.Count-4) { "Owner offset ${offset}: $matches/$($samples.Count)" }
    }
    foreach ($sample in $samples | Where-Object { $_.Base -ne ([uint32]::MaxValue) -or $_.Id -eq 141 }) {
        "Tail $($sample.Id): " + (($sample.Bytes[4944..5039] | ForEach-Object { $_.ToString('X2') }) -join ' ')
    }
    if ($Country12Address) {
        if ($Country12Address -notmatch '^0x[0-9A-Fa-f]+$') { throw 'Explicit hex country12 address required' }
        $anchor = [Convert]::ToUInt64($Country12Address.Substring(2),16)
        $countrySamples = @()
        $colorSource = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../../flags/colors.txt') -Raw
        $moduleBase = [uint64]$game[0].MainModule.BaseAddress.ToInt64()
        foreach ($country in $countries) {
            $id = [uint32]$country.Groups[1].Value
            # Шаг проверяется на каждом объекте; это исследовательское наблюдение, не runtime профиль.
            $candidate = [uint64]([long]$anchor+([long]$id-12)*14992)
            $bytes = $memory.Read($candidate,14992)
            if ([BitConverter]::ToUInt32($bytes,8) -ne $id -or [BitConverter]::ToUInt64($bytes,0) -ne $moduleBase+0x23940B8) { throw "Country object mismatch $id" }
            $length = [BitConverter]::ToUInt64($bytes,5368)
            $capacity = [BitConverter]::ToUInt64($bytes,5376)
            if ($length -lt 1 -or $length -gt 256 -or $capacity -lt $length) { throw "Country name invalid $id" }
            $nameBytes = if ($capacity -le 15) { $bytes[5352..(5351+[int]$length)] } else { $memory.Read([BitConverter]::ToUInt64($bytes,5352),[int]$length) }
            $name = [Text.UTF8Encoding]::new($false,$true).GetString($nameBytes)
            $type = [regex]::Match($country.Value,'(?m)^\t\ttype="([^"]+)"').Groups[1].Value
            $definition=$memory.Read([BitConverter]::ToUInt64($bytes,11024),64)
            if ((ReadSso $definition 32) -cne $type) { throw "Country type mismatch $id" }
            $flag=[regex]::Match($country.Value,'(?ms)^\t\tflag=\s*\{.*?^\t\t\}').Value
            $icon=[regex]::Match($flag,'(?ms)^\t\t\ticon=\s*\{.*?^\t\t\t\}').Value
            $category=[regex]::Match($icon,'category="([^"]*)"').Groups[1].Value
            $file=[regex]::Match($icon,'file="([^"]*)"').Groups[1].Value
            if ((ReadSso $bytes 10456) -cne $category -or (ReadSso $bytes 10504) -cne $file) { throw "Country flag mismatch $id" }
            $colors=@([regex]::Matches([regex]::Match($flag,'(?ms)^\t\t\tcolors=\s*\{.*?^\t\t\t\}').Value,'"([^"]+)"') | ForEach-Object { $_.Groups[1].Value })
            if($colors.Count -ne 6){throw "Expected 6 colors country $id"}
            for($colorIndex=0;$colorIndex -lt 6;$colorIndex++){
                $definition=$memory.Read([BitConverter]::ToUInt64($bytes,10968+$colorIndex*8),88)
                if ((ReadSso $definition 24) -cne $colors[$colorIndex]) { throw "Country color mismatch $id/$colorIndex" }
                if($colors[$colorIndex] -eq 'null'){continue}
                $line=[regex]::Match($colorSource,'(?m)^\s*'+[regex]::Escape($colors[$colorIndex])+'\s*=\s*\{([^\r\n]+)').Groups[1].Value
                foreach($channel in @(@{Kind='flag';Offset=56},@{Kind='map';Offset=72})) {
                    $rgb=[regex]::Match($line,$channel.Kind+'\s*=\s*rgb\s*\{\s*(\d+)\s+(\d+)\s+(\d+)\s*\}')
                    if(!$rgb.Success){throw "Missing rgb definition $($colors[$colorIndex])/$($channel.Kind)"}
                    for($axis=0;$axis -lt 3;$axis++){
                        if([Math]::Abs([BitConverter]::ToSingle($definition,$channel.Offset+$axis*4)*255-[int]$rgb.Groups[$axis+1].Value) -gt 0.0001){throw "RGB mismatch $id/$colorIndex/$($channel.Kind)"}
                    }
                }
            }
            $countrySamples += [pscustomobject]@{Id=$id; Bytes=$bytes; Type=$type; Name=$name}
            "Country $id; type $type; display $name"
        }
        $groups = @($countrySamples | Group-Object Type)
        for ($offset=0; $offset -le 14984; $offset+=8) {
            $values=@{}; $valid=$true
            foreach ($group in $groups) {
                $distinct=@($group.Group | ForEach-Object { [BitConverter]::ToUInt64($_.Bytes,$offset) } | Select-Object -Unique)
                if ($distinct.Count -ne 1 -or $values.ContainsKey($distinct[0])) { $valid=$false; break }
                $values[$distinct[0]]=$group.Name
            }
            if ($valid) { "Type candidate +${offset}: " + (($values.GetEnumerator() | ForEach-Object { "{0:X}={1}" -f $_.Key,$_.Value }) -join ', ') }
        }
    }
} finally { $memory.Dispose() }
