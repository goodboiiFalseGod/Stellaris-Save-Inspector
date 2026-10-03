using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace StellarisLive
{
    public sealed class ProcessMemory : IDisposable
    {
        private IntPtr _handle;

        public ProcessMemory(int processId)
        {
            if (IntPtr.Size != 8)
            {
                throw new InvalidOperationException("Нужен 64-битный PowerShell.");
            }
            using (var process = Process.GetProcessById(processId))
            {
                if (!string.Equals(process.ProcessName, "stellaris", StringComparison.OrdinalIgnoreCase))
                {
                    throw new InvalidOperationException("Разрешено подключение только к Stellaris.");
                }
                // Только QUERY_INFORMATION и VM_READ, без прав записи и инъекции.
                _handle = OpenProcess(0x0400 | 0x0010, false, processId);
            }
            if (_handle == IntPtr.Zero)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Нет доступа на чтение к Stellaris.");
            }
        }

        public void Dispose()
        {
            if (_handle != IntPtr.Zero)
            {
                CloseHandle(_handle);
                _handle = IntPtr.Zero;
            }
        }

        public List<Region> Regions()
        {
            EnsureOpen();
            var result = new List<Region>();
            ulong address = 0;
            var timer = Stopwatch.StartNew();
            while (address < 0x0000800000000000UL)
            {
                if (result.Count >= 100000 || timer.Elapsed.TotalSeconds > 10)
                {
                    throw new InvalidOperationException("Превышен лимит перечисления памяти.");
                }
                MemoryInfo info;
                var queried = VirtualQueryEx(_handle, new IntPtr((long)address), out info, new UIntPtr((uint)Marshal.SizeOf(typeof(MemoryInfo))));
                if (queried == UIntPtr.Zero)
                {
                    var error = Marshal.GetLastWin32Error();
                    if (error == 87) break;
                    throw new Win32Exception(error, "Не удалось перечислить память.");
                }
                var start = (ulong)info.BaseAddress.ToInt64();
                var size = info.RegionSize.ToUInt64();
                if (size == 0 || start + size <= address)
                {
                    throw new InvalidOperationException("Некорректная область памяти.");
                }
                var protection = info.Protect & 0xFF;
                var readable = info.State == 0x1000 && (info.Protect & 0x100) == 0 && (protection == 2 || protection == 4 || protection == 8 || protection == 0x20 || protection == 0x40 || protection == 0x80);
                result.Add(new Region { Address = start, Size = size, Protection = info.Protect, Type = info.Type, Readable = readable });
                address = start + size;
            }
            return result;
        }

        public byte[] Read(ulong address, int length)
        {
            EnsureOpen();
            if (length < 1 || length > 65536 || address >= 0x0000800000000000UL || address + (ulong)length > 0x0000800000000000UL)
            {
                throw new ArgumentOutOfRangeException("length", "Чтение ограничено 64 КиБ и пользовательской памятью.");
            }
            var buffer = new byte[length];
            UIntPtr read;
            if (!ReadProcessMemory(_handle, new IntPtr((long)address), buffer, new UIntPtr((uint)length), out read) || read.ToUInt64() != (ulong)length)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Область стала недоступна или процесс завершился.");
            }
            return buffer;
        }

        public SearchResult Find(byte[] pattern, int maxMegabytes, int maxMatches, ulong startAddress = 0)
        {
            if (pattern == null || pattern.Length < 3 || pattern.Length > 1024 || maxMegabytes < 1 || maxMegabytes > 512 || maxMatches < 1 || maxMatches > 100)
            {
                throw new ArgumentException("Некорректные ограничения поиска.");
            }
            var result = new SearchResult();
            var limit = (ulong)maxMegabytes * 1024 * 1024;
            var timer = Stopwatch.StartNew();
            foreach (var region in Regions())
            {
                // Ищем только в динамической памяти, не в EXE и ресурсных mappings.
                if (!region.Readable || region.Type != 0x20000 || region.Address + region.Size <= startAddress) continue;
                ulong offset = startAddress > region.Address ? startAddress - region.Address : 0;
                while (offset < region.Size)
                {
                    result.NextAddress = region.Address + offset;
                    if (result.BytesRead >= limit || result.Addresses.Count >= maxMatches || timer.Elapsed.TotalSeconds >= 20)
                    {
                        result.Limited = true;
                        return result;
                    }
                    var length = (int)Math.Min(65536UL, Math.Min(region.Size - offset, limit - result.BytesRead));
                    byte[] data;
                    try
                    {
                        data = Read(region.Address + offset, length);
                    }
                    catch (Win32Exception)
                    {
                        result.FailedReads++;
                        result.BytesRead += (ulong)length;
                        offset += (ulong)length;
                        continue;
                    }
                    foreach (var index in FindOffsets(data, pattern))
                    {
                        result.Addresses.Add(region.Address + offset + (ulong)index);
                        if (result.Addresses.Count >= maxMatches) break;
                    }
                    result.BytesRead += (ulong)length;
                    if (result.Addresses.Count >= maxMatches)
                    {
                        result.Limited = true;
                        return result;
                    }
                    // Перекрытие позволяет находить строки на границе двух блоков.
                    offset += (ulong)(length >= pattern.Length ? length - pattern.Length + 1 : length);
                }
            }
            return result;
        }

        public static List<int> FindOffsets(byte[] data, byte[] pattern)
        {
            if (pattern == null || pattern.Length == 0)
            {
                throw new ArgumentException("Пустой шаблон.");
            }
            var matches = new List<int>();
            for (var i = 0; i <= data.Length - pattern.Length; i++)
            {
                if (data[i] != pattern[0]) continue;
                var j = 1;
                while (j < pattern.Length && data[i + j] == pattern[j]) j++;
                if (j == pattern.Length) matches.Add(i);
            }
            return matches;
        }

        private void EnsureOpen()
        {
            if (_handle == IntPtr.Zero)
            {
                throw new ObjectDisposedException("ProcessMemory");
            }
        }

        public sealed class Region
        {
            public ulong Address;
            public ulong Size;
            public uint Protection;
            public uint Type;
            public bool Readable;
        }

        public sealed class SearchResult
        {
            public List<ulong> Addresses = new List<ulong>();
            public ulong BytesRead;
            public int FailedReads;
            public bool Limited;
            public ulong NextAddress;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MemoryInfo
        {
            public IntPtr BaseAddress;
            public IntPtr AllocationBase;
            public uint AllocationProtect;
            public UIntPtr RegionSize;
            public uint State;
            public uint Protect;
            public uint Type;
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr OpenProcess(uint access, bool inheritHandle, int processId);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern UIntPtr VirtualQueryEx(IntPtr process, IntPtr address, out MemoryInfo info, UIntPtr length);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool ReadProcessMemory(IntPtr process, IntPtr address, byte[] buffer, UIntPtr length, out UIntPtr bytesRead);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr handle);
    }
}
