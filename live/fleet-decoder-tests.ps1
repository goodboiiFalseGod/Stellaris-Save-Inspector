Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -Path @((Join-Path $PSScriptRoot 'ProcessMemory.cs'), (Join-Path $PSScriptRoot 'LiveGalaxy.cs'))
# Искусственные объекты, без подключения к памяти игры.
Add-Type -TypeDefinition @'
using System;
using System.Reflection;
public static class LiveFleetDecoderTests
{
    public static string Run(Type galaxy)
    {
        var decode = galaxy.GetMethod("DecodeFleet", BindingFlags.NonPublic | BindingFlags.Static);
        var bytes = new byte[1452];
        Action<int, byte[]> put = delegate(int offset, byte[] value) { Array.Copy(value, 0, bytes, offset, value.Length); };
        put(0, BitConverter.GetBytes(0x1000UL));
        put(48, BitConverter.GetBytes(7U));
        put(800, BitConverter.GetBytes(0x2000UL));
        put(808, BitConverter.GetBytes(2U));
        put(812, BitConverter.GetBytes(2U));
        put(1032, System.Text.Encoding.UTF8.GetBytes("Fleet"));
        put(1048, BitConverter.GetBytes(5UL));
        put(1056, BitConverter.GetBytes(15UL));
        put(1096, BitConverter.GetBytes(0U));
        put(1100, BitConverter.GetBytes(99U));
        put(1448, BitConverter.GetBytes(5U));
        var ships = new byte[8];
        Array.Copy(BitConverter.GetBytes(12U), ships, 4);
        Array.Copy(BitConverter.GetBytes(13U), 0, ships, 4, 4);
        var heapName = System.Text.Encoding.UTF8.GetBytes("Длинное имя флота");
        Func<ulong, int, byte[]> read = delegate(ulong address, int length)
        {
            if (address == 0x3000UL && length == bytes.Length) return bytes;
            if (address == 0x2000UL && length == ships.Length) return ships;
            if (address == 0x4000UL && length == heapName.Length) return heapName;
            throw new System.ComponentModel.Win32Exception(299);
        };
        Func<object> invoke = delegate { return decode.Invoke(null, new object[] {0x3000UL, 0x1000UL, read}); };
        var fleet = invoke();
        Func<string, object> field = key => fleet.GetType().GetField(key).GetValue(fleet);
        if (fleet == null || (string)field("id") != "7" || (string)field("ownerId") != "0" || (string)field("systemId") != "5" || (string)field("nameKey") != "Fleet") throw new Exception("Fleet core mismatch.");
        if (string.Join(",", ((System.Collections.Generic.List<string>)field("shipIds")).ToArray()) != "12,13") throw new Exception("Ship vector mismatch.");
        put(1448, BitConverter.GetBytes(uint.MaxValue));
        fleet = invoke();
        if (fleet == null || field("systemId") != null) throw new Exception("INVALID origin mismatch.");
        put(1032, BitConverter.GetBytes(0x4000UL));
        put(1048, BitConverter.GetBytes((ulong)heapName.Length));
        put(1056, BitConverter.GetBytes(63UL));
        fleet = invoke();
        if (fleet == null || (string)field("nameKey") != "Длинное имя флота") throw new Exception("Heap UTF8 mismatch.");
        Array.Copy(BitConverter.GetBytes(12U), 0, ships, 4, 4);
        if (invoke() != null) throw new Exception("Duplicate ship accepted.");
        Array.Copy(BitConverter.GetBytes(uint.MaxValue), 0, ships, 4, 4);
        if (invoke() != null) throw new Exception("INVALID ship accepted.");
        ships = new byte[16384 * 4];
        for (var index = 0; index < 16384; index++) Array.Copy(BitConverter.GetBytes((uint)index), 0, ships, index * 4, 4);
        put(808, BitConverter.GetBytes(16385U));
        put(812, BitConverter.GetBytes(16384U));
        fleet = invoke();
        if (fleet == null || ((System.Collections.Generic.List<string>)field("shipIds")).Count != 16384) throw new Exception("64 KiB ship vector boundary rejected.");
        put(812, BitConverter.GetBytes(16385U));
        if (invoke() != null) throw new Exception("Oversized ship vector accepted.");
        put(812, BitConverter.GetBytes(0U));
        put(1048, BitConverter.GetBytes(0UL));
        fleet = invoke();
        if (fleet == null || (string)field("nameKey") != "") throw new Exception("Empty name mismatch.");
        put(1096, BitConverter.GetBytes(100000U));
        if (invoke() != null) throw new Exception("Invalid owner accepted.");
        put(1096, BitConverter.GetBytes(0U));
        put(1048, BitConverter.GetBytes(5UL));
        put(1032, BitConverter.GetBytes(0x5000UL));
        try { invoke(); throw new Exception("Read failure swallowed."); }
        catch (TargetInvocationException error) { if (!(error.InnerException is System.ComponentModel.Win32Exception)) throw; }
        return "PASS: fleet core, owner/controller distinction, ship vector, INVALID origin, UTF8, bounds, read errors; no game memory read.";
    }
}
'@
[LiveFleetDecoderTests]::Run([StellarisLive.LiveGalaxy])
