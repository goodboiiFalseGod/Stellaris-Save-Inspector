'use strict';

(function (root) {
  let catalog, pending;
  const numeric = value => value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
  const biologicalArmor = key => /^(?:SMALL|MEDIUM|LARGE)_(?:BIO_(?:LM_)?ARMOR_[1-5]|DRAGON_BIO_ARMOR|BIO_ARCHAEO_ARMOR)$/.test(key || '');
  function parse(sources, csv) {
    const components = new Map(), sections = new Map(), slots = new Map(), technologies = new Map(), weapons = new Map();
    const variables = new Map(), hullSpeeds = new Map(), scopes = new Map(), sectionLayouts = new Map();
    for (const source of sources.variables || []) for (const entry of SaveFormat.entries(source)) if (entry.key?.startsWith('@')) variables.set(entry.key, entry.scalar);
    function resolve(value, scope, depth = 0) { return depth > 12 ? null : value?.startsWith('@') ? resolve(scope.get(value), scope, depth + 1) : numeric(value); }
    function scopeFor(source) {
      if (scopes.has(source)) return scopes.get(source);
      const scope = new Map(variables);
      for (const entry of SaveFormat.entries(source)) if (entry.key?.startsWith('@')) scope.set(entry.key, entry.scalar);
      scopes.set(source, scope);
      return scope;
    }
    for (const source of sources.hulls || []) {
      const scope = scopeFor(source);
      for (const entry of SaveFormat.entries(source)) if (entry.block !== undefined) hullSpeeds.set(entry.key, resolve(SaveFormat.scalar(entry.block, 'max_speed'), scope));
    }
    let speedScale = null;
    for (const source of sources.defines || []) {
      const text = source.split(/\r?\n/).map(line => line.split('#')[0]).join('\n');
      for (const match of text.matchAll(/\bSHIP_SPEED_SCALE\s*=\s*([\d.eE+-]+)/g)) speedScale = numeric(match[1]);
    }
    if (!(speedScale > 0)) speedScale = null;
    for (const source of sources.technologies || []) for (const entry of SaveFormat.entries(source)) {
      if (entry.block !== undefined) technologies.set(entry.key, numeric(SaveFormat.scalar(entry.block, 'tier')));
    }
    for (const source of sources.slots || []) for (const entry of SaveFormat.entries(source)) {
      if (entry.block !== undefined) slots.set(entry.key, SaveFormat.scalar(entry.block, 'size'));
    }
    for (const source of sources.sections || []) for (const entry of SaveFormat.entries(source)) {
      if (entry.key !== 'ship_section_template' || entry.block === undefined) continue;
      const list = SaveFormat.entries(entry.block).filter(field => field.key === 'component_slot' && field.block !== undefined);
      sections.set(SaveFormat.scalar(entry.block, 'key'), list.map(field => SaveFormat.scalar(field.block, 'template')));
      sectionLayouts.set(SaveFormat.scalar(entry.block, 'key'), {
        position: SaveFormat.scalar(entry.block, 'fits_on_slot'),
        slots: list.map(field => ({name: SaveFormat.scalar(field.block, 'name'), size: slots.get(SaveFormat.scalar(field.block, 'template'))?.toLowerCase()}))
      });
    }
    for (const source of sources.components || []) for (const entry of SaveFormat.entries(source)) {
      if (!entry.key?.endsWith('_component_template') || entry.block === undefined) continue;
      const key = SaveFormat.scalar(entry.block, 'key');
      if (!key) continue;
      const modifier = SaveFormat.block(entry.block, 'modifier');
      const componentScope = scopeFor(source);
      const baseSpeed = SaveFormat.field(modifier, 'ship_base_speed_mult');
      const speed = SaveFormat.field(modifier, 'ship_speed_mult');
      // Biological armor receives its armor points from an inline game script, not a modifier block.
      const protection = /\bship_armor_add\s*=/.test(modifier) || biologicalArmor(key) ? 'armor' : /\bship_shield_add\s*=/.test(modifier) ? 'shield' : null;
      const prerequisites = SaveFormat.entries(SaveFormat.block(entry.block, 'prerequisites')).map(field => field.scalar).filter(Boolean);
      const tiers = prerequisites.map(key => technologies.get(key));
      const isCraft = entry.key === 'strike_craft_component_template';
      components.set(key, {
        weapon: ['weapon_component_template', 'strike_craft_component_template'].includes(entry.key), protection,
        icon: SaveFormat.scalar(entry.block, 'icon'),
        size: isCraft ? 'strike_craft' : SaveFormat.scalar(entry.block, 'size')?.toLowerCase(), family: SaveFormat.scalar(entry.block, 'component_set') || key,
        baseSpeedMult: baseSpeed ? resolve(baseSpeed.scalar, componentScope) : 0,
        speedMult: speed ? resolve(speed.scalar, componentScope) : 0,
        tier: tiers.length && tiers.every(tier => tier !== null && tier !== undefined) ? Math.max(...tiers) : null,
        armorDamage: isCraft ? resolve(SaveFormat.scalar(entry.block, 'armor_damage'), componentScope) : null,
        shieldDamage: isCraft ? resolve(SaveFormat.scalar(entry.block, 'shield_damage'), componentScope) : null,
        armorPenetration: isCraft ? resolve(SaveFormat.scalar(entry.block, 'armor_penetration'), componentScope) : null,
        shieldPenetration: isCraft ? resolve(SaveFormat.scalar(entry.block, 'shield_penetration'), componentScope) : null,
        engagementRange: isCraft ? resolve(SaveFormat.scalar(entry.block, 'engagement_range'), componentScope) : null
      });
    }
    for (const text of csv) {
      const lines = text.split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('#'));
      const header = lines.shift()?.split(';') || [];
      for (const line of lines) {
        const cells = line.split(';');
        const fields = Object.fromEntries(header.map((key, i) => [key, numeric(cells[i])]));
        weapons.set(cells[0], fields);
      }
    }
    return { components, sections, slots, weapons, hullSpeeds, speedScale, sectionLayouts };
  }
  function initialize(sources, csv) { catalog = parse(sources, csv); return catalog; }
  async function load() {
    if (catalog) return catalog;
    if (!pending) pending = (async () => {
      async function read(path) { const response = await fetch(path); if (!response.ok) throw new Error(`Combat definitions unavailable: ${path}`); return response.text(); }
      const manifest = JSON.parse(await read('combat-files.json')), sources = {};
      const jobs = Object.entries(manifest).flatMap(([kind, paths]) => { sources[kind] = new Array(paths.length); return paths.map((path, index) => ({kind, path, index})); });
      let next = 0;
      await Promise.all(Array.from({length: 8}, async () => { while (next < jobs.length) { const job = jobs[next++]; sources[job.kind][job.index] = await read(job.path); } }));
      const csv = await Promise.all(['weapon_components.csv', 'mutation_weapon_components.csv'].map(async file => {
        const path = `../common/component_templates/${file}`;
        const response = await fetch(path);
        if (response.status === 404 && file === 'mutation_weapon_components.csv') return '';
        if (!response.ok) throw new Error(`Combat definitions unavailable: ${path}`);
        return response.text();
      }));
      return initialize(sources, csv);
    })().catch(error => { pending = undefined; throw error; });
    return pending;
  }
  function equipment(text) {
    if (text === undefined) return null;
    const components = [], sections = [], layout = [];
    for (const field of SaveFormat.entries(text)) {
      if (field.key === 'required_component' && field.scalar) components.push(field.scalar);
      if (field.key !== 'section' || field.block === undefined) continue;
      sections.push(SaveFormat.scalar(field.block, 'template'));
      const section = {template: SaveFormat.scalar(field.block, 'template'), position: SaveFormat.scalar(field.block, 'slot'), components: []};
      layout.push(section);
      for (const component of SaveFormat.entries(field.block)) {
        if (component.key === 'component' && component.block !== undefined) {
          const key = SaveFormat.scalar(component.block, 'template');
          components.push(key);
          section.components.push({slot: SaveFormat.scalar(component.block, 'slot'), key});
        }
      }
    }
    return {components: components.filter(Boolean), sections, layout};
  }
  function summarize(fleet, data = catalog) {
    if (!data) throw new Error('Combat definitions are not loaded');
    const ships = fleet.ships || [], counts = new Map(), defense = {armor: [], shield: []}, protectionCounts = {armor: new Map(), shield: new Map()};
    const countMount = (map, component, splitSize = true) => {
      const size = splitSize ? component.size || 'unknown' : '', id = `${component.family}:${size}`;
      if (!map.has(id)) map.set(id, {key: component.family, size, count: 0});
      map.get(id).count++;
      return map.get(id);
    };
    const sortedMounts = map => [...map.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key) || a.size.localeCompare(b.size));
    let pdSlots = 0, pdUsed = 0, missingSections = 0, missingComponents = 0, fitted = 0, weaponCount = 0;
    const damage = {count: 0, armor: 0, shield: 0, armorBypass: 0, shieldBypass: 0};
    const ranges = [], hullCounts = new Map(), auxiliaryCounts = new Map();
    for (const ship of ships) {
      const hull = ship.size || 'unknown';
      hullCounts.set(hull, (hullCounts.get(hull) || 0) + 1);
      if (!ship.equipment) continue;
      fitted++;
      const shipWeapons = new Set();
      for (const section of ship.equipment.sections) {
        const entries = data.sections.get(section);
        if (!entries || entries.some(slot => !data.slots.has(slot))) { missingSections++; continue; }
        pdSlots += entries.filter(slot => data.slots.get(slot) === 'point_defence').length;
      }
      for (const key of ship.equipment.components) {
        const component = data.components.get(key);
        if (!component) { missingComponents++; continue; }
        if (component.protection) {
          defense[component.protection].push(component.tier);
          countMount(protectionCounts[component.protection], component, false);
        }
        if (component.size === 'aux' || component.size === 'auxiliary') {
          const auxiliary = countMount(auxiliaryCounts, {...component, size: 'auxiliary'});
          if (!shipWeapons.has(auxiliary)) {
            auxiliary.shipCount = (auxiliary.shipCount || 0) + 1;
            shipWeapons.add(auxiliary);
          }
        }
        if (!component.weapon) continue;
        weaponCount++;
        const mount = countMount(counts, component);
        if (!shipWeapons.has(mount)) {
          mount.shipCount = (mount.shipCount || 0) + 1;
          shipWeapons.add(mount);
        }
        if (component.size === 'point_defence') { pdUsed++; continue; }
        const csv = data.weapons.get(key);
        const stats = component.size === 'strike_craft' ? {
          armor_damage: csv?.armor_damage ?? component.armorDamage ?? 1,
          shield_damage: csv?.shield_damage ?? component.shieldDamage ?? 1,
          armor_penetration: csv?.armor_penetration ?? component.armorPenetration ?? 0,
          shield_penetration: csv?.shield_penetration ?? component.shieldPenetration ?? 0,
          range: component.engagementRange ?? csv?.range
        } : csv;
        if (stats?.range !== null && stats?.range !== undefined) ranges.push(stats.range);
        if (!stats || ['armor_damage', 'shield_damage', 'armor_penetration', 'shield_penetration'].some(field => stats[field] === null || stats[field] === undefined)) continue;
        damage.count++;
        damage.armor += stats.armor_damage; damage.shield += stats.shield_damage;
        damage.armorBypass += stats.armor_penetration; damage.shieldBypass += stats.shield_penetration;
      }
    }
    const speeds = data.speedScale ? ships.map(ship => Number.isFinite(ship.speed) && ship.speed >= 0 ? ship.speed / data.speedScale : null).filter(value => value !== null) : [];
    const equipmentSpeeds = ships.map(ship => equipmentSpeed(ship, data)).filter(value => value !== null);
    const commanders = [...new Map((fleet.commanders || []).map(leader => [leader.id, leader])).values()];
    const tier = values => {
      const known = values.filter(value => value !== null);
      return {count: values.length, known: known.length, average: known.length ? known.reduce((a, b) => a + b, 0) / known.length : null, min: known.length ? Math.min(...known) : null, max: known.length ? Math.max(...known) : null};
    };
    return {
      fitted, ships: ships.length, missingSections, missingComponents, weaponCount,
      hulls: [...hullCounts].map(([size, count]) => ({size, count})).sort((a, b) => b.count - a.count || a.size.localeCompare(b.size)),
      weapons: sortedMounts(counts).sort((a, b) => b.shipCount - a.shipCount || b.count - a.count || a.key.localeCompare(b.key) || a.size.localeCompare(b.size)),
      auxiliaries: sortedMounts(auxiliaryCounts),
      protectionComponents: {armor: sortedMounts(protectionCounts.armor), shield: sortedMounts(protectionCounts.shield)},
      pdSlots, pdUsed, damage,
      range: {count: ranges.length, mean: ranges.length ? ranges.reduce((a, b) => a + b, 0) / ranges.length : null, max: ranges.length ? Math.max(...ranges) : null, short: ranges.filter(value => value <= 40).length, medium: ranges.filter(value => value > 40 && value <= 80).length, long: ranges.filter(value => value > 80).length},
      commanders: tier(commanders.map(leader => leader.level)),
      speed: {count: speeds.length, min: speeds.length ? Math.min(...speeds) : null, max: speeds.length ? Math.max(...speeds) : null, mean: speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : null},
      equipmentSpeed: {count: equipmentSpeeds.length, min: equipmentSpeeds.length ? Math.min(...equipmentSpeeds) : null, max: equipmentSpeeds.length ? Math.max(...equipmentSpeeds) : null, mean: equipmentSpeeds.length ? equipmentSpeeds.reduce((a, b) => a + b, 0) / equipmentSpeeds.length : null},
      defense: {armor: tier(defense.armor), shield: tier(defense.shield), total: tier([...defense.armor, ...defense.shield])}
    };
  }
  function equipmentSpeed(ship, data) {
    const base = data.hullSpeeds?.get(ship.size);
    if (!Number.isFinite(base) || base < 0 || !ship.equipment) return null;
    let baseBonus = 0, multiplier = 0;
    for (const key of ship.equipment.components) {
      const component = data.components.get(key);
      if (!component || component.baseSpeedMult === null || component.speedMult === null) return null;
      baseBonus += component.baseSpeedMult;
      multiplier += component.speedMult;
    }
    return base * Math.max(0, 1 + baseBonus) * Math.max(0, 1 + multiplier);
  }
  function weaponIcon(family, size) {
    if (size === 'auxiliary') return [...catalog.components.values()].find(component => component.family === family && ['aux', 'auxiliary'].includes(component.size))?.icon;
    return [...catalog.components.values()].find(component => component.weapon && component.family === family && component.size === size)?.icon;
  }
  function defenseIcon(family, protection) {
    return [...catalog.components.values()].find(component => component.protection === protection && component.family === family)?.icon;
  }
  function biologicalSupportIcon(key) {
    const match = /^(?:BIO_)?(HEALING|CONFUSER|ANTI_EVASION|EVASION|ANTI_FIRE_RATE|FIRE_RATE)_GUN_(\d+)$/.exec(key || '');
    if (!match) return '';
    const names = {HEALING: 'bio_healing', CONFUSER: 'bio_confuser', ANTI_EVASION: 'bio_anti_evasion', EVASION: 'bio_evasion', ANTI_FIRE_RATE: 'bio_anti_fire_rate', FIRE_RATE: 'bio_fire_rate'};
    return `GFX_ship_part_${names[match[1]]}_${match[2]}`;
  }
  function sectionLayout(equipment) {
    return (equipment?.layout || []).map(section => {
      const definition = catalog.sectionLayouts.get(section.template);
      const used = new Set();
      const cells = (definition?.slots || []).map(slot => {
        const fitted = section.components.find(component => component.slot === slot.name);
        if (fitted) used.add(fitted);
        const component = catalog.components.get(fitted?.key);
        return {slot: slot.name, key: fitted?.key, size: component?.size || slot.size || 'unknown', icon: component?.icon || biologicalSupportIcon(fitted?.key)};
      });
      for (const fitted of section.components) {
        const component = catalog.components.get(fitted.key);
        if (!used.has(fitted) && component?.weapon) cells.push({slot: fitted.slot, key: fitted.key, size: component.size, icon: component.icon});
      }
      return {template: section.template, position: section.position || definition?.position || '', known: !!definition, cells};
    }).sort((a, b) => {
      const order = {bow: 0, mid: 1, core: 1, stern: 2};
      return (order[a.position] ?? 3) - (order[b.position] ?? 3);
    });
  }
  const api = {parse, initialize, load, equipment, summarize, equipmentSpeed, weaponIcon, defenseIcon, sectionLayout};
  root.CombatStats = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
