'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

class MockFile extends Blob {
  constructor(parts, name, options = {}) {
    super(parts, options);
    this.name = name;
    this.lastModified = options.lastModified || 0;
  }
}

class FileHandle {
  constructor(file) { this.kind = 'file'; this.name = file.name; this.file = file; }
  async getFile() { return this.file; }
}

class DirectoryHandle {
  constructor(name, entries = {}, permission = 'granted') { this.kind = 'directory'; this.name = name; this.entries = entries; this.permission = permission; this.permissionRequests = 0; }
  async getDirectoryHandle(name) { const entry = this.entries[name]; if (!entry || entry.kind !== 'directory') throw Object.assign(new Error('not found'), {name: 'NotFoundError'}); return entry; }
  async getFileHandle(name) { const entry = this.entries[name]; if (!entry || entry.kind !== 'file') throw Object.assign(new Error('not found'), {name: 'NotFoundError'}); return entry; }
  async *values() { for (const entry of Object.values(this.entries)) yield entry; }
  async queryPermission() { return this.permission; }
  async requestPermission() { this.permissionRequests++; this.permission = 'granted'; return 'granted'; }
}

function file(name, text, modified = 0) { return new FileHandle(new MockFile([text], name, {lastModified: modified})); }
function directory(name, entries, permission) { return new DirectoryHandle(name, entries, permission); }

function indexedDb(values) {
  return {open() {
    const request = {};
    queueMicrotask(() => {
      request.result = {
        createObjectStore() {},
        transaction() { return {objectStore() { return {
          get(key) { const result = {}; queueMicrotask(() => { result.result = values.get(key); result.onsuccess(); }); return result; },
          put(value, key) { const result = {}; queueMicrotask(() => { values.set(key, value); result.onsuccess(); }); return result; }
        }; }}; },
        close() {}
      };
      request.onsuccess();
    });
    return request;
  }};
}

function fixture(permission = 'granted') {
  const game = directory('Stellaris', {
    common: directory('common', {
      ship_sizes: directory('ship_sizes', {'ships.txt': file('ships.txt', 'ship')}),
      technology: directory('technology', {'tech.txt': file('tech.txt', 'tech')}),
      scripted_variables: directory('scripted_variables', {'vars.txt': file('vars.txt', 'vars')}),
      governments: directory('governments', {civics: directory('civics', {'civics.txt': file('civics.txt', 'civic')})}),
      component_templates: directory('component_templates', {'components.txt': file('components.txt', 'component')}),
      section_templates: directory('section_templates', {'sections.txt': file('sections.txt', 'section')}),
      component_slot_templates: directory('component_slot_templates', {'slots.txt': file('slots.txt', 'slot')}),
      defines: directory('defines', {'defines.txt': file('defines.txt', 'define')})
    }),
    localisation: directory('localisation', {english: directory('english', {
      'a_l_english.yml': file('a_l_english.yml', 'l_english:'),
      nested: directory('nested', {'b_l_english.yml': file('b_l_english.yml', 'second')})
    })}),
    gfx: directory('gfx', {interface: directory('interface', {'icon.dds': file('icon.dds', 'pixels')})})
  }, permission);
  const saves = directory('save games', {
    old: file('old.sav', 'old', 10),
    campaign: directory('campaign', {newest: file('newest.SAV', 'new', 20), note: file('note.txt', 'x', 30)})
  }, permission);
  return {game, saves};
}

async function createEnvironment(stored = new Map(), permission = 'granted') {
  const {game, saves} = fixture(permission);
  const picker = [game, saves];
  let networkCalls = 0;
  const window = {
    isSecureContext: true,
    indexedDB: indexedDb(stored),
    navigator: {userActivation: {isActive: true}},
    location: {href: 'https://example.test/SaveInspector/index.html'},
    showDirectoryPicker: async () => picker.shift(),
    fetch: async () => { networkCalls++; return new Response('network'); },
    Response, Request, URL, Blob, setTimeout
  };
  const context = vm.createContext({...window, window, globalThis: window, Response, Request, URL, Blob, console, queueMicrotask, setTimeout});
  vm.runInContext(fs.readFileSync(require.resolve('./client-files.js'), 'utf8'), context);
  return {window, api: window.ClientFiles, game, saves, stored, networkCalls: () => networkCalls};
}

