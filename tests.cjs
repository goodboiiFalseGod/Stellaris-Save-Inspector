const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {gamePath} = require('./test-game-root.cjs');
const art = require('./game-art.js');
const mapLayout = require('./map-layout.js');
assert.notEqual(mapLayout.starColor('sc_b'), mapLayout.starColor('sc_m'));
assert.equal(mapLayout.starColor('sc_binary_2'), mapLayout.starColor('sc_b'));
const occupiedLabels = [{x: 40, y: 60, width: 40, height: 20}];
const placedLabel = mapLayout.placeLabel({x: 60, y: 50}, 40, 14, occupiedLabels, {width: 300, height: 200});
assert.equal(mapLayout.overlaps(placedLabel, occupiedLabels[0]), false);
assert.equal(occupiedLabels.length, 2);
const dxtFixture = new ArrayBuffer(144), dxtView = new DataView(dxtFixture);
dxtView.setUint32(0, 0x20534444, true);
dxtView.setUint32(12, 3, true);
dxtView.setUint32(16, 3, true);
dxtView.setUint32(80, 4, true);
dxtView.setUint32(84, 0x35545844, true);
dxtView.setUint8(128, 255);
dxtView.setUint16(136, 0xf800, true);
assert.deepEqual([...art.decodeDds(dxtFixture).data.slice(0, 4)], [255, 0, 0, 255]);
assert.equal(art.decodeDds(dxtFixture).data.length, 36);
assert.throws(() => art.decodeDds(dxtFixture.slice(0, 140)), /Truncated DXT5/);
dxtView.setUint8(128, 0);
dxtView.setUint8(129, 255);
dxtView.setUint8(130, 7);
assert.equal(art.decodeDds(dxtFixture).data[3], 255);
dxtView.setUint8(130, 6);
assert.equal(art.decodeDds(dxtFixture).data[3], 0);
const livingArmorBytes = fs.readFileSync(gamePath('gfx/interface/icons/ship_parts/ship_part_lm_armor_4.dds'));
const livingArmor = art.decodeDds(livingArmorBytes.buffer.slice(livingArmorBytes.byteOffset, livingArmorBytes.byteOffset + livingArmorBytes.byteLength));
assert.equal(livingArmor.width, 58);
assert.equal(livingArmor.height, 58);
assert.ok(livingArmor.data.some((value, index) => index % 4 === 3 && value > 0));
const economy = require('./economy.js');
const format = require('./save-format.js');
const english = require('./english.js');
const fleets = require('./fleets.js');
const combat = require('./combat-stats.js');
const combatSources = Object.fromEntries(Object.entries(require('./combat-files.json')).map(([key, files]) => [key, files.map(file => fs.readFileSync(gamePath(file), 'utf8'))]));
const combatCatalog = combat.initialize(combatSources, ['weapon_components.csv', 'mutation_weapon_components.csv'].map(file => fs.readFileSync(gamePath(`common/component_templates/${file}`), 'utf8')));
const fleetArt = require('./fleet-art.js');
const shipTypes = require('./ship-types.js');
shipTypes.initialize(require('./ship-size-files.json').map(file => fs.readFileSync(gamePath(file), 'utf8')));
for (const file of require('./english-files.json')) english.add(fs.readFileSync(gamePath(file), 'utf8'));

const node = { addEventListener() {} };
const document = { querySelector: () => node, querySelectorAll: () => [] };
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const core = new Function('document', 'window', script + '; return { parseCountries, parseGalaxy, readZipEntry, directValue, escapeHtml };')(document, { DecompressionStream });
const presentation = new Function('document', 'escapeHtml', fs.readFileSync(path.join(__dirname, 'presentation.js'), 'utf8') + '; return { filteredCountries, formatAmount, formatBalance, cardHtml, fleetDetailsHtml, fleetRosterHtml, shipTemplateHtml, conditionText, shipBarsHtml };')(document, core.escapeHtml);

assert.equal(english.name(`key="%ADJECTIVE%" variables={{key="adjective" value={key="format.species" variables={{key="This.GetSpeciesName" value={key="SPEC_Ikarzuri"}}}}}}`), 'Ikarzuri');
assert.equal(english.saved('adjective={key="Torrent" literal=yes} name={key="%ADJECTIVE%" variables={{key="nomadic_start" value={key="Nomadic"}} {key="This.GetSpeciesAdj" value={key="Torrent" literal=yes}} {key="nomadic" value={key="Starfarers"}}}}', 'name', { ADJ: 'Torrent', ADJECTIVE: 'Torrent' }), 'Nomadic Torrent Starfarers');
assert.equal(english.name(`
			key="%ADJ%"
			variables=
			{
				{
					key="1"
					value=
					{
						key="Nomadic"
						variables=
						{
							{
								key="1"
								value=
								{
									key="%ADJECTIVE%"
									variables=
									{
										{
											key="adjective"
											value=
											{
												key="SPEC_Torrent"
											}
										}
										{
											key="1"
											value=
											{
												key="Starfarers"
											}
										}
									}
								}
							}
						}
					}
				}
			}
`), 'Nomadic Torrent Starfarers');
assert.equal(english.name('key="my eXact <Fleet> & \\\"name\\\"" literal=yes'), 'my eXact <Fleet> & "name"');
assert.equal(english.saved('nested={name="Wrong"} name={key="EMPIRE_DESIGN_humans1"}'), 'United Nations of Earth');
assert.equal(english.expand('UNKNOWN_MOD_NAME'), 'UNKNOWN_MOD_NAME');
english.add(' TEST_ALIAS:0 "$TEST_TARGET$"\n TEST_TARGET:0 "§GResolved§!"\n TEST_CYCLE:0 "$TEST_CYCLE$"');
assert.equal(english.expand('TEST_ALIAS'), 'Resolved');
assert.match(english.expand('TEST_CYCLE'), /Unresolved/);
assert.equal(english.label('trait_robot_deviants'), 'Deviants');
assert.equal(english.name('key="TEST_TARGET" literal=yes'), 'TEST_TARGET');
const nomadicCountry = core.parseCountries('country={1={type=default is_nomadic=yes name="Nomad" graphical_culture=biogenesis_01 government={type=gov_neural_chorus authority=auth_machine_intelligence} founder_species_ref=3}} player={country=1} species_db={3={name="Nomad species" portrait="human"}}');
assert.equal(nomadicCountry[0].isNomadic, true);
assert.equal(nomadicCountry[0].portrait, 'human');
assert.equal(nomadicCountry[0].governmentId, 'gov_neural_chorus');
assert.equal(nomadicCountry[0].shipset, 'biogenesis_01');
assert.match(presentation.cardHtml({...nomadicCountry[0], fleetDetails: [], fleetPowerSummary: {missing: 0, known: 0}, fleetPower: 0}), /data-icon-kind="nomadic"/);
assert.match(presentation.cardHtml({...nomadicCountry[0], fleetDetails: [], fleetPowerSummary: {missing: 0, known: 0}, fleetPower: 0}), /data-icon-kind="government"/);
assert.match(presentation.cardHtml({...nomadicCountry[0], fleetDetails: [], fleetPowerSummary: {missing: 0, known: 0}, fleetPower: 0}), /data-icon-kind="bioShipset"/);
const wanderlustGalaxy = core.parseGalaxy('galactic_object={42={coordinate={x=15 y=-25} name="Wanderlust site" flags={ancient_wonders_system=1 visited_by_nomad7=1 visited_by_nomad12=1}}} country={7={fleets_manager={owned_fleets={}}}}', [{id: '7', category: 'player', isNomadic: true, name: 'Nomad Seven'}]);
assert.deepEqual(wanderlustGalaxy.pois[0].visitedBy, ['7', '12']);
assert.deepEqual(wanderlustGalaxy.wanderlustCountries.map(country => country.id), ['7']);
const cutholoidGalaxy = core.parseGalaxy('galactic_object={42={coordinate={x=15 y=-25} name="Ambush" flags={hidden_cutholoid=1}}} planets={planet={9={name="Sleeping horror" planet_class=pc_cutholoid coordinate={origin=42}} 10={planet_class=pc_asteroid coordinate={origin=42}}}}', []);
assert.equal(cutholoidGalaxy.hiddenCutholoids.length, 1);
assert.equal(cutholoidGalaxy.hiddenCutholoids[0].id, '9');
assert.equal(cutholoidGalaxy.hiddenCutholoids[0].system.id, '42');
assert.equal(format.block('nested={ships={999={}}} # ships={wrong}\n ships={1={name="a } # { b"}}', 'ships'), '1={name="a } # { b"}');

