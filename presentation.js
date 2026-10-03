'use strict';

let displayedCountries = [];
let viewRevision = 0;
const categoryLabels = { player: 'Player', ai: 'AI empire', preftl: 'Pre-FTL', enclave: 'Enclave', other: 'Other' };
const resourceLabels = { energy: 'Energy credits', minerals: 'Minerals', food: 'Food', alloys: 'Alloys', consumer_goods: 'Consumer goods', unity: 'Unity', influence: 'Influence', physics_research: 'Physics research', society_research: 'Society research', engineering_research: 'Engineering research' };
let palettePromise;
let originsPromise;

function resetView() {
  displayedCountries = [];
  viewRevision++;
  document.querySelector('#count').textContent = 'No save loaded';
  document.querySelector('#search').value = '';
  for (const element of document.querySelectorAll('[data-category-count]')) element.textContent = '0';
}

function renderEmpires(countries, info, fileName) {
  displayedCountries = countries;
  meta.textContent = `${info.name} · ${info.date}${info.version ? ` · ${info.version}` : ''}`;
  meta.title = fileName;
  for (const element of document.querySelectorAll('[data-category-count]')) {
    element.textContent = countries.filter(country => country.category === element.dataset.categoryCount).length;
  }
  refreshCards();
}

function filteredCountries(countries, categories, query, sort) {
  const search = query.trim().toLocaleLowerCase();
  return countries.filter(country => categories.includes(country.category) && (!search || [country.name, country.id, country.authority, country.type, ...country.traits.flatMap(trait => [trait.id, cleanLabel(trait.id)])].join(' ').replace(/_/g, ' ').toLocaleLowerCase().includes(search)))
    .sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : (b[sort] ?? -1) - (a[sort] ?? -1)) || Number(a.id) - Number(b.id));
}

function refreshCards() {
  const revision = ++viewRevision;
  const categories = [...document.querySelectorAll('.category-filters input:checked')].map(input => input.value);
  const countries = filteredCountries(displayedCountries, categories, document.querySelector('#search').value, document.querySelector('#sort').value);
  document.querySelector('#count').textContent = `${countries.length} / ${displayedCountries.length} countries`;
  empireList.innerHTML = countries.length ? countries.map(cardHtml).join('') : '<div class="empty">No countries match these filters.</div>';
  renderArtwork(countries, revision).catch(error => {
    console.error('Ошибка отображения игровых изображений:', error);
    if (revision === viewRevision) status.textContent = `Artwork error: ${error.message}`;
  });
}

function cleanLabel(value) {
  return English.label(value);
}

function chipHtml(trait) {
  const label = cleanLabel(trait.id);
  return `<span class="trait ${trait.kind === 'origin' ? 'origin' : ''}" title="${escapeHtml(`${label} (${trait.id})`)}"><span class="art-slot" data-icon-kind="${escapeHtml(trait.kind)}" data-icon-id="${escapeHtml(trait.id)}" aria-hidden="true">◇</span><span class="chip-label">${escapeHtml(label)}</span></span>`;
}

function formatAmount(value) {
  if (value === null || value === undefined || value === '—' || value === '' || !Number.isFinite(Number(value))) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(Number(value));
}

function formatBalance(value) {
  if (formatAmount(value) === '—') return '—';
  const rounded = Math.round(Number(value) * 10) / 10;
  return `${rounded < 0 ? '−' : '+'}${formatAmount(Math.abs(rounded))}`;
}

function formatStockpile(value) {
  if (formatAmount(value) === '—') return '—';
  return Math.abs(Number(value)) < 10000 ? formatAmount(value) : new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value));
}

function resourceHtml(resource) {
  const name = resourceLabels[resource.key];
  const period = resource.month === 'last_month' ? 'Last saved month' : 'Current saved month';
  const tooltip = `${name}\nStockpile: ${formatAmount(resource.stockpile)}\n${period}, net: ${formatBalance(resource.balance)}\nIncome: ${formatAmount(resource.income)}\nExpenses: ${formatAmount(resource.expenses)}\nStockpile source: ${resource.stockpileSource || 'not saved'}\nBalance source: ${resource.balanceSource || 'not saved'}`;
  const roundedBalance = Math.round(resource.balance * 10) / 10;
  const tone = resource.balance === null ? 'unknown' : roundedBalance > 0 ? 'positive' : roundedBalance < 0 ? 'negative' : 'neutral';
  return `<div class="resource" title="${escapeHtml(tooltip)}"><span class="art-slot" data-icon-kind="resource" data-icon-id="${resource.key}" role="img" aria-label="${name}">◇</span><span class="resource-values"><span class="stockpile" aria-label="Stockpile">${formatStockpile(resource.stockpile)}</span><span class="balance ${tone}" aria-label="Monthly net">${formatBalance(resource.balance)}</span></span></div>`;
}

function empireStatHtml(icon, value, tooltip) {
  return `<div class="stat" title="${escapeHtml(tooltip)}" aria-label="${escapeHtml(tooltip.split('\n')[0])}">${fleetIconHtml('empireStat', icon)}<strong>${formatStockpile(value)}</strong></div>`;
}

