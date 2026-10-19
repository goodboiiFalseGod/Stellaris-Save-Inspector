(function (root) {
  'use strict';

  const DB_NAME = 'stellaris-save-inspector';
  const STORE_NAME = 'directory-handles';
  const GAME_KEY = 'game';
  const SAVE_KEY = 'save';
  const MAX_DEPTH = 12;
  const MAX_FILES = 100000;
  const MAX_SAVE_SIZE = 512 * 1024 * 1024;
  const GAME_PREFIXES = new Set(['assets', 'common', 'gfx', 'flags', 'interface', 'localisation', 'curated_save_games']);
  const MANIFEST_NAMES = new Set(['english-files.json', 'ship-size-files.json', 'combat-files.json', 'technology-manifest']);
  const MIME = {'.csv': 'text/csv; charset=utf-8', '.dds': 'application/octet-stream', '.gfx': 'text/plain; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.sav': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8', '.yml': 'text/plain; charset=utf-8'};

  let gameDirectory;
  let saveDirectory;
  let gameFiles;
  let saveFiles;
  let enabled = false;
  let gameReady = false;
  let saveReady = false;
  let originalFetch;
  const manifestCache = new Map();

  function supported() {
    return typeof root.Response === 'function' || typeof Response === 'function';
  }

  function persistentAccessSupported() {
    return root.isSecureContext !== false && typeof root.showDirectoryPicker === 'function' && !!root.indexedDB;
  }

  function mode() {
    return persistentAccessSupported() ? 'persistent' : 'snapshot';
  }

  function ensureSupported() {
    if (!supported()) throw new Error('Браузер не поддерживает локальную загрузку файлов. Откройте страницу в Chromium.');
  }

  function ensureUserGesture() {
    const activation = root.navigator && root.navigator.userActivation;
    if (activation && !activation.isActive) throw new Error('Доступ к папке можно разрешить только после нажатия кнопки.');
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = root.indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Не удалось открыть локальное хранилище разрешений.'));
    });
  }

  async function databaseOperation(mode, action) {
    const database = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode);
        const request = action(transaction.objectStore(STORE_NAME));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error('Не удалось прочитать локальное хранилище разрешений.'));
        transaction.onabort = () => reject(new Error('Не удалось сохранить выбранную папку.'));
      });
    } finally {
      database.close();
    }
  }

  function loadHandle(key) {
    return databaseOperation('readonly', store => store.get(key));
  }

  function saveHandle(key, handle) {
    return databaseOperation('readwrite', store => store.put(handle, key));
  }

  async function initialize() {
    if (!persistentAccessSupported()) return supported();
    [gameDirectory, saveDirectory] = await Promise.all([loadHandle(GAME_KEY), loadHandle(SAVE_KEY)]);
    return true;
  }

  async function requestReadPermission(handle, description) {
    if (!handle) return false;
    if (typeof handle.queryPermission === 'function' && await handle.queryPermission({mode: 'read'}) === 'granted') return true;
    ensureUserGesture();
    if (typeof handle.requestPermission !== 'function' || await handle.requestPermission({mode: 'read'}) !== 'granted') throw new Error(`Не разрешено чтение папки ${description}.`);
    return true;
  }

  async function enable(scope = 'all') {
    ensureSupported();
    if (!gameDirectory && !saveDirectory && !gameFiles && !saveFiles) throw new Error('Сначала выберите папку Stellaris или папку сохранений.');
    if (scope === 'restore') {
      gameReady = !!gameFiles || !!gameDirectory && (typeof gameDirectory.queryPermission !== 'function' || await gameDirectory.queryPermission({mode: 'read'}) === 'granted');
      saveReady = !!saveFiles || !!saveDirectory && (typeof saveDirectory.queryPermission !== 'function' || await saveDirectory.queryPermission({mode: 'read'}) === 'granted');
    } else {
      if (scope === 'all' || scope === 'game') gameReady = !!gameFiles || await requestReadPermission(gameDirectory, 'Stellaris');
      if (scope === 'all' || scope === 'save') saveReady = !!saveFiles || await requestReadPermission(saveDirectory, 'сохранений');
    }
    if (gameReady && !enabled) {
      originalFetch = root.fetch.bind(root);
      root.fetch = interceptedFetch;
      enabled = true;
    }
    if (scope === 'game' && !gameReady) throw new Error('Нет доступа к папке Stellaris.');
    if (scope === 'save' && !saveReady) throw new Error('Нет доступа к папке сохранений.');
    return gameReady || saveReady;
  }

  async function chooseDirectory(key, description) {
    if (!persistentAccessSupported()) throw new Error(`На HTTP выбор папки ${description} выполняется через кнопку загрузки папки.`);
    ensureUserGesture();
    let handle;
    try {
      handle = await root.showDirectoryPicker({id: `stellaris-${key}`, mode: 'read'});
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error(`Выбор папки ${description} отменён.`);
      throw error;
    }
    await requestReadPermission(handle, description);
    return handle;
  }

  async function chooseGameDirectory() {
    const handle = await chooseDirectory(GAME_KEY, 'Stellaris');
    try {
      await handle.getDirectoryHandle('common');
      await handle.getDirectoryHandle('gfx');
      await handle.getDirectoryHandle('localisation');
    } catch (error) {
      throw new Error('В выбранной папке не найдены каталоги common, gfx и localisation. Выберите корневую папку Stellaris.');
    }
    await saveHandle(GAME_KEY, handle);
    gameDirectory = handle;
    gameFiles = undefined;
    gameReady = false;
    manifestCache.clear();
    return gameDirectory;
  }

  async function chooseSaveDirectory() {
    const handle = await chooseDirectory(SAVE_KEY, 'сохранений');
    await saveHandle(SAVE_KEY, handle);
    saveDirectory = handle;
    saveFiles = undefined;
    saveReady = false;
    return saveDirectory;
  }

  function hasGameDirectory() {
    return !!gameDirectory || !!gameFiles;
  }

  function hasSaveDirectory() {
    return !!saveDirectory || !!saveFiles;
  }

  function hasGameAccess() {
    return gameReady;
  }

  function hasSaveAccess() {
    return saveReady;
  }

  function indexFileList(fileList, game) {
    if (!fileList || typeof fileList.length !== 'number') throw new Error('Не получен список файлов выбранной папки.');
    if (fileList.length > MAX_FILES) throw new Error(`В папке найдено больше ${MAX_FILES} файлов. Выберите более узкую папку.`);
    const index = new Map();
    let selectedRoot;
    for (const file of Array.from(fileList)) {
      const raw = String(file.webkitRelativePath || file.name || '').replace(/\\/g, '/');
      const segments = raw.split('/').filter(Boolean);
      if (!segments.length || segments.length > MAX_DEPTH + 2 || segments.some(segment => segment === '.' || segment === '..' || /[\0-\x1f]/.test(segment))) throw new Error('Выбранная папка содержит недопустимый путь.');
      let relative = segments;
      if (game) {
        if (segments.length < 3) continue;
        if (selectedRoot === undefined) selectedRoot = segments[0];
        if (segments[0] !== selectedRoot) throw new Error('Все игровые файлы должны относиться к одной выбранной папке.');
        relative = segments.slice(1);
        if (!GAME_PREFIXES.has(relative[0])) continue;
      }
      const key = relative.join('/');
      if (index.has(key)) throw new Error(`В выбранной папке повторяется путь ${key}.`);
      index.set(key, file);
    }
    if (!index.size) throw new Error(game ? 'В выбранной папке не найдены файлы Stellaris.' : 'В выбранной папке нет файлов.');
    return index;
  }

  function setGameFiles(files) {
    const index = indexFileList(files, true);
    const paths = [...index.keys()];
    if (!paths.some(path => path.startsWith('common/')) || !paths.some(path => path.startsWith('gfx/')) || !paths.some(path => path.startsWith('localisation/'))) throw new Error('В выбранной папке не найдены каталоги common, gfx и localisation. Выберите корневую папку Stellaris.');
    gameFiles = index;
    gameDirectory = undefined;
    gameReady = false;
    manifestCache.clear();
    return index.size;
  }

  function setSaveFiles(files) {
    saveFiles = indexFileList(files, false);
    saveDirectory = undefined;
    saveReady = false;
    return saveFiles.size;
  }

  function safeSegments(pathname) {
    let decoded;
    try {
      decoded = decodeURIComponent(pathname).replace(/\\/g, '/');
    } catch (error) {
      throw new Error('Некорректный адрес локального файла.');
    }
    const segments = decoded.split('/').filter(Boolean);
    if (!segments.length || segments.some(segment => segment === '.' || segment === '..' || segment.includes('/') || /[\0-\x1f]/.test(segment))) throw new Error('Недопустимый путь к локальному файлу.');
    return segments;
  }

  async function fileAt(rootHandle, segments) {
    if (!rootHandle && gameFiles) {
      const file = gameFiles.get(segments.join('/'));
      if (!file) throw Object.assign(new Error('Локальный файл не найден.'), {name: 'NotFoundError'});
      return file;
    }
    let directory = rootHandle;
    for (let index = 0; index < segments.length - 1; index++) directory = await directory.getDirectoryHandle(segments[index]);
    return (await directory.getFileHandle(segments[segments.length - 1])).getFile();
  }

  async function listFiles(rootHandle, directoryPath, suffix, output, depth, state) {
    if (!rootHandle && gameFiles) {
      const prefix = directoryPath.join('/') + '/';
      for (const path of gameFiles.keys()) if (path.startsWith(prefix) && path.toLowerCase().endsWith(suffix)) output.push(path);
      return output.sort();
    }
    if (depth > MAX_DEPTH) throw new Error(`Превышена допустимая глубина папок (${MAX_DEPTH}).`);
    state = state || {count: 0};
    let directory = rootHandle;
    for (const segment of directoryPath) directory = await directory.getDirectoryHandle(segment);
    for await (const entry of directory.values()) {
      state.count++;
      if (state.count > MAX_FILES) throw new Error(`В папке найдено больше ${MAX_FILES} объектов. Уточните выбранную папку.`);
      const path = directoryPath.concat(entry.name);
      if (entry.kind === 'directory') await listFiles(rootHandle, path, suffix, output, depth + 1, state);
      else if (entry.kind === 'file' && entry.name.toLowerCase().endsWith(suffix)) output.push(path.join('/'));
    }
    return output;
  }

  async function files(directory, suffix) {
    return (await listFiles(gameDirectory, directory.split('/'), suffix, [], 0)).sort();
  }

  async function buildManifest(name) {
    if (!gameDirectory && !gameFiles) throw new Error('Сначала выберите папку Stellaris.');
    if (name === 'english-files.json') return (await files('localisation/english', '_l_english.yml')).map(path => `../${path}`);
    if (name === 'ship-size-files.json') return (await files('common/ship_sizes', '.txt')).map(path => `../${path}`);
    if (name === 'technology-manifest') return {
      technology: await files('common/technology', '.txt'),
      variables: await files('common/scripted_variables', '.txt'),
      civics: await files('common/governments/civics', '.txt')
    };
    const definitions = {components: 'component_templates', sections: 'section_templates', slots: 'component_slot_templates', technologies: 'technology', hulls: 'ship_sizes', variables: 'scripted_variables', defines: 'defines'};
    const result = {};
    for (const [key, directory] of Object.entries(definitions)) result[key] = (await files(`common/${directory}`, '.txt')).map(path => `../${path}`);
    return result;
  }

  function jsonResponse(value, status) {
    return new Response(JSON.stringify(value), {status: status || 200, headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}});
  }

  function errorResponse(error, status) {
    return jsonResponse({error: error && error.message ? error.message : 'Не удалось прочитать локальный файл.'}, status || 404);
  }

  function manifestName(pathname) {
    const name = pathname.split('/').filter(Boolean).pop();
    return MANIFEST_NAMES.has(name) ? name : undefined;
  }

  async function localResponse(input, init, url) {
    const method = ((init && init.method) || (typeof Request !== 'undefined' && input instanceof Request && input.method) || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return errorResponse(new Error('Для локальных файлов поддерживаются только GET и HEAD.'), 405);
    const manifest = manifestName(url.pathname);
    try {
      if (manifest) {
        if (!manifestCache.has(manifest)) manifestCache.set(manifest, buildManifest(manifest).catch(error => { manifestCache.delete(manifest); throw error; }));
        const value = await manifestCache.get(manifest);
        return method === 'HEAD' ? new Response(null, {status: 200, headers: {'Content-Type': 'application/json; charset=utf-8'}}) : jsonResponse(value);
      }
      if (!gameDirectory && !gameFiles) throw new Error('Сначала выберите папку Stellaris.');
      const segments = safeSegments(url.pathname);
      if (!GAME_PREFIXES.has(segments[0])) throw new Error('Запрошенный путь не относится к разрешённым папкам Stellaris.');
      const file = await fileAt(gameDirectory, segments);
      const dot = file.name.lastIndexOf('.');
      const type = MIME[dot < 0 ? '' : file.name.slice(dot).toLowerCase()] || file.type || 'application/octet-stream';
      return new Response(method === 'HEAD' ? null : file, {status: 200, headers: {'Content-Type': type, 'Content-Length': String(file.size), 'Cache-Control': 'no-store'}});
    } catch (error) {
      return errorResponse(error, error && error.name === 'NotAllowedError' ? 403 : 404);
    }
  }

  function interceptedFetch(input, init) {
    const raw = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    const url = new URL(raw, root.location.href);
    if (url.origin !== new URL(root.location.href).origin) return originalFetch(input, init);
    try {
      const rawSegments = decodeURIComponent(raw.split(/[?#]/, 1)[0]).replace(/\\/g, '/').split('/');
      const rootIndex = rawSegments.findIndex(segment => GAME_PREFIXES.has(segment));
      if (rootIndex >= 0 && rawSegments.slice(rootIndex + 1).some(segment => segment === '.' || segment === '..')) return Promise.resolve(errorResponse(new Error('Недопустимый путь к локальному файлу.'), 400));
    } catch (error) {
      return Promise.resolve(errorResponse(new Error('Некорректный адрес локального файла.'), 400));
    }
    let segments;
    try { segments = safeSegments(url.pathname); } catch (error) { return Promise.resolve(errorResponse(error, 400)); }
    if (manifestName(url.pathname) || GAME_PREFIXES.has(segments[0])) return localResponse(input, init, url);
    return originalFetch(input, init);
  }

  async function latestSave() {
    if (!saveDirectory && !saveFiles) throw new Error('Сначала выберите папку сохранений или кампании.');
    if (!saveReady) throw new Error('Нет разрешения на чтение папки сохранений. Подключите её повторно.');
    if (saveFiles) {
      let newest;
      for (const [relativePath, file] of saveFiles) {
        if (!file.name.toLowerCase().endsWith('.sav')) continue;
        if (!newest || file.lastModified > newest.file.lastModified || file.lastModified === newest.file.lastModified && relativePath.localeCompare(newest.relativePath) > 0) newest = {file, relativePath};
      }
      if (!newest) throw new Error('В выбранной папке не найдено файлов .sav.');
      if (newest.file.size > MAX_SAVE_SIZE) throw new Error('Самое новое сохранение превышает безопасный лимит 512 МиБ.');
      return {...newest, revision: `${newest.relativePath}|${newest.file.size}|${newest.file.lastModified}`};
    }
    if (typeof saveDirectory.queryPermission === 'function' && await saveDirectory.queryPermission({mode: 'read'}) !== 'granted') throw new Error('Нет разрешения на чтение папки сохранений. Нажмите кнопку подключения папок.');
    let newest;
    let visited = 0;
    async function scan(directory, depth, prefix) {
      if (depth > MAX_DEPTH) throw new Error(`Превышена допустимая глубина папок (${MAX_DEPTH}).`);
      for await (const entry of directory.values()) {
        visited++;
        if (visited > MAX_FILES) throw new Error(`В папке найдено больше ${MAX_FILES} объектов. Выберите папку конкретной кампании.`);
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.kind === 'directory') await scan(entry, depth + 1, relativePath);
        else if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.sav')) {
          const file = await entry.getFile();
          if (!newest || file.lastModified > newest.file.lastModified || file.lastModified === newest.file.lastModified && relativePath.localeCompare(newest.relativePath) > 0) newest = {handle: entry, file, relativePath};
        }
      }
    }
    await scan(saveDirectory, 0, '');
    if (!newest) throw new Error('В выбранной папке не найдено файлов .sav.');
    if (newest.file.size > MAX_SAVE_SIZE) throw new Error('Самое новое сохранение превышает безопасный лимит 512 МиБ.');
    await new Promise(resolve => setTimeout(resolve, 120));
    const stable = await newest.handle.getFile();
    if (stable.size !== newest.file.size || stable.lastModified !== newest.file.lastModified) throw new Error('Последний сейв ещё записывается. Повторите попытку.');
    return {file: stable, relativePath: newest.relativePath, revision: `${newest.relativePath}|${stable.size}|${stable.lastModified}`};
  }

  root.ClientFiles = {
    get supported() { return supported(); },
    get mode() { return mode(); },
    get canWatch() { return mode() === 'persistent' && saveReady; },
    initialize,
    enable,
    chooseGameDirectory,
    chooseSaveDirectory,
    setGameFiles,
    setSaveFiles,
    hasGameDirectory,
    hasSaveDirectory,
    hasGameAccess,
    hasSaveAccess,
    latestSave
  };
})(typeof window !== 'undefined' ? window : globalThis);
