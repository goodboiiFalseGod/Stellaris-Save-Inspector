'use strict';

const SystemFinder = (() => {
  const files = ["common/planet_classes/06_planet_classes_nomads.txt","common/planet_classes/05_planet_classes_strange_worlds.txt","common/planet_classes/04_planet_classes_grand_archive.txt","common/planet_classes/03_planet_classes_events.txt","common/planet_classes/03_planet_classes_ancient_relics.txt","common/planet_classes/02_planet_classes_megacorp.txt","common/planet_classes/01_planet_classes_apocalypse.txt","common/planet_classes/00_planet_classes_leviathans.txt","common/planet_classes/00_planet_classes_first_contact_dlc.txt","common/planet_classes/00_planet_classes_distant_stars.txt","common/planet_classes/00_planet_classes_astral_planes_dlc.txt","common/planet_classes/00_planet_classes.txt","common/deposits/02_event_planetary_deposits.txt","common/deposits/01_planetary_deposits.txt","common/deposits/01_orbital_deposits.txt","common/deposits/01_blocker_deposits.txt","common/deposits/00_null_deposit.txt","common/deposits/04_distant_stars_deposits.txt","common/deposits/03_leviathans_deposits.txt","common/deposits/02_sr_deposits.txt","common/deposits/05_starting_deposits.txt","common/deposits/06_ancient_relics_deposits.txt","common/deposits/17_nomads_deposits.txt","common/deposits/16_extreme_frontiers_deposits.txt","common/deposits/15_strange_worlds_deposits.txt","common/deposits/15_shroud_deposits.txt","common/deposits/15_infernals_deposits.txt","common/deposits/15_biogenesis_deposits.txt","common/deposits/14_grand_archive_deposits.txt","common/deposits/13_machine_age_deposits.txt","common/deposits/12_wilderness_deposits.txt","common/deposits/12_cosmic_storms_deposits.txt","common/deposits/11_astral_planes_deposits.txt","common/deposits/10_paragon_deposits.txt","common/deposits/09_first_contact_deposits.txt","common/deposits/08_overlord_deposits.txt","common/deposits/07_federations_deposits.txt"];
  let rules, loading, model = {systems: [], countries: []};
  function initialize(texts, variablesText) {
    const variables = Object.fromEntries(SaveFormat.entries(variablesText).filter(e => e.scalar !== undefined).map(e => [e.key, Number(e.scalar)]));
    const deposits = new Map(), classes = new Map();
    for (const {path, text} of texts) for (const entry of SaveFormat.entries(text)) {
      if (!entry.block || !entry.key) continue;
      if (path.includes('/planet_classes/')) {
        classes.set(entry.key, {star: SaveFormat.scalar(entry.block, 'star') === 'yes', colonizable: SaveFormat.scalar(entry.block, 'colonizable') === 'yes'});
      } else {
        const output = {}, resources = SaveFormat.block(entry.block, 'resources');
        let uncertain = false;
        for (const production of SaveFormat.entries(resources).filter(e => e.key === 'produces' && e.block !== undefined)) {
          if (SaveFormat.block(production.block, 'trigger')) {uncertain = true; continue;}
          for (const resource of SaveFormat.entries(production.block)) {
            if (resource.scalar === undefined || !resource.key) continue;
            const value = resource.scalar.startsWith('@') ? variables[resource.scalar] : Number(resource.scalar);
            if (!Number.isFinite(value)) {uncertain = true; continue;}
            output[resource.key] = (output[resource.key] || 0) + value;
          }
        }
        deposits.set(entry.key, {station: SaveFormat.scalar(entry.block, 'station'), output, uncertain});
      }
    }
    const arc = variables['@arc_furnace_4_mod_value'], dyson = variables['@dyson_swarm_3_mod_value'];
    if (!Number.isFinite(arc) || !Number.isFinite(dyson)) throw new Error('Missing local production rules');
    rules = {deposits, classes, variables, arc: 1 + arc, dyson: 1 + dyson};
  }
  async function load() {
    if (rules) return;
    if (!loading) loading = (async () => {
      const read = async path => {const response = await fetch('../' + path); if (!response.ok) throw new Error('Cannot load ' + path); return response.text();};
      const [texts, variables] = await Promise.all([Promise.all(files.map(async path => ({path, text: await read(path)}))), read('common/scripted_variables/07_scripted_variables_machine_age.txt')]);
      initialize(texts, variables);
    })().catch(error => {loading = null; throw error;});
    await loading;
  }
  const add = (target, output, multiplier = 1) => {for (const [key, value] of Object.entries(output)) target[key] = (target[key] || 0) + value * multiplier;};
  function rank(galaxy, kind, options = {}) {
    if (!rules) throw new Error('Finder rules not loaded');
    const results = [];
    for (const system of galaxy.systems || []) {
      if (options.countryId && system.ownerId !== options.countryId) continue;
      const bodies = system.bodies || [];
      const info = body => ({...body, definition: rules.classes.get(body.planetClass), depositsInfo: (body.deposits || []).map(key => rules.deposits.get(key))});
      const eligibleTarget = body => !body.anomaly && !(body.flags || []).some(flag => ['megastructure', 'has_megastructure'].includes(flag));
      const megas = system.megastructures || [], flags = system.flags || [];
      if (kind === 'arc') {
        if (megas.some(type => /orbital_arc_furnace|dyson_sphere/.test(type)) || flags.some(flag => /arc_furnace_construction|dyson_sphere_construction/.test(flag))) continue;
        if (!bodies.some(body => body.planetClass === 'pc_molten' && eligibleTarget(body))) continue;
        const affected = bodies.map(info).filter(body => body.definition && !body.definition.star && !body.definition.colonizable && body.planetClass !== 'pc_astral_scar' && body.depositsInfo.every(deposit => deposit && deposit.station !== 'shipclass_research_station'));
        if (!affected.length) continue;
        const mode = options.mode || 'balanced', produced = {}, gain = {};
        const added = mode === 'minerals' ? {minerals: rules.variables['@arc_furnace_4_output_minerals_minerals']} : mode === 'alloys' ? {alloys: rules.variables['@arc_furnace_4_output_alloys_alloys']} : {minerals: rules.variables['@arc_furnace_4_output_balanced_minerals'], alloys: rules.variables['@arc_furnace_4_output_balanced_alloys']};
        if (Object.values(added).some(value => !Number.isFinite(value))) throw new Error('Missing furnace mode rules');
        let uncertain = false;
        for (const body of affected) {
          add(produced, added, rules.arc); add(gain, added, rules.arc);
          for (const deposit of body.depositsInfo) if (deposit.station === 'shipclass_mining_station') {
            if (deposit.output.trade) {add(gain, deposit.output, -1); continue;}
            add(produced, deposit.output, rules.arc); add(gain, deposit.output, rules.arc - 1); uncertain ||= deposit.uncertain;
          }
        }
        const upkeepMult = mode === 'balanced' ? 0 : rules.variables['@arc_furnace_' + mode + '_energy_upkeep_mult'];
        results.push({system, produced, gain, count: affected.length, uncertain, upkeep: {energy: rules.variables['@arc_furnace_4_upkeep_energy'] * (1 + upkeepMult)}, score: gain[mode === 'minerals' ? 'minerals' : 'alloys'] || 0});
      } else {
        const stars = bodies.map(info).filter(body => body.definition?.star);
        if (stars.length !== 1 || /binary|trinary|black_hole|neutron_star|pulsar/.test(system.starClass || '') || megas.some(type => /dyson_swarm|dyson_sphere/.test(type))) continue;
        const star = stars[0];
        if (!eligibleTarget(star) || /protostar|black_hole|neutron_star|pulsar/.test(star.planetClass) || (star.flags || []).includes('red_giant_unstable')) continue;
        if (star.depositsInfo.some(deposit => !deposit)) continue;
        const orbital = star.depositsInfo.filter(deposit => ['shipclass_mining_station', 'shipclass_research_station'].includes(deposit.station));
        const produced = {}, gain = {};
        for (const deposit of orbital) {add(produced, deposit.output, rules.dyson); add(gain, deposit.output, rules.dyson - 1);}
        const score = gain[options.resource || 'energy'] || 0;
        if (score > 0) results.push({system, produced, gain, uncertain: orbital.some(deposit => deposit.uncertain), upkeep: {alloys: 20}, score});
      }
    }
    return results.sort((a, b) => b.score - a.score || (b.gain.minerals || 0) - (a.gain.minerals || 0) || a.system.name.localeCompare(b.system.name));
  }
  function render(galaxy) {
    model = galaxy;
    if (typeof document === 'undefined') return;
    const select = document.querySelector('#finder-country'), previous = select.value;
    select.innerHTML = '<option value="">All systems</option>' + (model.countries || []).filter(country => country.isEmpire || country.category === 'player' || country.category === 'ai').map(country => '<option value="' + escapeHtml(country.id) + '">' + escapeHtml(country.name) + '</option>').join('');
    select.value = previous;
    if (document.querySelector('#system-finder').open) update();
  }
  async function update() {
    const results = document.querySelector('#finder-results');
    const kind = document.querySelector('#finder-kind').value;
    document.querySelector('#finder-mode').hidden = kind !== 'arc';
    document.querySelector('#finder-resource').hidden = kind === 'arc';
    results.textContent = 'Loading local game rules…';
    try {
      await load();
      const list = rank(model, document.querySelector('#finder-kind').value, {countryId: document.querySelector('#finder-country').value, mode: document.querySelector('#finder-mode').value, resource: document.querySelector('#finder-resource').value});
      const output = resources => Object.entries(resources).map(([key, value]) => (Math.round(value * 10) / 10).toLocaleString('en-US') + ' ' + (typeof English !== 'undefined' ? English.label(key) : key)).join(' · ');
      results.innerHTML = list.slice(0, 15).map((result, index) => '<button type="button" data-route-system="' + escapeHtml(result.system.id) + '"><strong>' + (index + 1) + '. ' + escapeHtml(result.system.name) + '</strong><span>~' + escapeHtml(output(result.produced)) + '/mo</span><small>Gain ~' + escapeHtml(output(result.gain)) + ' · upkeep ' + escapeHtml(output(result.upkeep)) + (result.count ? ' · ' + result.count + ' bodies' : '') + (result.uncertain ? ' · partial estimate' : '') + '</small></button>').join('') || 'No matching systems with known deposits.';
    } catch (error) {console.error('Ошибка Finder:', error); results.textContent = error.message;}
  }
  if (typeof document !== 'undefined') {
    document.querySelector('#system-finder').addEventListener('toggle', () => {if (document.querySelector('#system-finder').open) update();});
    for (const id of ['kind', 'country', 'mode', 'resource']) document.querySelector('#finder-' + id).addEventListener('change', update);
  }
  return {initialize, load, rank, render};
})();
if (typeof module !== 'undefined') module.exports = SystemFinder;