function cardHtml(country) {
  const civics = country.traits.filter(trait => ['origin', 'civic'].includes(trait.kind));
  const speciesTraits = country.traits.filter(trait => trait.kind === 'speciesTrait');
  const species = country.traits.find(trait => trait.kind === 'species');
  return `<article class="empire" data-country-id="${escapeHtml(country.id)}">
    <div class="empire-summary">
      <div class="crest" role="img" aria-label="Flag of ${escapeHtml(country.name)}"><span class="crest-placeholder">◇</span></div>
      <div class="identity"><h2>${escapeHtml(country.name)}${country.isNomadic ? `<span class="nomadic-mark" data-icon-kind="nomadic" data-icon-id="toggle_nomad" role="img" aria-label="Nomadic empire" title="Nomadic empire">◇</span>` : ''}${/^biogenesis_\d+$/.test(country.shipset || '') ? `<span class="shipset-mark" data-icon-kind="bioShipset" data-icon-id="${escapeHtml(country.shipset)}" role="img" aria-label="Biological shipset" title="Biological shipset: ${escapeHtml(country.shipset)}">◇</span>` : ''}</h2><div class="government"><span class="government-mark" data-icon-kind="government" data-icon-id="${escapeHtml(`${country.governmentId || ''}|${country.authorityId || 'unknown'}`)}" role="img" aria-label="${escapeHtml(country.government)}">◇</span>${escapeHtml(country.government)}</div>${species ? `<div class="species-name">${escapeHtml(species.id)}</div>` : ''}<div class="country-id">${categoryLabels[country.category]} · #${escapeHtml(country.id)}</div></div>
      <div class="stats">${empireStatHtml('planets', country.planets, `Owned planets: ${country.planets}`)}${empireStatHtml('economy', country.economyPower, country.economyPower === null || country.economyPower === undefined ? 'Economic power is not stored in this save (country economy_power)' : `Economic power: ${formatAmount(country.economyPower)}\nSaved as country economy_power`)}${empireStatHtml('tech', country.techPower, country.techPower === null || country.techPower === undefined ? 'Technological power is not stored in this save (country tech_power)' : `Technological power: ${formatAmount(country.techPower)}\nSaved as country tech_power`)}${empireStatHtml('power', country.fleetPower, country.fleetPowerSummary?.missing ? `Total unavailable: ${country.fleetPowerSummary.missing} fleet(s) with incomplete power data. Known subtotal: ${formatAmount(country.fleetPowerSummary.known)}` : `Combined military fleet power: ${formatAmount(country.fleetPower)}`)}</div>
      <div class="resources"><span class="section-label">Stockpile / monthly net</span><div class="resource-grid">${country.resources.map(resourceHtml).join('')}</div></div>
    </div>
    ${civics.length || speciesTraits.length ? `<div class="empire-details">${civics.length ? `<div class="detail-row"><span class="detail-label">Government</span><div class="chips">${civics.map(chipHtml).join('')}</div></div>` : ''}${speciesTraits.length ? `<div class="detail-row"><span class="detail-label">Species traits</span><div class="chips">${speciesTraits.map(chipHtml).join('')}</div></div>` : ''}</div>` : ''}
    ${fleetDetailsHtml(country)}
  </article>`;
}

function fleetDetailsHtml(country) {
  const fleets = country.fleetDetails || [];
  const groups = ['Military', 'Unavailable'];
  const labels = { Military: 'Military Fleets', Unavailable: 'Unavailable Fleets' };
  const totals = groups.map(kind => ({ kind, count: fleets.filter(fleet => fleet.kind === kind).length })).filter(group => group.count);
  const summary = totals.map(group => `${group.count} ${group.kind.toLowerCase()}${group.kind === 'Station' && group.count !== 1 ? 's' : ''}`).join(' · ');
  return `<details class="fleet-details"><summary>Fleet composition <span>${escapeHtml(summary || 'No military fleets')}</span></summary>${fleets.length ? combatSummaryHtml({ships: fleets.flatMap(fleet => fleet.ships || []), commanders: fleets.flatMap(fleet => fleet.commanders || [])}) : ''}<div class="fleet-list">${totals.length ? totals.map(group => `<section class="fleet-group"><h3>${labels[group.kind]}<span>${group.count}</span></h3>${fleets.filter(fleet => fleet.kind === group.kind).map(fleetEntryHtml).join('')}</section>`).join('') : '<p class="fleet-muted">This country has no military fleets.</p>'}</div></details>`;
}

function fleetIconHtml(kind, id, extraClass = '') {
  if (!id || id === 'unknown') return '<span class="art-slot" aria-hidden="true">?</span>';
  return `<span class="art-slot ${extraClass}" data-icon-kind="${escapeHtml(kind)}" data-icon-id="${escapeHtml(id)}" aria-hidden="true">◇</span>`;
}

function fleetEntryHtml(fleet) {
  const composition = fleet.composition.map(group => `${group.count} ${SaveFleets.compositionLabel(group.size, group.count)}`).join(', ');
  return `<details class="fleet-entry" data-fleet-id="${escapeHtml(fleet.id)}"><summary class="fleet-outliner-row" title="${escapeHtml(composition || (fleet.missing ? 'Fleet data missing from save' : 'No ships'))}">
    ${fleetIconHtml('shipSize', fleet.composition[0]?.size, 'fleet-type-icon')}
    <span class="fleet-outliner-name" title="${escapeHtml(fleet.name)}">${escapeHtml(fleet.name)}</span><span class="fleet-location" title="${escapeHtml(`Current system: ${fleet.system || 'unknown'}`)}">${escapeHtml(fleet.system || 'Unknown system')}</span>
    <span class="fleet-ship-count">${fleet.missing ? 'Data unavailable' : `${fleet.total} ${fleet.total === 1 ? 'ship' : 'ships'}`}</span><span class="fleet-power" title="Saved military power: ${formatAmount(fleet.power)}">${fleetIconHtml('fleetStat', 'power')}${formatStockpile(fleet.power)}</span><span class="fleet-chevron" aria-hidden="true">›</span>
    </summary><div class="fleet-panel"></div></details>`;
}

