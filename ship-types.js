'use strict';

(function (root) {
  let sourcePromise, types;
  function initialize(sources) {
    types = new Map();
    for (const source of sources) {
      for (const entry of SaveFormat.entries(source)) {
        if (!entry.key || entry.block === undefined) continue;
        types.set(entry.key, {
          station: SaveFormat.scalar(entry.block, 'is_space_station') === 'yes',
          civilian: SaveFormat.scalar(entry.block, 'is_civilian') === 'yes',
          icon: SaveFormat.scalar(entry.block, 'icon'),
          class: SaveFormat.scalar(entry.block, 'class')
        });
      }
    }
    sourcePromise = Promise.resolve(sources);
    return types;
  }
  async function read(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Ship type definitions unavailable: ${path}`);
    return response.text();
  }
  function sources() {
    if (!sourcePromise) sourcePromise = (async () => {
      const paths = JSON.parse(await read('ship-size-files.json')), result = new Array(paths.length);
      let next = 0;
      await Promise.all(Array.from({ length: 6 }, async () => {
        while (next < paths.length) { const index = next++; result[index] = await read(paths[index]); }
      }));
      return result;
    })().catch(error => { sourcePromise = undefined; throw error; });
    return sourcePromise;
  }
  async function load() { if (!types) initialize(await sources()); return types; }
  function isArkship(size) { return /^(?:civilian|science|military)_arkship_/.test(size); }
  function arkHullLabel(size, count) {
    const role = /^(civilian|science|military)_arkship_/.exec(size)?.[1];
    if (!role) return null;
    const tier = /_tier_([123])$/.exec(size)?.[1] || /_tier_([123])$/.exec(types?.get(size)?.icon || '')?.[1];
    if (!tier) return null;
    const name = {civilian: 'Civilian', science: 'Scientific', military: 'Military'}[role];
    return `${name} Arkship${count === 1 ? '' : 's'} ${['', 'I', 'II', 'III'][Number(tier)]}`;
  }
  function isMilitary(size) {
    if (!types) throw new Error('Ship type definitions must be loaded before parsing fleets');
    const type = types.get(size);
    if (type?.station) return false;
    // Все мобильные ковчеги учитываются независимо от специализации.
    if (isArkship(size)) return true;
    if (type?.civilian) return false;
    // Проверяем идентификатор класса, а не пользовательское имя корабля.
    const utility = /(?:^|_)(?:.*station|.*platform|orbital|logistic\w*|construct\w*|science|research|mining|coloni\w*|colony|civilian|transport|observation|habitat)(?:_|$)/i;
    if (utility.test(size) || utility.test(type?.class || '')) return false;
    if (type?.class === 'shipclass_starbase') return size === 'juggernaut';
    return true;
  }
  function isWaystation(size) { return /waystation/i.test(size || ''); }
  const api = { initialize, sources, load, isMilitary, isArkship, isWaystation, arkHullLabel };
  root.ShipTypes = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