async function run() {
  const environment = await createEnvironment();
  const {api, window, game, saves, stored} = environment;
  assert.strictEqual(api.supported, true);
  assert.strictEqual(api.mode, 'persistent');
  assert.strictEqual(await api.initialize(), true);
  assert.strictEqual(api.hasGameDirectory(), false);
  await api.chooseGameDirectory();
  await api.chooseSaveDirectory();
  assert.strictEqual(api.canWatch, false);
  assert.strictEqual(stored.get('game'), game);
  assert.strictEqual(stored.get('save'), saves);
  await api.enable();
  assert.strictEqual(api.canWatch, true);

  const asset = await window.fetch('../gfx/interface/icon.dds');
  assert.strictEqual(await asset.text(), 'pixels');
  assert.strictEqual(asset.headers.get('content-type'), 'application/octet-stream');
  const english = await (await window.fetch('english-files.json')).json();
  assert.deepStrictEqual(Array.from(english), ['../localisation/english/a_l_english.yml', '../localisation/english/nested/b_l_english.yml']);
  const technology = await (await window.fetch('technology-manifest')).json();
  assert.deepStrictEqual(Array.from(technology.technology), ['common/technology/tech.txt']);
  assert.strictEqual(environment.networkCalls(), 0);
  const persistentLatest = await api.latestSave();
  assert.strictEqual(persistentLatest.file.name, 'newest.SAV');
  assert.strictEqual(persistentLatest.relativePath, 'campaign/newest.SAV');

  game.entries.common.entries.technology.entries['later.txt'] = file('later.txt', 'later');
  const cached = await (await window.fetch('technology-manifest')).json();
  assert.strictEqual(cached.technology.length, 1);
  assert.strictEqual((await window.fetch('/common/%2e%2e/secret.txt')).status, 400);
  await window.fetch('/unrelated.json');
  assert.strictEqual(environment.networkCalls(), 1);

  game.permission = 'prompt'; saves.permission = 'prompt';
  const restored = await createEnvironment(new Map([['game', game], ['save', saves]]), 'prompt');
  restored.window.navigator.userActivation.isActive = false;
  await restored.api.initialize();
  await assert.rejects(restored.api.enable(), /нажатия кнопки/);
  restored.window.navigator.userActivation.isActive = true;
  await restored.api.enable();
  assert.strictEqual(game.permissionRequests, 1);

  const fallback = await createEnvironment();
  fallback.window.isSecureContext = false;
  delete fallback.window.showDirectoryPicker;
  assert.strictEqual(await fallback.api.initialize(), true);
  assert.strictEqual(fallback.api.mode, 'snapshot');
  const gameList = [
    Object.assign(new MockFile(['ship'], 'ships.txt'), {webkitRelativePath: 'Stellaris/common/ship_sizes/ships.txt'}),
    Object.assign(new MockFile(['tech'], 'tech.txt'), {webkitRelativePath: 'Stellaris/common/technology/tech.txt'}),
    Object.assign(new MockFile(['vars'], 'vars.txt'), {webkitRelativePath: 'Stellaris/common/scripted_variables/vars.txt'}),
    Object.assign(new MockFile(['civic'], 'civics.txt'), {webkitRelativePath: 'Stellaris/common/governments/civics/civics.txt'}),
    Object.assign(new MockFile(['loc'], 'a_l_english.yml'), {webkitRelativePath: 'Stellaris/localisation/english/a_l_english.yml'}),
    Object.assign(new MockFile(['image'], 'icon.dds'), {webkitRelativePath: 'Stellaris/gfx/interface/icon.dds'})
  ];
  const saveList = [
    Object.assign(new MockFile(['old'], 'old.sav', {lastModified: 1}), {webkitRelativePath: 'save games/campaign/old.sav'}),
    Object.assign(new MockFile(['new'], 'new.sav', {lastModified: 2}), {webkitRelativePath: 'save games/campaign/new.sav'})
  ];
  assert.strictEqual(fallback.api.setGameFiles(gameList), gameList.length);
  assert.throws(() => fallback.api.setGameFiles([
    Object.assign(new MockFile(['x'], 'a.txt'), {webkitRelativePath: 'Wrapper/Stellaris/common/a.txt'}),
    Object.assign(new MockFile(['x'], 'b.dds'), {webkitRelativePath: 'Wrapper/Stellaris/gfx/b.dds'}),
    Object.assign(new MockFile(['x'], 'c.yml'), {webkitRelativePath: 'Wrapper/Stellaris/localisation/c.yml'})
  ]), /не найдены файлы Stellaris/);
  assert.strictEqual(fallback.api.setSaveFiles(saveList), saveList.length);
  await fallback.api.enable();
  assert.strictEqual(fallback.api.canWatch, false);
  assert.strictEqual(await (await fallback.window.fetch('/gfx/interface/icon.dds')).text(), 'image');
  assert.strictEqual((await fallback.api.latestSave()).file.name, 'new.sav');

  console.log('client-files: все тесты пройдены');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