function conditionText(value) {
  if (!value || value.current === null || value.max === null) return '—';
  if (value.max === 0) return value.current === 0 ? 'N/A' : '—';
  return `${Math.round(value.current / value.max * 100)}%`;
}

function conditionTitle(label, value) {
  return `${label}: ${conditionText(value)} (${formatAmount(value?.current)} / ${formatAmount(value?.max)})`;
}

function shipBarsHtml(ship) {
  return `<span class="ship-condition-bars">${['hull', 'armor', 'shield'].map(key => {
    const value = ship.condition?.[key], known = value && value.current !== null && value.max !== null && value.max > 0;
    const percent = known ? Math.max(0, Math.min(100, value.current / value.max * 100)) : 0;
    const title = conditionTitle(key, value);
    return `<span class="ship-condition-bar ${key}${known ? '' : ' unavailable'}" role="img" aria-label="${escapeHtml(title)}" title="${escapeHtml(title)}"><span style="height:${percent}%"></span></span>`;
  }).join('')}</span>`;
}

function combatSummaryHtml(fleet) {
  const stats = CombatStats.summarize(fleet), d = stats.damage, r = stats.range;
  const ratio = (a, b) => a + b > 0 ? `${Math.round(a / (a + b) * 100)}% / ${Math.round(b / (a + b) * 100)}%` : '—';
  const ships = fleet.ships || [];
  const protectedShips = ships.filter(ship => ship.condition?.armor?.max !== null && ship.condition?.armor?.max !== undefined && ship.condition?.shield?.max !== null && ship.condition?.shield?.max !== undefined);
  const coveredShips = ships.filter(ship => ['hull', 'armor', 'shield'].every(key => ship.condition?.[key]?.max !== null && ship.condition?.[key]?.max !== undefined));
  const hull = ships.reduce((sum, ship) => sum + (Number.isFinite(ship.condition?.hull?.max) ? ship.condition.hull.max : 0), 0);
  const armor = protectedShips.reduce((sum, ship) => sum + ship.condition.armor.max, 0), shield = protectedShips.reduce((sum, ship) => sum + ship.condition.shield.max, 0);
  const sizes = {small: 'S · Small', medium: 'M · Medium', large: 'L · Large', extra_large: 'X · Extra large', titan: 'T · Titan', point_defence: 'P · Point defense', torpedo: 'G · Torpedo', guided: 'G · Guided', strike_craft: 'H · Hangar', planet_killer: 'W · Planet killer', auxiliary: 'A · Auxiliary'};
  const defenseTiles = (mounts, protection) => mounts.map(mount => {
    const mark = /^(?:ARMOR|SHIELD)_([1-5])$/.exec(mount.key);
    const suffix = mark ? ` · ${['', 'I', 'II', 'III', 'IV', 'V'][Number(mark[1])]}` : '';
    const description = `${English.label(mount.key)}${suffix} · ${mount.count} installed components · all sizes combined`;
    return `<li class="weapon-tile" tabindex="0" aria-label="${escapeHtml(description)}" title="${escapeHtml(description)}">${fleetIconHtml('weapon', CombatStats.defenseIcon(mount.key, protection))}<strong>×${mount.count}</strong><span class="weapon-tooltip">${escapeHtml(description)}</span></li>`;
  }).join('');
  const weaponTiles = mounts => mounts.map(mount => {
    const size = sizes[mount.size] || mount.size;
    const description = `${English.label(mount.key)} · ${size} · Used by ${mount.shipCount} ships · ${mount.count} installed mounts`;
    const icon = CombatStats.weaponIcon(mount.key, mount.size);
    return `<li class="weapon-tile" tabindex="0" aria-label="${escapeHtml(description)}" title="${escapeHtml(description)}">${fleetIconHtml('weapon', icon)}<span class="weapon-size">${escapeHtml(size.split(' · ')[0])}</span><strong>×${mount.count}</strong><span class="weapon-tooltip">${escapeHtml(description)}</span></li>`;
  }).join('');
  const hullGroups = new Map();
  for (const hull of stats.hulls) {
    const label = SaveFleets.compositionLabel(hull.size, 2);
    hullGroups.set(label, (hullGroups.get(label) || 0) + hull.count);
  }
  const hullList = [...hullGroups].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([label, count]) => `<li><span>${escapeHtml(label)}</span><strong>×${count}</strong></li>`).join('');
  const shipsByHull = new Map();
  for (const ship of ships) {
    const label = SaveFleets.compositionLabel(ship.size || 'unknown', 2);
    if (!shipsByHull.has(label)) shipsByHull.set(label, []);
    shipsByHull.get(label).push(ship);
  }
  const weaponGroups = [...shipsByHull].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).map(([label, group]) => {
    const groupStats = CombatStats.summarize({ships: group});
    return `<div class="hull-weapons"><h5>${escapeHtml(label)} · ${group.length} ships</h5><ul class="weapon-tiles">${weaponTiles([...groupStats.weapons, ...groupStats.auxiliaries]) || '<li>No known weapons or auxiliaries</li>'}</ul>${groupStats.missingComponents || groupStats.fitted < group.length ? `<small>Equipment known for ${groupStats.fitted}/${group.length} ships; ${groupStats.missingComponents} unresolved components.</small>` : ''}</div>`;
  }).join('');
  const damageLabel = !d.count ? 'Unknown' : Math.abs(d.armor - d.shield) < d.count * .1 ? 'Balanced' : d.armor > d.shield ? 'Anti-armor' : 'Anti-shield';
  const distance = !r.count ? 'Unknown' : r.short > r.count / 2 ? 'Close range' : r.long > r.count / 2 ? 'Long range' : r.medium > r.count / 2 ? 'Medium range' : 'Mixed range';
  return `<details class="combat-summary"><summary>Combat overview · ${stats.ships} ships</summary><div class="combat-grid">
    <section><h4>Ships by hull type · ${stats.ships} total</h4><ul class="component-mounts">${hullList || '<li>No ships</li>'}</ul><small>Combined hull counts for the included fleets; current hull types, not design names.</small></section>
    <section class="weapon-overview"><h4>Ship templates &amp; arkships</h4>${fleetSectionLayoutHtml(fleet) || weaponGroups || '<small>No ships</small>'}<small>Regular ships: templates, components per ship. Arkships: grouped by role and tier, total component counts.</small></section>
    <div class="combat-sidebar"><section><h4>Damage focus: ${damageLabel}</h4><strong>Armor ×${formatAmount(d.count ? d.armor / d.count : null)} · Shields ×${formatAmount(d.count ? d.shield / d.count : null)}</strong><small>Base per mount · ${d.count} covered · not DPS.</small><strong class="damage-penetration">Penetration: armor ${d.count ? Math.round(d.armorBypass / d.count * 100) + '%' : '—'} · shields ${d.count ? Math.round(d.shieldBypass / d.count * 100) + '%' : '—'}</strong></section>
    <section><h4>Engagement: ${distance}</h4><strong>Average range ${formatAmount(r.mean)} · Max ${formatAmount(r.max)}</strong><small>Close ≤40: ${r.short} · Medium 41–80: ${r.medium} · Long &gt;80: ${r.long} mounts. ${r.count} covered; PD excluded, hangars use engagement range.</small></section>
    <section><h4>Speed · equipment estimate</h4><strong>Avg ${formatAmount(stats.equipmentSpeed.mean)} · ${formatAmount(stats.equipmentSpeed.min)}–${formatAmount(stats.equipmentSpeed.max)}</strong><small tabindex="0" title="Hull + fitted speed modifiers. Excludes excess power, empire/commander/system bonuses and damage penalties; not the full in-game maximum.">${stats.equipmentSpeed.count}/${ships.length} ships · excludes external bonuses ⓘ</small><small tabindex="0" title="Saved movement converted to game speed units; may be below maximum while accelerating or in formation.">Movement: ${formatAmount(stats.speed.mean)} avg · ${formatAmount(stats.speed.min)}–${formatAmount(stats.speed.max)} (${stats.speed.count}/${ships.length}) ⓘ</small></section>
    <section class="fitted-defense"><h4>Armor &amp; shields · ${stats.defense.total.count} components</h4><div class="hp-breakdown" aria-label="Maximum hit points: hull, armor, shields"><span title="Hull maximum hit points">${fleetIconHtml('fleetStat', 'hull')}<strong>${formatAmount(hull)}</strong></span><span title="Armor maximum hit points">${fleetIconHtml('fleetStat', 'armor')}<strong>${formatAmount(armor)}</strong></span><span title="Shield maximum hit points">${fleetIconHtml('fleetStat', 'shield')}<strong>${formatAmount(shield)}</strong></span></div><small>Max HP order: Hull / Armor / Shields · ${coveredShips.length}/${ships.length} ships covered.</small><small>Armor · ${stats.defense.armor.count}</small><ul class="weapon-tiles">${defenseTiles(stats.protectionComponents.armor, 'armor') || '<li>No known armor components</li>'}</ul><small>Shields · ${stats.defense.shield.count}</small><ul class="weapon-tiles">${defenseTiles(stats.protectionComponents.shield, 'shield') || '<li>No known shield components</li>'}</ul><small>All slot sizes combined. Hover or focus for component details; unresolved equipment is not counted.</small></section>
    <section><h4>Assigned commanders</h4><strong>${stats.commanders.count ? `Avg level ${formatAmount(stats.commanders.average)}` : 'No assigned commander'}</strong><small>${stats.commanders.known}/${stats.commanders.count} levels known; unique commanders/admirals only.</small></section>
  </div></div><p class="combat-caveat">Equipment known for ${stats.fitted}/${stats.ships} ships; ${stats.missingComponents} unresolved components. Damage/range are base equipment estimates, without empire modifiers, combat-computer tactics, evasion or target size. Innate/mutation effects outside the saved design are not included.</p></details>`;
}

