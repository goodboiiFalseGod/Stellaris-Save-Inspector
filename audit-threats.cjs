const fs = require('node:fs');
const format = require('./save-format.js');
const threats = require('./map-threats.js');
const script = fs.readFileSync(`${__dirname}/index.html`, 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const node = {addEventListener() {}};
const english = {saved: (block, key = 'name') => format.scalar(block, key) || format.scalar(format.block(block, key), 'key'), expand: key => key};
const core = new Function('document', 'window', 'SaveFormat', 'English', 'ShipTypes', script + ';return {readZipEntry, parseGalaxy};')({querySelector: () => node}, {DecompressionStream}, format, english, {isWaystation: () => false, isArkship: () => false});
(async () => {
  const bytes = fs.readFileSync(process.argv[2]);
  const text = new TextDecoder().decode(await core.readZipEntry(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'gamestate'));
  const tables = new Map(format.entries(text).filter(entry => entry.block !== undefined).map(entry => [entry.key, entry.block]));
  const blocks = new Map(format.entries(tables.get('country')).filter(entry => entry.block !== undefined).map(entry => [entry.key, entry.block]));
  const countries = [...blocks].map(([id, block]) => ({id, name: english.saved(block), type: format.scalar(block, 'type'), category: format.scalar(block, 'type') === 'default' ? 'ai' : 'other', fleetDetails: []}));
  const pov = countries.find(country => /maids/i.test(country.name)) || countries.find(country => country.id === process.argv[3]);
  if (!pov) throw new Error('Specify an empire ID as the third argument.');
  console.log('POV', pov);
  const galaxy = core.parseGalaxy(text, countries);
  console.log('POV faction', format.block(blocks.get(pov?.id), 'faction'));
  if (process.argv.includes('--capital')) {
    console.log('CAPITAL FIELDS', format.entries(blocks.get(pov.id)).filter(entry => /capital|nomad/.test(entry.key || '')));
    return;
  }
  for (const country of countries) {
    const faction = format.block(blocks.get(country.id), 'faction');
    const fleets = galaxy.presence.filter(marker => marker.country.id === country.id);
    if (country.type === 'default') continue;
    if (!/cloud|faction|amoeba|crystal|tiyanki|guardian/.test(country.type)) continue;
    console.log(JSON.stringify({id: country.id, name: country.name, type: country.type, faction, towardUs: galaxy.relations[country.id]?.[pov?.id], towardThem: galaxy.relations[pov?.id]?.[country.id], hostility: threats.hostility(galaxy, country.id, pov?.id), fleets: fleets.map(marker => ({id: marker.fleet.id, name: marker.fleet.name, system: marker.system.name, systemId: marker.system.id}))}));
  }
  console.log('Threat systems', threats.systems(galaxy, pov?.id).size);
  const risks = threats.systems(galaxy, pov?.id);
  for (const id of process.argv.includes('--verify-maids') ? ['129', '52', '140', '214', '274'] : []) {
    const risk = risks.get(id);
    if (!risk?.threats.length) throw new Error(`Expected hostile presence in system ${id}`);
    console.log('VERIFIED', id, risk.level, risk.threats.map(marker => marker.fleet.name));
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
