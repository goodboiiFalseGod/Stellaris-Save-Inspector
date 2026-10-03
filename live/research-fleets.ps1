param([switch]$Objects, [Parameter(Mandatory=$true)][string]$SavePath)
$ErrorActionPreference = 'Stop'
if (-not $Objects) { throw 'Укажите -Objects для полной проверки.' }
$game = Get-Process stellaris
if (@($game).Count -ne 1) { throw 'Нужен один процесс Stellaris.' }
if ((Get-FileHash $game.Path -Algorithm SHA256).Hash -ne '07F8D4551E2C508F8E9A2E80AE52B71A623588CB8C5A5EFB4E30847BB908FC3F') { throw 'Неизвестная сборка.' }
$source = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Text;
using System.ComponentModel;
using System.Runtime.InteropServices;
using StellarisLive;
public static class FleetResearch
{
    public static Dictionary<uint, byte[]> Records = new Dictionary<uint, byte[]>();
    public static Dictionary<uint, string> Names = new Dictionary<uint, string>();
    public static Dictionary<uint, uint[]> Ships = new Dictionary<uint, uint[]>();
    private static Stopwatch _timer;
    private static ulong _bytes;
    private static byte[] Read(ProcessMemory memory, ulong address, int length)
    {
        if (_timer.Elapsed.TotalSeconds >= 90 || _bytes + (ulong)length > 12UL * 1024 * 1024 * 1024) throw new Exception("Лимит исследования памяти.");
        _bytes += (ulong)length;
        // Недоступная область прерывает проверку, частичные результаты не подтверждаются.
        return memory.Read(address, length);
    }
    public static void Capture(int pid, ulong image)
    {
        _timer = Stopwatch.StartNew(); _bytes = 0;
        Records.Clear(); Names.Clear(); Ships.Clear();
        using (var memory = new ProcessMemory(pid))
        {
            foreach (var region in memory.Regions())
            {
                if (!region.Readable || region.Type != 0x20000) continue;
                for (ulong offset = 0; offset < region.Size;)
                {
                    var length = (int)Math.Min(65536UL, region.Size - offset);
                    var data = Read(memory, region.Address + offset, length);
                    for (var i = 0; i <= data.Length - 8; i += 8)
                    {
                        if (BitConverter.ToUInt64(data,i) != image + 0x23C87F0UL) continue;
                        var record = Read(memory,region.Address + offset + (ulong)i,4832);
                        var id = BitConverter.ToUInt32(record,48);
                        if (Records.ContainsKey(id)) throw new Exception("Повторный ID флота " + id);
                        var len = BitConverter.ToUInt64(record,1048);
                        var cap = BitConverter.ToUInt64(record,1056);
                        if (len < 1 || len > 256 || cap < len) throw new Exception("Некорректное имя флота " + id);
                        var utf8 = new UTF8Encoding(false,true);
                        Names.Add(id,cap <= 15 ? utf8.GetString(record,1032,(int)len) : utf8.GetString(Read(memory,BitConverter.ToUInt64(record,1032),(int)len)));
                        var count = BitConverter.ToUInt32(record,812);
                        if (count > BitConverter.ToUInt32(record,808) || count > 16384) throw new Exception("Некорректный список кораблей " + id);
                        var ids = new uint[count];
                        if (count > 0)
                        {
                            var bytes = Read(memory,BitConverter.ToUInt64(record,800),(int)count*4);
                            for (var j = 0; j < ids.Length; j++) ids[j] = BitConverter.ToUInt32(bytes,j*4);
                        }
                        Ships.Add(id,ids); Records.Add(id,record);
                    }
                    // Заголовок из 8 байт не пересекает границу выровненных блоков.
                    offset += (ulong)length;
                }
            }
        }
        Console.WriteLine("Полный поиск: " + Records.Count + " флотов, " + _bytes + " байт.");
    }
}
'@
Add-Type -TypeDefinition ($source + [Environment]::NewLine + (Get-Content "$PSScriptRoot/ProcessMemory.cs" -Raw).Replace('using System;', '').Replace('using System.Collections.Generic;', '').Replace('using System.Diagnostics;', '').Replace('using System.ComponentModel;', '').Replace('using System.Runtime.InteropServices;', ''))
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $SavePath).Path)
try {
    $reader = New-Object IO.StreamReader($archive.GetEntry('gamestate').Open())
    try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
} finally { $archive.Dispose() }
$referenceModule = Join-Path $PSScriptRoot 'save-reference.cjs'
$formatModule = Join-Path (Split-Path $PSScriptRoot) 'save-format.js'
$expected = ($text | node -e "const t=require('fs').readFileSync(0,'utf8'),s=require(process.argv[2]),r=require(process.argv[1]).reference(t),fs=new Map(s.entries(s.block(t,'fleet')).filter(e=>e.block!==undefined).map(e=>[e.key,e.block])); for(const f of r.fleets){const b=fs.get(f.id),c=s.block(s.block(b,'movement_manager'),'coordinate')||s.block(b,'coordinate');f.x=s.scalar(c,'x');f.y=s.scalar(c,'y');}console.log(JSON.stringify(r.fleets));" $referenceModule $formatModule) | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or @($expected).Count -eq 0) { throw 'Не удалось разобрать эталон.' }
[FleetResearch]::Capture($game.Id,[uint64]$game.MainModule.BaseAddress.ToInt64())
if ([FleetResearch]::Records.Count -ne @($expected).Count) { throw 'Количество флотов отличается.' }
$culture = [Globalization.CultureInfo]::InvariantCulture
foreach ($fleet in $expected) {
    $id = [uint32]$fleet.id
    $record = [FleetResearch]::Records[$id]
    if (-not $record -or [FleetResearch]::Names[$id] -cne $fleet.nameKey) { throw "ID/имя флота $id отличается." }
    foreach ($offset in @(1096,1100,4824)) {
        if ([BitConverter]::ToUInt32($record,$offset) -ne [uint32]$fleet.ownerId) { throw "Владелец флота $id отличается." }
    }
    if ([BitConverter]::ToUInt32($record,1448) -ne [uint32]$fleet.systemId) { throw "Система флота $id отличается." }
    if ([Math]::Abs(([BitConverter]::ToInt64($record,1424)/100000.0)-[double]::Parse($fleet.x,$culture)) -gt 0.00001 -or [Math]::Abs(([BitConverter]::ToInt64($record,1432)/100000.0)-[double]::Parse($fleet.y,$culture)) -gt 0.00001) { throw "Координаты флота $id отличаются." }
    $ids = [FleetResearch]::Ships[$id]
    if ($ids.Length -ne @($fleet.shipIds).Count) { throw "Количество кораблей флота $id отличается." }
    for ($i=0; $i -lt $ids.Length; $i++) {
        if ($ids[$i] -ne [uint32]$fleet.shipIds[$i]) { throw "ID корабля флота $id отличается." }
    }
}
@{verifiedFleets=@($expected).Count; checkedFields=@('id','nameKey','ownerId','systemId','x','y','shipIds'); readOnly=$true; consistentSnapshotGuaranteed=$false} | ConvertTo-Json