function fleetComponentPreviewHtml(fleet, perTemplate = false) {
  const stats = CombatStats.summarize(fleet);
  const sizes = {small: 'S', medium: 'M', large: 'L', extra_large: 'X', titan: 'T', point_defence: 'P', torpedo: 'G', guided: 'G', strike_craft: 'H', auxiliary: 'A'};
  const groups = [
    [perTemplate ? 'Auxiliaries' : 'Weapons & auxiliaries', [...(perTemplate ? [] : stats.weapons), ...stats.auxiliaries], null],
    ['Armor', stats.protectionComponents.armor, 'armor'],
    ['Shields', stats.protectionComponents.shield, 'shield']
  ];
  const content = groups.filter(([, mounts]) => mounts.length).map(([label, mounts, protection]) => {
    const tiles = mounts.map(mount => {
      const size = protection ? '' : sizes[mount.size] || mount.size;
      const description = `${English.label(mount.key)} · ${protection ? 'all sizes combined' : mount.size} · ${mount.count} installed components${perTemplate ? ' per ship' : ''}`;
      const icon = protection ? CombatStats.defenseIcon(mount.key, protection) : CombatStats.weaponIcon(mount.key, mount.size);
      return `<li class="weapon-tile" tabindex="0" title="${escapeHtml(description)}" aria-label="${escapeHtml(description)}">${fleetIconHtml('weapon', icon)}${size ? `<span class="weapon-size">${escapeHtml(size)}</span>` : ''}<strong>×${mount.count}</strong><span class="weapon-tooltip">${escapeHtml(description)}</span></li>`;
    }).join('');
    return `<div><h5>${escapeHtml(label)}</h5><ul class="weapon-tiles">${tiles}</ul></div>`;
  }).join('');
  return `<div class="fleet-component-preview" aria-label="Fleet components">${content || '<small>No known components</small>'}${stats.missingComponents || stats.fitted < stats.ships ? `<small>Equipment known for ${stats.fitted}/${stats.ships} ships; ${stats.missingComponents} unresolved components.</small>` : ''}</div>`;
}

