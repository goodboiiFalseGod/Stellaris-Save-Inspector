'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const appRoot = __dirname;
const settingsPath = path.join(appRoot, 'settings.local.json');
const gameDirectories = new Set(['assets', 'common', 'curated_save_games', 'flags', 'gfx', 'interface', 'localisation']);
const gameExtensions = new Set(['.csv', '.dds', '.gfx', '.jpg', '.png', '.sav', '.txt', '.yml']);
const appExtensions = new Set(['.css', '.html', '.js', '.json']);
const types = {'.css': 'text/css; charset=utf-8', '.dds': 'application/octet-stream', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json; charset=utf-8'};
let gameRoot = null;

function validateGameLocation(location) {
  if (typeof location !== 'string' || !path.isAbsolute(location)) throw new Error('Укажите полный путь к папке Stellaris.');
  const resolved = path.resolve(location);
  for (const required of ['common/technology', 'gfx/interface', 'localisation']) {
    if (!fs.existsSync(path.join(resolved, required))) throw new Error(`В выбранной папке нет ${required}.`);
  }
  return resolved;
}

try { gameRoot = validateGameLocation(JSON.parse(fs.readFileSync(settingsPath, 'utf8').replace(/^\uFEFF/, '')).gameLocation); }
catch (error) { if (fs.existsSync(settingsPath)) console.warn(`Настроенная папка игры недоступна: ${error.message}`); }

function json(response, status, data) {
  response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
  response.end(JSON.stringify(data));
}

function restrictedPath(root, relative) {
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep)) return null;
  let cursor = root;
  for (const segment of relative.split('/')) {
    cursor = path.join(cursor, segment);
    try { if (fs.lstatSync(cursor).isSymbolicLink()) return null; }
    catch (error) { if (error.code !== 'ENOENT') return null; }
  }
  return file;
}

http.createServer(async (request, response) => {
  const method = request.method;
  const requestPath = (request.url || '/').split('?')[0];
  const host = request.headers.host;
  const origin = request.headers.origin;
  if (requestPath === '/SaveInspector/game-location') {
    if (!['127.0.0.1:8765', 'localhost:8765'].includes(host) || request.headers['x-stellaris-config'] !== '1' || (method === 'POST' && !['http://127.0.0.1:8765', 'http://localhost:8765'].includes(origin))) return json(response, 403, {error: 'Недопустимый запрос настроек.'});
    if (method === 'GET') return json(response, 200, {gameLocation: gameRoot});
    if (method !== 'POST') return json(response, 405, {error: 'Метод не поддерживается.'});
    try {
      const chunks = [];
      let length = 0;
      for await (const chunk of request) { length += chunk.length; if (length > 4096) throw new Error('Некорректный размер запроса.'); chunks.push(chunk); }
      const body = Buffer.concat(chunks).toString('ascii');
      if (!/^path=[A-Za-z0-9_.!~*'()%\-]+$/.test(body)) throw new Error('Некорректный запрос пути.');
      const nextRoot = validateGameLocation(decodeURIComponent(body.slice(5)));
      const temporary = settingsPath + '.tmp';
      fs.writeFileSync(temporary, JSON.stringify({gameLocation: nextRoot}), 'utf8');
      fs.renameSync(temporary, settingsPath);
      gameRoot = nextRoot;
      return json(response, 200, {gameLocation: gameRoot});
    } catch (error) { return json(response, 400, {error: error.message}); }
  }
  if (requestPath === '/SaveInspector/server-info') return json(response, 200, {backend: 'node', latestSave: false, liveSnapshot: false});
  if (requestPath === '/SaveInspector/technology-manifest') {
    if (!gameRoot) return json(response, 503, {error: 'Выберите папку Stellaris в настройках.'});
    const list = directory => fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => entry.isDirectory() ? list(path.join(directory, entry.name)) : entry.name.endsWith('.txt') ? [path.relative(gameRoot, path.join(directory, entry.name)).replace(/\\/g, '/')] : []);
    return json(response, 200, {technology: list(path.join(gameRoot, 'common', 'technology')), variables: list(path.join(gameRoot, 'common', 'scripted_variables')), civics: list(path.join(gameRoot, 'common', 'governments', 'civics'))});
  }
  if (requestPath === '/SaveInspector/latest-save') return json(response, 503, {error: 'Latest-save loading is available through server.ps1. Restart with launch-inspector.cmd.'});
  if (requestPath === '/SaveInspector/live/snapshot') return json(response, 503, {error: 'Живой режим пока доступен через server.ps1. Перезапустите сервер штатным launch-inspector.cmd.'});
  if (!['GET', 'HEAD'].includes(method)) return json(response, 405, {error: 'Метод не поддерживается.'});
  let decoded;
  try { decoded = decodeURIComponent(requestPath).replace(/\\/g, '/'); }
  catch { return json(response, 400, {error: 'Некорректный адрес.'}); }
  const isApp = decoded === '/' || decoded === '/SaveInspector' || decoded.startsWith('/SaveInspector/');
  const root = isApp ? appRoot : gameRoot;
  const relative = isApp ? (['/', '/SaveInspector', '/SaveInspector/'].includes(decoded) ? 'index.html' : decoded.slice('/SaveInspector/'.length)) : decoded.replace(/^\/+/, '');
  const fileName = relative.endsWith('/') ? relative + 'index.html' : relative;
  const extension = path.extname(fileName).toLowerCase();
  const allowed = isApp ? appExtensions.has(extension) && fileName !== 'settings.local.json' : gameRoot && gameDirectories.has(fileName.split('/')[0]) && gameExtensions.has(extension);
  const file = allowed && root ? restrictedPath(root, fileName) : null;
  if (!file) return json(response, 403, {error: 'Forbidden'});
  fs.readFile(file, (error, data) => {
    if (error) return json(response, error.code === 'ENOENT' ? 404 : 500, {error: 'Not found'});
    response.writeHead(200, {'Content-Type': types[extension] || 'application/octet-stream', 'Content-Length': data.length, 'Cache-Control': 'no-store'});
    response.end(method === 'HEAD' ? undefined : data);
  });
}).listen(8765, '127.0.0.1', () => console.log('Open http://127.0.0.1:8765/SaveInspector/'));
