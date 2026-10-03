using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace StellarisLive
{
    public static class LiveGalaxy
    {
        private const string BUILD_HASH = "07F8D4551E2C508F8E9A2E80AE52B71A623588CB8C5A5EFB4E30847BB908FC3F";
        private const ulong VTABLE_RVA = 0x239CAE8;
        private const ulong COUNTRY_VTABLE_RVA = 0x23940B8;
        private const ulong FLEET_VTABLE_RVA = 0x23C87F0;
        private static readonly object _gate = new object();
        private static readonly UTF8Encoding _utf8 = new UTF8Encoding(false, true);
        private static Dictionary<uint, ulong> _addresses;
        private static Dictionary<uint, ulong> _countryAddresses;
        private static Dictionary<uint, ulong> _fleetAddresses;
        private static int _processId;
        private static long _startTicks;
        private static bool _scanComplete;

        public static Snapshot Capture(int processId)
        {
            lock (_gate)
            {
                var timer = Stopwatch.StartNew();
                return Recover<Snapshot>(delegate(int attempt)
                {
                    var snapshot = CaptureOnce(processId, timer);
                    snapshot.captureAttempts = attempt;
                    return snapshot;
                }, delegate { _addresses = null; _countryAddresses = null; _fleetAddresses = null; }, delegate { return timer.Elapsed.TotalSeconds >= 90; });
            }
        }

        private static T Recover<T>(Func<int, T> capture, Action reset, Func<bool> expired)
        {
            for (var attempt = 1; attempt <= 2; attempt++)
            {
                if (expired()) throw new InvalidOperationException("Снимок RAM превысил общий лимит 90 секунд.");
                try
                {
                    var result = capture(attempt);
                    if (expired()) throw new InvalidOperationException("Снимок RAM превысил общий лимит 90 секунд.");
                    return result;
                }
                catch (Exception exception)
                {
                    // Только известные временные ошибки допускают новый поиск областей.
                    if (!(exception is TransientCaptureException) && !(exception is Win32Exception)) throw;
                    reset();
                    if (attempt == 2) throw;
                }
            }
            throw new InvalidOperationException("Исчерпаны попытки получения снимка RAM.");
        }

        private static Snapshot CaptureOnce(int processId, Stopwatch timer)
        {
            lock (_gate)
            {
                using (var process = Process.GetProcessById(processId))
                {
                    if (IntPtr.Size != 8 || !string.Equals(process.ProcessName, "stellaris", StringComparison.OrdinalIgnoreCase))
                    {
                        throw new InvalidOperationException("Нужен 64-битный процесс Stellaris и 64-битный сервер.");
                    }
                    string hash;
                    using (var file = File.OpenRead(process.MainModule.FileName))
                    using (var sha = SHA256.Create())
                    {
                        hash = BitConverter.ToString(sha.ComputeHash(file)).Replace("-", "");
                    }
                    if (hash != BUILD_HASH) throw new InvalidOperationException("Эта сборка Stellaris не поддерживается профилем RAM.");
                    var startTicks = process.StartTime.ToUniversalTime().Ticks;
                    var vtable = checked((ulong)process.MainModule.BaseAddress.ToInt64() + VTABLE_RVA);
                    var countryVtable = checked((ulong)process.MainModule.BaseAddress.ToInt64() + COUNTRY_VTABLE_RVA);
                    var fleetVtable = checked((ulong)process.MainModule.BaseAddress.ToInt64() + FLEET_VTABLE_RVA);
                    using (var memory = new ProcessMemory(processId))
                    {
                        var cached = _addresses != null && _countryAddresses != null && _fleetAddresses != null && _processId == processId && _startTicks == startTicks;
                        if (!cached)
                        {
                            _addresses = null;
                            _countryAddresses = null;
                            _fleetAddresses = null;
                            bool complete;
                            Dictionary<uint, ulong> foundCountries;
                            Dictionary<uint, ulong> foundFleets;
                            var found = Discover(memory, vtable, countryVtable, fleetVtable, timer, out complete, out foundCountries, out foundFleets);
                            if (!complete) throw new InvalidOperationException("Поиск памяти не завершён или области стали недоступны. Кэш не сохранён; повторите поиск на паузе игры.");
                            if (found.Count < 2) throw new InvalidOperationException("В памяти не найден проверяемый набор систем. Загрузите партию.");
                            _addresses = found;
                            _countryAddresses = foundCountries;
                            _fleetAddresses = foundFleets;
                            _scanComplete = complete;
                            _processId = processId;
                            _startTicks = startTicks;
                        }
                        var systems = new List<SystemData>();
                        var countries = new List<CountryData>();
                        var fleets = new List<FleetData>();
                        Func<ulong, int, byte[]> snapshotRead = delegate(ulong address, int length)
                        {
                            return ReadWithRetries(delegate { return memory.Read(address, length); }, delegate
                            {
                                if (timer.Elapsed.TotalSeconds >= 90) throw new InvalidOperationException("Снимок RAM превысил общий лимит 90 секунд.");
                            });
                        };
                        try
                        {
                            var countryIds = new HashSet<string>();
                            foreach (var entry in _countryAddresses)
                            {
                                var country = DecodeCountry(entry.Value, countryVtable, snapshotRead);
                                if (country == null || country.id != entry.Key.ToString(System.Globalization.CultureInfo.InvariantCulture)) throw new TransientCaptureException("Адреса империй изменились. Требуется новый поиск памяти.");
                                countryIds.Add(country.id);
                                countries.Add(country);
                            }
                            foreach (var entry in _addresses)
                            {
                                var system = Decode(memory, entry.Value, vtable, snapshotRead);
                                if (system == null || system.id != entry.Key.ToString(System.Globalization.CultureInfo.InvariantCulture))
                                {
                                    throw new TransientCaptureException("Адреса систем изменились. Требуется новый поиск памяти.");
                                }
                                if (system.baseOwnerId != null && !countryIds.Contains(system.baseOwnerId)) throw new TransientCaptureException("Набор империй неполон: не найден владелец станции.");
                                systems.Add(system);
                            }
                            var ids = new HashSet<string>();
                            foreach (var system in systems) ids.Add(system.id);
                            foreach (var system in systems)
                            foreach (var lane in system.lanes)
                            {
                                if (!ids.Contains(lane.to)) throw new TransientCaptureException("Набор систем неполон: отсутствует сосед гиперлинии.");
                            }
                            foreach (var entry in _fleetAddresses)
                            {
                                var fleet = DecodeFleet(entry.Value, fleetVtable, snapshotRead);
                                if (fleet == null || fleet.id != entry.Key.ToString(System.Globalization.CultureInfo.InvariantCulture)) throw new TransientCaptureException("Адреса флотов изменились. Требуется новый поиск памяти.");
                                if (!countryIds.Contains(fleet.ownerId)) throw new TransientCaptureException("Набор империй неполон: не найден владелец флота.");
                                if (fleet.systemId != null && !ids.Contains(fleet.systemId)) throw new TransientCaptureException("Набор систем неполон: не найдена текущая система флота.");
                                fleets.Add(fleet);
                            }
                        }
                        catch
                        {
                            _addresses = null;
                            _countryAddresses = null;
                            _fleetAddresses = null;
                            throw;
                        }
                        systems.Sort(delegate(SystemData a, SystemData b) { return uint.Parse(a.id).CompareTo(uint.Parse(b.id)); });
                        countries.Sort(delegate(CountryData a, CountryData b) { return uint.Parse(a.id).CompareTo(uint.Parse(b.id)); });
                        fleets.Sort(delegate(FleetData a, FleetData b) { return uint.Parse(a.id).CompareTo(uint.Parse(b.id)); });
                        return new Snapshot { processId = processId, processStartedAt = process.StartTime.ToUniversalTime().ToString("o"), buildHash = hash, capturedAt = DateTime.UtcNow.ToString("o"), systems = systems, countries = countries, fleets = fleets, discoveryComplete = _scanComplete, cachedAddresses = cached };
                    }
                }
            }
        }

        public static void ClearCache()
        {
            lock (_gate)
            {
                _addresses = null;
                _countryAddresses = null;
                _fleetAddresses = null;
            }
        }

        private static Dictionary<uint, ulong> Discover(ProcessMemory memory, ulong vtable, ulong countryVtable, ulong fleetVtable, Stopwatch totalTimer, out bool complete, out Dictionary<uint, ulong> countryAddresses, out Dictionary<uint, ulong> fleetAddresses)
        {
            var addresses = new Dictionary<uint, ulong>();
            var needle = BitConverter.GetBytes(vtable);
            var countryNeedle = BitConverter.GetBytes(countryVtable);
            var fleetNeedle = BitConverter.GetBytes(fleetVtable);
            countryAddresses = new Dictionary<uint, ulong>();
            fleetAddresses = new Dictionary<uint, ulong>();
            ulong totalBytes = 0;
            Action<int> reserveRead = delegate(int requestedLength)
            {
                if (totalTimer.Elapsed.TotalSeconds >= 90) throw new InvalidOperationException("Поиск превысил 90 секунд. Частичная карта не сохранена; повторите на паузе игры.");
                if (totalBytes + (ulong)requestedLength > 12UL * 1024 * 1024 * 1024) throw new InvalidOperationException("Поиск достиг лимита чтения 12 ГиБ, включая повторы. Частичная карта не сохранена.");
                totalBytes += (ulong)requestedLength;
            };
            Func<ulong, int, byte[]> discoveryRead = delegate(ulong readAddress, int readLength)
            {
                return ReadWithRetries(delegate { return memory.Read(readAddress, readLength); }, delegate { reserveRead(readLength); });
            };
            complete = false;
            foreach (var region in memory.Regions())
            {
                if (!region.Readable || region.Type != 0x20000) continue;
                for (ulong offset = 0; offset < region.Size;)
                {
                    // Мягкие лимиты проверяются между системными вызовами чтения.
                    var length = (int)Math.Min(65536UL, region.Size - offset);
                    try
                    {
                        var readAddress = region.Address + offset;
                        var bytes = discoveryRead(readAddress, length);
                        foreach (var index in ProcessMemory.FindOffsets(bytes, needle))
                        {
                            var address = region.Address + offset + (ulong)index;
                            if (address % 8 != 0) continue;
                            var system = Decode(memory, address, vtable, discoveryRead);
                            if (system == null) continue;
                            var id = uint.Parse(system.id);
                            ulong previous;
                            if (addresses.TryGetValue(id, out previous) && previous != address)
                            {
                                throw new InvalidOperationException("Найдено несколько объектов с одним ID системы; снимок неоднозначен.");
                            }
                            addresses[id] = address;
                        }
                        foreach (var index in ProcessMemory.FindOffsets(bytes, countryNeedle))
                        {
                            var address = region.Address + offset + (ulong)index;
                            if (address % 8 != 0) continue;
                            var country = DecodeCountry(address, countryVtable, discoveryRead);
                            if (country == null) continue;
                            var id = uint.Parse(country.id);
                            ulong previous;
                            if (countryAddresses.TryGetValue(id, out previous) && previous != address) throw new InvalidOperationException("Найдено несколько объектов с одним ID империи; снимок неоднозначен.");
                            countryAddresses[id] = address;
                        }
                        foreach (var index in ProcessMemory.FindOffsets(bytes, fleetNeedle))
                        {
                            var address = region.Address + offset + (ulong)index;
                            if (address % 8 != 0) continue;
                            var fleet = DecodeFleet(address, fleetVtable, discoveryRead);
                            if (fleet == null) continue;
                            var id = uint.Parse(fleet.id);
                            ulong previous;
                            if (fleetAddresses.TryGetValue(id, out previous) && previous != address) throw new InvalidOperationException("Найдено несколько объектов с одним ID флота; снимок неоднозначен.");
                            fleetAddresses[id] = address;
                        }
                    }
                    catch (Win32Exception exception)
                    {
                        // Не пропускаем блок: новый поиск повторно перечислит актуальные области.
                        throw new TransientCaptureException("Область RAM стала недоступна после трёх попыток чтения.", exception);
                    }
                    offset += (ulong)(length > 7 ? length - 7 : length);
                }
            }
            complete = true;
            return addresses;
        }

        private static FleetData DecodeFleet(ulong address, ulong vtable, Func<ulong, int, byte[]> read)
        {
            try
            {
                // Только подтверждённые ссылки: без предположений о силе и типе флота.
                var bytes = read(address, 1452);
                if (BitConverter.ToUInt64(bytes, 0) != vtable) return null;
                var id = BitConverter.ToUInt32(bytes, 48);
                var owner = BitConverter.ToUInt32(bytes, 1096);
                var origin = BitConverter.ToUInt32(bytes, 1448);
                var length = BitConverter.ToUInt64(bytes, 1048);
                var capacity = BitConverter.ToUInt64(bytes, 1056);
                var shipCapacity = BitConverter.ToUInt32(bytes, 808);
                var shipCount = BitConverter.ToUInt32(bytes, 812);
                if (id >= 1000000 || owner >= 100000 || length > 1024 || capacity < length || capacity > 1048576 || shipCount > 16384 || shipCapacity < shipCount || shipCapacity > 1000000) return null;
                var nameBytes = new byte[(int)length];
                if (capacity <= 15)
                {
                    if (length > 15) return null;
                    Array.Copy(bytes, 1032, nameBytes, 0, (int)length);
                }
                else if (length > 0)
                {
                    nameBytes = read(BitConverter.ToUInt64(bytes, 1032), (int)length);
                }
                var nameKey = _utf8.GetString(nameBytes);
                foreach (var character in nameKey) if (char.IsControl(character)) return null;
                var shipIds = new List<string>();
                if (shipCount > 0)
                {
                    var shipBytes = read(BitConverter.ToUInt64(bytes, 800), (int)shipCount * 4);
                    var seenShips = new HashSet<uint>();
                    for (var index = 0; index < shipCount; index++)
                    {
                        var shipId = BitConverter.ToUInt32(shipBytes, index * 4);
                        if (shipId == uint.MaxValue || !seenShips.Add(shipId)) return null;
                        shipIds.Add(shipId.ToString(System.Globalization.CultureInfo.InvariantCulture));
                    }
                }
                return new FleetData { id = id.ToString(System.Globalization.CultureInfo.InvariantCulture), nameKey = nameKey, ownerId = owner.ToString(System.Globalization.CultureInfo.InvariantCulture), systemId = origin == uint.MaxValue ? null : origin.ToString(System.Globalization.CultureInfo.InvariantCulture), shipIds = shipIds };
            }
            catch (ArgumentOutOfRangeException) { return null; }
            catch (DecoderFallbackException) { return null; }
        }

        private static CountryData DecodeCountry(ulong address, ulong vtable, Func<ulong, int, byte[]> read)
        {
            try
            {
                // Поля страны подтверждены на всех 33 объектах эталонной партии.
                var bytes = read(address, 11032);
                if (BitConverter.ToUInt64(bytes, 0) != vtable) return null;
                var id = BitConverter.ToUInt32(bytes, 8);
                var length = BitConverter.ToUInt64(bytes, 5368);
                var capacity = BitConverter.ToUInt64(bytes, 5376);
                if (id >= 100000 || length > 1024 || capacity < length || capacity > 1048576) return null;
                var nameBytes = new byte[(int)length];
                if (capacity <= 15)
                {
                    if (length > 15) return null;
                    Array.Copy(bytes, 5352, nameBytes, 0, (int)length);
                }
                else if (length > 0)
                {
                    nameBytes = read(BitConverter.ToUInt64(bytes, 5352), (int)length);
                }
                var rawName = _utf8.GetString(nameBytes);
                var name = new StringBuilder();
                for (var index = 0; index < rawName.Length; index++)
                {
                    var character = rawName[index];
                    // Игра кодирует цвет как 0x11 и букву, сброс цвета — 0x11!.
                    if (character == '\u0011')
                    {
                        if (++index >= rawName.Length) return null;
                        var code = rawName[index];
                        if (!(code >= 'A' && code <= 'Z') && !(code >= 'a' && code <= 'z') && code != '!') return null;
                        continue;
                    }
                    if (char.IsControl(character)) return null;
                    name.Append(character);
                }
                var type = ReadCountryString(read(BitConverter.ToUInt64(bytes, 11024), 64), 32, read);
                var category = ReadCountryString(bytes, 10456, read);
                var file = ReadCountryString(bytes, 10504, read);
                if (!IsCountryKey(type) || !IsFlagSegment(category) || !IsFlagSegment(file)) return null;
                var colors = new string[6];
                for (var index = 0; index < colors.Length; index++)
                {
                    colors[index] = ReadCountryString(read(BitConverter.ToUInt64(bytes, 10968 + index * 8), 64), 24, read);
                    if (!IsCountryKey(colors[index])) return null;
                }
                return new CountryData { id = id.ToString(System.Globalization.CultureInfo.InvariantCulture), name = name.ToString(), type = type, flag = new FlagData { category = category, file = file, colors = colors } };
            }
            catch (ArgumentOutOfRangeException) { return null; }
            catch (DecoderFallbackException) { return null; }
        }

        private static string ReadCountryString(byte[] bytes, int offset, Func<ulong, int, byte[]> read)
        {
            var length = BitConverter.ToUInt64(bytes, offset + 16);
            var capacity = BitConverter.ToUInt64(bytes, offset + 24);
            if (length > 256 || capacity < length || capacity > 1048576 || (capacity <= 15 && length > 15)) return null;
            var value = new byte[(int)length];
            if (capacity <= 15) Array.Copy(bytes, offset, value, 0, (int)length);
            else if (length > 0) value = read(BitConverter.ToUInt64(bytes, offset), (int)length);
            var text = _utf8.GetString(value);
            foreach (var character in text) if (char.IsControl(character)) return null;
            return text;
        }

        private static bool IsCountryKey(string value)
        {
            if (string.IsNullOrEmpty(value)) return false;
            foreach (var character in value)
            {
                if (!(character >= 'A' && character <= 'Z') && !(character >= 'a' && character <= 'z') && !(character >= '0' && character <= '9') && character != '_' && character != '-') return false;
            }
            return true;
        }

        private static bool IsFlagSegment(string value)
        {
            if (value == null || value.Contains("..")) return false;
            foreach (var character in value)
            {
                if (!(character >= 'A' && character <= 'Z') && !(character >= 'a' && character <= 'z') && !(character >= '0' && character <= '9') && character != '_' && character != '-' && character != '.') return false;
            }
            return true;
        }

        private static byte[] ReadWithRetries(Func<byte[]> read, Action beforeRead)
        {
            for (var attempt = 0; attempt < 3; attempt++)
            {
                if (beforeRead != null)
                {
                    beforeRead();
                }
                try
                {
                    return read();
                }
                catch (Win32Exception)
                {
                    // Последняя ошибка сохраняется; недоступные блоки не считаем прочитанными.
                    if (attempt == 2) throw;
                }
            }
            throw new InvalidOperationException("Исчерпаны попытки чтения памяти.");
        }

        private static SystemData Decode(ProcessMemory memory, ulong address, ulong vtable, Func<ulong, int, byte[]> read = null)
        {
            if (read == null)
            {
                read = delegate(ulong readAddress, int readLength)
                {
                    return ReadWithRetries(delegate { return memory.Read(readAddress, readLength); }, null);
                };
            }
            try
            {
                var bytes = read(address, 1536);
                if (BitConverter.ToUInt64(bytes, 0) != vtable) return null;
                var id = BitConverter.ToUInt32(bytes, 8);
                var x = BitConverter.ToInt64(bytes, 1040) / 100000.0;
                var y = BitConverter.ToInt64(bytes, 1048) / 100000.0;
                var length = BitConverter.ToUInt64(bytes, 1120);
                var capacity = BitConverter.ToUInt64(bytes, 1128);
                var planets = BitConverter.ToUInt32(bytes, 1188);
                var laneCount = BitConverter.ToUInt32(bytes, 1436);
                if (id >= 2000 || Math.Abs(x) > 10000 || Math.Abs(y) > 10000 || length < 1 || length > 256 || capacity < length || capacity > 1048576 || planets > 256 || laneCount > 64) return null;
                byte[] nameBytes;
                if (capacity <= 15)
                {
                    if (length > 15) return null;
                    nameBytes = new byte[(int)length];
                    Array.Copy(bytes, 1104, nameBytes, 0, (int)length);
                }
                else nameBytes = read(BitConverter.ToUInt64(bytes, 1104), (int)length);
                var name = _utf8.GetString(nameBytes);
                foreach (var character in name) if (char.IsControl(character)) return null;
                var classBytes = read(BitConverter.ToUInt64(bytes, 1072), 64);
                var classLength = BitConverter.ToUInt64(classBytes, 48);
                var classCapacity = BitConverter.ToUInt64(classBytes, 56);
                if (classLength < 4 || classLength > 128 || classCapacity < classLength || classCapacity > 1048576) return null;
                byte[] classNameBytes;
                if (classCapacity <= 15)
                {
                    if (classLength > 15) return null;
                    classNameBytes = new byte[(int)classLength];
                    Array.Copy(classBytes, 32, classNameBytes, 0, (int)classLength);
                }
                else classNameBytes = read(BitConverter.ToUInt64(classBytes, 32), (int)classLength);
                var starClass = _utf8.GetString(classNameBytes);
                if (!starClass.StartsWith("sc_", StringComparison.Ordinal)) return null;
                foreach (var character in starClass) if (!(character >= 'a' && character <= 'z') && !(character >= '0' && character <= '9') && character != '_') return null;
                var starbaseCount = BitConverter.ToUInt32(bytes, 1404);
                var starbaseCapacity = BitConverter.ToUInt32(bytes, 1400);
                if (starbaseCount > 256 || starbaseCapacity < starbaseCount || starbaseCapacity > 1048576) return null;
                var starbaseIds = new List<string>();
                var baseOwner = BitConverter.ToUInt32(read(checked(address + 4976), 4), 0);
                if (baseOwner != uint.MaxValue && baseOwner >= 100000) return null;
                if (starbaseCount > 0)
                {
                    var starbaseBytes = read(BitConverter.ToUInt64(bytes, 1392), (int)starbaseCount * 4);
                    var seenStarbases = new HashSet<uint>();
                    for (var index = 0; index < starbaseCount; index++)
                    {
                        var starbaseId = BitConverter.ToUInt32(starbaseBytes, index * 4);
                        // INVALID обозначает отсутствие базы, а не её ID.
                        if (starbaseId == uint.MaxValue) continue;
                        if (!seenStarbases.Add(starbaseId)) return null;
                        starbaseIds.Add(starbaseId.ToString(System.Globalization.CultureInfo.InvariantCulture));
                    }
                }
                var planetIds = new List<string>();
                if (planets > 0)
                {
                    var planetBytes = read(BitConverter.ToUInt64(bytes, 1176), (int)planets * 4);
                    var seenPlanets = new HashSet<uint>();
                    for (var index = 0; index < planets; index++)
                    {
                        var planetId = BitConverter.ToUInt32(planetBytes, index * 4);
                        if (planetId == uint.MaxValue || !seenPlanets.Add(planetId)) return null;
                        planetIds.Add(planetId.ToString(System.Globalization.CultureInfo.InvariantCulture));
                    }
                }
                var lanes = new List<Lane>();
                if (laneCount > 0)
                {
                    var laneBytes = read(BitConverter.ToUInt64(bytes, 1424), (int)laneCount * 32);
                    for (var index = 0; index < laneCount; index++)
                    {
                        var target = BitConverter.ToUInt32(laneBytes, index * 32 + 8);
                        var distance = BitConverter.ToInt64(laneBytes, index * 32 + 16) / 100000.0;
                        if (target >= 2000 || target == id || distance < 0 || distance > 100000) return null;
                        lanes.Add(new Lane { to = target.ToString(System.Globalization.CultureInfo.InvariantCulture), length = distance });
                    }
                }
                return new SystemData { id = id.ToString(System.Globalization.CultureInfo.InvariantCulture), nameKey = name, x = x, y = y, lanes = lanes, planetIds = planetIds, starClass = starClass, starbaseIds = starbaseIds, baseOwnerId = baseOwner == uint.MaxValue ? null : baseOwner.ToString(System.Globalization.CultureInfo.InvariantCulture) };
            }
            catch (ArgumentOutOfRangeException) { return null; }
            catch (DecoderFallbackException) { return null; }
        }

        public sealed class Snapshot
        {
            public int schemaVersion = 1;
            public int processId;
            public string processStartedAt;
            public string buildHash;
            public string capturedAt;
            public List<SystemData> systems;
            public List<CountryData> countries;
            public List<FleetData> fleets;
            public bool discoveryComplete;
            public bool cachedAddresses;
            public int captureAttempts;
            public string[] limitations = { "Системы, классы звёзд, империи, эмблемы, цвета и флоты; дипломатия, свойства планет, боевая статистика и специальные объекты пока не декодированы.", "Чтение не атомарно; рекомендуется пауза игры.", "Полнота систем, стран и флотов не подтверждена независимыми счётчиками баз объектов; добавления обнаруживаются плановым поиском.", "Лимиты времени мягкие; действуют между вызовами чтения." };
        }

        public sealed class FleetData
        {
            public string id;
            public string nameKey;
            public string ownerId;
            public string systemId;
            public List<string> shipIds;
        }

        public sealed class CountryData
        {
            public string id;
            public string name;
            public string type;
            public FlagData flag;
        }

        public sealed class FlagData
        {
            public string category;
            public string file;
            public string[] colors;
        }

        public sealed class SystemData
        {
            public string id;
            public string nameKey;
            public double x;
            public double y;
            public List<Lane> lanes;
            public List<string> planetIds;
            public string starClass;
            public List<string> starbaseIds;
            public string baseOwnerId;
        }

        public sealed class Lane
        {
            public string to;
            public double length;
        }

        private sealed class TransientCaptureException : InvalidOperationException
        {
            public TransientCaptureException(string message) : base(message) { }
            public TransientCaptureException(string message, Exception innerException) : base(message, innerException) { }
        }
    }
}