function weaponSlotHtml(cell) {
  const badges = {small: 'S', medium: 'M', large: 'L', extra_large: 'X', titan: 'T', point_defence: 'P', torpedo: 'G', guided: 'G', strike_craft: 'H'};
  const description = `${cell.key ? English.label(cell.key) : 'Empty slot'} · ${cell.size} · ${cell.slot || 'Unknown slot'}`;
  return `<li class="weapon-tile section-slot" data-slot-size="${escapeHtml(cell.size)}" tabindex="0" title="${escapeHtml(description)}" aria-label="${escapeHtml(description)}">${cell.key ? fleetIconHtml('weapon', cell.icon) : ''}<span class="weapon-size">${escapeHtml(badges[cell.size] || '?')}</span><span class="weapon-tooltip">${escapeHtml(description)}</span></li>`;
}

function shipSectionsHtml(layout) {
  return `<div class="ship-sections">${layout.map(section => `<div class="ship-section"><h6 title="${escapeHtml(section.position)}">${escapeHtml(English.label(section.template || 'Unknown section'))}</h6><ul class="section-slots">${section.cells.map(weaponSlotHtml).join('') || '<li>No known weapon slots</li>'}</ul>${section.known ? '' : '<small>Section definition unavailable</small>'}</div>`).join('')}</div>`;
}

function sectionLoadoutHtml(heading, layout, sampleShip) {
  return `<div class="section-loadout"><h5>${escapeHtml(heading)}</h5>${shipSectionsHtml(layout)}${fleetComponentPreviewHtml({ships: [sampleShip]}, true)}</div>`;
}

function shipTemplateHtml(ship) {
  if (!ship || ship.missing) return '<p class="fleet-warning">Ship data missing from save</p>';
  const design = ship.designName || SaveFleets.compositionLabel(ship.size, 1);
  if (ShipTypes.isArkship(ship.size || '')) {
    return `<div class="ship-template-panel"><h5>${escapeHtml(design)}</h5>${fleetComponentPreviewHtml({ships: [ship]})}</div>`;
  }
  const layout = CombatStats.sectionLayout(ship.equipment);
  if (!layout.length) {
    return `<div class="ship-template-panel"><h5>${escapeHtml(design || 'Unknown template')}</h5>${ship.equipment ? fleetComponentPreviewHtml({ships: [ship]}, true) : '<p class="fleet-muted">No saved template for this ship.</p>'}</div>`;
  }
  return `<div class="ship-template-panel">${sectionLoadoutHtml(design, layout, ship)}</div>`;
}

function fleetSectionLayoutHtml(fleet) {
  const groups = new Map();
  const arks = new Map();
  for (const ship of fleet.ships || []) {
    if (ShipTypes.isArkship(ship.size || '')) {
      const label = SaveFleets.compositionLabel(ship.size, 2);
      if (!arks.has(label)) arks.set(label, []);
      arks.get(label).push(ship);
      continue;
    }
    const layout = CombatStats.sectionLayout(ship.equipment);
    if (!layout.length) continue;
    const placements = (ship.equipment.layout || []).map(section => [section.position, section.template, section.components.map(component => [component.slot, component.key]).sort()]).sort();
    const key = JSON.stringify([ship.size, placements, [...ship.equipment.components].sort()]);
    if (!groups.has(key)) groups.set(key, {size: ship.size, layout, ship, count: 0});
    groups.get(key).count++;
  }
  const arkHtml = [...arks].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).map(([label, ships]) => `<div class="arkship-components"><h5>${escapeHtml(label)} · ${ships.length} ships</h5>${fleetComponentPreviewHtml({ships})}</div>`).join('');
  if (!groups.size) return arkHtml;
  return `<div class="fleet-section-layout"><h4>${groups.size} templates · components per ship</h4>${[...groups.values()].sort((a, b) => b.count - a.count || (a.size || '').localeCompare(b.size || '')).map(group => sectionLoadoutHtml(`${SaveFleets.compositionLabel(group.size, group.count)} · ${group.count} ships`, group.layout, group.ship)).join('')}</div>${arkHtml}`;
}

