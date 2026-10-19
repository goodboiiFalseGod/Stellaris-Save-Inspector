Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -Path @((Join-Path $PSScriptRoot 'ProcessMemory.cs'), (Join-Path $PSScriptRoot 'LiveGalaxy.cs'))
# Искусственные ошибки: тест не подключается к игре и не читает память.
Add-Type -TypeDefinition @'
public static class LiveRetryTests
{
    public static void Run(System.Type readerType)
    {
        var method = readerType.GetMethod("ReadWithRetries", System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic);
        if (method == null) throw new System.Exception("Retry method missing.");
        var calls = 0;
        var budgetCalls = 0;
        System.Func<byte[]> recovered = delegate
        {
            calls++;
            if (calls < 3) throw new System.ComponentModel.Win32Exception(299);
            return new byte[] { 42 };
        };
        System.Action budget = delegate { budgetCalls++; };
        var result = (byte[])method.Invoke(null, new object[] { recovered, budget });
        if (calls != 3 || budgetCalls != 3 || result[0] != 42) throw new System.Exception("Transient failure retry incorrect.");
        calls = 0;
        System.Func<byte[]> permanent = delegate { calls++; throw new System.ComponentModel.Win32Exception(299); };
        try
        {
            method.Invoke(null, new object[] { permanent, budget });
            throw new System.Exception("Permanent failure swallowed.");
        }
        catch (System.Reflection.TargetInvocationException error)
        {
            if (!(error.InnerException is System.ComponentModel.Win32Exception) || calls != 3) throw;
        }
        calls = 0;
        budgetCalls = 0;
        System.Action exhausted = delegate
        {
            budgetCalls++;
            if (budgetCalls == 2) throw new System.InvalidOperationException("budget exhausted");
        };
        try
        {
            method.Invoke(null, new object[] { permanent, exhausted });
            throw new System.Exception("Budget ignored.");
        }
        catch (System.Reflection.TargetInvocationException error)
        {
            if (!(error.InnerException is System.InvalidOperationException) || calls != 1) throw;
        }
        var decode = readerType.GetMethod("Decode", System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic);
        var objectBytes = new byte[1536];
        System.Buffer.BlockCopy(System.BitConverter.GetBytes(1UL), 0, objectBytes, 0, 8);
        System.Buffer.BlockCopy(System.BitConverter.GetBytes(42U), 0, objectBytes, 8, 4);
        objectBytes[1104] = 65;
        System.Buffer.BlockCopy(System.BitConverter.GetBytes(1UL), 0, objectBytes, 1120, 8);
        System.Buffer.BlockCopy(System.BitConverter.GetBytes(15UL), 0, objectBytes, 1128, 8);
        System.Buffer.BlockCopy(System.BitConverter.GetBytes(1U), 0, objectBytes, 1188, 4);
        System.Func<ulong, int, byte[]> failedLinkedRead = delegate(ulong address, int length)
        {
            if (length == 1536) return objectBytes;
            throw new System.ComponentModel.Win32Exception(299);
        };
        try
        {
            decode.Invoke(null, new object[] { null, 0UL, 1UL, failedLinkedRead });
            throw new System.Exception("Linked object read failure swallowed.");
        }
        catch (System.Reflection.TargetInvocationException error)
        {
            if (!(error.InnerException is System.ComponentModel.Win32Exception)) throw;
        }
        calls = 0;
        System.Func<byte[]> unexpected = delegate { calls++; throw new System.InvalidOperationException("unexpected"); };
        try
        {
            method.Invoke(null, new object[] { unexpected, budget });
            throw new System.Exception("Unexpected failure swallowed.");
        }
        catch (System.Reflection.TargetInvocationException error)
        {
            if (!(error.InnerException is System.InvalidOperationException) || calls != 1) throw;
        }
    }
}
'@
[LiveRetryTests]::Run([StellarisLive.LiveGalaxy])
'PASS: transient recovery, 3-attempt limit, shared budget, unexpected and linked-object errors preserved; no game memory read.'
