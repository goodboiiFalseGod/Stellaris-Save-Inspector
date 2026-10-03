'use strict';

(function (root) {
  function indexTable(text) {
    return new Map(SaveFormat.entries(text).filter(entry => entry.key && entry.block !== undefined).map(entry => [entry.key, entry.block]));
  }
  function ids(text) { return [...new Set(SaveFormat.entries(text).filter(entry => entry.key === undefined && /^\d+$/.test(entry.scalar)).map(entry => entry.scalar))]; }
  function number(value) {
    return value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  }
  function condition(fields, current, maximum) {
    return { current: number(fields.get(current)), max: number(fields.get(maximum)) };
  }
  function aggregate(ships, key) {
    const values = ships.map(ship => ship.condition?.[key]);
    const sum = field => values.length && values.every(value => value && value[field] !== null) ? values.reduce((total, value) => total + value[field], 0) : null;
    return { current: sum('current'), max: sum('max') };
  }
  function create(tables) {
    const designs = new Map([...indexTable(tables.get('ship_design') || '')].map(([id, text]) => [id, {
      size: SaveFormat.scalar(text, 'ship_size'), name: English.saved(text), equipment: CombatStats.equipment(text),
      stages: SaveFormat.entries(SaveFormat.block(text, 'growth_stages')).filter(entry => entry.block !== undefined).map(entry => ({size: SaveFormat.scalar(entry.block, 'ship_size'), equipment: CombatStats.equipment(entry.block)}))
    }]));
    const leaders = new Map([...indexTable(tables.get('leaders') || '')].map(([id, text]) => [id, {id, level: number(SaveFormat.scalar(text, 'level')), class: SaveFormat.scalar(text, 'class'), location: SaveFormat.block(text, 'location')} ]));
    const systems = new Map([...indexTable(tables.get('galactic_object') || '')].map(([id, text]) => [id, English.saved(text) || `System #${id}`]));
    const ships = new Map([...indexTable(tables.get('ships') || '')].map(([id, text]) => {
      const fields = new Map(SaveFormat.entries(text).filter(entry => entry.scalar !== undefined).map(entry => [entry.key, entry.scalar]));
      const implementation = SaveFormat.block(text, 'ship_design_implementation');
      const designId = implementation ? SaveFormat.scalar(implementation, 'design') : fields.get('ship_design');
      const design = designs.get(designId);
      const stageValue = SaveFormat.scalar(implementation, 'growth_stage');
      const stage = stageValue === '' ? (design?.stages.length === 1 ? 0 : null) : number(stageValue);
      const currentStage = Number.isInteger(stage) ? design?.stages[stage] : undefined;
      return [id, {
        id, name: English.saved(text) || `Ship #${id}`, size: currentStage?.size || design?.size || fields.get('ship_size') || 'unknown',
        equipment: design?.stages.length ? currentStage?.equipment : design?.equipment,
        speed: number(fields.get('speed')), leaderId: fields.get('leader'),
        designId, designName: design?.name || '', designMissing: !design,
        power: number(fields.get('military_power')),
        systemId: SaveFormat.scalar(SaveFormat.block(text, 'coordinate'), 'origin'),
        condition: { hull: condition(fields, 'hitpoints', 'max_hitpoints'), armor: condition(fields, 'armor_hitpoints', 'max_armor_hitpoints'), shield: condition(fields, 'shield_hitpoints', 'max_shield_hitpoints') }
      }];
    }));
    const fleets = indexTable(tables.get('fleet') || '');
    return country => {
      const manager = SaveFormat.block(country, 'fleets_manager');
      const owned = SaveFormat.block(manager || country, 'owned_fleets');
      const references = [...new Set(SaveFormat.entries(owned).map(entry => entry.block !== undefined ? SaveFormat.scalar(entry.block, 'fleet') : entry.key === 'fleet' ? entry.scalar : '').filter(Boolean))];
      return references.map(id => {
        if (!fleets.has(id)) return { id, name: `Fleet #${id}`, kind: 'Unavailable', total: null, composition: [], ships: [], power: null, system: '', condition: {}, missing: true };
        const text = fleets.get(id), members = ids(SaveFormat.block(text, 'ships')), counts = new Map();
        if (SaveFormat.scalar(text, 'station') === 'yes') return null;
        const civilian = SaveFormat.scalar(text, 'civilian') === 'yes';
        const roster = members.map(id => ships.get(id) || { id, name: `Ship #${id}`, size: 'unknown', designName: '', missing: true, power: null, condition: {} }).filter(ship => ShipTypes.isMilitary(ship.size) && (!civilian || ShipTypes.isArkship(ship.size)));
        if (civilian && !roster.length) return null;
        if (members.length && !roster.length) return null;
        const excludedShips = members.length - roster.length;
        for (const ship of roster) {
          counts.set(ship.size, (counts.get(ship.size) || 0) + 1);
        }
        const kind = 'Military';
        const coordinate = SaveFormat.block(SaveFormat.block(text, 'movement_manager'), 'coordinate') || SaveFormat.block(text, 'coordinate');
        const systemId = coordinate ? SaveFormat.scalar(coordinate, 'origin') : roster.find(ship => ship.systemId)?.systemId;
        const leaderIds = new Set([SaveFormat.scalar(text, 'leader'), ...roster.map(ship => ship.leaderId)].filter(value => value && value !== '4294967295'));
        for (const leader of leaders.values()) if (SaveFormat.scalar(leader.location, 'type') === 'fleet' && SaveFormat.scalar(leader.location, 'id') === id) leaderIds.add(leader.id);
        const commanders = [...leaderIds].map(id => leaders.get(id) || {id, level: null, class: ''}).filter(leader => !leader.class || ['admiral', 'commander'].includes(leader.class));
        return {
          id, name: English.saved(text) || `Fleet #${id}`, kind, total: roster.length, excludedShips, commanders,
          power: excludedShips ? (roster.every(ship => ship.power !== null) ? roster.reduce((sum, ship) => sum + ship.power, 0) : null) : number(SaveFormat.field(text, 'military_power')?.scalar), systemId,
          system: systems.get(systemId) || (systemId && systemId !== '4294967295' ? `System #${systemId}` : ''),
          condition: Object.fromEntries(['hull', 'armor', 'shield'].map(key => [key, aggregate(roster, key)])),
          ships: roster, composition: [...counts].map(([size, count]) => ({ size, count })).sort((a, b) => b.count - a.count || a.size.localeCompare(b.size))
        };
      }).filter(Boolean);
    };
  }
  function compositionLabel(size, count) {
    if (size === 'unknown') return 'Unknown hull type';
    const arkLabel = ShipTypes.arkHullLabel(size, count);
    if (arkLabel) return arkLabel;
    return English.label(count !== 1 && English.has(`${size}_plural`) ? `${size}_plural` : size);
  }
  function powerSummary(fleets) {
    const relevant = fleets.filter(fleet => fleet.kind === 'Military' || fleet.missing);
    const known = relevant.reduce((sum, fleet) => sum + (fleet.power ?? 0), 0);
    const missing = relevant.filter(fleet => fleet.power === null || fleet.power === undefined).length;
    return { total: missing ? null : known, known, missing };
  }
  const api = { create, compositionLabel, powerSummary };
  root.SaveFleets = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