function fleetRosterHtml(fleet) {
  if (fleet.missing) return '<p class="fleet-warning">Fleet data missing from save</p>';
  const condition = ['hull', 'armor', 'shield'].map(key => `<span class="fleet-condition ${key}" title="${escapeHtml(conditionTitle(key, fleet.condition?.[key]))}">${fleetIconHtml('fleetStat', key)}<span>${conditionText(fleet.condition?.[key])}</span></span>`).join('');
  const rows = fleet.composition.map(group => `<details class="ship-group"><summary>${fleetIconHtml('shipSilhouette', group.size, 'ship-silhouette')}<span>${escapeHtml(SaveFleets.compositionLabel(group.size, group.count))}</span><strong>${group.count}</strong></summary>${fleet.ships.filter(ship => ship.size === group.size).map(ship => {
    const hull = ship.missing ? 'Ship data missing from save' : SaveFleets.compositionLabel(ship.size, 1);
    return `<details class="ship-entry" data-ship-id="${escapeHtml(ship.id)}"><summary class="ship-row" title="${escapeHtml(`Ship #${ship.id}`)}">${shipBarsHtml(ship)}${fleetIconHtml('shipSize', ship.size)}<div class="ship-identity"><div class="ship-name" title="${escapeHtml(ship.name)}">${escapeHtml(ship.name)}</div><div class="ship-design${ship.missing || ship.size === 'unknown' ? ' fleet-warning' : ''}" title="${escapeHtml(hull)}">${escapeHtml(hull)}</div></div></summary><div class="ship-template"></div></details>`;
  }).join('')}</details>`).join('');
  return `<div class="fleet-banner"><div class="fleet-flag" aria-hidden="true"></div><div><h4>${escapeHtml(fleet.name)}</h4><span>${escapeHtml(fleet.kind)} · ${escapeHtml(fleet.system || 'Unknown system')}</span></div></div>
    ${fleetSectionLayoutHtml(fleet) || fleetComponentPreviewHtml(fleet)}${combatSummaryHtml(fleet)}<div class="fleet-condition-strip">${condition}<span class="fleet-power" title="Saved military power">${fleetIconHtml('fleetStat', 'power')}${formatStockpile(fleet.power)}</span></div>
    ${fleet.excludedShips ? `<p class="fleet-muted">${fleet.excludedShips} non-military ship(s) excluded.${fleet.power === null ? ' Military-only power is unavailable in this save.' : ''}</p>` : ''}<div class="ship-roster" aria-label="Ships in ${escapeHtml(fleet.name)}">${rows || '<p class="fleet-muted">No ships</p>'}</div>`;
}

function openShipTemplate(row) {
  if (!row.open || row.dataset.rendered) return;
  const country = displayedCountries.find(country => country.id === row.closest('.empire')?.dataset.countryId);
  const fleet = country?.fleetDetails.find(fleet => fleet.id === row.closest('.fleet-entry')?.dataset.fleetId);
  const ship = fleet?.ships.find(ship => ship.id === row.dataset.shipId);
  const panel = row.querySelector('.ship-template');
  if (!panel) return;
  panel.innerHTML = shipTemplateHtml(ship);
  row.dataset.rendered = 'true';
  const revision = viewRevision, jobs = [];
  appendIconJobs(panel, revision, jobs);
  runArtworkJobs(jobs, revision).catch(error => {
    console.error('Ошибка отображения шаблона корабля:', error);
    if (revision === viewRevision) status.textContent = `Artwork error: ${error.message}`;
  });
}

function openFleetDetails(event) {
  const details = event.target;
  if (details.matches('.ship-entry')) {
    openShipTemplate(details);
    return;
  }
  if (!details.matches('.fleet-entry') || !details.open || details.dataset.rendered) return;
  const country = displayedCountries.find(country => country.id === details.closest('.empire').dataset.countryId);
  const fleet = country?.fleetDetails.find(fleet => fleet.id === details.dataset.fleetId);
  if (!fleet) { console.warn('Не найден флот для раскрытия:', details.dataset.fleetId); return; }
  const panel = details.querySelector('.fleet-panel'), revision = viewRevision;
  panel.innerHTML = fleetRosterHtml(fleet);
  details.dataset.rendered = 'true';
  const jobs = [];
  appendIconJobs(panel, revision, jobs);
  if (!fleet.missing) {
    if (country.flag.file) jobs.push(async () => {
      const image = await flagImage(country.flag);
      if (revision === viewRevision) panel.querySelector('.fleet-flag').replaceChildren(GameArt.canvas(image));
    });
    jobs.push(async () => {
      const image = await GameArt.load('../gfx/interface/fleet_view/ship_entry_bg.dds');
      if (revision === viewRevision) panel.style.setProperty('--ship-row-texture', `url("${GameArt.canvas(image).toDataURL()}")`);
    });
  }
  runArtworkJobs(jobs, revision).catch(error => {
    console.error('Ошибка изображений флота:', error);
    if (revision === viewRevision) status.textContent = `Fleet artwork error: ${error.message}`;
  });
}

function palette() {
  if (!palettePromise) palettePromise = fetch('../flags/colors.txt').then(response => {
    if (!response.ok) throw new Error('Could not load flags/colors.txt');
    return response.text();
  }).then(GameArt.parsePalette);
  return palettePromise;
}