const fleetFixture = new Map([
  ['ship_design', '10={ship_size=corvette} 20={ship_size=battleship}'],
  ['ships', '1={ship_design=10 design_upgrade=20} 2={ship_design=10} 3={ship_design=20} 4={ship_design=20} 5={ship_design=20} 6={ship_design=999}'],
  ['fleet', '7={name={key="Fleet <One>" literal=yes} ships={1 2 1 3 4 5 6 99}} 8={name="Empty" ships={}}']
]);
const fixtureFleets = fleets.create(fleetFixture)('fleets_manager={owned_fleets={{fleet=7} {fleet=8} {fleet=7} {fleet=404}}}');
assert.equal(fixtureFleets.length, 3);
assert.equal(fixtureFleets[0].total, 7);
assert.deepEqual(fixtureFleets[0].composition, [{ size: 'battleship', count: 3 }, { size: 'corvette', count: 2 }, { size: 'unknown', count: 2 }]);
assert.equal(fixtureFleets[1].total, 0);
assert.equal(fixtureFleets[2].total, null);
assert.equal(fixtureFleets[2].missing, true);
assert.deepEqual(fleets.create(fleetFixture)('name="No fleets"'), []);
const fleetHtml = presentation.fleetDetailsHtml({ fleetDetails: fixtureFleets });
assert.match(fleetHtml, /Fleet &lt;One&gt;/);
assert.match(fleetHtml, /3 Battleships/);
assert.match(fleetHtml, /Unknown hull type/);
assert.match(fleetHtml, /Fleet data missing from save/);
assert.match(fleetHtml, /No ships/);
assert.doesNotMatch(fleetHtml, /class="ship-row"/);
assert.match(fleetHtml, /class="fleet-entry"/);
assert.match(fleetHtml, /Military Fleets/);
assert.match(presentation.fleetRosterHtml(fixtureFleets[2]), /Fleet data missing from save/);
assert.match(presentation.fleetRosterHtml(fixtureFleets[0]), /Ship data missing from save/);
assert.equal(presentation.conditionText({current: 150, max: 300}), '50%');
assert.equal(presentation.conditionText({current: 0, max: 100}), '0%');
assert.equal(presentation.conditionText({current: 0, max: 0}), 'N/A');
assert.equal(presentation.conditionText({current: 20, max: null}), '—');
assert.equal(presentation.conditionText(undefined), '—');
const damagedFleet = fleets.create(new Map([
  ['ship_design', '1={name={key="Lamprey II" literal=yes} ship_size=cruiser}'],
  ['ships', '1={name={key="<Ember>" literal=yes} ship_design=1 hitpoints=150 max_hitpoints=300 armor_hitpoints=0 max_armor_hitpoints=100 shield_hitpoints=0 max_shield_hitpoints=0}'],
  ['fleet', '1={name="Damaged fleet" ships={1} military_power=29300 movement_manager={coordinate={origin=0} target={coordinate={origin=99}}}}'],
  ['galactic_object', '0={name={key="Eye of Bal" literal=yes}} 99={name="Wrong destination"}']
]))('fleets_manager={owned_fleets={{fleet=1}}}')[0];
assert.equal(damagedFleet.system, 'Eye of Bal');
assert.equal(damagedFleet.power, 29300);
assert.deepEqual(damagedFleet.condition.hull, {current: 150, max: 300});
const damagedHtml = presentation.fleetRosterHtml(damagedFleet);
assert.match(damagedHtml, /&lt;Ember&gt;/);
assert.doesNotMatch(damagedHtml, /<Ember>/);
assert.match(damagedHtml, /Cruiser/);
assert.doesNotMatch(damagedHtml, /Lamprey II|Unknown design/);
assert.match(damagedHtml, /height:50%/);
assert.match(damagedHtml, /height:0%/);
assert.match(damagedHtml, /shield unavailable/);
assert.match(damagedHtml, /29.3K/);
assert.match(presentation.shipTemplateHtml(damagedFleet.ships[0]), /Lamprey II/);
assert.match(presentation.shipTemplateHtml({missing: true}), /Ship data missing from save/);
assert.deepEqual(fixtureFleets[0].condition.hull, {current: null, max: null});
assert.equal(fixtureFleets[0].power, null);
const excludedSizes = ['mining_station', 'research_station', 'starbase_waystation_1', 'starbase_waystation_3', 'military_station_small', 'military_station_large', 'defense_platform_synth_queen', 'starbase_outpost', 'orbital_ring_tier_1', 'logistic_ship', 'nomads_constructor', 'nomads_engineer_vessel', 'constructor', 'science', 'colonizer', 'sponsored_colonizer', 'lithoid_colonizer', 'guided_sapience_colonizer', 'transport', 'mod_colony_ship', 'mod_science_ship'];
for (const size of excludedSizes) assert.equal(shipTypes.isMilitary(size), false, size);
for (const size of ['corvette', 'frigate', 'cruiser', 'battleship', 'titan', 'juggernaut', 'paladin_ship', 'military_arkship_tier_1', 'military_arkship_champions_forge', 'science_arkship_tier_1', 'science_arkship_tier_2', 'science_arkship_tier_3', 'civilian_arkship_tier_1', 'civilian_arkship_tier_2', 'civilian_arkship_tier_3']) assert.equal(shipTypes.isMilitary(size), true, size);
assert.equal(shipTypes.isWaystation('starbase_waystation_1'), true);
assert.equal(shipTypes.isWaystation('starbase_waystation_3'), true);
assert.equal(shipTypes.isWaystation('corvette'), false);
const arkshipFleets = fleets.create(new Map([
  ['ship_design', '1={growth_stages={{ship_size=science_arkship_tier_3}}} 2={growth_stages={{ship_size=military_arkship_tier_3}}} 3={ship_size=science}'],
  ['ships', '1={ship_design_implementation={design=1 growth_stage=0}} 2={ship_design_implementation={design=2 growth_stage=0}} 3={ship_design=3}'],
  ['fleet', '1={name="Gift Mount Teeths" ships={1} military_power=41400} 2={ships={2} military_power=29300} 3={ships={3} military_power=500}']
]))('fleets_manager={owned_fleets={{fleet=1} {fleet=2} {fleet=3}}}');
assert.equal(arkshipFleets.length, 2);
assert.deepEqual(arkshipFleets[0].composition, [{size: 'science_arkship_tier_3', count: 1}]);
assert.equal(arkshipFleets[0].power, 41400);
assert.deepEqual(fleets.powerSummary(arkshipFleets), {total: 70700, known: 70700, missing: 0});
const civilianArkFleets = fleets.create(new Map([
  ['ship_design', '1={growth_stages={{ship_size=civilian_arkship_tier_3}}} 2={ship_size=colonizer}'],
  ['ships', '1={ship_design_implementation={design=1 growth_stage=0}} 2={ship_design=2}'],
  ['fleet', '1={ships={1} civilian=yes military_power=12000} 2={ships={2} civilian=yes military_power=300}']
]))('fleets_manager={owned_fleets={{fleet=1} {fleet=2}}}');
assert.equal(civilianArkFleets.length, 1);
assert.deepEqual(civilianArkFleets[0].composition, [{size: 'civilian_arkship_tier_3', count: 1}]);
assert.deepEqual(fleets.powerSummary(civilianArkFleets), {total: 12000, known: 12000, missing: 0});
const excludedTables = new Map([
  ['ship_design', excludedSizes.map((size, i) => `${i}={ship_size=${size}}`).join(' ')],
  ['ships', excludedSizes.map((_, i) => `${i}={ship_design=${i}}`).join(' ')],
  ['fleet', excludedSizes.map((_, i) => `${i}={ships={${i}} military_power=9000}`).join(' ')]
]);
assert.deepEqual(fleets.create(excludedTables)(`fleets_manager={owned_fleets={${excludedSizes.map((_, i) => `{fleet=${i}}`).join(' ')}}}`), []);
const mixedTables = new Map([
  ['ship_design', '1={ship_size=cruiser} 2={ship_size=constructor}'],
  ['ships', '1={ship_design=1 military_power=700} 2={ship_design=2 military_power=300} 3={ship_design=1}'],
  ['fleet', '1={ships={1 2} military_power=1000} 2={ships={3 2} military_power=2000} 3={ships={1} civilian=yes military_power=9000} 4={ships={1} station=yes military_power=9000}']
]);
const mixedFleets = fleets.create(mixedTables)('fleets_manager={owned_fleets={{fleet=1} {fleet=2} {fleet=3} {fleet=4} {fleet=1}}}');
assert.equal(mixedFleets.length, 2);
assert.equal(mixedFleets[0].power, 700);
assert.equal(mixedFleets[0].total, 1);
assert.equal(mixedFleets[0].excludedShips, 1);
assert.deepEqual(mixedFleets[0].composition, [{size: 'cruiser', count: 1}]);
assert.equal(mixedFleets[1].power, null);
assert.match(presentation.fleetRosterHtml(mixedFleets[1]), /Military-only power is unavailable/);
assert.deepEqual(fleets.powerSummary(mixedFleets), {total: null, known: 700, missing: 1});
assert.deepEqual(fleets.powerSummary([]), {total: 0, known: 0, missing: 0});
assert.deepEqual(fleets.powerSummary([{kind: 'Military', power: 700}, {kind: 'Military', power: 300}, {kind: 'Station', power: 9000}]), {total: 1000, known: 1000, missing: 0});
const ranked = [null, 300, 0, 900, 300].map((power, i) => ({id: String(i), name: `Empire ${i}`, traits: [], category: 'player', fleetPower: power}));
assert.deepEqual(presentation.filteredCountries(ranked, ['player'], '', 'fleetPower').map(country => country.id), ['3', '1', '4', '2', '0']);
assert.match(html, /value="fleetPower">Highest fleet power/);
const powerCountries = core.parseCountries('country={1={type=default name="Rated" economy_power=933.64000 tech_power=407.50000} 2={type=default name="Unrated" modules={module={economy_power=555 tech_power=555}}}}');
assert.equal(powerCountries[0].economyPower, 933.64);
assert.equal(powerCountries[0].techPower, 407.5);
assert.equal(powerCountries[1].economyPower, null);
assert.equal(powerCountries[1].techPower, null);
const powerCard = presentation.cardHtml({...powerCountries[0], fleetDetails: [], fleetPowerSummary: {missing: 0, known: 0}, fleetPower: 0});
assert.match(powerCard, /data-icon-kind="empireStat" data-icon-id="planets"/);
assert.match(powerCard, /data-icon-kind="empireStat" data-icon-id="power"/);
assert.match(powerCard, /data-icon-kind="empireStat" data-icon-id="economy"/);
assert.match(powerCard, /data-icon-kind="empireStat" data-icon-id="tech"/);
assert.doesNotMatch(powerCard, /data-icon-id="fleets"/);
assert.doesNotMatch(powerCard, />Planets<|>Fleets<|>Economy<|>Technology<|>Fleet power</);
assert.match(powerCard, /Economic power: 933\.6/);
assert.match(powerCard, /Technological power: 407\.5/);
assert.match(presentation.cardHtml({...powerCountries[1], fleetDetails: [], fleetPowerSummary: {missing: 0, known: 0}, fleetPower: 0}), /Economic power is not stored in this save/);
const rankedPowers = [null, 300, 0, 900, 300].map((power, i) => ({id: String(i), name: `Empire ${i}`, traits: [], category: 'player', economyPower: power, techPower: power}));
assert.deepEqual(presentation.filteredCountries(rankedPowers, ['player'], '', 'economyPower').map(country => country.id), ['3', '1', '4', '2', '0']);
assert.deepEqual(presentation.filteredCountries(rankedPowers, ['player'], '', 'techPower').map(country => country.id), ['3', '1', '4', '2', '0']);
assert.match(html, /value="economyPower">Highest economic power/);
assert.match(html, /value="techPower">Highest technological power/);
const smallCatalog = combat.parse({
  defines: ['SHIP_SPEED_SCALE=1'],
  technologies: ['armor_tech={tier=2} shield_tech={tier=4}'],
  slots: ['pd_turret={size=point_defence}'],
  sections: ['ship_section_template={key=TEST_SECTION component_slot={template=pd_turret} component_slot={template=pd_turret}}'],
  components: ['weapon_component_template={key=LASER size=large component_set=LASERS} weapon_component_template={key=PD size=point_defence} utility_component_template={key=ARMOR modifier={ship_armor_add=100} prerequisites={armor_tech}} utility_component_template={key=SHIELD modifier={ship_shield_add=100} prerequisites={shield_tech}}']
}, ['key;armor_damage;shield_damage;armor_penetration;shield_penetration;range\nLASER;1.5;0.5;0;0;100']);
const smallSummary = combat.summarize({ships: [
  {speed: 4, equipment: {sections: ['TEST_SECTION'], components: ['LASER', 'LASER', 'PD', 'ARMOR']}},
  {speed: 8, equipment: {sections: ['TEST_SECTION'], components: ['LASER', 'SHIELD']}},
  {speed: null, equipment: null}
], commanders: [{id: '1', level: 2}, {id: '1', level: 2}, {id: '2', level: 4}]}, smallCatalog);
assert.deepEqual(smallSummary.weapons[0], {key: 'LASERS', size: 'large', count: 3, shipCount: 2});
const shipSorted = combat.summarize({ships: [
  {equipment: {sections: [], components: ['LASER', 'LASER', 'LASER', 'LASER', 'PD']}},
  {equipment: {sections: [], components: ['PD']}},
  {equipment: {sections: [], components: ['PD', 'PD']}}
]}, smallCatalog);
assert.deepEqual(shipSorted.weapons.map(mount => [mount.key, mount.shipCount, mount.count]), [['PD', 3, 4], ['LASERS', 1, 4]]);
assert.equal(smallSummary.pdSlots, 4);
assert.equal(smallSummary.pdUsed, 1);
assert.equal(smallSummary.damage.armor, 4.5);
assert.equal(smallSummary.damage.shield, 1.5);
assert.equal(smallSummary.range.long, 3);
assert.equal(smallSummary.range.mean, 100);
assert.equal(smallSummary.range.max, 100);
assert.equal(smallSummary.speed.mean, 6);
assert.equal(smallSummary.speed.count, 2);
assert.equal(smallSummary.defense.total.average, 3);
assert.equal(smallSummary.commanders.average, 3);
assert.equal(smallSummary.commanders.count, 2);
assert.equal(smallSummary.fitted, 2);
const hangarCatalog = combat.parse({components: ['@engagement_range=125 strike_craft_component_template={key=TEST_CRAFT size=LARGE component_set=TEST_WING armor_damage=1.5 shield_penetration=1.0 engagement_range=@engagement_range} weapon_component_template={key=TEST_GUN size=LARGE}']}, []);
const hangarStats = combat.summarize({ships: [{equipment: {sections: [], components: ['TEST_CRAFT', 'TEST_GUN']}}]}, hangarCatalog);
assert.equal(hangarStats.weapons.find(mount => mount.key === 'TEST_WING').size, 'strike_craft');
assert.equal(hangarStats.weapons.find(mount => mount.key === 'TEST_GUN').size, 'large');
assert.equal(hangarStats.range.count, 1);
assert.equal(hangarStats.range.mean, 125);
assert.equal(hangarStats.range.long, 1);
assert.equal(hangarStats.damage.count, 1);
assert.equal(hangarStats.damage.armor, 1.5);
assert.equal(hangarStats.damage.shield, 1);
assert.equal(hangarStats.damage.shieldBypass, 1);
assert.equal(hangarStats.damage.armorBypass, 0);
assert.equal(combatCatalog.components.get('STRIKE_CRAFT_HANGAR_1').engagementRange, 125);
assert.equal(combat.summarize({ships: [{equipment: {sections: [], components: ['STRIKE_CRAFT_HANGAR_1']}}]}).range.mean, 125);
const hullSummary = combat.summarize({ships: [{size: 'corvette'}, {size: 'cruiser'}, {size: 'corvette'}, {size: 'unknown'}, {}]});
assert.deepEqual(hullSummary.hulls, [{size: 'corvette', count: 2}, {size: 'unknown', count: 2}, {size: 'cruiser', count: 1}]);
assert.equal(hullSummary.hulls.reduce((total, hull) => total + hull.count, 0), hullSummary.ships);
assert.deepEqual(combat.summarize({ships: []}).hulls, []);
const equipmentFixture = {ships: [{equipment: {sections: [], components: [
  'SMALL_RED_LASER', 'MEDIUM_RED_LASER', 'LARGE_RED_LASER', 'LARGE_RED_LASER',
  ...Array(6).fill('MEDIUM_ARMOR_5'), ...Array(2).fill('MEDIUM_SHIELD_4')
]}}]};
const equipmentSummary = combat.summarize(equipmentFixture);
assert.deepEqual(equipmentSummary.weapons.map(mount => [mount.size, mount.count]), [['large', 2], ['medium', 1], ['small', 1]]);
assert.deepEqual(equipmentSummary.protectionComponents.armor, [{key: 'ARMOR_5', size: '', count: 6}]);
assert.deepEqual(equipmentSummary.protectionComponents.shield, [{key: 'SHIELD_4', size: '', count: 2}]);
const mixedDefense = combat.summarize({ships: [{equipment: {sections: [], components: ['SMALL_ARMOR_5', 'MEDIUM_ARMOR_5', 'LARGE_ARMOR_5', 'SMALL_SHIELD_4', 'LARGE_SHIELD_4']}}]});
assert.deepEqual(mixedDefense.protectionComponents.armor, [{key: 'ARMOR_5', size: '', count: 3}]);
assert.deepEqual(mixedDefense.protectionComponents.shield, [{key: 'SHIELD_4', size: '', count: 2}]);
assert.equal(combatCatalog.components.get('MEDIUM_BIO_ARMOR_4').protection, 'armor');
assert.equal(combatCatalog.components.get('MEDIUM_BIO_ARMOR_4').icon, 'GFX_ship_part_bio_armor_4');
assert.equal(combatCatalog.components.get('LARGE_BIO_LM_ARMOR_5').protection, 'armor');
const biologicalDefense = combat.summarize({ships: [{equipment: {sections: [], components: ['SMALL_BIO_ARMOR_4', 'MEDIUM_BIO_ARMOR_4', 'LARGE_BIO_LM_ARMOR_5']}}]});
assert.deepEqual(biologicalDefense.protectionComponents.armor, [{key: 'BIO_ARMOR_4', size: '', count: 2}, {key: 'BIO_LM_ARMOR_5', size: '', count: 1}]);
const summaryHtml = new Function('document', 'escapeHtml', fs.readFileSync(path.join(__dirname, 'presentation.js'), 'utf8') + '; return combatSummaryHtml;')(document, core.escapeHtml)(equipmentFixture);
assert.match(summaryHtml, /M · Medium/);
assert.match(summaryHtml, / · V · 6 installed components/);
assert.match(summaryHtml, / · IV · 2 installed components/);
assert.match(summaryHtml, /Armor &amp; shields · 8 components/);
assert.match(summaryHtml, /class="hp-breakdown"/);
assert.match(summaryHtml, /Ships by hull type · 1 total/);
assert.match(summaryHtml, /Penetration: armor/);
assert.match(summaryHtml, /Max 80/);
assert.match(summaryHtml, /class="weapon-tile" tabindex="0"/);
assert.match(summaryHtml, /class="weapon-overview"/);
assert.match(summaryHtml, /Used by 1 ships/);
assert.doesNotMatch(summaryHtml, /<h4>Point defense slots<\/h4>/);
assert.match(summaryHtml, /data-icon-kind="weapon"/);
const renderCombat = new Function('document', 'escapeHtml', fs.readFileSync(path.join(__dirname, 'presentation.js'), 'utf8') + '; return combatSummaryHtml;')(document, core.escapeHtml);
const sectionEquipment = combat.equipment('section={template="CRUISER_BOW_M1S2" slot="bow" component={slot="SMALL_GUN_01" template="SMALL_RED_LASER"}}');
const sectionLayout = combat.sectionLayout(sectionEquipment);
assert.equal(sectionLayout[0].cells.length, 3);
assert.equal(sectionLayout[0].cells.filter(cell => cell.key).length, 1);
assert.equal(sectionLayout[0].cells.find(cell => cell.slot === 'SMALL_GUN_01').key, 'SMALL_RED_LASER');
const renderSections = new Function('document', 'escapeHtml', fs.readFileSync(path.join(__dirname, 'presentation.js'), 'utf8') + '; return fleetSectionLayoutHtml;')(document, core.escapeHtml);
const sectionsHtml = renderSections({ships: [{size: 'cruiser', equipment: sectionEquipment}, {size: 'cruiser', equipment: sectionEquipment}]});
assert.equal((sectionsHtml.match(/class="section-loadout"/g) || []).length, 1);
assert.match(sectionsHtml, /2 ships/);
assert.match(sectionsHtml, /Empty slot/);
assert.match(sectionsHtml, /GFX_ship_part_laser_1/);
const variantEquipment = {...sectionEquipment, components: [...sectionEquipment.components, 'AFTERBURNER_2']};
const templateHtml = renderSections({ships: [{size: 'cruiser', equipment: variantEquipment}, {size: 'cruiser', equipment: sectionEquipment}, {size: 'cruiser', equipment: sectionEquipment}]});
assert.match(templateHtml, /2 templates/);
assert.ok(templateHtml.indexOf('2 ships') < templateHtml.indexOf('1 ships'));
assert.equal((templateHtml.match(/class="section-loadout"/g) || []).length, 2);
assert.match(templateHtml, /<strong>×1<\/strong>/);
assert.match(templateHtml, /installed components per ship/);
const repeatedEquipment = {...sectionEquipment, components: [...sectionEquipment.components, 'AFTERBURNER_2', 'AFTERBURNER_2', 'MEDIUM_ARMOR_5', 'MEDIUM_ARMOR_5']};
const compactTemplate = renderSections({ships: [{size: 'cruiser', equipment: repeatedEquipment}]});
assert.equal((compactTemplate.match(/data-icon-id="GFX_ship_part_afterburner_2"/g) || []).length, 1);
assert.equal((compactTemplate.match(/data-icon-id="GFX_ship_part_armor_5"/g) || []).length, 1);
assert.equal((compactTemplate.match(/<strong>×2<\/strong>/g) || []).length, 2);
assert.match(templateHtml, /GFX_ship_part_afterburner_2/);
const mixedTemplatesHtml = renderSections({ships: [
  {size: 'cruiser', equipment: sectionEquipment},
  {size: 'military_arkship_tier_1', equipment: sectionEquipment},
  {size: 'military_arkship_tier_1', equipment: variantEquipment},
  {size: 'military_arkship_tier_2', equipment: variantEquipment}
]});
assert.equal((mixedTemplatesHtml.match(/class="section-loadout"/g) || []).length, 1);
assert.equal((mixedTemplatesHtml.match(/class="arkship-components"/g) || []).length, 2);
assert.match(mixedTemplatesHtml, /Military Arkships I · 2 ships/);
assert.match(mixedTemplatesHtml, /Military Arkships II · 1 ships/);
assert.match(mixedTemplatesHtml, /<strong>×2<\/strong>/);
const auxiliaryFleet = {ships: [{size: 'cruiser', equipment: {sections: [], components: ['AFTERBURNER_2', 'AFTERBURNER_2']}}, {size: 'cruiser', equipment: {sections: [], components: ['AFTERBURNER_2']}}]};
const auxiliaryStats = combat.summarize(auxiliaryFleet);
assert.deepEqual(auxiliaryStats.auxiliaries, [{key: 'AFTERBURNER_2', size: 'auxiliary', count: 3, shipCount: 2}]);
assert.equal(auxiliaryStats.weaponCount, 0);
assert.equal(auxiliaryStats.range.count, 0);
assert.equal(auxiliaryStats.damage.count, 0);
const auxiliaryHtml = renderCombat(auxiliaryFleet);
assert.match(auxiliaryHtml, /GFX_ship_part_afterburner_2/);
assert.match(auxiliaryHtml, /class="weapon-size">A<\/span>/);
assert.match(auxiliaryHtml, /×3/);
const previewFleet = {...auxiliaryFleet, name: 'Preview', kind: 'Military', composition: [], condition: {}, power: 10};
const previewRoster = presentation.fleetRosterHtml(previewFleet);
assert.ok(previewRoster.indexOf('class="fleet-component-preview"') < previewRoster.indexOf('class="combat-summary"'));
const previewMarkup = previewRoster.split('<details class="combat-summary"')[0];
assert.match(previewMarkup, /GFX_ship_part_afterburner_2/);
assert.match(previewMarkup, /×3/);
assert.match(previewMarkup, /tabindex="0"/);
const hullWeaponsHtml = renderCombat({ships: [
  {size: 'cruiser', equipment: {sections: [], components: ['LARGE_RED_LASER', 'LARGE_RED_LASER']}},
  {size: 'corvette', equipment: {sections: [], components: ['SMALL_MASS_DRIVER_1']}}
]});
const weaponRows = [...hullWeaponsHtml.matchAll(/<div class="hull-weapons">([\s\S]*?)<\/div>/g)].map(match => match[1]);
assert.equal(weaponRows.length, 2);
const cruiserWeapons = weaponRows.find(row => row.includes('Cruisers'));
const corvetteWeapons = weaponRows.find(row => row.includes('Corvettes'));
assert.match(cruiserWeapons, /GFX_ship_part_laser_1/);
assert.match(cruiserWeapons, /×2/);
assert.doesNotMatch(corvetteWeapons, /GFX_ship_part_laser_1/);
assert.match(corvetteWeapons, /×1/);
english.add(' test_hull_a_plural:0 "Shared Hulls"\n test_hull_b_plural:0 "Shared Hulls"');
const groupedHullHtml = renderCombat({ships: [{size: 'test_hull_a'}, {size: 'test_hull_b'}, {size: 'test_hull_a'}]});
assert.equal((groupedHullHtml.match(/Shared Hulls/g) || []).length, 2);
assert.match(groupedHullHtml, /Shared Hulls<\/span><strong>×3/);
const arkTierHtml = renderCombat({ships: [
  {size: 'military_arkship_tier_1'}, {size: 'military_arkship_tier_2'},
  {size: 'military_arkship_tier_3'}, {size: 'military_arkship_champions_forge'},
  {size: 'science_arkship_tier_3'}, {size: 'civilian_arkship_tier_2'}
]});
assert.match(arkTierHtml, /Military Arkships I<\/span><strong>×1/);
assert.match(arkTierHtml, /Military Arkships II<\/span><strong>×1/);
assert.match(arkTierHtml, /Military Arkships III<\/span><strong>×2/);
assert.match(arkTierHtml, /Scientific Arkships III<\/span><strong>×1/);
assert.match(arkTierHtml, /Civilian Arkships II<\/span><strong>×1/);
const weaponIcons = require('./weapon-icons.json');
assert.equal(combat.weaponIcon('RED_LASER', 'small'), 'GFX_ship_part_laser_1');
const weaponBuffer = fs.readFileSync(gamePath(weaponIcons[combat.weaponIcon('RED_LASER', 'small')]));
const weaponImage = art.decodeDds(weaponBuffer.buffer.slice(weaponBuffer.byteOffset, weaponBuffer.byteOffset + weaponBuffer.byteLength));
assert.ok(weaponImage.width > 0);
assert.match(summaryHtml, /Unknown hull type/);
const defenseHtml = summaryHtml.match(/<section class="fitted-defense">[\s\S]*?<\/section>/)[0];
assert.match(defenseHtml, /class="hp-breakdown"/);
assert.match(defenseHtml, /Max HP order: Hull \/ Armor \/ Shields/);
assert.doesNotMatch(defenseHtml, /component-size|weapon-size/);
assert.equal((defenseHtml.match(/class="weapon-tile"/g) || []).length, 2);
assert.match(defenseHtml, /GFX_ship_part_armor_5/);
assert.match(defenseHtml, /GFX_ship_part_shield_4/);
assert.doesNotMatch(summaryHtml, /Defense technology tier|Overall 3/);
const missingSummary = combat.summarize({ships: [{equipment: {sections: ['MISSING'], components: ['UNKNOWN']}}]}, smallCatalog);
assert.equal(missingSummary.missingSections, 1);
assert.equal(missingSummary.missingComponents, 1);
assert.equal(missingSummary.speed.mean, null);
assert.equal(missingSummary.defense.total.average, null);
assert.equal(missingSummary.commanders.average, null);
const commanderFleet = fleets.create(new Map([
  ['ship_design', '1={ship_size=cruiser}'], ['ships', '1={ship_design=1 leader=7 speed=5} 2={ship_design=1 leader=7 speed=7}'],
  ['fleet', '1={ships={1 2} leader=7}'], ['leaders', '7={class=commander level=4 location={type=fleet id=1}} 8={class=scientist level=9 location={type=fleet id=1}}']
]))('fleets_manager={owned_fleets={{fleet=1}}}')[0];
assert.equal(commanderFleet.commanders.length, 1);
assert.equal(combat.summarize(commanderFleet).commanders.average, 4);
assert.ok(Math.abs(combat.summarize(commanderFleet).speed.mean - 6 / .045) < 1e-9);
const speedCatalog = combat.parse({
  defines: ['# SHIP_SPEED_SCALE=99\nSHIP_SPEED_SCALE=0.045'],
  variables: ['@cruiser_speed=120'], hulls: ['cruiser={max_speed=@cruiser_speed}'],
  components: ['utility_component_template={key=THRUSTER modifier={ship_base_speed_mult=0.75}} utility_component_template={key=AFTERBURNER modifier={ship_base_speed_mult=0.30}}']
}, []);
const speedShip = {size: 'cruiser', speed: 7.8, equipment: {sections: [], components: ['THRUSTER', 'AFTERBURNER', 'AFTERBURNER']}};
assert.equal(combat.equipmentSpeed(speedShip, speedCatalog), 282);
const speedSummary = combat.summarize({ships: [speedShip, {...speedShip, speed: 0}, {...speedShip, speed: null}]}, speedCatalog);
assert.equal(speedSummary.speed.count, 2);
assert.equal(speedSummary.speed.min, 0);
assert.ok(Math.abs(speedSummary.speed.max - 173.33333333333334) < 1e-9);
assert.equal(speedSummary.equipmentSpeed.mean, 282);
assert.equal(speedSummary.equipmentSpeed.count, 3);
assert.equal(combat.equipmentSpeed({...speedShip, equipment: null}, speedCatalog), null);
assert.equal(combat.equipmentSpeed({...speedShip, size: 'unknown'}, speedCatalog), null);
assert.equal(combat.equipmentSpeed({...speedShip, equipment: {components: ['MISSING']}}, speedCatalog), null);
assert.equal(combat.summarize({ships: [speedShip]}, combat.parse({}, [])).speed.mean, null);
const modernFleets = fleets.create(new Map([
  ['ship_design', '0={name="Hidden project" growth_stages={{ship_size=corvette} {ship_size=cruiser}}} 1={growth_stages={{ship_size=science}}} 2={ship_size=battleship}'],
  ['ships', '1={ship_design=2 ship_design_implementation={design=0 upgrade=2 growth_stage=0}} 2={ship_design_implementation={design=0 upgrade=2 growth_stage=1}} 3={ship_design_implementation={design=1 growth_stage=0}} 4={ship_design_implementation={design=0 growth_stage=99}}'],
  ['fleet', '1={ships={1 2 3 4}}']
]))('fleets_manager={owned_fleets={{fleet=1}}}')[0];
assert.deepEqual(modernFleets.ships.map(ship => ship.size), ['corvette', 'cruiser', 'unknown']);
assert.equal(modernFleets.excludedShips, 1);
assert.doesNotMatch(presentation.fleetRosterHtml(modernFleets), /Hidden project|Unknown design/);
assert.match(presentation.fleetDetailsHtml({ fleetDetails: [] }), /No military fleets/);

