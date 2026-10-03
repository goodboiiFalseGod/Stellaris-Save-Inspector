Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -Path @((Join-Path $PSScriptRoot 'ProcessMemory.cs'), (Join-Path $PSScriptRoot 'LiveGalaxy.cs'))
# Проверяем управляющую логику без чтения памяти игры.
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Reflection;
public static class LiveRecoveryTests
{
    public static string Run(Type galaxy)
    {
        var recovery = galaxy.GetMethod("Recover", BindingFlags.NonPublic | BindingFlags.Static).MakeGenericMethod(typeof(int));
        var transient = galaxy.GetNestedType("TransientCaptureException", BindingFlags.NonPublic);
        Func<Exception> temporary = delegate { return (Exception)Activator.CreateInstance(transient, new object[] { "test" }); };
        Func<Func<int, int>, Action, Func<bool>, int> invoke = delegate(Func<int, int> capture, Action reset, Func<bool> expired)
        {
            try { return (int)recovery.Invoke(null, new object[] { capture, reset, expired }); }
            catch (TargetInvocationException exception) { throw exception.InnerException; }
        };
        var calls = 0;
        var resets = 0;
        Action resetCache = delegate { resets++; };
        Func<bool> available = delegate { return false; };
        var value = invoke(delegate(int attempt) { calls++; if (attempt == 1) throw temporary(); return attempt; }, resetCache, available);
        if (value != 2 || calls != 2 || resets != 1) throw new Exception("Временная ошибка не восстановлена.");
        calls = resets = 0;
        invoke(delegate(int attempt) { calls++; if (attempt == 1) throw new Win32Exception(299); return attempt; }, resetCache, available);
        if (calls != 2 || resets != 1) throw new Exception("Win32 не восстановлена.");
        calls = resets = 0;
        try { invoke(delegate(int attempt) { calls++; throw temporary(); }, resetCache, available); throw new Exception("Ошибка скрыта."); }
        catch (InvalidOperationException exception) { if (exception.GetType() != transient || calls != 2 || resets != 2) throw; }
        calls = resets = 0;
        try { invoke(delegate(int attempt) { calls++; throw new InvalidOperationException("unsupported/ambiguous/budget"); }, resetCache, available); throw new Exception("Ошибка скрыта."); }
        catch (InvalidOperationException) { if (calls != 1 || resets != 0) throw; }
        calls = resets = 0;
        try { invoke(delegate(int attempt) { calls++; throw temporary(); }, resetCache, delegate { return calls > 0; }); throw new Exception("Лимит скрыт."); }
        catch (InvalidOperationException) { if (calls != 1 || resets != 1) throw; }
        calls = resets = 0;
        try { invoke(delegate(int attempt) { calls++; return 1; }, resetCache, delegate { return calls > 0; }); throw new Exception("Поздний успех скрыт."); }
        catch (InvalidOperationException) { if (calls != 1 || resets != 0) throw; }
        return "PASS: typed recovery, Win32, two attempts, fail-closed, common deadline.";
    }
}
'@
[LiveRecoveryTests]::Run([StellarisLive.LiveGalaxy])