function originIcons() {
  if (!originsPromise) originsPromise = fetch('../common/governments/civics/00_origins.txt').then(response => {
    if (!response.ok) throw new Error('Could not load origin icon definitions');
    return response.text();
  }).then(text => {
    const result = {}, regex = /^(origin_\w+)\s*=\s*\{/gm;
    let match;
    while ((match = regex.exec(text))) {
      const block = blockFrom(text, regex.lastIndex - 1);
      if (!block) break;
      const icon = valueOf(block.content, 'icon');
      if (icon) result[match[1]] = `../${icon}`;
      regex.lastIndex = block.end;
    }
    return result;
  });
  return originsPromise;
}

function assetSegment(value) {
  if (!/^[\w .-]+$/.test(value) || value === '..') throw new Error('Invalid texture name');
  return encodeURIComponent(value);
}

async function flagImage(flag) {
  const [colors, frame, mask, background, symbol] = await Promise.all([
    palette(),
    GameArt.load('../gfx/interface/flags/empire_flag_64_frame.dds'),
    GameArt.load('../gfx/interface/flags/empire_flag_64_mask.dds'),
    GameArt.load(`../flags/${assetSegment(flag.backgroundCategory || 'backgrounds')}/${assetSegment(flag.backgroundFile || '00_solid.dds')}`),
    GameArt.load(`../flags/${assetSegment(flag.category)}/${assetSegment(flag.file)}`)
  ]);
  const colorValues = [0, 1, 2].map(index => {
    const key = flag.colors[index] || 'null';
    if (!colors[key]) throw new Error(`Unknown flag color: ${key}`);
    return colors[key];
  });
  return GameArt.composeFlag(frame, mask, background, symbol, colorValues);
}

let weaponIconsPromise;
let traitIconsPromise;

async function traitIconPath(id) {
  try {
    return await GameArt.load(`../gfx/interface/icons/traits/${assetSegment(id)}.dds`);
  } catch (_) {
    if (!traitIconsPromise) {
      const files = [
        '01_species_traits_habitability.txt', '02_species_traits_basic_characteristics.txt', '03_species_traits_presapients.txt',
        '04_species_traits.txt', '05_species_traits_robotic.txt', '06_distant_stars_traits.txt', '07_megacorp_traits.txt',
        '08_ancrel_traits.txt', '09_ascension_traits.txt', '09_tox_traits.txt', '10_species_traits_cyborg.txt',
        '11_first_contact_traits.txt', '12_astral_planes_traits.txt', '13_cosmic_storms_traits.txt', '13_machine_age_traits.txt',
        '14_grand_archive_traits.txt', '15_biogenesis_species_traits.txt', '15_extreme_frontiers_traits.txt',
        '15_strange_worlds_traits.txt', '15_unplugged_traits.txt', '16_infernals_traits.txt', '17_shroud_species_traits.txt',
        '18_nomads_species_traits.txt'
      ];
      traitIconsPromise = Promise.all(files.map(async file => {
        const response = await fetch(`../common/traits/${file}`);
        if (!response.ok) throw new Error(`Trait definitions unavailable: ${file}`);
        return response.text();
      })).then(sources => {
        const icons = new Map();
        for (const source of sources) {
          for (const entry of SaveFormat.entries(source)) {
            const icon = entry.block === undefined ? '' : SaveFormat.scalar(entry.block, 'icon');
            if (/^gfx\/interface\/icons\/traits\/[\w./-]+\.dds$/.test(icon)) icons.set(entry.key, `../${icon}`);
          }
        }
        return icons;
      }).catch(error => { traitIconsPromise = undefined; throw error; });
    }
    const path = (await traitIconsPromise).get(id);
    if (!path) throw new Error(`Trait icon unavailable: ${id}`);
    return GameArt.load(path);
  }
}

async function iconImage(kind, id) {
  if (kind === 'weapon') {
    if (!weaponIconsPromise) weaponIconsPromise = fetch('weapon-icons.json').then(response => {
      if (!response.ok) throw new Error('Weapon icon manifest unavailable');
      return response.json();
    }).catch(error => { weaponIconsPromise = undefined; throw error; });
    const path = (await weaponIconsPromise)[id];
    return FleetArt.loadComponent(id, path);
  }
  if (kind === 'shipSize' || kind === 'shipSilhouette') return FleetArt.load(id, kind === 'shipSilhouette');
  if (kind === 'fleetStat') {
    const paths = { power: 'system/offensive_value', hull: 'icons/ship_stats/hit_points', armor: 'icons/ship_stats/armor', shield: 'icons/ship_stats/shield' };
    if (!paths[id]) throw new Error(`Unknown fleet statistic: ${id}`);
    return GameArt.load(`../gfx/interface/${paths[id]}.dds`);
  }
  if (kind === 'empireStat') {
    // Иконки экрана дипломатии: GFX_planetview_trade_value и GFX_research_icon.
    const paths = { planets: 'icons/planet', power: 'system/offensive_value', economy: 'planetview/trade_value', tech: 'icons/research_icon' };
    if (!paths[id]) throw new Error(`Unknown empire statistic: ${id}`);
    return GameArt.load(`../gfx/interface/${paths[id]}.dds`);
  }
  if (kind === 'resource') return GameArt.load(`../gfx/interface/icons/resources/${assetSegment(id)}.dds`);
  if (kind === 'mapIcon') {
    if (id === 'leviathan') return GameArt.frame(await GameArt.load('../gfx/interface/icons/skulls.dds'), 2, 4);
    if (id === 'cutholoid') return GameArt.load('../gfx/interface/icons/concepts/planet_classes/pc_asteroid.dds');
    const icons = {
      wormhole: ['ship_classes', 12, 67], fleet: ['ship_icons_type', 1, 16], arkship: ['ship_icons_type_arkship', 1, 16],
      waystation: ['ship_classes', 65, 67], waystation2: ['ship_classes', 66, 67], waystation3: ['ship_classes', 67, 67],
      wanderlust: ['message/message_exploration_focus', 1, 1]
    };
    if (!icons[id]) throw new Error(`Unknown map icon: ${id}`);
    const [file, frame, count] = icons[id];
    return GameArt.frame(await GameArt.load(`../gfx/interface/icons/${file}.dds`), frame, count);
  }
  if (kind === 'nomadic' && id === 'toggle_nomad') return GameArt.load('../gfx/interface/icons/governments/nomad_toggle.dds');
  if (kind === 'government') {
    const [governmentId, authorityId] = String(id).split('|');
    const advancedAuthorityId = governmentId.replace(/^gov_/, 'auth_')
      .replace(/democracy/g, 'democratic')
      .replace(/oligarchy/g, 'oligarchic')
      .replace(/dictatorship/g, 'dictatorial')
      .replace(/monarchy/g, 'imperial');
    const candidates = [...new Set([advancedAuthorityId, authorityId].filter(candidate => /^auth_[\w.]+$/.test(candidate)))];
    for (const candidate of candidates) {
      try {
        return await GameArt.load(`../gfx/interface/icons/governments/authorities/${assetSegment(candidate)}.dds`);
      } catch (_) {
        // Встроенная иконка может отсутствовать у обычной формы правления.
      }
    }
    return GameArt.load('../gfx/interface/icons/governments/authorities/unknown.dds');
  }
  const key = assetSegment(id);
  if (kind === 'bioShipset') return GameArt.load('../gfx/interface/icons/dlc/biogenesis.dds');
  if (kind === 'authority') return GameArt.load(`../gfx/interface/icons/governments/authorities/${key}.dds`).catch(() => GameArt.load('../gfx/interface/icons/governments/authorities/unknown.dds'));
  if (kind === 'civic') return GameArt.load(`../gfx/interface/icons/governments/civics/${key}.dds`);
  if (kind === 'speciesTrait') return traitIconPath(id);
  if (kind === 'origin') {
    const icons = await originIcons();
    return GameArt.load(icons[id] || `../gfx/interface/icons/origins/${key}.dds`);
  }
  throw new Error(`Unknown icon category: ${kind}`);
}

async function renderArtwork(countries, revision) {
  const jobs = [];
  const cards = [...empireList.querySelectorAll('.empire')];
  for (let index = 0; index < cards.length; index++) {
    const country = countries[index], crest = cards[index].querySelector('.crest');
    if (country.flag.file) jobs.push(async () => {
      const image = await flagImage(country.flag);
      if (revision === viewRevision) crest.replaceChildren(GameArt.canvas(image));
    });
  }
  appendIconJobs(empireList, revision, jobs);
  await runArtworkJobs(jobs, revision);
}

function renderMapArtwork() {
  const jobs = [];
  appendIconJobs(document.querySelector('.galaxy-map-panel'), viewRevision, jobs);
  return runArtworkJobs(jobs, viewRevision);
}

function appendIconJobs(container, revision, jobs) {
  for (const slot of container.querySelectorAll('[data-icon-kind]')) {
    jobs.push(async () => {
      try {
        const image = await iconImage(slot.dataset.iconKind, slot.dataset.iconId);
        if (revision === viewRevision) slot.replaceChildren(GameArt.canvas(image));
      } catch (error) {
        slot.title = `Icon unavailable: ${slot.dataset.iconId}`;
        throw error;
      }
    });
  }
}

async function runArtworkJobs(jobs, revision) {
  const failures = new Set();
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(8, jobs.length) }, async () => {
    while (index < jobs.length && revision === viewRevision) {
      const job = jobs[index++];
      try { await job(); } catch (error) { failures.add(error.message); }
    }
  }));
  if (revision !== viewRevision) return;
  if (failures.size) {
    console.warn('Не удалось загрузить часть игровых изображений:', [...failures]);
    status.textContent = `Loaded locally · ${failures.size} unavailable textures (hover an icon for details)`;
  } else status.textContent = 'Loaded locally · Original Stellaris artwork';
}