function texture(relative) {
  const bytes = fs.readFileSync(gamePath(relative));
  return art.decodeDds(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}
const cutholoidIcon = texture('gfx/interface/icons/concepts/planet_classes/pc_asteroid.dds');
assert.ok(cutholoidIcon.width > 0 && cutholoidIcon.height > 0);

(async () => {
  const file = fs.readFileSync(gamePath('curated_save_games/tutorial.sav'));
  const data = await core.readZipEntry(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), 'gamestate');
  const countries = core.parseCountries(new TextDecoder().decode(data));
  const galaxy = core.parseGalaxy(new TextDecoder().decode(data), countries);
  assert.ok(galaxy.systems.length > 0);
  assert.ok(galaxy.systems.every(system => Number.isFinite(system.x) && Number.isFinite(system.y)));
  assert.ok(galaxy.systems.some(system => system.links.length > 0));
  assert.ok(galaxy.neutral.every(marker => !['player', 'ai'].includes(marker.country.category)));
  assert.ok(galaxy.neutral.every(marker => ['preftl', 'enclave', 'leviathan', 'other'].includes(marker.mapCategory)));
  assert.ok(galaxy.neutral.every(marker => galaxy.systems.some(system => system.id === marker.system.id)));
  assert.ok(galaxy.systems.some(system => system.ownerId));
  assert.ok(Array.isArray(galaxy.markers));
  assert.ok(Array.isArray(galaxy.pois));
  assert.ok(Array.isArray(galaxy.hiddenCutholoids));
  assert.ok(galaxy.pois.every(marker => marker.kind === 'wanderlust' && marker.system && marker.categories.length));
  assert.ok(galaxy.pois.every(marker => Array.isArray(marker.visitedBy)));
  assert.ok(galaxy.markers.some(marker => marker.kind === 'fleet' && marker.country.category === 'player'));
  assert.ok(galaxy.relations && galaxy.relations['0']);
  const counts = Object.fromEntries(['player', 'ai', 'preftl', 'enclave', 'other'].map(category => [category, countries.filter(country => country.category === category).length]));
  assert.deepEqual(counts, { player: 1, ai: 7, preftl: 9, enclave: 2, other: 13 });
  assert.equal(core.directValue('nested={ type="primitive" } type="default"', 'type'), 'default');
  const player = countries.find(country => country.id === '0');
  assert.equal(player.name, 'United Nations of Earth');
  assert.equal(countries.find(country => country.id === '6').name, 'Ikarzuri Commissariat');
  assert.equal(player.government, 'Representative Democracy');
  assert.equal(player.traits.find(trait => trait.kind === 'species').id, 'Human');
  assert.equal(player.fleets, 1);
  assert.equal(player.fleetDetails.length, 1);
  assert.equal(player.fleetPower, 107.58059);
  assert.equal(player.economyPower, 1);
  assert.equal(player.techPower, 255);
  const firstFleet = player.fleetDetails.find(fleet => fleet.id === '3');
  assert.equal(firstFleet.name, '1st Fleet');
  assert.equal(firstFleet.kind, 'Military');
  assert.equal(firstFleet.total, 3);
  const combatSummary = combat.summarize(firstFleet);
  assert.equal(combatSummary.fitted, 3);
  assert.equal(combatSummary.weaponCount, 9);
  assert.equal(combatSummary.pdSlots, 0);
  assert.equal(combatSummary.pdUsed, 0);
  assert.equal(combatSummary.damage.count, 9);
  assert.equal(combatSummary.defense.total.count, 9);
  console.log('Tutorial combat summary:', JSON.stringify(combatSummary));
  assert.equal(firstFleet.power, 107.58059);
  assert.equal(firstFleet.system, 'Sol');
  assert.equal(firstFleet.ships[0].name, 'UNS Bass');
  assert.equal(firstFleet.ships[0].designName, 'Cordelia');
  assert.deepEqual(firstFleet.condition.hull, {current: 900, max: 900});
  assert.deepEqual(firstFleet.condition.armor, {current: 150, max: 150});
  assert.deepEqual(firstFleet.condition.shield, {current: 300, max: 300});
  assert.deepEqual(firstFleet.composition, [{ size: 'corvette', count: 3 }]);
  assert.equal(player.fleetDetails.find(fleet => fleet.id === '0'), undefined);
  assert.equal(player.fleetDetails.find(fleet => fleet.id === '1'), undefined);
  assert.equal(fleets.compositionLabel('corvette', 3), 'Corvettes');
  assert.equal(fleets.compositionLabel('battleship', 1), 'Battleship');
  const card = presentation.cardHtml(player);
  assert.match(card, /<details class="fleet-details">/);
  assert.match(card, /1st Fleet/);
  assert.match(card, /3 Corvettes/);
  assert.doesNotMatch(card, /Utility Ships/);
  assert.doesNotMatch(card, />Stations</);
  assert.match(card, /Combined military fleet power: 107.6/);
  assert.match(card, /Economic power: 1/);
  assert.match(card, /Technological power: 255/);
  const roster = presentation.fleetRosterHtml(firstFleet);
  assert.match(roster, /UNS Bass/);
  assert.match(roster, /Corvette/);
  assert.match(roster, /<details class="ship-group">/);
  assert.doesNotMatch(roster, /<details class="ship-group" open>/);
  assert.match(roster, /data-ship-id="[^"]+"/);
  assert.doesNotMatch(roster, /Cordelia|Unknown design/);
  assert.match(roster, /height:100%/);
  assert.match(roster, /data-icon-kind="shipSilhouette"/);
  assert.equal((roster.match(/class="ship-row"/g) || []).length, 3);
  const bassTemplate = presentation.shipTemplateHtml(firstFleet.ships[0]);
  assert.match(bassTemplate, /Cordelia/);
  assert.match(bassTemplate, /class="section-loadout"/);
  assert.doesNotMatch(card, /ADJECTIVE/);
  const energy = player.resources.find(resource => resource.key === 'energy');
  assert.equal(energy.stockpile, 100);
  assert.ok(Math.abs(energy.balance - 124.33492) < .00001);
  assert.ok(Math.abs(energy.income - 164.85992) < .00001);
  assert.ok(Math.abs(energy.expenses - 40.525) < .00001);
  assert.equal(energy.stockpileSource, 'modules.standard_economy_module.resources');
  assert.equal(player.resources.find(resource => resource.key === 'unity').stockpile, 0);
  const physics = player.resources.find(resource => resource.key === 'physics_research');
  assert.ok(physics);
  assert.equal(physics.stockpile, 0);
  assert.ok(physics.balance !== null);
  assert.match(presentation.cardHtml(player), /data-icon-id="physics_research"/);
  assert.match(presentation.cardHtml(player), /data-icon-id="society_research"/);
  assert.match(presentation.cardHtml(player), /data-icon-id="engineering_research"/);
  assert.deepEqual(player.flag.colors, ['blue', 'black', 'null', 'null']);
  assert.equal(player.flag.backgroundFile, '00_solid.dds');
  assert.equal(player.flag.file, 'flag_human_9.dds');
  assert.equal(presentation.filteredCountries(countries, ['player'], '', 'name').length, 1);
  assert.equal(presentation.filteredCountries(countries, ['preftl', 'enclave'], '', 'name').length, 11);
  assert.equal(presentation.filteredCountries(countries, [], '', 'name').length, 0);
  assert.equal(presentation.filteredCountries(countries, ['player'], 'nomadic', 'name').length, 1);
  assert.equal(presentation.formatAmount('3635.07087'), '3,635.1');
  assert.equal(presentation.formatAmount('—'), '—');
  assert.equal(presentation.formatAmount(null), '—');
  assert.equal(presentation.formatBalance(57.94), '+57.9');
  assert.equal(presentation.formatBalance(-12.34), '−12.3');
  assert.equal(presentation.formatBalance(0), '+0');
  assert.equal(presentation.formatBalance(null), '—');

  const fixture = `
    name="braces { and } inside a name"
    budget={current_month={income={base={resources={energy=500}}} expenses={ships={energy=25}} balance={base={energy=500} ships={energy=-25}} extra_balance={energy=999}}}
    modules={standard_economy_module={resources={energy=3200 minerals=0}}}
  `;
  const sample = economy.read(fixture, ['energy', 'minerals']);
  assert.equal(sample[0].stockpile, 3200);
  assert.equal(sample[0].balance, 475);
  assert.equal(sample[1].stockpile, 0);
  assert.equal(sample[1].balance, 0);
  const science = economy.read('modules={standard_economy_module={resources={physics_research=12}}} budget={current_month={balance={physics_research=8.4} income={physics_research=8.4} expenses={}}}', ['physics_research'])[0];
  assert.equal(science.stockpile, 12);
  assert.equal(science.balance, 8.4);
  const negative = economy.read('resources={energy=90} budget={current_month={income={energy=5} expenses={ships={energy=9}}}}', ['energy'])[0];
  assert.equal(negative.stockpile, 90);
  assert.equal(negative.balance, -4);
  const absent = economy.read('nested={resources={energy=500}}', ['energy'])[0];
  assert.equal(absent.stockpile, null);
  assert.equal(absent.balance, null);
  const previous = economy.read('budget={last_month={balance={base={energy=-8}}}}', ['energy'])[0];
  assert.equal(previous.balance, -8);
  assert.equal(previous.month, 'last_month');
  const currentZero = economy.read('budget={current_month={balance={}} last_month={balance={energy=25}}}', ['energy'])[0];
  assert.equal(currentZero.balance, 0);
  assert.equal(currentZero.month, 'current_month');
  assert.throws(() => economy.read('resources={energy=oops}', ['energy']), /Invalid resource value/);

  const palette = art.parsePalette(fs.readFileSync(gamePath('flags/colors.txt'), 'utf8'));
  assert.deepEqual(palette.blue, [46, 63, 152]);
  assert.deepEqual(palette.map.blue, [46, 63, 153]);
  assert.deepEqual(palette.orange, [215, 100, 35]);
  assert.deepEqual(palette.map.orange, [237, 118, 25]);
  assert.deepEqual(palette.map.dark_brown, [107, 68, 40]);
  const frame = texture('gfx/interface/flags/empire_flag_64_frame.dds');
  const mask = texture('gfx/interface/flags/empire_flag_64_mask.dds');
  const background = texture('flags/backgrounds/00_solid.dds');
  const symbol = texture('flags/human/flag_human_9.dds');
  assert.equal(background.width, 400);
  assert.equal(background.data[3], 255);
  const flag = art.composeFlag(frame, mask, background, symbol, [palette.blue, palette.black, palette.null]);
  assert.equal(flag.width, 70);
  assert.equal(flag.height, 70);
  assert.ok(flag.data.some((value, index) => index % 4 === 3 && value > 0));
  assert.equal(flag.data[3], 0);
  for (const resource of ['energy', 'minerals', 'food', 'alloys', 'consumer_goods', 'unity', 'influence', 'physics_research', 'society_research', 'engineering_research']) {
    const image = texture(`gfx/interface/icons/resources/${resource}.dds`);
    assert.ok(image.data.some((value, index) => index % 4 === 3 && value > 0), resource);
  }
  assert.throws(() => art.decodeDds(new ArrayBuffer(10)), /Invalid DDS/);
  const spriteDefs = fleetArt.definitions(require('./ship-size-files.json').map(file => fs.readFileSync(gamePath(file), 'utf8')), [fs.readFileSync(gamePath('interface/icons.gfx'), 'utf8'), fs.readFileSync(gamePath('interface/mutations.gfx'), 'utf8')]);
  assert.equal(spriteDefs.sizes.get('cruiser'), 'ship_size_military_4');
  const cruiserSprite = fleetArt.sprite(spriteDefs, 'GFX_ship_size_military_4');
  for (const tier of [1, 2]) {
    const afterburner = fleetArt.sprite(spriteDefs, `GFX_ship_part_afterburner_${tier}`);
    assert.equal(afterburner.path, `gfx/interface/icons/ship_parts/ship_part_afterburners_${tier}.dds`);
    const bytes = fs.readFileSync(gamePath(afterburner.path));
    const decoded = art.decodeDds(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    assert.ok(art.frame(decoded, afterburner.frame, afterburner.count).width > 0);
  }
  assert.equal(cruiserSprite.frame, 4);
  const mutationSprite = fleetArt.sprite(spriteDefs, 'GFX_mutation_shard_accelerator_1');
  assert.equal(mutationSprite.path, 'gfx/interface/icons/mutations/shard_accelerator_1.dds');
  assert.ok(art.frame(texture(mutationSprite.path), mutationSprite.frame, mutationSprite.count).width > 0);
  const bioSupportSprite = fleetArt.sprite(spriteDefs, 'GFX_ship_part_bio_fire_rate_1');
  assert.equal(bioSupportSprite.path, 'gfx/interface/icons/ship_parts/biogenesis/ship_part_bio_fire_rate_1.dds');
  const sizeSheet = texture(cruiserSprite.path);
  const cruiserIcon = art.frame(sizeSheet, cruiserSprite.frame, cruiserSprite.count);
  assert.equal(cruiserIcon.width, 30);
  assert.equal(cruiserIcon.height, 30);
  assert.ok(cruiserIcon.data.some((value, index) => index % 4 === 3 && value > 0));
  const cruiserTop = fleetArt.sprite(spriteDefs, 'GFX_ship_size_military_4_top');
  assert.equal(art.frame(texture(cruiserTop.path), cruiserTop.frame, cruiserTop.count).width, 80);
  assert.throws(() => art.frame(sizeSheet, 0, 29), /Invalid sprite frame/);
  assert.throws(() => art.frame(sizeSheet, 30, 29), /Invalid sprite frame/);
  for (const file of ['system/offensive_value.dds', 'icons/ship_stats/hit_points.dds', 'icons/ship_stats/armor.dds', 'icons/ship_stats/shield.dds', 'fleet_view/ship_entry_bg.dds', 'planetview/trade_value.dds', 'icons/research_icon.dds', 'icons/planet.dds']) {
    assert.ok(texture(`gfx/interface/${file}`).data.some((value, index) => index % 4 === 3 && value > 0), file);
  }
  console.log('PASS: fleet outliner/ship roster, ship names/designs, saved power/current system, damage bars, lazy markup, game sprite frames, English names, fleet ownership/composition, missing references, escaped HTML, tutorial ZIP, filters, flags, resource stockpile/net.');
  console.log(counts);
  if (process.argv[2]) {
    const actualFile = fs.readFileSync(process.argv[2]);
    const actualBytes = await core.readZipEntry(actualFile.buffer.slice(actualFile.byteOffset, actualFile.byteOffset + actualFile.byteLength), 'gamestate');
    const actualCountries = core.parseCountries(new TextDecoder().decode(actualBytes));
    const actualFleets = actualCountries.flatMap(country => country.fleetDetails);
    const target = actualFleets.find(fleet => fleet.name === 'Raucous Plunderers');
    const unknown = actualFleets.flatMap(fleet => fleet.ships).filter(ship => ship.size === 'unknown').length;
    console.log('Real save:', { fleets: actualFleets.length, unknownHulls: unknown, target: target && { name: target.name, composition: target.composition } });
    const actualSummary = combat.summarize({ships: actualFleets.flatMap(fleet => fleet.ships || []), commanders: actualFleets.flatMap(fleet => fleet.commanders || [])});
    console.log('Real save combat:', JSON.stringify(actualSummary));
    if (target) {
      assert.ok(target.ships.length > 0);
      assert.ok(target.ships.every(ship => ship.size !== 'unknown'));
      assert.doesNotMatch(presentation.fleetRosterHtml(target), /Unknown design|Unknown hull type/);
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
