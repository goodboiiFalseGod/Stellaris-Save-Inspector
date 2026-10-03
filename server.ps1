$ErrorActionPreference = 'Stop'

$Port = if ($env:STELLARIS_INSPECTOR_PORT) { [int]$env:STELLARIS_INSPECTOR_PORT } else { 8765 }
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Порт должен быть в диапазоне 1024–65535.' }
$allowedHosts = @("127.0.0.1:$Port", "localhost:$Port")
$allowedOrigins = @("http://127.0.0.1:$Port", "http://localhost:$Port")

$appRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$appPrefix = $appRoot + [IO.Path]::DirectorySeparatorChar
$settingsPath = Join-Path $appRoot 'settings.local.json'
$gameRoot = $null
$gamePrefix = $null
$gameDirectories = @('assets', 'common', 'curated_save_games', 'flags', 'gfx', 'interface', 'localisation')
$gameExtensions = @('.csv', '.dds', '.gfx', '.jpg', '.png', '.sav', '.txt', '.yml')
$mimeTypes = @{
    '.css' = 'text/css; charset=utf-8'
    '.dds' = 'application/octet-stream'
    '.html' = 'text/html; charset=utf-8'
    '.js' = 'text/javascript; charset=utf-8'
    '.jpg' = 'image/jpeg'
    '.png' = 'image/png'
    '.svg' = 'image/svg+xml'
    '.json' = 'application/json; charset=utf-8'
}

function Set-GameLocation
{
    param([string]$Location)
    if (-not [IO.Path]::IsPathRooted($Location)) { throw [ArgumentException]::new('Укажите полный путь к папке Stellaris.') }
    $resolved = [IO.Path]::GetFullPath($Location).TrimEnd([IO.Path]::DirectorySeparatorChar)
    foreach ($required in @('common\technology', 'gfx\interface', 'localisation'))
    {
        if (-not [IO.Directory]::Exists((Join-Path $resolved $required))) { throw [IO.DirectoryNotFoundException]::new("В выбранной папке нет $required.") }
    }
    $script:gameRoot = $resolved
    $script:gamePrefix = $resolved + [IO.Path]::DirectorySeparatorChar
}

if ([IO.File]::Exists($settingsPath))
{
    try { Set-GameLocation (([IO.File]::ReadAllText($settingsPath, [Text.Encoding]::UTF8) | ConvertFrom-Json).gameLocation) }
    catch { Write-Warning "Настроенная папка игры недоступна: $($_.Exception.Message)" }
}

function Write-Response
{
    param(
        [Net.Sockets.NetworkStream]$Stream,
        [int]$StatusCode,
        [string]$StatusText,
        [string]$ContentType,
        [byte[]]$Body,
        [bool]$HeadOnly,
        [hashtable]$AdditionalHeaders = @{}
    )

    $extraHeaders = ''
    foreach ($name in $AdditionalHeaders.Keys)
    {
        if ($name -notmatch '^[A-Za-z0-9-]+$' -or [string]$AdditionalHeaders[$name] -match "[`r`n]")
        {
            throw "Недопустимый HTTP-заголовок: $name"
        }
        $extraHeaders += "$name`: $($AdditionalHeaders[$name])`r`n"
    }
    $headers = "HTTP/1.1 $StatusCode $StatusText`r`nContent-Type: $ContentType`r`nContent-Length: $($Body.Length)`r`nCache-Control: no-store`r`n${extraHeaders}Connection: close`r`n`r`n"
    $headerBytes = [Text.Encoding]::ASCII.GetBytes($headers)
    $Stream.Write($headerBytes, 0, $headerBytes.Length)
    if (-not $HeadOnly -and $Body.Length -gt 0)
    {
        $Stream.Write($Body, 0, $Body.Length)
    }
}