document.querySelector('#search').addEventListener('input', refreshCards);
document.querySelector('#empires').addEventListener('toggle', openFleetDetails, true);
document.querySelector('#sort').addEventListener('change', refreshCards);
for (const input of document.querySelectorAll('.category-filters input')) input.addEventListener('change', refreshCards);
document.querySelector('#players-only').addEventListener('click', () => {
  for (const input of document.querySelectorAll('.category-filters input')) input.checked = input.value === 'player';
  refreshCards();
});
document.querySelector('#all-countries').addEventListener('click', () => {
  for (const input of document.querySelectorAll('.category-filters input')) input.checked = true;
  refreshCards();
});
document.querySelector('#tutorial').addEventListener('click', async () => {
  const revision = liveRevision;
  try {
    status.textContent = 'Reading bundled tutorial save…';
    const response = await fetch('../curated_save_games/tutorial.sav');
    if (!response.ok) throw new Error('Bundled tutorial save not found');
    const buffer = await response.arrayBuffer();
    const text = new TextDecoder().decode(await readZipEntry(buffer, 'gamestate'));
    const metadata = new TextDecoder().decode(await readZipEntry(buffer, 'meta'));
    status.textContent = 'Loading English game localization…';
    await Promise.all([English.load(), ShipTypes.load(), CombatStats.load()]);
    if (revision !== liveRevision) return;
    const countries = parseCountries(text);
    render(countries, parseGalaxy(text, countries), parseMetadata(metadata), 'tutorial.sav', text);
  } catch (error) {
    if (revision !== liveRevision) return;
    console.error('Ошибка чтения учебного сохранения:', error);
    status.textContent = error.message;
  }
});
