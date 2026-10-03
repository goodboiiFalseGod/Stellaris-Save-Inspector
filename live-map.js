'use strict';

const LiveMap = (() => {
  function model(snapshot, localize = key => key) {
    if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.systems) || !snapshot.systems.length) throw new Error('Неподдерживаемый снимок памяти.');
    if (snapshot.discoveryComplete !== true) throw new Error('Поиск памяти не завершён; частичная карта не будет показана.');
    if (snapshot.countries !== undefined && !Array.isArray(snapshot.countries)) throw new Error('Некорректный список империй.');
    const countryIds = new Set();
    const countries = (snapshot.countries || []).map(country => {
      const id = String(country.id);
      if (!/^\d+$/.test(id) || Number(id) >= 100000 || countryIds.has(id) || typeof country.name !== 'string' || country.name.length > 1024) throw new Error('Некорректная империя в снимке.');
      countryIds.add(id);
      let flag;
      if (country.flag !== undefined) {
        const source = country.flag;
        if (!source || typeof source.category !== 'string' || typeof source.file !== 'string' || !/^[a-zA-Z0-9_-]*$/.test(source.category) || !/^[a-zA-Z0-9_.-]*$/.test(source.file) || source.file.includes('..') || !Array.isArray(source.colors) || source.colors.length !== 6 || source.colors.some(key => typeof key !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(key))) throw new Error('Некорректный флаг империи.');
        flag = {category: source.category, file: source.file, colors: [...source.colors]};
      }
      return {id, name: country.name || `Империя #${id}`, type: country.type, flag};
    });
    const ids = new Set();
    const systems = snapshot.systems.map(system => {
      const id = String(system.id);
      if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || typeof system.nameKey !== 'string' || ids.has(id) || !Number.isFinite(system.x) || !Number.isFinite(system.y) || !Array.isArray(system.lanes) || system.lanes.some(lane => !/^\d+$/.test(String(lane.to)))) throw new Error('Некорректные системы в снимке.');
      ids.add(id);
      if (system.starClass !== undefined && !/^sc_[a-z0-9_]+$/.test(system.starClass)) throw new Error('Некорректный класс звезды.');
      if (system.baseOwnerId != null && (!/^\d+$/.test(String(system.baseOwnerId)) || Number(system.baseOwnerId) >= 100000)) throw new Error('Некорректный владелец базы.');
      if (system.starbaseIds !== undefined && (!Array.isArray(system.starbaseIds) || system.starbaseIds.some(base => !/^\d+$/.test(String(base)) || !Number.isSafeInteger(Number(base)) || Number(base) >= 4294967295))) throw new Error('Некорректные ссылки на базы.');
      return {id, name: localize(system.nameKey), x: system.x, y: system.y, starClass: system.starClass, baseOwnerId: system.baseOwnerId == null ? undefined : String(system.baseOwnerId), starbaseIds: system.starbaseIds?.map(String), links: system.lanes.map(lane => String(lane.to)), wormholes: [], flags: [], bodies: [], live: true};
    });
    if (systems.some(system => system.links.some(id => !ids.has(id)))) throw new Error('Снимок неполный: отсутствуют соседние системы.');
    if (snapshot.countries !== undefined && systems.some(system => system.baseOwnerId !== undefined && !countryIds.has(system.baseOwnerId))) throw new Error('Снимок неполный: отсутствует империя владельца базы.');
    if (snapshot.fleets !== undefined && !Array.isArray(snapshot.fleets)) throw new Error('Некорректный список флотов.');
    const byId = new Map(systems.map(system => [system.id, system])), byCountry = new Map(countries.map(country => [country.id, country]));
    const fleetIds = new Set();
    const markers = [];
    for (const source of snapshot.fleets || []) {
      const id = String(source.id), ownerId = String(source.ownerId), systemId = source.systemId == null ? null : String(source.systemId);
      if (!/^\d+$/.test(id) || Number(id) >= 1000000 || fleetIds.has(id) || !byCountry.has(ownerId) || typeof source.nameKey !== 'string' || !Array.isArray(source.shipIds) || source.shipIds.length > 16384 || source.shipIds.some(ship => !/^\d+$/.test(String(ship)) || Number(ship) >= 4294967295) || new Set(source.shipIds.map(String)).size !== source.shipIds.length) throw new Error('Некорректный флот в снимке.');
      fleetIds.add(id);
      if (systemId === null) continue;
      if (!byId.has(systemId)) throw new Error('Снимок неполный: отсутствует система флота.');
      markers.push({kind: 'fleet', system: byId.get(systemId), country: byCountry.get(ownerId), fleet: {id, name: localize(source.nameKey) || `Флот #${id}`, shipIds: source.shipIds.map(String), live: true}});
    }
    const borders = countries.length > 0 && countries.every(country => country.flag) && snapshot.systems.every(system => Object.hasOwn(system, 'baseOwnerId'));
    if (borders) for (const system of systems) system.ownerId = system.baseOwnerId;
    const sourceIdentity = [snapshot.processId, snapshot.processStartedAt, snapshot.buildHash, ...systems.map(system => `${system.id}:${system.x}:${system.y}`).sort()].join('|');
    return {systems, neutral: [], markers, presence: markers, pois: [], hiddenCutholoids: [], nomadStarts: [], capitalStarts: [], relations: {}, wars: [], countries, wanderlustCountries: [], live: true, sourceIdentity, liveCapabilities: {borders, fleets: snapshot.fleets !== undefined}, liveFleetCount: fleetIds.size};
  }
  return {model};
})();
if (typeof module !== 'undefined') module.exports = LiveMap;
