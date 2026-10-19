Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -Path @((Join-Path $PSScriptRoot 'ProcessMemory.cs'), (Join-Path $PSScriptRoot 'LiveGalaxy.cs'))
# Проверяем только искусственные объекты, без доступа к игре.
Add-Type -TypeDefinition @'
using System;
using System.Reflection;
public static class LiveCountryDecoderTests
{
    public static string Run(Type galaxy)
    {
        var decode = galaxy.GetMethod("DecodeCountry", BindingFlags.NonPublic | BindingFlags.Static);
        var bytes = new byte[11032];
        Action<int, byte[]> put = delegate(int offset, byte[] value) { Array.Copy(value, 0, bytes, offset, value.Length); };
        put(0, BitConverter.GetBytes(0x1000UL));
        put(8, BitConverter.GetBytes(0U));
        put(5352, System.Text.Encoding.UTF8.GetBytes("Test"));
        put(5368, BitConverter.GetBytes(4UL));
        put(5376, BitConverter.GetBytes(15UL));
        Action<byte[], int, string> sso = delegate(byte[] target, int offset, string value)
        {
            Array.Clear(target, offset, 32);
            var encoded = System.Text.Encoding.UTF8.GetBytes(value);
            if (encoded.Length > 15) throw new Exception("Fixture SSO too long.");
            Array.Copy(encoded, 0, target, offset, encoded.Length);
            Array.Copy(BitConverter.GetBytes((ulong)encoded.Length), 0, target, offset + 16, 8);
            Array.Copy(BitConverter.GetBytes(15UL), 0, target, offset + 24, 8);
        };
        var typeBytes = new byte[64];
        var colorBytes = new byte[64];
        sso(typeBytes, 32, "default");
        sso(colorBytes, 24, "white");
        sso(bytes, 10456, "corporate");
        sso(bytes, 10504, "icon.dds");
        put(11024, BitConverter.GetBytes(0x5000UL));
        for (var index = 0; index < 6; index++) put(10968 + index * 8, BitConverter.GetBytes(0x6000UL));
        var heapName = System.Text.Encoding.UTF8.GetBytes("Длинное имя империи");
        var heapReads = 0;
        Func<ulong, int, byte[]> read = delegate(ulong address, int length)
        {
            if (address == 0x3000UL && length == bytes.Length) return bytes;
            if (address == 0x2000UL && length == heapName.Length) { heapReads++; return heapName; }
            if (address == 0x5000UL && length == 64) return typeBytes;
            if (address == 0x6000UL && length == 64) return colorBytes;
            throw new System.ComponentModel.Win32Exception(299);
        };
        Func<object> invoke = delegate { return decode.Invoke(null, new object[] {0x3000UL, 0x1000UL, read}); };
        var country = invoke();
        if (country == null || (string)country.GetType().GetField("id").GetValue(country) != "0" || (string)country.GetType().GetField("name").GetValue(country) != "Test") throw new Exception("SSO/zero ID incorrect.");
        if ((string)country.GetType().GetField("type").GetValue(country) != "default") throw new Exception("Country type missing.");
        var flag = country.GetType().GetField("flag").GetValue(country);
        if ((string)flag.GetType().GetField("category").GetValue(flag) != "corporate" || (string)flag.GetType().GetField("file").GetValue(flag) != "icon.dds") throw new Exception("Flag fields missing.");
        var colors = (string[])flag.GetType().GetField("colors").GetValue(flag);
        if (colors.Length != 6 || Array.Exists(colors, delegate(string color) { return color != "white"; })) throw new Exception("Six colors incorrect.");
        sso(colorBytes, 24, "null");
        country = invoke();
        flag = country.GetType().GetField("flag").GetValue(country);
        colors = (string[])flag.GetType().GetField("colors").GetValue(flag);
        if (Array.Exists(colors, delegate(string color) { return color != "null"; })) throw new Exception("Literal null colors rejected.");
        sso(bytes, 10504, "../bad.dds");
        if (invoke() != null) throw new Exception("Unsafe flag path accepted.");
        sso(bytes, 10504, "bad/file.dds");
        if (invoke() != null) throw new Exception("Flag path separator accepted.");
        sso(bytes, 10504, "");
        sso(bytes, 10456, "");
        if (invoke() == null) throw new Exception("Empty flag segments rejected.");
        sso(bytes, 10504, "icon.dds");
        sso(bytes, 10456, "corporate");
        sso(typeBytes, 32, "bad key");
        if (invoke() != null) throw new Exception("Unsafe country type accepted.");
        sso(typeBytes, 32, "default");
        sso(colorBytes, 24, "bad\u0001");
        if (invoke() != null) throw new Exception("Color control character accepted.");
        sso(colorBytes, 24, "null");
        Array.Copy(BitConverter.GetBytes(257UL), 0, colorBytes, 40, 8);
        Array.Copy(BitConverter.GetBytes(511UL), 0, colorBytes, 48, 8);
        if (invoke() != null) throw new Exception("Oversized color key accepted.");
        sso(colorBytes, 24, "null");
        put(11024, BitConverter.GetBytes(0x7000UL));
        try { invoke(); throw new Exception("Type read failure swallowed."); }
        catch (TargetInvocationException error) { if (!(error.InnerException is System.ComponentModel.Win32Exception)) throw; }
        put(11024, BitConverter.GetBytes(0x5000UL));
        put(5352, BitConverter.GetBytes(0x2000UL));
        put(5368, BitConverter.GetBytes((ulong)heapName.Length));
        put(5376, BitConverter.GetBytes(63UL));
        country = invoke();
        if (country == null || heapReads != 1 || (string)country.GetType().GetField("name").GetValue(country) != "Длинное имя империи") throw new Exception("Heap UTF8 incorrect.");
        heapName = System.Text.Encoding.UTF8.GetBytes("\u0011MMetalfire\u0011!");
        put(5368, BitConverter.GetBytes((ulong)heapName.Length));
        country = invoke();
        if (country == null || (string)country.GetType().GetField("name").GetValue(country) != "Metalfire") throw new Exception("Game colour formatting not removed.");
        heapName = System.Text.Encoding.UTF8.GetBytes("Invalid\u0001");
        put(5368, BitConverter.GetBytes((ulong)heapName.Length));
        if (invoke() != null) throw new Exception("Unexpected control character accepted.");
        var previousReads = heapReads;
        put(5368, BitConverter.GetBytes(0UL));
        country = invoke();
        if (country == null || (string)country.GetType().GetField("name").GetValue(country) != "" || heapReads != previousReads) throw new Exception("Empty name incorrect.");
        put(5368, BitConverter.GetBytes(1025UL));
        if (invoke() != null) throw new Exception("Oversized name accepted.");
        put(5368, BitConverter.GetBytes(0UL));
        put(8, BitConverter.GetBytes(uint.MaxValue));
        if (invoke() != null) throw new Exception("INVALID ID accepted.");
        put(8, BitConverter.GetBytes(1U));
        put(5368, BitConverter.GetBytes(5UL));
        put(5352, BitConverter.GetBytes(0x4000UL));
        try { invoke(); throw new Exception("Read failure swallowed."); }
        catch (TargetInvocationException error) { if (!(error.InnerException is System.ComponentModel.Win32Exception)) throw; }
        return "PASS: country names, type, flags, six colors, literal null, safe keys, bounds and read errors; no game memory read.";
    }
}
'@
[LiveCountryDecoderTests]::Run([StellarisLive.LiveGalaxy])
