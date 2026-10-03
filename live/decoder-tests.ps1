Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -Path @((Join-Path $PSScriptRoot 'ProcessMemory.cs'), (Join-Path $PSScriptRoot 'LiveGalaxy.cs'))
Add-Type -TypeDefinition @'
using System;
using System.Reflection;
public static class LiveDecoderTests
{
    public static string Run(Type galaxy)
    {
        var decode = galaxy.GetMethod("Decode", BindingFlags.NonPublic | BindingFlags.Static);
        var bytes = new byte[1536];
        Action<int, byte[]> put = delegate(int offset, byte[] value) { Array.Copy(value, 0, bytes, offset, value.Length); };
        put(0, BitConverter.GetBytes(0x1000UL));
        put(8, BitConverter.GetBytes(1U));
        put(1040, BitConverter.GetBytes(200000L));
        put(1048, BitConverter.GetBytes(-300000L));
        put(1072, BitConverter.GetBytes(0x4000UL));
        put(1104, System.Text.Encoding.UTF8.GetBytes("Sol"));
        put(1120, BitConverter.GetBytes(3UL));
        put(1128, BitConverter.GetBytes(15UL));
        put(1176, BitConverter.GetBytes(0x2000UL));
        put(1188, BitConverter.GetBytes(2U));
        put(1392, BitConverter.GetBytes(0x5000UL));
        put(1400, BitConverter.GetBytes(1U));
        put(1404, BitConverter.GetBytes(1U));
        var planets = new byte[8];
        var starbases = BitConverter.GetBytes(14U);
        var baseOwner = BitConverter.GetBytes(0U);
        var starClass = new byte[64];
        Array.Copy(System.Text.Encoding.UTF8.GetBytes("sc_g"), 0, starClass, 32, 4);
        Array.Copy(BitConverter.GetBytes(4UL), 0, starClass, 48, 8);
        Array.Copy(BitConverter.GetBytes(15UL), 0, starClass, 56, 8);
        Array.Copy(BitConverter.GetBytes(10U), planets, 4);
        Array.Copy(BitConverter.GetBytes(11U), 0, planets, 4, 4);
        Func<ulong, int, byte[]> read = delegate(ulong address, int length)
        {
            var source = address == 0x3000UL ? bytes : address == 0x2000UL ? planets : address == 0x4000UL ? starClass : address == 0x5000UL ? starbases : address == 0x4370UL ? baseOwner : null;
            if (source == null || source.Length != length) throw new Exception("Unexpected fixture read.");
            return source;
        };
        var result = decode.Invoke(null, new object[] {null, 0x3000UL, 0x1000UL, read});
        if (result == null) throw new Exception("Valid fixture rejected.");
        var resultType = result.GetType();
        if ((string)resultType.GetField("starClass").GetValue(result) != "sc_g") throw new Exception("Star class mismatch.");
        if ((string)resultType.GetField("baseOwnerId").GetValue(result) != "0") throw new Exception("Owner zero must not be treated as absent.");
        var bases = (System.Collections.Generic.List<string>)resultType.GetField("starbaseIds").GetValue(result);
        if (bases.Count != 1 || bases[0] != "14") throw new Exception("Starbase references mismatch.");
        starbases = BitConverter.GetBytes(uint.MaxValue);
        var emptyResult = decode.Invoke(null, new object[] {null, 0x3000UL, 0x1000UL, read});
        if (((System.Collections.Generic.List<string>)resultType.GetField("starbaseIds").GetValue(emptyResult)).Count != 0) throw new Exception("INVALID starbase accepted.");
        var ids = (System.Collections.Generic.List<string>)resultType.GetField("planetIds").GetValue(result);
        if (string.Join(",", ids.ToArray()) != "10,11") throw new Exception("Planet references mismatch.");
        if ((double)resultType.GetField("x").GetValue(result) != 2 || (double)resultType.GetField("y").GetValue(result) != -3) throw new Exception("Fixed-point coordinates mismatch.");
        Array.Copy(BitConverter.GetBytes(10U), 0, planets, 4, 4);
        if (decode.Invoke(null, new object[] {null, 0x3000UL, 0x1000UL, read}) != null) throw new Exception("Duplicate planet reference accepted.");
        Array.Copy(BitConverter.GetBytes(uint.MaxValue), 0, planets, 4, 4);
        if (decode.Invoke(null, new object[] {null, 0x3000UL, 0x1000UL, read}) != null) throw new Exception("Invalid planet reference accepted.");
        return "PASS: native decoder, fixed-point coordinates, planet references, invalid and duplicate IDs; no game memory read.";
    }
}
'@
[LiveDecoderTests]::Run([StellarisLive.LiveGalaxy])
