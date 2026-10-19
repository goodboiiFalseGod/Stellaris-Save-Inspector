'use strict';

const format = require('../save-format.js');
const INVALID = '4294967295';

// Эталон для диагностики RAM, никогда не источник данных живой карты.
function reference(text) {
  const table = (key, source = text) => new Map(format.entries(format.block(source, key)).filter(entry => /^\d+$/.test(entry.key) && entry.block !== undefined).map(entry => [entry.key, entry.block]));
  const countries = table('country'), fleets = table('fleet'), ships = table('ships'), bases = table('starbases', format.block(text, 'starbase_mgr')), systems = table('galactic_object');
  const owners = new Map();
  function collectFleetIds(block) {
    const ids = [];
    for (const entry of format.entries(block)) {
      if (entry.key === 'fleet' && /^\d+$/.test(entry.scalar)) ids.push(entry.scalar);
      if (entry.block !== undefined) ids.push(...collectFleetIds(entry.block));
    }
    return ids;
  }
  for (const [id, block] of countries) {
    for (const fleet of collectFleetIds(format.block(format.block(block, 'fleets_manager'), 'owned_fleets'))) {
      if (owners.has(fleet) && owners.get(fleet) !== id) throw new Error(`Флот ${fleet} принадлежит нескольким империям в эталоне.`);
      owners.set(fleet, id);
    }
  }
  const fleetData = [...fleets].map(([id, block]) => {
    const movement = format.block(block, 'movement_manager');
    const coordinate = format.block(movement, 'coordinate') || format.block(block, 'coordinate');
    return {id, ownerId: owners.get(id), nameKey: format.scalar(format.block(block, 'name'), 'key'), systemId: format.scalar(coordinate, 'origin'), shipIds: format.entries(format.block(block, 'ships')).map(entry => entry.scalar).filter(id => /^\d+$/.test(id) && id !== INVALID)};
  });
  const systemData = [...systems].map(([id, block]) => {
    const starbaseIds = format.entries(format.block(block, 'starbases')).map(entry => entry.scalar).filter(id => /^\d+$/.test(id) && id !== INVALID);
    // Владелец станции не обязательно владеет территорией (фауна, мародёры).
    const baseOwners = starbaseIds.map(base => {
      const station = format.scalar(bases.get(base) || '', 'station');
      const fleet = format.scalar(ships.get(station) || '', 'fleet');
      return {baseId: base, stationId: station, fleetId: fleet, countryId: owners.get(fleet)};
    });
    return {id, starClass: format.scalar(block, 'star_class'), starbaseIds, baseOwners};
  });
  return {systems: systemData, fleets: fleetData, countries: [...countries].map(([id, block]) => ({id, type: format.scalar(block, 'type'), nameKey: format.scalar(format.block(block, 'name'), 'key')}))};
}

module.exports = {reference};
