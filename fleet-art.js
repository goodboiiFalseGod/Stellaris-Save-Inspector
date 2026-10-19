'use strict';

(function (root) {
  let definitionsPromise;
  const images = new Map();
  function definitions(sizeSources, spriteSource) {
    const sizes = new Map(), sprites = new Map();
    for (const source of sizeSources) {
      for (const entry of SaveFormat.entries(source)) {
        if (entry.key && entry.block !== undefined) sizes.set(entry.key, SaveFormat.scalar(entry.block, 'icon') || 'ship_size_military_1');
      }
    }
    for (const source of Array.isArray(spriteSource) ? spriteSource : [spriteSource]) {
      for (const entry of SaveFormat.entries(SaveFormat.block(source, 'spriteTypes'))) {
        if (entry.key !== 'spriteType' || entry.block === undefined) continue;
        const fields = new Map(SaveFormat.entries(entry.block).map(field => [field.key?.toLowerCase(), field.scalar]));
        sprites.set(fields.get('name'), { path: fields.get('texturefile'), count: Number(fields.get('noofframes') || 1), parent: fields.get('sprite_sheet_sprite_type'), frame: Number(fields.get('default_frame') || 1) });
      }
    }
    return { sizes, sprites };
  }
  async function text(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Fleet artwork definition unavailable: ${path}`);
    return response.text();
  }
  function loadDefinitions() {
    if (!definitionsPromise) definitionsPromise = (async () => {
      const sources = await ShipTypes.sources();
      return definitions(sources, await Promise.all(['../interface/icons.gfx', '../interface/mutations.gfx'].map(text)));
    })().catch(error => { definitionsPromise = undefined; throw error; });
    return definitionsPromise;
  }
  function sprite(defs, name, depth = 0) {
    const entry = defs.sprites.get(name);
    if (!entry || depth > 8) throw new Error(`Unknown fleet sprite: ${name}`);
    return entry.parent ? { ...sprite(defs, entry.parent, depth + 1), frame: entry.frame } : entry;
  }
  function load(size, silhouette = false) {
    const cacheKey = `${size}:${silhouette}`;
    if (!images.has(cacheKey)) images.set(cacheKey, (async () => {
      const defs = await loadDefinitions(), icon = defs.sizes.get(size);
      if (!icon) throw new Error(`Ship class icon unavailable: ${size}`);
      const entry = sprite(defs, `GFX_${icon}${silhouette ? '_top' : ''}`);
      if (!entry.path || !/^gfx\/[\w/ .-]+\.dds$/i.test(entry.path) || entry.path.includes('..')) throw new Error('Invalid fleet sprite path');
      const image = await GameArt.load(`../${entry.path}`);
      return GameArt.frame(image, entry.frame, entry.count);
    })());
    return images.get(cacheKey);
  }
  function loadComponent(name, fallbackPath) {
    const key = `component:${name}`;
    if (!images.has(key)) images.set(key, (async () => {
      const defs = await loadDefinitions();
      const entry = defs.sprites.has(name) ? sprite(defs, name) : {path: fallbackPath?.replace(/^\.\.\//, ''), frame: 1, count: 1};
      if (!entry.path || !/^gfx\/[\w/ .-]+\.dds$/i.test(entry.path) || entry.path.includes('..')) throw new Error(`Component texture unavailable: ${name}`);
      return GameArt.frame(await GameArt.load(`../${entry.path}`), entry.frame, entry.count);
    })());
    return images.get(key);
  }
  const api = { load, definitions, sprite, loadComponent };
  root.FleetArt = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
