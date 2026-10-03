'use strict';

const MapThreats = (() => {
  function hostility(model, countryId, perspective) {
    if (!perspective || !countryId || countryId === perspective) return '';
    const theirs = model.relations?.[countryId] || {}, ours = model.relations?.[perspective] || {};
    const towardUs = theirs[perspective] || {}, towardThem = ours[countryId] || {};
    if (theirs.factionNeutral || ours.factionNeutral || towardUs.neutral || towardThem.neutral || towardUs.friendly || towardThem.friendly) return '';
    if ((model.wars || []).some(war => (war.attackers.includes(perspective) && war.defenders.includes(countryId)) || (war.defenders.includes(perspective) && war.attackers.includes(countryId)))) return 'war';
    if (towardUs.hostile === true || towardThem.hostile === true) return 'hostile';
    if (theirs.factionHostile && towardUs.hostile !== false && towardThem.hostile !== false) return 'hostile';
    if (towardThem.closedBorders || towardUs.closedBorders) return 'closed';
    return '';
  }
  function systems(model, perspective) {
    const result = new Map();
    if (!perspective) return result;
    const ensure = system => {
      if (!result.has(system.id)) result.set(system.id, {system, level: '', threats: [], potential: []});
      return result.get(system.id);
    };
    for (const system of model.systems || []) {
      const level = hostility(model, system.ownerId, perspective);
      if (level) ensure(system).level = level;
    }
    const seen = new Set();
    for (const marker of model.presence || [...(model.markers || []), ...(model.neutral || [])]) {
      if (marker.combatCapable === false) continue;
      const key = `${marker.country.id}:${marker.fleet.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const level = hostility(model, marker.country.id, perspective);
      if (level !== 'war' && level !== 'hostile') continue;
      const entry = ensure(marker.system);
      entry.threats.push(marker);
      entry.level = entry.level === 'war' || level === 'war' ? 'war' : 'hostile';
    }
    for (const marker of model.hiddenCutholoids || []) ensure(marker.system).potential.push(marker);
    return result;
  }
  function playerThreats(model) {
    const result = new Map();
    const players = (model.countries || []).filter(country => country.category === 'player');
    for (const player of players) {
      for (const [id, risk] of systems(model, player.id)) {
        const universal = risk.threats.filter(marker => model.relations?.[marker.country.id]?.factionHostile && players.every(other => ['hostile', 'war'].includes(hostility(model, marker.country.id, other.id))));
        if (!universal.length) continue;
        if (!result.has(id)) result.set(id, {system: risk.system, level: 'hostile', threats: [], potential: [], players: []});
        const entry = result.get(id);
        entry.players.push(player.id);
        for (const marker of universal) if (!entry.threats.some(other => other.country.id === marker.country.id && other.fleet.id === marker.fleet.id)) entry.threats.push(marker);
      }
    }
    return result;
  }
  return {hostility, systems, playerThreats};
})();
if (typeof module !== 'undefined') module.exports = MapThreats;