function Read-StableStellarisSave
{
    param([IO.FileInfo]$Save)

    $maximumSize = 512MB
    for ($attempt = 1; $attempt -le 3; $attempt++)
    {
        $before = Get-Item -LiteralPath $Save.FullName -ErrorAction Stop
        if ($before.Length -gt $maximumSize) { throw [InvalidDataException]::new('Самое новое сохранение превышает безопасный лимит 512 МиБ.') }
        $stream = [IO.File]::Open($before.FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
        try
        {
            $bytes = [byte[]]::new($before.Length)
            $offset = 0
            while ($offset -lt $bytes.Length)
            {
                $read = $stream.Read($bytes, $offset, $bytes.Length - $offset)
                if ($read -eq 0) { break }
                $offset += $read
            }
        }
        finally
        {
            $stream.Dispose()
        }
        $after = Get-Item -LiteralPath $Save.FullName -ErrorAction Stop
        $stable = $offset -eq $before.Length -and $before.Length -eq $after.Length -and $before.LastWriteTimeUtc.Ticks -eq $after.LastWriteTimeUtc.Ticks
        if ($stable)
        {
            $hasLocalHeader = $bytes.Length -ge 4 -and [BitConverter]::ToUInt32($bytes, 0) -eq 0x04034b50
            $hasDirectoryEnd = $false
            for ($index = $bytes.Length - 22; $index -ge [Math]::Max(0, $bytes.Length - 65558); $index--)
            {
                if ([BitConverter]::ToUInt32($bytes, $index) -eq 0x06054b50) { $hasDirectoryEnd = $true; break }
            }
            if (-not $hasLocalHeader -or -not $hasDirectoryEnd) { throw [InvalidDataException]::new('Самое новое сохранение не является завершённым ZIP-архивом.') }
            return ,$bytes
        }
        Start-Sleep -Milliseconds 100
    }
    throw [IO.IOException]::new('Самое новое сохранение ещё записывается. Повторите попытку через несколько секунд.')
}

$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
$listener.Start()

try
{
    while ($true)
    {
        $client = $listener.AcceptTcpClient()
        try
        {
            $stream = $null
            $stream = $client.GetStream()
            $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::ASCII, $false, 1024, $true)
            try
            {
                $requestLine = $reader.ReadLine()
                $requestHeaders = @{}
                while ($headerLine = $reader.ReadLine()) {
                    if ($headerLine -match '^([^:]+):\s*(.*)$') { $requestHeaders[$Matches[1].ToLowerInvariant()] = $Matches[2] }
                }
                $requestBody = ''
                if ($requestLine -match '^POST\s+' -and $requestHeaders['content-length'])
                {
                    $bodyLength = 0
                    if (-not [int]::TryParse($requestHeaders['content-length'], [ref]$bodyLength) -or $bodyLength -lt 1 -or $bodyLength -gt 4096) { throw 'Некорректный размер запроса.' }
                    $buffer = [char[]]::new($bodyLength)
                    $readCount = $reader.ReadBlock($buffer, 0, $bodyLength)
                    if ($readCount -ne $bodyLength) { throw 'Запрос настроек прочитан не полностью.' }
                    $requestBody = -join $buffer
                }
            }
            finally
            {
                $reader.Dispose()
            }

            if ($requestLine -notmatch '^(GET|HEAD|POST)\s+([^\s]+)\s+HTTP/')
            {
                Write-Response $stream 405 'Method Not Allowed' 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes('Method not allowed')) $false
                continue
            }

            $method = $Matches[1]
            $requestPath = $Matches[2].Split('?')[0]
            if ($requestPath -eq '/SaveInspector/game-location')
            {
                $allowedHost = $requestHeaders['host'] -in $allowedHosts
                $allowedOrigin = $requestHeaders['origin'] -in $allowedOrigins
                if (-not $allowedHost -or $requestHeaders['x-stellaris-config'] -ne '1' -or ($method -eq 'POST' -and -not $allowedOrigin))
                {
                    Write-Response $stream 403 'Forbidden' 'application/json; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes('{"error":"Недопустимый запрос настроек."}')) $false
                    continue
                }
                try
                {
                    if ($method -eq 'POST')
                    {
                        if ($requestBody -notmatch '^path=([A-Za-z0-9_.!~*''()%\-]+)$') { throw [ArgumentException]::new('Некорректный запрос пути.') }
                        $candidate = [Uri]::UnescapeDataString($Matches[1])
                        Set-GameLocation $candidate
                        $settings = @{gameLocation = $gameRoot} | ConvertTo-Json -Compress
                        $temporaryPath = "$settingsPath.tmp"
                        [IO.File]::WriteAllText($temporaryPath, $settings, [Text.Encoding]::UTF8)
                        if ([IO.File]::Exists($settingsPath)) { [IO.File]::Replace($temporaryPath, $settingsPath, $null) }
                        else { [IO.File]::Move($temporaryPath, $settingsPath) }
                    }
                    elseif ($method -ne 'GET') { throw [ArgumentException]::new('Метод не поддерживается.') }
                    $body = @{gameLocation = $gameRoot} | ConvertTo-Json -Compress
                    Write-Response $stream 200 'OK' 'application/json; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes($body)) $false
                }
                catch
                {
                    $body = @{error = $_.Exception.Message} | ConvertTo-Json -Compress
                    Write-Response $stream 400 'Bad Request' 'application/json; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes($body)) $false
                }
                continue
            }
            if ($requestPath -eq '/SaveInspector/powershell-ready')
            {
                Write-Response $stream 200 'OK' 'text/plain; charset=us-ascii' ([Text.Encoding]::ASCII.GetBytes('stellaris-inspector-powershell-v2')) ($method -eq 'HEAD')
                continue
            }
            if ($requestPath -eq '/SaveInspector/server-info')
            {
                # Только сведения о возможностях локального сервера, без путей и сохранений.
                $body = '{"backend":"powershell","latestSave":true,"liveSnapshot":true}'
                Write-Response $stream 200 'OK' 'application/json; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes($body)) ($method -eq 'HEAD')
                continue
            }
            if ($requestPath -eq '/SaveInspector/technology-manifest')
            {
                if (-not $gameRoot)
                {
                    Write-Response $stream 503 'Service Unavailable' 'application/json; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes('{"error":"Выберите папку Stellaris в настройках."}')) ($method -eq 'HEAD')
                    continue
                }
                $technologyRoot = Join-Path $gameRoot 'common\technology'
                $variablesRoot = Join-Path $gameRoot 'common\scripted_variables'
                $civicsRoot = Join-Path $gameRoot 'common\governments\civics'
                $manifest = @{ technology = @(Get-ChildItem -LiteralPath $technologyRoot -Filter '*.txt' -File -Recurse | ForEach-Object { $_.FullName.Substring($gameRoot.Length + 1).Replace('\', '/') }); variables = @(Get-ChildItem -LiteralPath $variablesRoot -Filter '*.txt' -File -Recurse | ForEach-Object { $_.FullName.Substring($gameRoot.Length + 1).Replace('\', '/') }); civics = @(Get-ChildItem -LiteralPath $civicsRoot -Filter '*.txt' -File -Recurse | ForEach-Object { $_.FullName.Substring($gameRoot.Length + 1).Replace('\', '/') }) } | ConvertTo-Json -Compress
                Write-Response $stream 200 'OK' 'application/json; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes($manifest)) ($method -eq 'HEAD')
                continue
            }
            if ($requestPath -eq '/SaveInspector/latest-save')
            {
                # Доступ разрешён только интерфейсу на этом же loopback-origin.
                $allowedHost = $requestHeaders['host'] -in $allowedHosts
                $allowedOrigin = -not $requestHeaders['origin'] -or $requestHeaders['origin'] -in $allowedOrigins
                if ($method -ne 'GET' -or -not $allowedHost -or -not $allowedOrigin -or $requestHeaders['x-stellaris-save'] -ne '1')
                {
                    Write-Response $stream 403 'Forbidden' 'application/json; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes('{"error":"Недопустимый запрос сохранения."}')) $false
                    continue
                }
                try
                {
                    $saveRoots = @()
                    $userDirectoryFile = if ($gameRoot) { Join-Path $gameRoot 'userdir.txt' } else { $null }
                    if ($userDirectoryFile -and (Test-Path -LiteralPath $userDirectoryFile -PathType Leaf))
                    {
                        $configuredDirectory = [Environment]::ExpandEnvironmentVariables(([IO.File]::ReadAllText($userDirectoryFile, [Text.Encoding]::UTF8).Trim([char]0xFEFF, [char]0x20, [char]0x09, [char]0x0D, [char]0x0A)))
                        if ($configuredDirectory)
                        {
                            $configuredRoot = if ([IO.Path]::IsPathRooted($configuredDirectory)) { [IO.Path]::GetFullPath($configuredDirectory) } else { [IO.Path]::GetFullPath((Join-Path $gameRoot $configuredDirectory)) }
                            $configuredSaveRoot = Join-Path $configuredRoot 'save games'
                            if (Test-Path -LiteralPath $configuredSaveRoot -PathType Container) { $saveRoots += $configuredSaveRoot }
                        }
                    }
                    $documentFolders = @(
                        [Environment]::GetFolderPath([Environment+SpecialFolder]::MyDocuments),
                        (Join-Path $env:USERPROFILE 'Documents'),
                        $(if ($env:OneDrive) { Join-Path $env:OneDrive 'Documents' }),
                        $(if ($env:OneDriveConsumer) { Join-Path $env:OneDriveConsumer 'Documents' })
                    ) | Where-Object { $_ } | Select-Object -Unique
                    $saveRoots += @($documentFolders | ForEach-Object { Join-Path $_ 'Paradox Interactive\Stellaris\save games' } | Where-Object { Test-Path -LiteralPath $_ -PathType Container })
                    $saveRoots = @($saveRoots | ForEach-Object { [IO.Path]::GetFullPath($_) } | Select-Object -Unique)
                    $candidates = for ($rootIndex = 0; $rootIndex -lt $saveRoots.Count; $rootIndex++)
                    {
                        Get-ChildItem -LiteralPath $saveRoots[$rootIndex] -Filter '*.sav' -File -Recurse -ErrorAction Stop | ForEach-Object { [PSCustomObject]@{File = $_; RootPriority = $rootIndex} }
                    }
                    $latestSave = $candidates | Sort-Object @{Expression = {$_.File.LastWriteTimeUtc}; Descending = $true}, @{Expression = {$_.RootPriority}; Ascending = $true}, @{Expression = {$_.File.FullName}; Descending = $true} | Select-Object -First 1 -ExpandProperty File
                    if (-not $latestSave) { throw [IO.FileNotFoundException]::new('Сохранения Stellaris не найдены в настроенной папке игры или папке документов.') }
                    $encodedName = [Uri]::EscapeDataString($latestSave.Name)
                    $saveBytes = Read-StableStellarisSave $latestSave
                    Write-Response $stream 200 'OK' 'application/zip' $saveBytes $false @{'X-Stellaris-Filename' = $encodedName; 'X-Stellaris-Modified' = $latestSave.LastWriteTimeUtc.ToString('o')}
                }
                catch
                {
                    $body = @{error = $_.Exception.Message} | ConvertTo-Json -Compress
                    $statusCode = if ($_.Exception -is [InvalidDataException] -and $_.Exception.Message -like '*512*') { 413 } elseif ($_.Exception -is [IO.FileNotFoundException]) { 404 } elseif ($_.Exception -is [IO.IOException] -or $_.Exception -is [InvalidDataException]) { 503 } else { 500 }
                    $statusText = if ($statusCode -eq 413) { 'Payload Too Large' } elseif ($statusCode -eq 404) { 'Not Found' } elseif ($statusCode -eq 503) { 'Service Unavailable' } else { 'Internal Server Error' }
                    Write-Response $stream $statusCode $statusText 'application/json; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes($body)) $false
                }
                continue
            }
            if ($requestPath -eq '/SaveInspector/live/snapshot')
            {
                # Браузер с другого origin не должен запускать чтение памяти.
                $allowedHost = $requestHeaders['host'] -in $allowedHosts
                $allowedOrigin = -not $requestHeaders['origin'] -or $requestHeaders['origin'] -in $allowedOrigins
                if ($method -ne 'GET' -or -not $allowedHost -or -not $allowedOrigin -or $requestHeaders['x-stellaris-live'] -ne '1')
                {
                    Write-Response $stream 403 'Forbidden' 'application/json' ([Text.Encoding]::UTF8.GetBytes('{"error":"Недопустимый запрос живой карты."}')) $false
                    continue
                }
                try
                {
                    if (-not ('StellarisLive.LiveGalaxy' -as [type]))
                    {
                        Add-Type -Path @((Join-Path $PSScriptRoot 'live/ProcessMemory.cs'), (Join-Path $PSScriptRoot 'live/LiveGalaxy.cs'))
                    }
                    $gameProcesses = @(Get-Process -Name stellaris -ErrorAction SilentlyContinue)
                    try {
                        if ($gameProcesses.Count -ne 1) { throw 'Нужен ровно один запущенный Stellaris с загруженной партией.' }
                        if ($requestHeaders['x-stellaris-rescan'] -eq '1') { [StellarisLive.LiveGalaxy]::ClearCache() }
                        $snapshot = [StellarisLive.LiveGalaxy]::Capture($gameProcesses[0].Id)
                        $body = $snapshot | ConvertTo-Json -Depth 12 -Compress
                    } finally { foreach ($gameProcess in $gameProcesses) { $gameProcess.Dispose() } }
                    Write-Response $stream 200 'OK' 'application/json; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes($body)) $false
                }
                catch
                {
                    Write-Warning "Ошибка чтения живой карты: $($_.Exception.Message)"
                    $body = @{error = $_.Exception.Message} | ConvertTo-Json -Compress
                    Write-Response $stream 503 'Service Unavailable' 'application/json; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes($body)) $false
                }
                continue
            }
            if ($method -notin @('GET', 'HEAD'))
            {
                Write-Response $stream 405 'Method Not Allowed' 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes('Method not allowed')) $false
                continue
            }
            $decodedPath = [Uri]::UnescapeDataString($requestPath).Replace('\', '/')
            $isApp = $decodedPath -eq '/' -or $decodedPath -eq '/SaveInspector' -or $decodedPath.StartsWith('/SaveInspector/', [StringComparison]::OrdinalIgnoreCase)
            if ($isApp)
            {
                $root = $appRoot
                $prefix = $appPrefix
                $relativePath = if ($decodedPath -in @('/', '/SaveInspector', '/SaveInspector/')) { 'index.html' } else { $decodedPath.Substring('/SaveInspector/'.Length) }
                if ($relativePath.EndsWith('/')) { $relativePath += 'index.html' }
                $extension = [IO.Path]::GetExtension($relativePath).ToLowerInvariant()
                $allowed = $extension -in @('.html', '.css', '.js', '.json') -and $relativePath -ne 'settings.local.json'
            }
            else
            {
                $root = $gameRoot
                $prefix = $gamePrefix
                $relativePath = $decodedPath.TrimStart('/')
                $segments = $relativePath.Split('/')
                $extension = [IO.Path]::GetExtension($relativePath).ToLowerInvariant()
                $allowed = $root -and $segments[0] -in $gameDirectories -and $extension -in $gameExtensions
            }
            if (-not $allowed)
            {
                Write-Response $stream 403 'Forbidden' 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes('Forbidden')) ($method -eq 'HEAD')
                continue
            }
            $filePath = [IO.Path]::GetFullPath((Join-Path $root $relativePath.Replace('/', [IO.Path]::DirectorySeparatorChar)))
            if (-not $filePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase))
            {
                Write-Response $stream 403 'Forbidden' 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes('Forbidden')) ($method -eq 'HEAD')
                continue
            }

            $itemPath = $root
            $redirected = $false
            foreach ($segment in $relativePath.Split('/'))
            {
                $itemPath = Join-Path $itemPath $segment
                if ([IO.File]::Exists($itemPath) -or [IO.Directory]::Exists($itemPath))
                {
                    if ((Get-Item -LiteralPath $itemPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { $redirected = $true; break }
                }
            }
            if ($redirected)
            {
                Write-Response $stream 403 'Forbidden' 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes('Forbidden')) ($method -eq 'HEAD')
                continue
            }

            if (-not [IO.File]::Exists($filePath))
            {
                Write-Response $stream 404 'Not Found' 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes('Not found')) ($method -eq 'HEAD')
                continue
            }

            $extension = [IO.Path]::GetExtension($filePath).ToLowerInvariant()
            $contentType = if ($mimeTypes.ContainsKey($extension)) { $mimeTypes[$extension] } else { 'application/octet-stream' }
            Write-Response $stream 200 'OK' $contentType ([IO.File]::ReadAllBytes($filePath)) ($method -eq 'HEAD')
        }
        catch
        {
            if ($stream -and $stream.CanWrite)
            {
                try
                {
                    Write-Response $stream 500 'Internal Server Error' 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes('Internal server error')) $false
                }
                catch
                {
                    Write-Warning "Could not send the error response: $($_.Exception.Message)"
                }
            }
        }
        finally
        {
            $client.Dispose()
        }
    }
}
finally
{
    $listener.Stop()
}
