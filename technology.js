'use strict';

// Планировщик намеренно не исполняет скрипты Paradox. Он вычисляет только явно
// распознанные триггеры и показывает unknown вместо выдуманной точности.
(function (root) {
  const AREAS = ['physics', 'society', 'engineering'];
  const PLAN_STORAGE_KEY = 'stellaris-save-inspector-tech-plan-v2';
  let definitions, categories = new Map(), immutableCivics = new Set(), scriptedVariables = new Map(), save, area = 'physics', selectedTarget = '', targets = new Set(), excludedTechs = new Set(), simulated = new Set(), simulatedLevels = new Map(), consumedOfferAreas = new Set(), history = [], loadRevision = 0, countryStateCache = new Map(), plannerCache = new Map(), impossibleCache = new Map(), tierCountCache = new WeakMap(), techScriptCache = new Map(), plannerBuilds = 0;

  function entries(text) {
    let i = 0;
    const skip = () => { while (i < text.length) { if (/\s/.test(text[i])) i++; else if (text[i] === '#') while (i < text.length && text[i++] !== '\n') {} else break; } };
    const value = () => {
      skip(); if (i >= text.length) return null;
      if (text[i] === '{') { const start = ++i; let depth = 1, quote = false; for (; i < text.length; i++) { const c = text[i]; if (quote && c === '\\') { i++; continue; } if (c === '"') quote = !quote; if (!quote && c === '{') depth++; if (!quote && c === '}' && --depth === 0) return {block: text.slice(start, i++)}; } return {block: text.slice(start)}; }
      if (text[i] === '"') { let out = ''; i++; while (i < text.length && text[i] !== '"') { out += text[i] === '\\' ? (text[++i] || '') : text[i]; i++; } i++; return {scalar: out}; }
      const start = i; while (i < text.length && !/[\s{}=]/.test(text[i])) i++; return {scalar: text.slice(start, i)};
    };
    const out = []; while (true) { const key = value(); if (!key) return out; skip(); if (key.scalar !== undefined && text[i] === '=') { i++; const item = value(); if (item) out.push({key: key.scalar, ...item}); } else out.push(key); }
  }
  function scalar(text, key) { const values = entries(text).filter(item => item.key === key && item.scalar !== undefined); return values.at(-1)?.scalar || ''; }
  function block(text, key) { return entries(text).find(item => item.key === key)?.block || ''; }
  function list(text) { return entries(text).flatMap(item => item.scalar !== undefined ? [item.scalar] : []); }
  function number(text, key, fallback) { const value = Number(scalar(text, key)); return Number.isFinite(value) ? value : fallback; }
  function parseDefinitions(files, tierText) {
    const byId = new Map();
    for (const file of files) for (const item of entries(file)) {
      if (!item.key || !item.block || !/^tech_/.test(item.key)) continue;
      const body = item.block, areaName = scalar(body, 'area');
      if (!AREAS.includes(areaName)) continue;
      const levels = number(body, 'levels', 0);
      const weight = scalar(body, 'weight'), weightModifier = block(body, 'weight_modifier');
      // Literal zero без additive path не может попасть в обычную research draw.
      const adds = []; const collectAdds = text => entries(text).forEach(value => { if (value.key === 'add' && value.scalar !== undefined) adds.push(value.scalar); if (value.block) collectAdds(value.block); }); collectAdds(weightModifier);
      const eventOnly = weight === '0' && !adds.some(value => !Number.isFinite(Number(value)) || Number(value) > 0);
      byId.set(item.key, {id: item.key, area: areaName, tier: number(body, 'tier', 0), levels, cost: scalar(body, 'cost'), categories: list(block(body, 'category')), prerequisites: list(block(body, 'prerequisites')).filter(id => /^tech_/.test(id)), potential: block(body, 'potential'), allow: block(body, 'allow'), weight, weightModifier, eventOnly, icon: scalar(body, 'icon'), rarity: scalar(body, 'is_dangerous') === 'yes' ? 'dangerous' : scalar(body, 'is_rare') === 'yes' ? 'rare' : 'common', start: scalar(body, 'start_tech') === 'yes', repeatable: levels === -1 || levels > 1});
    }
    const gates = new Map(entries(tierText).filter(x => /^\d+$/.test(x.key || '') && x.block).map(x => [Number(x.key), number(x.block, 'previously_unlocked', 0)]));
    return {byId, gates};
  }
  function stateFromSave(text, country) {
    const countryBlock = findCountryBlock(text, country.id) || '';
    const found = expression => new Set([...countryBlock.matchAll(expression)].map(match => match[1]).filter(Boolean));
    const techStatus = block(countryBlock, 'tech_status');
    const alternativesBlock = block(techStatus, 'alternatives') || block(countryBlock, 'alternatives');
    const levels = new Map([...techStatus.matchAll(/\btechnology\s*=\s*"?(tech_[\w.]+)"?[\s\S]{0,80}?\blevel\s*=\s*(-?\d+)/g)].map(match => [match[1], Number(match[2])]));
    const researched = new Set([...techStatus.matchAll(/\btechnology\s*=\s*"?(tech_[\w.]+)"?/g)].map(match => match[1]));
    const alternatives = new Set(), alternativesByArea = new Map(); const collectOffers = (text, area) => entries(text).forEach(item => { if (item.scalar && /^tech_/.test(item.scalar)) { alternatives.add(item.scalar); if (area) { if (!alternativesByArea.has(area)) alternativesByArea.set(area, new Set()); alternativesByArea.get(area).add(item.scalar); } } if (item.block) collectOffers(item.block, item.key || area); }); collectOffers(alternativesBlock, '');
    const government = block(countryBlock, 'government'), ethicsBlock = block(countryBlock, 'ethos'), flagsBlock = block(countryBlock, 'flags');
    const identifiers = value => new Set(entries(value).map(item => item.key || item.scalar).filter(id => id && !/^\d+$/.test(id)));
    const nomadic = direct(countryBlock, 'is_nomadic');
    return {researched, levels, alternatives, alternativesByArea, flags: identifiers(flagsBlock), modifiers: found(/\bmodifier\s*=\s*"?([\w.]+)"?/g), traits: found(/\btrait\s*=\s*"?([\w.]+)"?/g), ethics: new Set([...ethicsBlock.matchAll(/\bethic\s*=\s*"?([\w.]+)"?/g)].map(match => match[1])), civics: new Set([...government.matchAll(/\bcivic\s*=\s*"?([\w.]+)"?/g)].map(match => match[1])), perks: identifiers(block(countryBlock, 'ascension_perks')), traditions: identifiers(block(countryBlock, 'traditions')), authority: direct(government, 'authority') || direct(countryBlock, 'authority'), origin: direct(government, 'origin'), countryType: direct(countryBlock, 'country_type') || direct(countryBlock, 'type'), isNomadic: nomadic ? nomadic === 'yes' : undefined};
  }
  function findCountryBlock(text, wanted) {
    const table = block(text, 'country');
    return entries(table).find(x => x.key === String(wanted))?.block || '';
  }
  function direct(text, key) { return scalar(text, key); }
  function scriptEntries(text) { const source = typeof text === 'string' ? text : ''; if (!techScriptCache.has(source)) techScriptCache.set(source, entries(source)); return techScriptCache.get(source); }
  function scriptScalar(text, key) { const values = scriptEntries(text).filter(item => item.key === key && item.scalar !== undefined); return values.at(-1)?.scalar || ''; }
  function condition(text, state) { return conditionItems(scriptEntries(text), state); }
  function conditionItems(items, state) {
    const unknown = [], results = [];
    const and = values => values.includes(false) ? false : values.includes(null) ? null : true;
    const or = values => values.includes(true) ? true : values.includes(null) ? null : false;
    for (const item of items) {
      if (!item.key) { unknown.push('comparison/script expression'); results.push(null); continue; }
      if (['factor', 'add', 'base', 'mult', 'mode', 'trigger', 'parameters', 'TYPE'].includes(item.key)) continue;
      if (['OR', 'NOR', 'AND', 'NOT'].includes(item.key) && item.block !== undefined) {
        const nested = conditionItems(scriptEntries(item.block), state); unknown.push(...nested.unknown);
        const value = item.key === 'OR' ? or(nested.parts) : item.key === 'NOR' ? or(nested.parts) : item.key === 'NOT' ? nested.value : and(nested.parts);
        results.push(item.key === 'NOR' || item.key === 'NOT' ? value === null ? null : !value : value); continue;
      }
      const value = item.scalar || ''; let known;
      if (item.key === 'has_technology') known = state.researched.has(value);
      else if (item.key === 'has_country_flag') known = state.flags.has(value);
      else if (item.key === 'has_modifier') known = state.modifiers.has(value);
      else if (item.key === 'has_ethic') known = state.ethics.has(value);
      else if (item.key === 'has_civic' || item.key === 'has_valid_civic') known = state.civics.has(value);
      else if (item.key === 'has_authority') known = state.authority === value;
      else if (item.key === 'has_origin') known = state.origin === value;
      else if (item.key === 'has_trait') known = state.traits.has(value);
      else if (item.key === 'has_ascension_perk') known = state.perks?.has(value);
      else if (item.key === 'has_tradition') known = state.traditions?.has(value);
      else if (item.key === 'is_nomadic') known = state.isNomadic === undefined ? null : (value === 'yes' ? !!state.isNomadic : !state.isNomadic);
      else if (item.key === 'is_country_type') known = state.countryType ? state.countryType === value : null;
      else if (/^is_(?:fanatic_)?(militarist|pacifist|egalitarian|authoritarian|xenophile|xenophobe|spiritualist|materialist)$/.test(item.key)) known = state.ethics.has(item.key.replace(/^is_/, 'ethic_')) === (value === 'yes');
      else if (item.key === 'always') known = value === 'yes';
      else { unknown.push(item.key); known = null; }
      results.push(known);
    }
    return {value: and(results), unknown: [...new Set(unknown)], parts: results};
  }
  function identityValue(key, value, state) {
    const authority = state.authority || '', gestalt = /gestalt|hive|machine/.test(authority), machine = /machine/.test(authority), hive = /hive/.test(authority);
    if (key === 'has_origin') return state.origin ? state.origin === value : null;
    if (key === 'has_authority') {
      if (!authority) return null; if (authority === value) return true;
      const family = id => /machine/.test(id) ? 'machine' : /hive/.test(id) ? 'hive' : /gestalt/.test(id) ? 'gestalt' : 'regular';
      return family(authority) === 'regular' && family(value) === 'regular' ? null : false;
    }
    if (key === 'is_gestalt') return value === 'yes' ? gestalt : !gestalt;
    if (key === 'is_machine_empire') return value === 'yes' ? machine : !machine;
    if (key === 'is_hive_empire') return value === 'yes' ? hive : !hive;
    if (key === 'is_regular_empire') return value === 'yes' ? !gestalt : gestalt;
    if (key === 'is_nomadic') return state.isNomadic === undefined ? null : value === 'yes' ? !!state.isNomadic : !state.isNomadic;
    if (key === 'is_country_type') return state.countryType ? state.countryType === value : null;
    if (['any_owned_planet','any_owned_colony','has_owned_planet','has_colony','can_colonize','can_colonise'].includes(key)) return state.isNomadic === true ? false : null;
    if (key === 'country_uses_bio_ships') return state.bioShips === null ? null : value === 'yes' ? state.bioShips : !state.bioShips;
    if ((key === 'has_civic' || key === 'has_valid_civic') && immutableCivics.has(value)) return state.civics.has(value);
    if (key === 'has_ascension_perk') {
      if (state.perks.has(value)) return true;
      const crisis = new Set(['ap_become_the_crisis','ap_cosmogenesis','ap_behemoths','ap_galactic_hyperthermia']), defenders = new Set(['ap_defender_of_the_galaxy','ap_defender_of_the_galaxy_nomads']);
      if (crisis.has(value) && [...state.perks].some(perk => (crisis.has(perk) && perk !== value) || defenders.has(perk))) return false;
    }
    return null;
  }
  function impossibleForCountry(tech, state) {
    const signature = `${state.origin || ''}|${state.authority || ''}|${state.countryType || ''}|${state.isNomadic}|${state.bioShips}|${[...(state.civics || [])].sort().join(',')}|${[...(state.perks || [])].sort().join(',')}`, cacheKey = tech.id ? `${tech.id}|${signature}` : '';
    const cached = cacheKey && impossibleCache.get(cacheKey); if (cached) return cached;
    const and = values => values.includes(false) ? false : values.includes(null) ? null : true, or = values => values.includes(true) ? true : values.includes(null) ? null : false;
    const inspect = text => {
      const values = scriptEntries(text).map(item => {
        if (!item.key) return {value: null, reasons: []};
        if (item.block !== undefined && ['AND','OR','NOR','NOT'].includes(item.key)) { const child = inspect(item.block); const value = item.key === 'OR' ? or(child.values) : item.key === 'NOR' ? or(child.values) : and(child.values); return {value: item.key === 'NOR' || item.key === 'NOT' ? value === null ? null : !value : value, reasons: child.reasons}; }
        const value = identityValue(item.key, item.scalar || '', state); return {value, reasons: value === false ? [item.key] : []};
      });
      return {value: and(values.map(item => item.value)), values: values.map(item => item.value), reasons: values.flatMap(item => item.reasons)};
    };
    const potential = inspect(tech.potential || ''), allow = inspect(tech.allow || '');
    const result = {impossible: potential.value === false || allow.value === false, reasons: [...new Set([...potential.reasons, ...allow.reasons]) ]}; if (cacheKey) impossibleCache.set(cacheKey, result); return result;
  }
  function weight(tech, state) {
    const base = numericWeight(tech.weight, 1); let result = base.value, unknown = base.unknown ? [tech.weight] : [];
    if (!tech.weightModifier) return {value: result, unknown};
    const modifier = scriptEntries(tech.weightModifier);
    const factorRaw = modifier.find(x => x.key === 'factor')?.scalar;
    if (factorRaw) { const factor = numericWeight(factorRaw, 1); result *= factor.value; if (factor.unknown) unknown.push(factorRaw); }
    for (const item of modifier.filter(x => x.key === 'modifier' && x.block)) {
      const test = condition(item.block, state); unknown.push(...test.unknown);
      // Нельзя считать неизвестный modifier сработавшим: это создало бы ложную вероятность.
      if (test.value !== true) continue;
      const fRaw = scriptScalar(item.block, 'factor'), addRaw = scriptScalar(item.block, 'add');
      if (fRaw) { const f = numericWeight(fRaw, 1); result *= f.value; if (f.unknown) unknown.push(fRaw); }
      if (addRaw) { const add = numericWeight(addRaw, 0); result += add.value; if (add.unknown) unknown.push(addRaw); }
    }
    return {value: Math.max(0, result), unknown: [...new Set(unknown)]};
  }
  function cost(tech) { const resolved = numericWeight(tech.cost || '1', 1); return {value: Math.max(1, resolved.value), unknown: resolved.unknown}; }
  function numericWeight(raw, fallback = 1) { const value = Number(raw); if (Number.isFinite(value)) return {value, unknown: false}; if (scriptedVariables.has(raw)) return {value: scriptedVariables.get(raw), unknown: false}; return {value: fallback, unknown: !!raw}; }
  function evaluate(tech, state) {
    const level = state.levels?.get(tech.id) || (state.researched.has(tech.id) ? 1 : 0);
    if (state.researched.has(tech.id) && (!tech.repeatable || (tech.levels > 0 && level >= tech.levels))) return {status: 'researched', reason: '', missing: [], unknown: []};
    const potential = condition(tech.potential, state), allow = condition(tech.allow, state);
    const missing = tech.prerequisites.filter(id => !state.researched.has(id));
    let tierCounts = tierCountCache.get(state); if (!tierCounts) { tierCounts = new Map(); for (const id of state.researched) { const other = definitions.byId.get(id); if (!other) continue; const key = `${other.area}|${other.tier}`; tierCounts.set(key, (tierCounts.get(key) || 0) + 1); } tierCountCache.set(state, tierCounts); }
    const previous = tierCounts.get(`${tech.area}|${tech.tier - 1}`) || 0;
    const gate = definitions.gates.get(tech.tier) || 0;
    const unknown = [...new Set([...potential.unknown, ...allow.unknown])];
    if (potential.value === false || allow.value === false) return {status: 'blocked', reason: 'potential/allow', missing, unknown};
    if (missing.length) return {status: 'locked', reason: 'prerequisite', missing, unknown};
    if (previous < gate) return {status: 'locked', reason: `tier gate ${previous}/${gate}`, missing, unknown};
    return {status: unknown.length ? 'available-unknown' : 'available', missing, unknown};
  }
  function closure(id, state, seen = new Set()) {
    if (seen.has(id)) return seen; seen.add(id); const tech = definitions.byId.get(id);
    if (tech) tech.prerequisites.filter(x => !state.researched.has(x)).forEach(x => closure(x, state, seen)); return seen;
  }
  function targetRequirements(targetIds, seen = new Set()) {
    for (const id of targetIds || []) {
      if (seen.has(id)) continue;
      seen.add(id);
      const tech = definitions?.byId.get(id);
      if (tech) targetRequirements(tech.prerequisites, seen);
    }
    return seen;
  }
  // Сводка считает уникальные технологии предыдущего тира. В частности, одна
  // выбранная filler-технология не может искусственно закрыть несколько слотов.
  function gateProgress(state, reduced, areaName) {
    const groups = new Map();
    for (const node of reduced?.nodes || []) {
      const tier = node.tech.tier, gate = definitions.gates.get(tier) || 0;
      if (node.tech.area !== areaName || !gate) continue;
      if (!groups.has(tier)) groups.set(tier, {tier, gate, targets:new Set(), fillers:new Set()});
      groups.get(tier).targets.add(node.tech.id);
    }
    for (const slot of reduced?.fillerSlots || []) {
      if (slot.gateTech.area !== areaName || !groups.has(slot.tier)) continue;
      groups.get(slot.tier).fillers.add(slot.selected.tech.id);
    }
    return [...groups.values()].sort((a, b) => a.tier - b.tier).map(group => {
      const previousTier = group.tier - 1;
      const researched = new Set(), planned = new Set();
      for (const tech of definitions.byId.values()) {
        if (tech.area !== areaName || tech.tier !== previousTier) continue;
        if (state.researched.has(tech.id)) researched.add(tech.id);
      }
      for (const node of reduced.nodes || []) {
        if (node.tech.area !== areaName || node.tech.tier !== previousTier || state.researched.has(node.tech.id)) continue;
        planned.add(node.tech.id);
      }
      const fillers = new Set([...group.fillers].filter(id => planned.has(id)));
      const total = researched.size + planned.size;
      return {tier:group.tier, previousTier, gate:group.gate, researched:researched.size, planned:planned.size, fillers:fillers.size, total, missing:Math.max(0, group.gate - total), targets:[...group.targets]};
    });
  }
  function plannedNodeEffects(node, reduced, state) {
    if (!node) return {children:[], gateTiers:[]};
    const children = (reduced?.nodes || []).filter(value => value.tech.prerequisites.includes(node.tech.id)).map(value => value.tech.id);
    const gateTiers = [...new Set((reduced?.fillerSlots || []).filter(slot => slot.selected.tech.id === node.tech.id && !state.researched.has(node.tech.id)).map(slot => slot.tier))].sort((a, b) => a - b);
    return {children, gateTiers};
  }
  function nodeEffectLabels(effects) {
    const labels = [];
    if (effects.gateTiers.length) labels.push(`Counts +1 toward Tier ${effects.gateTiers.join(', ')} gate`);
    if (effects.children.length) labels.push(`Required by ${effects.children.length} planned node${effects.children.length === 1 ? '' : 's'}`);
    return labels;
  }
  function gateLayoutLinks(reduced, areaName) {
    const links = new Map();
    for (const slot of reduced?.fillerSlots || []) {
      const from = slot.selected.tech.id, to = slot.gateTech.id;
      if (areaName && slot.gateTech.area !== areaName || from === to) continue;
      links.set(`${from}|${to}`, {from, to});
    }
    return [...links.values()];
  }
  function buildReducedPlan(state, targetIds) {
    const nodes = new Map(), add = (id, role, reason) => { if (excludedTechs.has(id)) return; const tech = definitions.byId.get(id); if (!tech) return; const existing = nodes.get(id); if (existing) { if (role === 'target') Object.assign(existing, {role, planRole: role, reason}); return; } nodes.set(id, {tech, role, planRole: role, reason}); tech.prerequisites.forEach(value => add(value, 'prerequisite', 'Required by target')); };
    [...targetIds].forEach(id => add(id, 'target', 'Selected target'));
    // Один и тот же кандидат встречается во многих tier-gate slots. Его полный
    // drawable-pool transition зависит от save state, но не от выбранного slot.
    const fillerSlots = [], fillerImpactCache = new Map();
    for (let index = 0; index < nodes.size; index++) {
      const node = [...nodes.values()][index];
      const tech = node.tech, gate = definitions.gates.get(tech.tier) || 0; if (tech.tier < 2 || !gate || excludedTechs.has(tech.id)) continue;
      const current = [...definitions.byId.values()].filter(value => value.area === tech.area && value.tier === tech.tier - 1 && (state.researched.has(value.id) || nodes.has(value.id))).length;
      const deficit = Math.max(0, gate - current);
      for (let slotIndex = 0; slotIndex < deficit; slotIndex++) {
        const slotId = fillerSlotId(tech.id, tech.tier, slotIndex), ranked = rankGateFillerAlternatives(state, tech, nodes, fillerImpactCache);
        if (!ranked.length) continue;
        const selected = ranked[0];
        fillerSlots.push({id: slotId, gateTech: tech, tier: tech.tier, selected, alternatives: ranked, candidateCount: ranked.candidateCount || ranked.length});
        add(selected.tech.id, 'tier-filler', `Tier ${tech.tier} gate · effort ${selected.score.toFixed(1)}`);
      }
    }
    for (const node of nodes.values()) if (state.researched.has(node.tech.id)) node.role = 'researched'; else if (state.alternatives.has(node.tech.id)) node.role = 'offered';
    const blockedByExclusion = [...targetIds].filter(id => [...closure(id, state)].some(required => excludedTechs.has(required)));
    return {nodes: [...nodes.values()].map(node => ({...node, cost: cost(node.tech)})), fillerSlots, targets: [...targetIds], incomplete: [...targetIds].filter(id => !definitions.byId.has(id)), blockedByExclusion};
  }
  function fillerSlotId(gateTechId, tier, slot) { return `gate:${gateTechId}:${tier}:${slot}`; }
  function rankGateFillerAlternatives(state, gateTech, nodes, impactCache = new Map()) {
    const previousTier = gateTech.tier - 1;
    const prerequisitePathIsViable = value => [...closure(value.id, state)].every(id => { const required = definitions.byId.get(id); return required && !excludedTechs.has(id) && (state.researched.has(id) || (!required.eventOnly && !impossibleForCountry(required, state).impossible)); });
    const viable = [...definitions.byId.values()].filter(value => value.area === gateTech.area && value.tier === previousTier && !value.repeatable && !excludedTechs.has(value.id) && !state.researched.has(value.id) && !nodes.has(value.id) && !value.eventOnly && !impossibleForCountry(value, state).impossible && prerequisitePathIsViable(value));
    // Ограничиваем дорогую оценку shortlist'ом, чтобы multi-target план
    // оставался отзывчивым на реальном наборе локальных технологий.
    const rough = viable.slice().sort((a, b) => (cost(a).value * (1 + a.prerequisites.length)) - (cost(b).value * (1 + b.prerequisites.length)) || a.id.localeCompare(b.id)).slice(0, 32);
    const ranked = rough.map(tech => {
      const path = [...closure(tech.id, state)], needed = path.filter(id => !state.researched.has(id) && !nodes.has(id)), prerequisiteIds = needed.filter(id => id !== tech.id);
      const costs = needed.map(id => cost(definitions.byId.get(id))), totalCost = costs.reduce((sum, item) => sum + item.value, 0);
      const plannedIds = new Set(nodes.keys()), beforeProjected = {...state, researched: new Set(state.researched)}, projected = {...beforeProjected, researched: new Set([...beforeProjected.researched, ...path])};
      let impact = impactCache.get(tech.id); if (!impact) { impact = poolImpactByArea(beforeProjected, projected); impactCache.set(tech.id, impact); }
      const own = impact.byArea[tech.area], crossAreas = AREAS.filter(areaName => areaName !== tech.area);
      const crossPoolDelta = crossAreas.reduce((sum, areaName) => sum + impact.byArea[areaName].countDelta, 0), crossWeightDelta = crossAreas.reduce((sum, areaName) => sum + impact.byArea[areaName].weightDelta, 0);
      const unrelated = impact.newlyDrawable.filter(item => !plannedIds.has(item.tech.id)), plannedUnlocks = impact.newlyDrawable.filter(item => plannedIds.has(item.tech.id)), futureWeights = unrelated.map(item => item.weight);
      const pollutionWeight = unrelated.reduce((sum, item) => sum + item.weight.value, 0), sharedPathBenefit = path.filter(id => nodes.has(id)).length + plannedUnlocks.length;
      const evaluation = evaluate(tech, state), partial = costs.some(item => item.unknown) || futureWeights.some(item => item.unknown.length) || evaluation.unknown.length > 0;
      const plannedWeightByArea = Object.fromEntries(AREAS.map(areaName => [areaName, plannedUnlocks.filter(item => item.tech.area === areaName).reduce((sum, item) => sum + item.weight.value, 0)]));
      const ownPollutionDelta = own.weightDelta - plannedWeightByArea[tech.area], crossPollutionDelta = crossAreas.reduce((sum, areaName) => sum + impact.byArea[areaName].weightDelta - plannedWeightByArea[areaName], 0);
      const score = totalCost * (1 + prerequisiteIds.length) + ownPollutionDelta + crossPollutionDelta * .65 + unrelated.length * .1 - sharedPathBenefit * Math.max(1, totalCost) * .25;
      return {tech, totalCost, prerequisiteCount: prerequisiteIds.length, prerequisiteIds, directFutureCount: unrelated.length, pollutionWeight, ownPoolDelta: own.countDelta, ownWeightDelta: own.weightDelta, crossPoolDelta, crossWeightDelta, plannedUnlockCount: plannedUnlocks.length, sharedPathBenefit, score, partial, unknown: [...new Set([...evaluation.unknown, ...futureWeights.flatMap(item => item.unknown)])]};
    }).sort((a, b) => a.score - b.score || a.tech.id.localeCompare(b.tech.id));
    ranked.candidateCount = viable.length;
    return ranked;
  }
  function rankFillerAlternatives(state, reduced) {
    const planned = new Set(reduced.nodes.map(node => node.tech.id)), rows = new Map(), viableSlotCandidatesByArea = Object.fromEntries(AREAS.map(areaName => [areaName, 0]));
    for (const slot of reduced.fillerSlots || []) viableSlotCandidatesByArea[slot.gateTech.area] += slot.candidateCount || slot.alternatives.length;
    for (const slot of reduced.fillerSlots || []) for (const item of slot.alternatives) {
      if (item.tech.id === slot.selected.tech.id || planned.has(item.tech.id)) continue;
      const existing = rows.get(item.tech.id), gate = `${slot.gateTech.id} (tier ${slot.tier})`;
      if (!existing) rows.set(item.tech.id, {...item, gates: [gate]});
      else {
        const gates = existing.gates.includes(gate) ? existing.gates : [...existing.gates, gate];
        if (item.score < existing.score) rows.set(item.tech.id, {...item, gates}); else existing.gates = gates;
      }
    }
    const items = [...rows.values()].sort((a, b) => a.score - b.score || a.tech.id.localeCompare(b.tech.id));
    return {items, total: items.length, viableSlotCandidates: (reduced.fillerSlots || []).reduce((sum, slot) => sum + (slot.candidateCount || slot.alternatives.length), 0), viableSlotCandidatesByArea};
  }
  function filterFillerAlternatives(alternatives, areaName) {
    const items = alternatives.items.filter(item => item.tech.area === areaName);
    return {items, total: items.length, viableSlotCandidates: alternatives.viableSlotCandidatesByArea?.[areaName] || 0};
  }
  function consumeAreaOffers(state, areaName) {
    const alternatives = new Set(state.alternatives || []), alternativesByArea = new Map([...(state.alternativesByArea || [])].map(([key, values]) => [key, new Set(values)])), areaOffers = alternativesByArea.get(areaName);
    // Старые сохранения не всегда содержат секции по наукам: тогда безопасно
    // убираем только предложения той же области, определённые локальными tech data.
    (areaOffers || new Set([...alternatives].filter(id => definitions?.byId.get(id)?.area === areaName))).forEach(id => alternatives.delete(id));
    alternativesByArea.delete(areaName);
    return {...state, alternatives, alternativesByArea};
  }
  function advanceState(state, tech) { const levels = new Map(state.levels || []), nextLevel = (levels.get(tech.id) || (state.researched.has(tech.id) ? 1 : 0)) + 1; levels.set(tech.id, nextLevel); return {...consumeAreaOffers(state, tech.area), researched: new Set([...state.researched, tech.id]), levels}; }
  function visibleTargetTech(tech, state) { return !!tech && (state.researched.has(tech.id) || state.alternatives?.has(tech.id) || (!tech.eventOnly && !impossibleForCountry(tech, state).impossible)); }
  function visibleTech(tech, state) { return visibleTargetTech(tech, state) && (state.researched.has(tech.id) || !excludedTechs.has(tech.id)); }
  function pool(state, areaName) { return [...definitions.byId.values()].filter(t => { const offered = state.alternatives?.has(t.id); return !excludedTechs.has(t.id) && t.area === areaName && !t.start && (offered || (!t.eventOnly && !impossibleForCountry(t, state).impossible)); }).map(t => ({tech: t, eval: evaluate(t, state), weight: weight(t, state)})).filter(x => state.alternatives?.has(x.tech.id) || (/^available/.test(x.eval.status) && (x.weight.value > 0 || x.weight.unknown.length > 0))); }
  function drawablePool(state, areaName) { return [...definitions.byId.values()].filter(tech => !excludedTechs.has(tech.id) && tech.area === areaName && !tech.start && !tech.eventOnly && !impossibleForCountry(tech, state).impossible).map(tech => ({tech, eval: evaluate(tech, state), weight: weight(tech, state)})).filter(item => /^available/.test(item.eval.status) && (item.weight.value > 0 || item.weight.unknown.length > 0)); }
  function poolImpactByArea(beforeState, afterState, plannedIds = new Set()) {
    const byArea = {}, newlyDrawable = [];
    for (const areaName of AREAS) {
      const before = drawablePool(beforeState, areaName), after = drawablePool(afterState, areaName), beforeIds = new Set(before.map(item => item.tech.id)), afterIds = new Set(after.map(item => item.tech.id));
      const beforeWeight = before.reduce((sum, item) => sum + item.weight.value, 0), afterWeight = after.reduce((sum, item) => sum + item.weight.value, 0);
      after.filter(item => !beforeIds.has(item.tech.id)).forEach(item => newlyDrawable.push({...item, planned: plannedIds.has(item.tech.id)}));
      byArea[areaName] = {beforeCount: before.length, afterCount: after.length, countDelta: after.length - before.length, beforeWeight, afterWeight, weightDelta: afterWeight - beforeWeight, ids: afterIds};
    }
    const totalCountDelta = AREAS.reduce((sum, areaName) => sum + byArea[areaName].countDelta, 0), totalWeightDelta = AREAS.reduce((sum, areaName) => sum + byArea[areaName].weightDelta, 0);
    return {byArea, newlyDrawable, totalCountDelta, totalWeightDelta};
  }
  function recommendation(state, target) {
    const targetTech = definitions.byId.get(target); if (!targetTech) return null;
    const before = pool(state, targetTech.area), path = closure(target, state); path.delete(target);
    const beforeWeight = before.reduce((sum, x) => sum + weight(x.tech, state).value, 0);
    const offeredTarget = state.alternatives?.has(target) && !before.some(item => item.tech.id === target) ? [{tech: targetTech, eval: evaluate(targetTech, state), weight: weight(targetTech, state)}] : [];
    const current = state.alternatives?.size ? [...offeredTarget, ...before.filter(item => state.alternatives.has(item.tech.id))] : before;
    return current.map(({tech, eval: techEval}) => {
      const next = advanceState(state, tech); const after = pool(next, targetTech.area);
      const offPath = after.filter(x => !before.some(old => old.tech.id === x.tech.id) && !path.has(x.tech.id) && x.tech.id !== target).length;
      const removed = before.filter(x => !after.some(nextItem => nextItem.tech.id === x.tech.id)).length;
      const targetBeforeEntry = before.find(item => item.tech.id === target), targetAfterEntry = after.find(item => item.tech.id === target); const targetBefore = targetBeforeEntry ? targetBeforeEntry.weight.value / beforeWeight : 0, afterTotal = after.reduce((sum, x) => sum + x.weight.value, 0), targetAfter = targetAfterEntry && afterTotal ? targetAfterEntry.weight.value / afterTotal : 0;
      return {tech, techEval, route: path.has(tech.id), current: state.alternatives?.has(tech.id), offPath, removed, beforeChance: targetBefore, afterChance: tech.id === target ? 1 : targetAfter, totalWeight: beforeWeight};
    }).sort((a, b) => (b.tech.id === target) - (a.tech.id === target) || b.route - a.route || b.afterChance - a.afterChance || a.tech.id.localeCompare(b.tech.id));
  }
  function rankSideChoices(state, areaName, reduced, options = {}) {
    const before = pool(state, areaName);
    // Карточки save — единственный достоверный выбор прямо сейчас. Без снимка
    // alternatives показываем вычисленный пул, но не выдаём его за реальные карты.
    const savedOffers = state.alternativesByArea?.get(areaName), flatOffers = new Set([...state.alternatives].filter(id => definitions.byId.get(id)?.area === areaName));
    const currentOffers = savedOffers?.size ? savedOffers : flatOffers.size ? flatOffers : null;
    const current = options.includeAll ? before : currentOffers ? before.filter(item => currentOffers.has(item.tech.id)) : before;
    const targetIds = new Set(reduced.targets || []), availableBefore = new Set([...targetIds].filter(id => /^available/.test(evaluate(definitions.byId.get(id), state).status)));
    return current.map(item => {
      const next = advanceState(state, item.tech), plannedIds = new Set(reduced.nodes.map(node => node.tech.id)), impactKey = `${areaName}|${item.tech.id}`, impact = options.impactCache?.get(impactKey) || poolImpactByArea(state, next, plannedIds), ownImpact = impact.byArea[areaName];
      options.impactCache?.set(impactKey, impact);
      const planNode = reduced.nodes.find(node => node.tech.id === item.tech.id);
      const tier = planNode?.planRole === 'tier-filler' || planNode?.role === 'tier-filler';
      const effort = cost(item.tech).value;
      const levelOf = (candidate, id) => candidate.levels?.get(id) || (candidate.researched.has(id) ? 1 : 0);
      const targetCompletions = [...targetIds].filter(id => levelOf(next, id) > levelOf(state, id)).length;
      const exposure = [...targetIds].filter(id => !availableBefore.has(id) && /^available/.test(evaluate(definitions.byId.get(id), next).status)).length;
      const usefulUnlocks = reduced.nodes.filter(node => !targetIds.has(node.tech.id) && !state.researched.has(node.tech.id) && /^available/.test(evaluate(node.tech, next).status) && !/^available/.test(evaluate(node.tech, state).status)).length;
      const crossPoolDelta = AREAS.filter(value => value !== areaName).reduce((sum, value) => sum + impact.byArea[value].countDelta, 0), crossWeightDelta = AREAS.filter(value => value !== areaName).reduce((sum, value) => sum + impact.byArea[value].weightDelta, 0);
      const plannedUnlocks = impact.newlyDrawable.filter(value => value.planned), plannedWeightByArea = Object.fromEntries(AREAS.map(value => [value, plannedUnlocks.filter(unlock => unlock.tech.area === value).reduce((sum, unlock) => sum + unlock.weight.value, 0)]));
      const ownPollutionDelta = ownImpact.weightDelta - plannedWeightByArea[areaName], crossPollutionDelta = AREAS.filter(value => value !== areaName).reduce((sum, value) => sum + impact.byArea[value].weightDelta - plannedWeightByArea[value], 0);
      const totalBeforeWeight = AREAS.reduce((sum, value) => sum + impact.byArea[value].beforeWeight, 0), poolBenefit = -ownPollutionDelta / Math.max(1, ownImpact.beforeWeight), futurePoolBenefit = (-ownPollutionDelta - crossPollutionDelta * .45) / Math.max(1, totalBeforeWeight);
      const score = ((planNode ? 100 : 0) + (tier ? 30 : 0) + targetCompletions * 100 + exposure * 40 + usefulUnlocks * 12 + futurePoolBenefit * 80) / effort;
      return {...item, offeredNow: !!state.alternatives?.has(item.tech.id), plan: !!planNode, tier, targetCompletions, targetExposure: exposure, usefulUnlocks, poolDelta: ownImpact.countDelta, weightDelta: ownImpact.weightDelta, crossPoolDelta, crossWeightDelta, beforePoolWeight: ownImpact.beforeWeight, afterPoolWeight: ownImpact.afterWeight, poolBenefit, effort, score};
    }).sort((a, b) => b.score - a.score || b.plan - a.plan || a.tech.id.localeCompare(b.tech.id));
  }
  // Полный current pool для sidebar. Saved alternatives — метка, а не фильтр.
  function rankAvailableFillers(state, areaName, reduced, impactCache) {
    const planned = new Set(reduced.nodes.map(node => node.tech.id));
    return rankSideChoices(state, areaName, reduced, {includeAll:true, impactCache}).filter(item => !planned.has(item.tech.id) && !state.researched.has(item.tech.id) && !excludedTechs.has(item.tech.id) && !item.tech.eventOnly && /^available/.test(item.eval.status) && (item.weight.value > 0 || item.weight.unknown.length > 0));
  }
  function planSearch(state, target, limit = 8) {
    const targetTech = definitions.byId.get(target); if (!targetTech) return {steps: [], status: 'unreachable', partial: false};
    const queue = [{state, steps: []}], seen = new Set([...[state.researched].sort().join(',')]); let partial = false, expanded = 0; const MAX_WORK = 48;
    while (queue.length && expanded++ < MAX_WORK) {
      const node = queue.shift();
      const currentLevel = node.state.levels?.get(target) || (node.state.researched.has(target) ? 1 : 0); if ((!targetTech.repeatable && node.state.researched.has(target)) || (targetTech.repeatable && currentLevel > (state.levels?.get(target) || 0))) return {steps: node.steps, status: 'reached', partial, expanded};
      if (node.steps.length >= limit) continue;
      const required = closure(target, node.state); const areas = new Set([...required].map(id => definitions.byId.get(id)?.area).filter(Boolean)); areas.add(targetTech.area);
      const all = [...areas].flatMap(value => pool(node.state, value)); const offers = node.state.alternatives?.size ? all.filter(item => node.state.alternatives.has(item.tech.id)) : all;
      const ordered = offers.sort((a, b) => weight(b.tech, node.state).value - weight(a.tech, node.state).value);
      const requiredChoices = ordered.filter(item => required.has(item.tech.id)); const choices = [...requiredChoices, ...ordered.filter(item => !required.has(item.tech.id)).slice(0, 2)].slice(0, 4);
      partial ||= all.some(item => item.weight.unknown.length || item.eval.unknown.length);
      for (const choice of choices) {
        const next = advanceState(node.state, choice.tech); const key = [...next.researched].sort().join(',') + ':' + [...next.levels.entries()].sort().join(','); if (seen.has(key)) continue; seen.add(key);
        queue.push({state: next, steps: [...node.steps, choice.tech.id]});
      }
    }
    return {steps: [], status: queue.length ? 'truncated' : 'unreachable', partial, expanded};
  }
  function targetPlan(state, targetId, activeArea) { const target = definitions.byId.get(targetId); return {target, items: target && target.area === activeArea ? (recommendation(state, targetId) || []) : [], path: target ? planSearch(state, targetId) : null}; }
  function label(id) { return root.English?.has(id) ? root.English.expand(id) : id.replace(/^tech_/, '').replace(/_/g, ' '); }
  function displayName(tech) { return label(tech.id); }
  function escape(value) { return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  function applySimulation(state, researched, levels) { const next = {...state, researched: new Set(state.researched), levels: new Map(state.levels || []), alternatives: new Set(state.alternatives || [])}; levels.forEach((count, id) => next.levels.set(id, (next.levels.get(id) || 0) + count)); researched.forEach(id => next.researched.add(id)); return next; }
  function markResearched(id) { const tech = definitions?.byId.get(id); if (!tech || (simulated.has(id) && !tech.repeatable)) return false; excludedTechs.delete(id); simulated.add(id); simulatedLevels.set(id, (simulatedLevels.get(id) || 0) + 1); consumedOfferAreas.add(tech.area); history.push(id); plannerCache.clear(); return true; }
  function undoSimulation() { const id = history.pop(); if (!id) return ''; const next = (simulatedLevels.get(id) || 0) - 1; if (next) simulatedLevels.set(id, next); else { simulatedLevels.delete(id); simulated.delete(id); } consumedOfferAreas = new Set(history.map(value => definitions.byId.get(value)?.area).filter(Boolean)); plannerCache.clear(); return id; }
  function canExcludeTech(id, state, reduced) {
    const tech = definitions?.byId.get(id); if (!tech || state?.researched?.has(id)) return false;
    // Цель и вся её статическая prerequisite-цепочка являются инвариантом плана.
    // reduced может быть устаревшим между кликом и render, поэтому не полагаемся на DOM/model.
    const activeTargets = new Set([...targets, ...(reduced?.targets || [])]);
    return !targetRequirements(activeTargets).has(id);
  }
  function excludeTech(id, state, reduced) { if (!canExcludeTech(id, state, reduced)) return false; excludedTechs.add(id); plannerCache.clear(); return true; }
  function restoreExcludedTech(id) { if (!excludedTechs.delete(id)) return false; plannerCache.clear(); return true; }
  function clearExcludedTechs() { if (!excludedTechs.size) return false; excludedTechs.clear(); plannerCache.clear(); return true; }
  function selectedBaseState() { const empire = document.querySelector('#tech-empire').value; const country = save?.countries.find(x => x.id === empire); if (!country) return null; let base = countryStateCache.get(country.id); if (!base) { base = stateFromSave(save.gamestate, country); base.shipset = country.shipset || ''; base.authorityId = country.authorityId || base.authority; base.countryType = country.countryType || base.countryType; if (typeof country.isNomadic === 'boolean') base.isNomadic = country.isNomadic; base.bioShips = /^biogenesis_\d+$/.test(base.shipset) ? true : base.shipset ? false : null; countryStateCache.set(country.id, base); } return base; }
  function selectedState() { const base = selectedBaseState(); if (!base) return null; let state = applySimulation(base, simulated, simulatedLevels); consumedOfferAreas.forEach(value => { state = consumeAreaOffers(state, value); }); return state; }
  function plannerStateKey(empire) { return `${loadRevision}|${empire}|${[...targets].sort().join(',')}|${[...excludedTechs].sort().join(',')}|${[...simulatedLevels].sort((a, b) => a[0].localeCompare(b[0])).map(item => item.join(':')).join(',')}|${[...consumedOfferAreas].sort().join(',')}`; }
  function cachedPlannerModel(key, build) { if (!plannerCache.has(key)) { if (plannerCache.size >= 8) plannerCache.clear(); plannerBuilds++; plannerCache.set(key, build()); } return plannerCache.get(key); }
  function clearPlannerCaches() { countryStateCache.clear(); plannerCache.clear(); impossibleCache.clear(); }
  function chanceText(before, after) { return Number.isFinite(before) && Number.isFinite(after) ? `target chance ${(before * 100).toFixed(2)}% → ${(after * 100).toFixed(2)}%` : 'target chance unknown'; }
  function definitionFingerprint() {
    const technology = [...definitions.byId.values()].map(tech => [tech.id, tech.area, tech.tier, tech.levels, tech.cost, tech.weight, tech.weightModifier, tech.prerequisites, tech.potential, tech.allow, tech.start, tech.eventOnly]).sort((a, b) => a[0].localeCompare(b[0]));
    const text = JSON.stringify({technology, gates: [...definitions.gates].sort((a, b) => a[0] - b[0]), variables: [...scriptedVariables].sort((a, b) => a[0].localeCompare(b[0])), immutableCivics: [...immutableCivics].sort()});
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
    return `v2-${definitions.byId.size}-${(hash >>> 0).toString(16)}`;
  }
  function serializePlan() { return {version: 3, targets: [...targets].sort(), excludedTechs: [...excludedTechs].sort(), simulatedLevels: [...simulatedLevels].sort((a, b) => a[0].localeCompare(b[0])), history: [...history], strategy: 'balanced', sourceFingerprint: definitionFingerprint()}; }
  function validatePlan(data, countryState = null) {
    const allowed = new Set(['version', 'targets', 'excludedTechs', 'simulatedLevels', 'history', 'strategy', 'sourceFingerprint']);
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !allowed.has(key))) throw new Error('Invalid or incompatible plan');
    if (!data || ![2, 3].includes(data.version) || data.strategy !== 'balanced' || data.sourceFingerprint !== definitionFingerprint() || !Array.isArray(data.targets) || !data.targets.every(id => typeof id === 'string' && definitions.byId.has(id))) throw new Error('Invalid or incompatible plan');
    if (new Set(data.targets).size !== data.targets.length) throw new Error('Invalid duplicate targets');
    if (data.version === 2 && Object.hasOwn(data, 'excludedTechs')) throw new Error('Invalid v2 exclusions');
    const importedExcluded = data.version === 2 ? [] : data.excludedTechs;
    if (!Array.isArray(importedExcluded) || !importedExcluded.every(id => typeof id === 'string' && definitions.byId.has(id)) || new Set(importedExcluded).size !== importedExcluded.length || importedExcluded.some(id => data.targets.includes(id))) throw new Error('Invalid excluded technologies');
    if (!Array.isArray(data.simulatedLevels) || !data.simulatedLevels.every(item => Array.isArray(item) && item.length === 2 && definitions.byId.has(item[0]) && Number.isSafeInteger(item[1]) && item[1] > 0)) throw new Error('Invalid simulated levels');
    if (new Set(data.simulatedLevels.map(item => item[0])).size !== data.simulatedLevels.length) throw new Error('Invalid duplicate simulated levels');
    if (data.simulatedLevels.some(([id, count]) => { const tech = definitions.byId.get(id); return (!tech.repeatable && count !== 1) || (tech.levels > 0 && count > tech.levels); })) throw new Error('Invalid simulated technology level');
    if (!Array.isArray(data.history) || !data.history.every(id => typeof id === 'string' && definitions.byId.has(id))) throw new Error('Invalid history');
    const historyCounts = new Map(); data.history.forEach(id => historyCounts.set(id, (historyCounts.get(id) || 0) + 1));
    if (historyCounts.size !== data.simulatedLevels.length || data.simulatedLevels.some(([id, count]) => historyCounts.get(id) !== count)) throw new Error('Invalid simulation history');
    const forbiddenExclusions = targetRequirements(data.targets);
    data.simulatedLevels.forEach(([id]) => forbiddenExclusions.add(id));
    countryState?.researched?.forEach(id => forbiddenExclusions.add(id));
    if (importedExcluded.some(id => forbiddenExclusions.has(id))) throw new Error('Excluded technology conflicts with the plan or researched state');
    return {targets: new Set(data.targets), excludedTechs: new Set(importedExcluded), simulatedLevels: new Map(data.simulatedLevels), history: [...data.history]};
  }
  function applyPlan(data) {
    const countryState = typeof document === 'undefined' ? null : selectedBaseState();
    const next = validatePlan(data, countryState);
    targets = next.targets; excludedTechs = next.excludedTechs; simulatedLevels = next.simulatedLevels; simulated = new Set(simulatedLevels.keys()); history = next.history;
    consumedOfferAreas = new Set(history.map(id => definitions.byId.get(id)?.area).filter(Boolean));
    selectedTarget = [...targets][0] || '';
    return true;
  }
  function persistPlan() {
    try { root.localStorage?.setItem(PLAN_STORAGE_KEY, JSON.stringify(serializePlan())); } catch { /* Режим приватности не должен ломать расчёт плана. */ }
  }
  function restorePlan() {
    try { const raw = root.localStorage?.getItem(PLAN_STORAGE_KEY); if (raw) applyPlan(JSON.parse(raw)); return !!raw; } catch { return false; }
  }
  // Дополнительные связи gate не меняют сам путь исследований, но участвуют в
  // раскладке. Так filler остаётся рядом с технологией, для которой он нужен.
  function layoutTree(nodes, layoutLinks = []) {
    const techs = nodes.map(node => node.tech || node).filter(Boolean).sort((a, b) => a.id.localeCompare(b.id)), byId = new Map(techs.map(tech => [tech.id, tech]));
    const children = new Map(), indegree = new Map(techs.map(tech => [tech.id, 0])), rank = new Map(techs.map(tech => [tech.id, tech.tier]));
    for (const tech of techs) for (const parent of tech.prerequisites || []) if (byId.has(parent)) { if (!children.has(parent)) children.set(parent, []); children.get(parent).push(tech.id); indegree.set(tech.id, indegree.get(tech.id) + 1); }
    const layoutChildren = new Map();
    for (const link of layoutLinks) if (link?.from && link?.to && byId.has(link.from) && byId.has(link.to) && link.from !== link.to) {
      if (!layoutChildren.has(link.from)) layoutChildren.set(link.from, []);
      layoutChildren.get(link.from).push(link.to);
    }
    layoutChildren.forEach(ids => ids.sort());
    children.forEach(ids => ids.sort());
    const queue = [...indegree].filter(([, count]) => count === 0).map(([id]) => id).sort();
    while (queue.length) { const id = queue.shift(); for (const child of children.get(id) || []) { rank.set(child, Math.max(rank.get(child), rank.get(id) + 1)); indegree.set(child, indegree.get(child) - 1); if (indegree.get(child) === 0) { queue.push(child); queue.sort(); } } }
    const groups = new Map(); for (const tech of techs) { const layer = rank.get(tech.id); if (!groups.has(layer)) groups.set(layer, []); groups.get(layer).push(tech.id); }
    const tiers = [...groups.keys()].sort((a, b) => a - b), order = new Map(tiers.map(tier => [tier, groups.get(tier).sort()]));
    const links = [];
    for (const tech of techs) for (const parent of tech.prerequisites || []) if (byId.has(parent) && rank.get(parent) < rank.get(tech.id)) links.push({from:parent, to:tech.id});
    for (const [from, ids] of layoutChildren) for (const to of ids) if (rank.get(from) < rank.get(to)) links.push({from, to});
    const ordering = () => new Map([...order].flatMap(([tier, ids]) => ids.map((id, index) => [id, {tier, index}])));
    // Считаем пересечения на общем вертикальном отрезке рёбер. Это учитывает
    // и длинные связи, которые пересекают промежуточные слои карточек.
    const crossings = () => {
      const indices = ordering(); let total = 0;
      for (let left = 0; left < links.length; left++) for (let right = left + 1; right < links.length; right++) {
        const first = links[left], second = links[right];
        if (first.from === second.from || first.to === second.to) continue;
        const a = indices.get(first.from), b = indices.get(first.to), c = indices.get(second.from), d = indices.get(second.to), start = Math.max(a.tier, c.tier), end = Math.min(b.tier, d.tier);
        if (start >= end) continue;
        const x = (edge, at) => { const from = indices.get(edge.from), to = indices.get(edge.to); return from.index + (to.index - from.index) * (at - from.tier) / (to.tier - from.tier); };
        const before = x(first, start + .001) - x(second, start + .001), after = x(first, end - .001) - x(second, end - .001);
        if (before * after < 0) total++;
      }
      return total;
    };
    const centers = new Map(); const updateCenters = () => order.forEach(ids => ids.forEach((id, index) => centers.set(id, index)));
    const average = ids => ids.length ? ids.reduce((sum, id) => sum + (centers.get(id) ?? 0), 0) / ids.length : null;
    const sortTier = (tier, linked) => order.get(tier).sort((a, b) => { const left = average(linked(a)), right = average(linked(b)); if (left === null && right === null) return a.localeCompare(b); if (left === null) return 1; if (right === null) return -1; return left - right || a.localeCompare(b); });
    updateCenters();
    for (let pass = 0; pass < 3; pass++) {
      for (const tier of tiers.slice(1)) { sortTier(tier, id => (byId.get(id).prerequisites || []).filter(parent => byId.has(parent) && rank.get(parent) < tier)); updateCenters(); }
      for (const tier of tiers.slice(0, -1).reverse()) { sortTier(tier, id => [...(children.get(id) || []), ...(layoutChildren.get(id) || [])].filter(child => rank.get(child) > tier)); updateCenters(); }
    }
    // Барицентр быстро даёт хорошее начальное решение, после чего соседние
    // перестановки оставляем только если они реально уменьшают число пересечений.
    const initialCrossings = crossings(); let crossingCount = initialCrossings;
    for (let pass = 0; pass < techs.length; pass++) {
      let improved = false;
      for (const tier of pass % 2 ? tiers.slice().reverse() : tiers) {
        const ids = order.get(tier);
        for (let index = 0; index < ids.length - 1; index++) {
          [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
          const nextCount = crossings();
          if (nextCount < crossingCount) { crossingCount = nextCount; improved = true; }
          else [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
        }
      }
      if (!improved) break;
    }
    const STEP = 224, positions = new Map();
    for (const tier of tiers.slice().reverse()) {
      const ids = order.get(tier), desired = new Map(ids.map((id, index) => { const childXs = [...(children.get(id) || []), ...(layoutChildren.get(id) || [])].filter(child => rank.get(child) > tier).map(child => positions.get(child)?.x).filter(Number.isFinite); return [id, childXs.length ? childXs.reduce((sum, x) => sum + x, 0) / childXs.length : index * STEP]; }));
      // Координаты могут сдвигаться, но порядок слоя после оптимизации менять
      // нельзя: иначе packing снова вернёт устранённые пересечения.
      const resolved = ids, blocks = [];
      // Isotonic packing distributes collisions around their barycenter. A simple
      // left-to-right push drifts shared parents past the rightmost child.
      resolved.forEach((id, index) => {
        blocks.push({start:index, end:index, sum:desired.get(id) - index * STEP, count:1});
        while (blocks.length > 1 && blocks.at(-2).sum / blocks.at(-2).count > blocks.at(-1).sum / blocks.at(-1).count) { const right = blocks.pop(), left = blocks.pop(); blocks.push({start:left.start, end:right.end, sum:left.sum + right.sum, count:left.count + right.count}); }
      });
      for (const packed of blocks) { const offset = packed.sum / packed.count; for (let index = packed.start; index <= packed.end; index++) { const id = resolved[index], x = offset + index * STEP; positions.set(id, {tier, gameTier: byId.get(id).tier, x, column: Math.round(x / STEP)}); } }
    }
    const minimum = Math.min(0, ...[...positions.values()].map(position => position.x)), shift = minimum < 0 ? -minimum + 12 : 12;
    positions.forEach(position => { position.x += shift; position.column = Math.round(position.x / STEP); });
    const width = Math.max(STEP + 24, ...[...positions.values()].map(position => position.x + 204 + 12));
    return {layers: tiers.map(tier => ({tier, ids: order.get(tier), gameTiers: [...new Set(order.get(tier).map(id => byId.get(id).tier))].sort((a, b) => a - b)})), positions, columns: Math.max(1, Math.ceil(width / STEP)), width, initialCrossings, crossings:crossingCount};
  }
  const EXPORT_CARD_WIDTH = 214, EXPORT_CARD_HEIGHT = 142, EXPORT_LAYER_HEIGHT = 174;
  function exportNodeStatus(node, state) {
    if (node.planRole === 'target') return 'Target';
    if (node.planRole === 'tier-filler') return 'Tier filler';
    if (state.researched.has(node.tech.id)) return 'Researched';
    if (state.alternatives.has(node.tech.id)) return 'Offered';
    return node.planRole === 'prerequisite' ? 'Required' : 'Planned';
  }
  // Независимая от DOM сцена объединяет науки в одно дерево. Это оставляет
  // междисциплинарные prerequisites рядом с веткой, а не между секциями PNG.
  function buildExportScene(model) {
    if (!model?.reduced || !model?.state) throw new Error('Technology plan is not ready.');
    const state = model.state, nodes = model.reduced.nodes, layout = layoutTree(nodes, gateLayoutLinks(model.reduced));
    const gates = AREAS.flatMap(area => gateProgress(state, model.reduced, area).map(gate => ({...gate, area})));
    const layerCount = Math.max(1, layout.layers.length), headerHeight = 82 + Math.max(0, gates.length - 1) * 19;
    const section = {area:'all', title:'Technology tree', x:24, y:24, width:Math.max(560, Math.ceil(layout.width + 68)), height:headerHeight + layerCount * EXPORT_LAYER_HEIGHT + 24, headerHeight, layout, gates, cards:[]};
    const visualLayers = layout.layers.slice().reverse();
    for (let layerIndex = 0; layerIndex < visualLayers.length; layerIndex++) for (const id of visualLayers[layerIndex].ids) {
      const node = nodes.find(value => value.tech.id === id), position = layout.positions.get(id); if (!node || !position) continue;
      const tech = node.tech, effects = plannedNodeEffects(node, model.reduced, state), card = {id, tech, x:section.x + position.x, y:section.y + section.headerHeight + layerIndex * EXPORT_LAYER_HEIGHT, width:EXPORT_CARD_WIDTH, height:EXPORT_CARD_HEIGHT, title:displayName(tech), badge:exportNodeStatus(node, state), tier:tech.tier, cost:cost(tech), weight:weight(tech, state), effects};
      section.cards.push(card);
    }
    const sections = [section], width = section.width + 48, height = section.y + section.height + 30;
    const cards = sections.flatMap(section => section.cards), cardById = new Map(cards.map(card => [card.id, card])), connections = [];
    for (const card of cards) for (const parentId of card.tech.prerequisites || []) {
      const parent = cardById.get(parentId); if (!parent) continue;
      connections.push({parentId, childId:card.id, crossArea:parent.tech.area !== card.tech.area, kind:'prerequisite'});
    }
    const gateConnections = [];
    for (const slot of model.reduced.fillerSlots || []) {
      const filler = cardById.get(slot.selected.tech.id), gate = cardById.get(slot.gateTech.id);
      if (!filler || !gate || filler.id === gate.id) continue;
      const key = `${filler.id}|${gate.id}`;
      if (gateConnections.some(link => link.key === key)) continue;
      gateConnections.push({key, parentId:filler.id, childId:gate.id, crossArea:filler.tech.area !== gate.tech.area, kind:'tier-gate'});
    }
    const allConnections = [...connections, ...gateConnections], ports = new Map(), addPort = (key, link) => { if (!ports.has(key)) ports.set(key, []); ports.get(key).push(link); };
    for (const link of allConnections) {
      const parent = cardById.get(link.parentId), child = cardById.get(link.childId), parentSide = parent.y > child.y ? 'top' : 'bottom', childSide = parentSide === 'top' ? 'bottom' : 'top';
      link.parentSide = parentSide; link.childSide = childSide; addPort(`${parent.id}|${parentSide}`, link); addPort(`${child.id}|${childSide}`, link);
    }
    ports.forEach(items => items.sort((left, right) => {
      const leftOther = left.parentId === items[0].parentId ? cardById.get(left.childId) : cardById.get(left.parentId), rightOther = right.parentId === items[0].parentId ? cardById.get(right.childId) : cardById.get(right.parentId);
      return leftOther.x - rightOther.x || left.parentId.localeCompare(right.parentId) || left.childId.localeCompare(right.childId);
    }));
    const portX = (id, side, link) => { const items = ports.get(`${id}|${side}`), index = items.indexOf(link); return (index + 1) / (items.length + 1); };
    for (const link of allConnections) {
      const parent = cardById.get(link.parentId), child = cardById.get(link.childId);
      link.from = {x:parent.x + parent.width * portX(parent.id, link.parentSide, link), y:link.parentSide === 'top' ? parent.y : parent.y + parent.height};
      link.to = {x:child.x + child.width * portX(child.id, link.childSide, link), y:link.childSide === 'top' ? child.y : child.y + child.height};
    }
    return {width, height, areas:sections, cards, connections:allConnections};
  }
  function exportScale(scene) {
    const maxDimension = 8192, maxPixels = 16 * 1024 * 1024;
    return Math.min(2, maxDimension / scene.width, maxDimension / scene.height, Math.sqrt(maxPixels / (scene.width * scene.height)));
  }
  function techIconPath(tech) { const override = tech?.icon; return override && !override.startsWith('gfx/') ? `../gfx/interface/icons/technologies/${override}.dds` : override ? `../${override}` : `../gfx/interface/icons/technologies/${tech?.id}.dds`; }
  function categoryIconPath(tech) { const name = tech?.categories?.[0], icon = name && scalar(categories.get(name) || '', 'icon'); return icon ? `../${icon}` : ''; }
  function categoryLabel(tech) { return (tech?.categories?.[0] || '').replaceAll('_', ' '); }
  async function exportIcons(scene) {
    const images = new Map(); if (!root.GameArt?.load || !root.GameArt?.canvas) return images;
    let cursor = 0; const worker = async () => { while (cursor < scene.cards.length) { const card = scene.cards[cursor++]; try { const texture = await root.GameArt.load(techIconPath(card.tech)), image = root.GameArt.canvas(texture); if (image) images.set(card.id, image); } catch { /* Одна отсутствующая DDS не должна отменять весь PNG. */ } } };
    await Promise.all(Array.from({length:Math.min(8, scene.cards.length)}, worker));
    await Promise.all([...new Set(scene.cards.map(card => card.tech.categories?.[0]).filter(Boolean))].map(async name => { const path = categoryIconPath({categories:[name]}); if (!path) return; try { images.set(`category:${name}`, root.GameArt.canvas(await root.GameArt.load(path))); } catch { /* Категория остаётся текстом, если её иконка недоступна. */ } }));
    return images;
  }
  function exportText(ctx, text, x, y, maxWidth, maxLines = 2) {
    let remaining = String(text).trim(); const lines = [], fit = (value, suffix = '') => { let end = value.length; while (end > 0 && ctx.measureText(value.slice(0, end) + suffix).width > maxWidth) end--; return value.slice(0, end) + suffix; };
    while (remaining && lines.length < maxLines) {
      if (ctx.measureText(remaining).width <= maxWidth) { lines.push(remaining); remaining = ''; break; }
      let end = remaining.length; while (end > 1 && ctx.measureText(remaining.slice(0, end)).width > maxWidth) end--;
      const whitespace = remaining.lastIndexOf(' ', end); if (whitespace > 0) end = whitespace;
      let line = remaining.slice(0, end).trim(); remaining = remaining.slice(end).trim();
      if (lines.length === maxLines - 1 && remaining) { line = fit(line, '…'); remaining = ''; }
      lines.push(line || fit(String(text), '…'));
    }
    lines.forEach((line, index) => ctx.fillText(line, x, y + index * 14));
  }
  function techPalette(tech) {
    if (tech?.rarity === 'dangerous') return {fill:'#301418', edge:'#df6670', text:'#ffc9cf'};
    if (tech?.rarity === 'rare') return {fill:'#251838', edge:'#ad81de', text:'#ead4ff'};
    if (tech?.area === 'physics') return {fill:'#112438', edge:'#4c93c5', text:'#d6edff'};
    if (tech?.area === 'engineering') return {fill:'#30221a', edge:'#bc8050', text:'#ffe5cb'};
    return {fill:'#102b1c', edge:'#63a973', text:'#dcf2d9'};
  }
  function drawExportScene(ctx, scene, images = new Map()) {
    ctx.fillStyle = '#06120d'; ctx.fillRect(0, 0, scene.width, scene.height);
    for (const section of scene.areas) {
      ctx.fillStyle = '#0a1b13'; ctx.fillRect(section.x, section.y, section.width, section.height);
      ctx.strokeStyle = '#355f4d'; ctx.strokeRect(section.x + .5, section.y + .5, section.width - 1, section.height - 1);
      ctx.fillStyle = '#e8f1e3'; ctx.font = '600 21px Segoe UI, sans-serif'; ctx.fillText(section.title, section.x + 15, section.y + 28);
      ctx.fillStyle = '#a7c7ae'; ctx.font = '12px Segoe UI, sans-serif'; ctx.fillText(section.cards.length ? `${section.cards.length} plan nodes · green = prerequisite · amber dash = tier gate` : 'No target path nodes', section.x + 15, section.y + 48);
      ctx.font = '600 12px Segoe UI, sans-serif';
      section.gates.forEach((gate, index) => {
        const y = section.y + 68 + index * 18;
        ctx.fillStyle = gate.missing ? '#e5c26f' : '#88d19b';
        ctx.fillText(`${gate.area[0].toUpperCase()}${gate.area.slice(1)} · Tier ${gate.tier} gate: ${gate.total}/${gate.gate} · researched ${gate.researched} · planned ${gate.planned}${gate.fillers ? ` (${gate.fillers} filler +1)` : ''}${gate.missing ? ` · missing ${gate.missing}` : ''}`, section.x + 15, y);
      });
    }
    ctx.lineWidth = 1.35;
    for (const link of scene.connections) { const direction = Math.sign(link.to.y - link.from.y) || -1, bend = Math.max(26, Math.abs(link.from.y - link.to.y) * .42); ctx.strokeStyle = link.kind === 'tier-gate' ? '#d4b45d' : '#5a9c79'; ctx.setLineDash?.(link.kind === 'tier-gate' ? [6, 4] : []); ctx.beginPath(); ctx.moveTo(link.from.x, link.from.y); ctx.bezierCurveTo(link.from.x, link.from.y + direction * bend, link.to.x, link.to.y - direction * bend, link.to.x, link.to.y); ctx.stroke(); }
    ctx.setLineDash?.([]);
    for (const section of scene.areas) for (const card of section.cards) {
        const target = card.badge === 'Target', filler = card.badge === 'Tier filler', researched = card.badge === 'Researched';
        const palette = techPalette(card.tech); ctx.fillStyle = palette.fill; ctx.fillRect(card.x, card.y, card.width, card.height); ctx.strokeStyle = palette.edge; ctx.lineWidth = 1.5; ctx.strokeRect(card.x + .5, card.y + .5, card.width - 1, card.height - 1);
        if (target || filler) { ctx.fillStyle = target ? '#e1c460' : '#d4b45d'; ctx.fillRect(card.x, card.y, 4, card.height); }
        const image = images.get(card.id); if (image) ctx.drawImage(image, card.x + card.width - 46, card.y + 9, 36, 36); else { ctx.strokeStyle = '#527965'; ctx.strokeRect(card.x + card.width - 46.5, card.y + 9.5, 36, 36); ctx.fillStyle = '#95b99a'; ctx.font = '20px Segoe UI, sans-serif'; ctx.fillText('◇', card.x + card.width - 36, card.y + 34); }
        const category = card.tech.categories?.[0], categoryImage = images.get(`category:${category}`); if (categoryImage) ctx.drawImage(categoryImage, card.x + 9, card.y + 7, 18, 18);
        ctx.fillStyle = target ? '#f0df90' : filler ? '#f0ca79' : researched ? '#a9bca8' : palette.text; ctx.font = '600 11px Segoe UI, sans-serif'; ctx.fillText(card.badge, card.x + (categoryImage ? 31 : 10), card.y + 18);
        ctx.fillStyle = '#eef6ec'; ctx.font = '600 15px Segoe UI, sans-serif'; exportText(ctx, card.title, card.x + 10, card.y + 40, card.width - 64);
        ctx.fillStyle = '#b5cdb9'; ctx.font = '12px Segoe UI, sans-serif'; exportText(ctx, `Tier ${card.tier} · cost ${card.cost.value.toFixed(0)}`, card.x + 10, card.y + 81, card.width - 20, 1);
        exportText(ctx, `Weight ${card.weight.value.toFixed(1)}${card.weight.unknown.length ? ' · partial' : ''}`, card.x + 10, card.y + 96, card.width - 20, 1);
        nodeEffectLabels(card.effects).forEach((effect, index) => { ctx.fillStyle = index === 0 && card.effects.gateTiers.length ? '#f0ca79' : '#9bd3ac'; ctx.font = '600 11px Segoe UI, sans-serif'; exportText(ctx, effect, card.x + 10, card.y + 114 + index * 16, card.width - 20, 1); });
    }
  }
  async function renderExportImage() {
    const model = currentPlannerModel(); if (!model) throw new Error('Open a save before exporting a PNG.');
    const scene = buildExportScene(model), scale = exportScale(scene), canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(scene.width * scale)); canvas.height = Math.max(1, Math.ceil(scene.height * scale));
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas export is unavailable in this browser.');
    ctx.scale(scale, scale); drawExportScene(ctx, scene, await exportIcons(scene));
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); if (!blob) throw new Error('Could not encode the PNG.');
    return {scene, canvas, blob, scale};
  }
  async function exportPng() {
    const {scene, canvas, blob, scale} = await renderExportImage();
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'stellaris-technology-plan.png'; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    scene.output = {width:canvas.width, height:canvas.height, bytes:blob.size, scale};
    return scene;
  }
  function compactChoiceText(item) {
    const parts = []; if (item.targetCompletions) parts.push(`Completes ${item.targetCompletions} target${item.targetCompletions === 1 ? '' : 's'}`); else if (item.targetExposure) parts.push(`Unlocks ${item.targetExposure} target${item.targetExposure === 1 ? '' : 's'}`); else if (item.plan) parts.push(item.tier ? 'Advances tier gate' : 'Advances plan');
    if (item.usefulUnlocks) parts.push(`opens ${item.usefulUnlocks} plan node${item.usefulUnlocks === 1 ? '' : 's'}`); return parts;
  }
  function signedImpact(label, value, digits = 0, tag = 'em') { const shown = Number(value.toFixed(digits)); return shown ? `<${tag} class="${shown > 0 ? 'is-bad' : 'is-good'}">${label} ${shown > 0 ? '+' : ''}${shown.toFixed(digits)}</${tag}>` : ''; }
  function fillerCard(item, index, future = false) {
    const ownPool = item.ownPoolDelta ?? item.poolDelta ?? 0, ownWeight = item.ownWeightDelta ?? item.weightDelta ?? 0, impact = [signedImpact('Own pool', ownPool, 0, 'span'), signedImpact('Own weight', ownWeight, 1, 'span'), signedImpact('Other pools', item.crossPoolDelta || 0, 0, 'span'), signedImpact('Other weight', item.crossWeightDelta || 0, 1, 'span')].filter(Boolean);
    if (item.sharedPathBenefit) impact.push(`<span class="is-good">Shared +${item.sharedPathBenefit}</span>`);
    const effort = item.totalCost ?? item.effort ?? cost(item.tech).value, prerequisites = item.prerequisiteCount ?? item.tech.prerequisites.length, offered = item.offeredNow ? '<span class="tech-status-badge tech-offered-badge">Offered now</span>' : '', fit = future && item.gates?.length ? `Fits: ${escape(item.gates.map(gate => displayName(definitions.byId.get(gate.split(' ')[0]))).join(', '))}` : 'Drawable now';
    return `<article class="tech-filler-card${item.offeredNow ? ' tech-offered' : ''}"><span class="tech-icon" data-tech-icon="${escape(item.tech.id)}"></span><div><span class="tech-filler-rank">#${index + 1}</span>${offered}<b>${escape(displayName(item.tech))}</b><small>${escape(item.tech.area)} · tier ${item.tech.tier} · score ${item.score.toFixed(1)}${item.partial ? ' · partial' : ''}</small></div><p>Cost ${effort.toFixed(0)} · ${prerequisites} prerequisite${prerequisites === 1 ? '' : 's'}${impact.length ? `<br>${impact.join(' · ')}` : ''}</p><small class="tech-filler-fit">${fit}</small><div class="tech-filler-actions"><button class="tech-filler-action" data-research-tech="${escape(item.tech.id)}" type="button">Mark researched</button><button class="tech-filler-action tech-exclude-action" data-exclude-tech="${escape(item.tech.id)}" type="button">Exclude</button></div></article>`;
  }
  function nodeBadge(node, state, result) {
    if (node?.planRole === 'target') return 'Target';
    if (node?.planRole === 'tier-filler') return 'Tier filler';
    if (state.researched.has(node?.tech.id)) return 'Researched';
    if (state.alternatives.has(node?.tech.id)) return 'Offered';
    if (node?.planRole === 'prerequisite') return 'Required';
    return result.status === 'locked' ? 'Locked' : result.status === 'blocked' ? 'Blocked' : 'Drawable';
  }
  // Снимок не зависит от открытой science-вкладки: её смена использует те же расчёты.
  function currentPlannerModel() {
    if (!definitions || !save || typeof document === 'undefined') return null;
    const empire = document.querySelector('#tech-empire')?.value || '', state = selectedState();
    if (!state) return null;
    targets = new Set([...targets].filter(id => visibleTargetTech(definitions.byId.get(id), state)));
    const forbiddenExclusions = targetRequirements(targets); state.researched.forEach(id => forbiddenExclusions.add(id)); simulated.forEach(id => forbiddenExclusions.add(id));
    for (const id of forbiddenExclusions) excludedTechs.delete(id);
    selectedTarget = [...targets][0] || '';
    const modelKey = plannerStateKey(empire);
    return cachedPlannerModel(modelKey, () => {
      const reduced = buildReducedPlan(state, targets);
      return {key: modelKey, state, reduced, allFillers: rankFillerAlternatives(state, reduced), targetOptions: [...definitions.byId.values()].filter(tech => visibleTargetTech(tech, state)).sort((a, b) => displayName(a).localeCompare(displayName(b))).map(tech => `<option value="${escape(tech.id)}">${escape(displayName(tech))}</option>`).join(''), sideByArea: new Map(), availableFillersByArea: new Map(), fillerImpactCache: new Map(), unifiedLayout:null};
    });
  }
  function areaLabel(areaName) { return areaName ? `${areaName[0].toUpperCase()}${areaName.slice(1)}` : 'Unknown'; }
  function unifiedGateProgress(state, reduced) { return AREAS.flatMap(areaName => gateProgress(state, reduced, areaName).map(gate => ({...gate, area:areaName}))); }
  function gateSummaryHtml(gates) {
    if (!gates.length) return '';
    return `<section class="tech-gate-summary" aria-label="Tier gate progress by research area"><strong>Tier gates</strong><span class="tech-gate-key"><i></i> prerequisite <i class="tech-gate-key-fill"></i> selected filler</span>${gates.map(gate => `<article class="tech-gate-progress tech-gate-area-${escape(gate.area)}${gate.missing ? ' is-incomplete' : ''}"><b>${escape(areaLabel(gate.area))} · Tier ${gate.tier}</b><span>${gate.total}/${gate.gate}</span><small>${gate.researched} researched · ${gate.planned} planned${gate.fillers ? ` · ${gate.fillers} filler +1` : ''}${gate.missing ? ` · ${gate.missing} missing` : ''}</small></article>`).join('')}</section>`;
  }
  function bindTechActions(container, state, reduced) {
    container.querySelectorAll('[data-research-tech]').forEach(button => button.addEventListener('click', () => { if (markResearched(button.dataset.researchTech)) render(); }));
    container.querySelectorAll('[data-exclude-tech]').forEach(button => button.addEventListener('click', () => { if (excludeTech(button.dataset.excludeTech, state, reduced)) render(); }));
  }
  function renderUnifiedTree(tree, model) {
    // Вкладка науки не входит в ключ модели: при её смене живое дерево и его
    // прокрутка остаются на месте, меняются только боковые рекомендации.
    if (tree.dataset.plannerKey === model.key) return;
    const {state, reduced} = model, nodeById = new Map(reduced.nodes.map(node => [node.tech.id, node]));
    const layout = model.unifiedLayout || layoutTree(reduced.nodes, gateLayoutLinks(reduced));
    model.unifiedLayout = layout;
    const gates = unifiedGateProgress(state, reduced);
    tree.innerHTML = `${gateSummaryHtml(gates)}<div class="tech-tree-note">Dependencies are arranged bottom → top across Physics, Society, and Engineering. Hover or focus a card to isolate its branch. <span>Green lines = prerequisites; amber dashed lines = tier fillers, not prerequisites.</span></div><div class="tech-tree-canvas" style="--tech-tree-width:${layout.width}px">${layout.layers.slice().reverse().map(layer => { const items = layer.ids.map(id => { const tech = definitions.byId.get(id), node = nodeById.get(id), result = evaluate(tech, state), w = weight(tech, state), missing = result.missing || [], position = layout.positions.get(id), badge = nodeBadge(node, state, result), effects = plannedNodeEffects(node, reduced, state), research = /^available/.test(result.status) || state.alternatives.has(tech.id) ? `<button data-research-tech="${escape(tech.id)}" type="button">Mark researched</button>` : '', exclude = canExcludeTech(tech.id, state, node ? {nodes:[node]} : null) ? `<button class="tech-exclude-action" data-exclude-tech="${escape(tech.id)}" type="button">Exclude</button>` : ''; const requirement = missing.length ? `Needs ${escape(missing.slice(0, 2).map(value => label(value)).join(', '))}${missing.length > 2 ? '…' : ''}` : '', effectLabels = nodeEffectLabels(effects); return `<article class="tech-card ${result.status}${targets.has(tech.id) ? ' tech-targeted' : ''}${state.alternatives.has(tech.id) ? ' tech-offered' : ''}${effects.gateTiers.length ? ' tech-tier-filler' : ''}" style="left:${position.x}px" tabindex="0" data-tech-id="${escape(tech.id)}" data-tech-area="${escape(tech.area)}" data-gate-targets="${escape((reduced.fillerSlots || []).filter(slot => slot.selected.tech.id === tech.id).map(slot => slot.gateTech.id).join(' '))}"><span class="tech-icon" data-tech-icon="${escape(tech.id)}"></span><span class="tech-status-badge">${escape(badge)}</span><h4>${escape(displayName(tech))}</h4><p class="tech-card-stats">${escape(areaLabel(tech.area))} · Tier ${tech.tier} · cost ${cost(tech).value.toFixed(0)} · weight ${w.value.toFixed(1)}${w.unknown.length ? ' · partial' : ''}</p>${effectLabels.map(effect => `<p class="tech-card-effect">${escape(effect)}</p>`).join('')}${requirement ? `<p class="tech-card-requirement">${requirement}</p>` : ''}${research || exclude ? `<div class="tech-card-actions">${research}${exclude}</div>` : ''}</article>`; }).join(''); const tierLabel = layer.gameTiers.length === 1 ? `Tier ${layer.gameTiers[0]}` : `Tiers ${layer.gameTiers.join(', ')}`; return `<section class="tech-tier tech-tier-${layer.tier}"><h3>${tierLabel}<small>path layer ${layer.tier}</small></h3><div class="tech-tier-cards">${items}</div></section>`; }).join('')}</div>`;
    tree.querySelector('.tech-tree-note span').textContent = 'Green lines = prerequisites; violet = cross-science prerequisites; amber dashed = tier fillers.';
    tree.dataset.plannerKey = model.key;
    decorateTechCards(tree); bindTreeBranchFocus(tree); bindTechActions(tree, state, reduced);
    sizeTreeRows(tree); renderIcons(tree); requestAnimationFrame(() => drawConnectors(tree));
  }
  function render() {
    const status = document.querySelector('#tech-status'), tree = document.querySelector('#tech-tree'), plan = document.querySelector('#tech-plan'), fillerList = document.querySelector('#tech-filler-list');
    if (!definitions || !save) return;
    const treeScroll = {left:tree.scrollLeft, top:tree.scrollTop}, fillerScroll = fillerList.scrollTop;
    const model = currentPlannerModel();
    if (!model) { status.textContent = 'Choose an empire.'; return; }
    const {state, reduced} = model; const targetList = document.querySelector('#tech-target-list'); if (targetList && targetList.dataset.plannerKey !== model.key) { targetList.innerHTML = model.targetOptions; targetList.dataset.plannerKey = model.key; }
    const fillerAlternatives = filterFillerAlternatives(model.allFillers, area), planItems = model.sideByArea.get(area) || rankSideChoices(state, area, reduced, {impactCache:model.fillerImpactCache}); model.sideByArea.set(area, planItems);
    const availableFillers = model.availableFillersByArea.get(area) || rankAvailableFillers(state, area, reduced, model.fillerImpactCache); model.availableFillersByArea.set(area, availableFillers);
    document.querySelector('#tech-targets').innerHTML = [...targets].map(id => `<button data-remove-target="${escape(id)}">${escape(displayName(definitions.byId.get(id)))} ×</button>`).join('') || 'No targets selected.';
    document.querySelectorAll('[data-remove-target]').forEach(button => button.addEventListener('click', () => { targets.delete(button.dataset.removeTarget); plannerCache.clear(); render(); }));
    const exclusions = document.querySelector('#tech-exclusions');
    exclusions.innerHTML = excludedTechs.size ? `<strong>Excluded:</strong>${[...excludedTechs].sort().map(id => `<button data-restore-exclusion="${escape(id)}">${escape(displayName(definitions.byId.get(id)))} ×</button>`).join('')}<button class="tech-exclusion-clear" data-clear-exclusions>Clear exclusions</button>` : '';
    exclusions.querySelectorAll('[data-restore-exclusion]').forEach(button => button.addEventListener('click', () => { if (restoreExcludedTech(button.dataset.restoreExclusion)) render(); }));
    exclusions.querySelector('[data-clear-exclusions]')?.addEventListener('click', () => { if (clearExcludedTechs()) render(); });
    const byArea = Object.fromEntries(AREAS.map(areaName => [areaName, reduced.nodes.filter(node => node.tech.area === areaName).length]));
    status.textContent = `${reduced.nodes.length} planned nodes · Physics ${byArea.physics} · Society ${byArea.society} · Engineering ${byArea.engineering} · ${state.researched.size} researched${simulated.size ? ` · ${simulated.size} simulated` : ''} · plan saved locally`;
    plan.innerHTML = targets.size ? `<div class="tech-plan-heading"><strong>${targets.size} target${targets.size === 1 ? '' : 's'}</strong><small>${reduced.nodes.length} planned nodes${reduced.incomplete.length ? ` · ${reduced.incomplete.length} missing definitions` : ''}${reduced.blockedByExclusion.length ? ` · blocked by exclusion: ${escape(reduced.blockedByExclusion.map(id => displayName(definitions.byId.get(id))).join(', '))}` : ''}</small></div><div class="tech-choice-grid">${planItems.slice(0, 8).map((item, index) => { const words = compactChoiceText(item), metrics = [signedImpact('Own pool', item.poolDelta), signedImpact('Own weight', item.weightDelta, 1), signedImpact('Other pools', item.crossPoolDelta), signedImpact('Other weight', item.crossWeightDelta, 1)].join(''), exclude = canExcludeTech(item.tech.id, state, reduced) ? `<button class="tech-exclude-action tech-choice-exclude" data-exclude-tech="${escape(item.tech.id)}" type="button">Exclude</button>` : ''; return `<div class="tech-choice-card"><button class="tech-choice-select" data-research-tech="${escape(item.tech.id)}" type="button"><span class="tech-choice-rank">${index + 1}</span><b>${escape(displayName(item.tech))}</b><small>${escape(words.join(' · ') || 'Neutral next choice')}</small><span class="tech-choice-metrics">${metrics}<em>Cost ${item.effort.toFixed(0)}</em></span></button>${exclude}</div>`; }).join('')}</div>` : 'Add one or more technology targets.';
    const currentFillerIds = new Set(availableFillers.map(item => item.tech.id)), futureFillers = fillerAlternatives.items.filter(item => !currentFillerIds.has(item.tech.id));
    fillerList.innerHTML = `<small class="tech-filler-summary">${availableFillers.length} available fillers · off-tree technologies drawable now · best → worst</small>${availableFillers.length ? availableFillers.map((item, index) => fillerCard(item, index)).join('') : `<p class="tech-filler-empty">No off-tree ${escape(area)} technology is drawable now.</p>`}${futureFillers.length ? `<div class="tech-filler-future"><strong>Future tier alternatives</strong><small>Not drawable now; shown for later tier gates.</small></div>${futureFillers.map((item, index) => fillerCard(item, index, true)).join('')}` : ''}`;
    renderUnifiedTree(tree, model);
    decorateTechCards(fillerList); bindTechActions(plan, state, reduced); bindTechActions(fillerList, state, reduced);
    tree.scrollLeft = treeScroll.left; tree.scrollTop = treeScroll.top; fillerList.scrollTop = fillerScroll;
    persistPlan(); renderIcons(fillerList);
  }
  function sizeTreeRows(tree) { tree.querySelectorAll('.tech-tier-cards').forEach(row => { const value = `${Math.max(122, ...[...row.querySelectorAll('.tech-card')].map(card => card.offsetHeight + 8))}px`; if (row.style.height !== value) row.style.height = value; }); }
  function decorateTechCards(container) {
    container.querySelectorAll('.tech-card, .tech-filler-card').forEach(card => {
      const id = card.dataset.techId || card.querySelector('[data-tech-icon]')?.dataset.techIcon, tech = definitions.byId.get(id);
      if (!tech) return;
      card.classList.add(`tech-rarity-${tech.rarity || 'common'}`, `tech-area-${tech.area}`);
      const category = tech.categories?.[0]; if (!category) return;
      const slot = document.createElement('span'); slot.className = 'tech-category-icon'; slot.title = categoryLabel(tech); slot.setAttribute('aria-label', categoryLabel(tech)); slot.dataset.techCategory = category;
      if (card.classList.contains('tech-card')) card.querySelector('.tech-status-badge')?.before(slot);
      else card.querySelector('.tech-icon')?.nextElementSibling?.prepend(slot);
    });
  }
  function renderIcons(tree) {
    tree.querySelectorAll('[data-tech-icon]').forEach(slot => { const tech = definitions.byId.get(slot.dataset.techIcon); root.GameArt?.load(techIconPath(tech)).then(root.GameArt.canvas).then(canvas => slot.replaceChildren(canvas)).catch(() => { slot.textContent = '◇'; }); });
    tree.querySelectorAll('[data-tech-category]').forEach(slot => { const path = categoryIconPath({categories:[slot.dataset.techCategory]}); if (path) root.GameArt?.load(path).then(root.GameArt.canvas).then(canvas => slot.replaceChildren(canvas)).catch(() => { slot.textContent = slot.dataset.techCategory.slice(0, 1).toUpperCase(); }); });
  }
  function bindTreeBranchFocus(tree) {
    const cards = new Map([...tree.querySelectorAll('.tech-card')].map(card => [card.dataset.techId, card]));
    const parents = new Map(), children = new Map();
    const connect = (parent, child) => {
      if (!cards.has(parent) || !cards.has(child)) return;
      if (!parents.has(child)) parents.set(child, new Set());
      if (!children.has(parent)) children.set(parent, new Set());
      parents.get(child).add(parent); children.get(parent).add(child);
    };
    cards.forEach((card, id) => {
      definitions.byId.get(id)?.prerequisites.forEach(parent => connect(parent, id));
      (card.dataset.gateTargets || '').split(' ').filter(Boolean).forEach(target => connect(id, target));
    });
    const clear = () => {
      tree.classList.remove('tech-branch-focused');
      cards.forEach(card => card.classList.remove('tech-branch-active'));
      tree.querySelectorAll('.tech-connectors path.tech-branch-active').forEach(path => path.classList.remove('tech-branch-active'));
    };
    const activate = id => {
      const active = new Set([id]);
      for (const linked of [parents, children]) {
        const pending = [id];
        while (pending.length) for (const next of linked.get(pending.pop()) || []) if (!active.has(next)) { active.add(next); pending.push(next); }
      }
      tree.classList.add('tech-branch-focused');
      cards.forEach((card, cardId) => card.classList.toggle('tech-branch-active', active.has(cardId)));
      tree.querySelectorAll('.tech-connectors path').forEach(path => path.classList.toggle('tech-branch-active', active.has(path.dataset.fromTech) && active.has(path.dataset.toTech)));
    };
    cards.forEach((card, id) => {
      card.addEventListener('mouseenter', () => activate(id));
      card.addEventListener('mouseleave', () => { if (!card.contains(document.activeElement)) clear(); });
      card.addEventListener('focusin', () => activate(id));
      card.addEventListener('focusout', event => { if (!card.contains(event.relatedTarget)) clear(); });
    });
  }
  function drawConnectors(tree) {
    if (tree.closest('[hidden]')) return;
    tree.querySelector('.tech-connectors')?.remove();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.classList.add('tech-connectors');
    const base = tree.getBoundingClientRect(), width = tree.scrollWidth, height = tree.scrollHeight;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.style.width = `${width}px`; svg.style.height = `${height}px`;
    const point = (rect, x, y) => ({x: rect.left - base.left + tree.scrollLeft + x, y: rect.top - base.top + tree.scrollTop + y});
    const cards = new Map([...tree.querySelectorAll('.tech-card')].map(card => [card.dataset.techId, card]));
    const links = [], unique = new Set(), add = (fromId, toId, kind) => {
      const key = `${fromId}|${toId}|${kind}`;
      if (!cards.has(fromId) || !cards.has(toId) || fromId === toId || unique.has(key)) return;
      unique.add(key); links.push({fromId, toId, kind});
    };
    cards.forEach((card, childId) => definitions.byId.get(childId)?.prerequisites.forEach(parentId => add(parentId, childId, 'prerequisite')));
    tree.querySelectorAll('[data-gate-targets]').forEach(card => {
      for (const gateId of (card.dataset.gateTargets || '').split(' ').filter(Boolean)) {
        add(card.dataset.techId, gateId, 'tier-gate');
      }
    });
    const rects = new Map([...cards].map(([id, card]) => [id, card.getBoundingClientRect()])), outgoing = new Map(), incoming = new Map();
    for (const link of links) { if (!outgoing.has(link.fromId)) outgoing.set(link.fromId, []); if (!incoming.has(link.toId)) incoming.set(link.toId, []); outgoing.get(link.fromId).push(link); incoming.get(link.toId).push(link); }
    const otherX = (link, source) => rects.get(source ? link.toId : link.fromId).left;
    outgoing.forEach(items => items.sort((a, b) => otherX(a, true) - otherX(b, true) || a.toId.localeCompare(b.toId)));
    incoming.forEach(items => items.sort((a, b) => otherX(a, false) - otherX(b, false) || a.fromId.localeCompare(b.fromId)));
    const port = (items, link) => (items.indexOf(link) + 1) / (items.length + 1);
    for (const link of links) {
      const lower = rects.get(link.fromId), higher = rects.get(link.toId), from = point(lower, lower.width * port(outgoing.get(link.fromId), link), 0), to = point(higher, higher.width * port(incoming.get(link.toId), link), higher.height), bend = Math.max(28, Math.abs(from.y - to.y) * (link.kind === 'tier-gate' ? .34 : .42)), path = document.createElementNS(svg.namespaceURI, 'path');
      path.setAttribute('d', `M ${from.x} ${from.y} C ${from.x} ${from.y - bend}, ${to.x} ${to.y + bend}, ${to.x} ${to.y}`);
      path.dataset.fromTech = link.fromId; path.dataset.toTech = link.toId;
      if (outgoing.get(link.fromId).filter(item => item.kind === 'prerequisite').length > 1) path.classList.add('tech-shared-branch');
      if (link.kind === 'tier-gate') path.classList.add('tech-tier-gate-link');
      if (definitions.byId.get(link.fromId)?.area !== definitions.byId.get(link.toId)?.area) path.classList.add('tech-cross-area-link');
      svg.append(path);
    }
    tree.prepend(svg);
  }
  async function loadDefinitions() {
    if (definitions) return definitions;
    const manifestResponse = await fetch('technology-manifest'); if (!manifestResponse.ok) throw new Error('technology manifest'); const manifest = await manifestResponse.json();
    const get = async path => { const response = await fetch('../' + path); if (!response.ok) throw new Error(path); return response.text(); };
    const techFiles = manifest.technology.filter(path => !/\/(?:tier|category)\//.test(path));
    const response = await Promise.all([...techFiles.map(get), get('common/technology/tier/00_tier.txt'), get('common/technology/category/00_category.txt'), ...manifest.variables.map(get), ...(manifest.civics || []).map(get)]);
    const variableStart = techFiles.length + 2, civicStart = variableStart + manifest.variables.length, variablesText = response.slice(variableStart, civicStart).join('\n'), categoryText = response[techFiles.length + 1];
    immutableCivics = new Set(response.slice(civicStart).flatMap(text => entries(text).filter(item => item.key?.startsWith('civic_') && item.block && scalar(item.block, 'modification') === 'no').map(item => item.key)));
    categories = new Map(entries(categoryText).filter(item => item.key && item.block).map(item => [item.key, item.block]));
    scriptedVariables = new Map(entries(variablesText).filter(item => item.key?.startsWith('@') && Number.isFinite(Number(item.scalar))).map(item => [item.key, Number(item.scalar)]));
    response.slice(0, techFiles.length).forEach(text => entries(text).filter(item => item.key?.startsWith('@') && Number.isFinite(Number(item.scalar))).forEach(item => scriptedVariables.set(item.key, Number(item.scalar))));
    definitions = parseDefinitions(response.slice(0, techFiles.length), response[techFiles.length]); return definitions;
  }
  async function setSave(next, options = {}) {
    const revision = ++loadRevision;
    const previousEmpire = options.preserve ? document.querySelector('#tech-empire').value : '';
    save = next; simulated.clear(); simulatedLevels.clear(); consumedOfferAreas.clear(); history = []; clearPlannerCaches();
    const select = document.querySelector('#tech-empire'), listElement = document.querySelector('#tech-target-list'), status = document.querySelector('#tech-status');
    select.innerHTML = next.countries.filter(c => c.isEmpire).map(c => `<option value="${escape(c.id)}">${escape(c.name)}</option>`).join('') || '<option value="">No regular empires</option>';
    if (previousEmpire && next.countries.some(c => String(c.id) === previousEmpire)) select.value = previousEmpire;
    try { status.textContent = 'Reading installed technology definitions…'; await loadDefinitions(); if (revision !== loadRevision) return; if (!options.preserve) restorePlan(); listElement.innerHTML = [...definitions.byId.values()].sort((a, b) => displayName(a).localeCompare(displayName(b))).map(t => `<option value="${escape(t.id)}">${escape(displayName(t))}</option>`).join(''); render(); }
    catch (error) { console.error('Technology planner initialization failed:', error); if (revision === loadRevision) status.textContent = `Could not read local technology definitions: ${error.message}`; }
  }
  function clear() {
    loadRevision++; save = undefined; simulated.clear(); simulatedLevels.clear(); consumedOfferAreas.clear(); history = []; selectedTarget = ''; clearPlannerCaches();
    const status = document.querySelector('#tech-status'), select = document.querySelector('#tech-empire');
    status.textContent = 'Open a save to plan research.';
    select.innerHTML = '<option value="">Load a save</option>';
    document.querySelector('#tech-plan').textContent = 'Load a save to calculate a path.';
    const tree = document.querySelector('#tech-tree'); tree.textContent = 'Technology definitions are loaded from this Stellaris installation.'; delete tree.dataset.plannerKey;
    document.querySelector('#tech-filler-list').textContent = 'Add targets to compare tier fillers.';
  }
  function findTarget(value) {
    const needle = value.trim().toLowerCase(); if (!needle || !definitions) return null;
    const candidate = definitions.byId.get(value) || [...definitions.byId.values()].find(t => displayName(t).toLowerCase() === needle) || [...definitions.byId.values()].find(t => t.id.includes(needle) || displayName(t).toLowerCase().includes(needle)) || null;
    const state = typeof document === 'undefined' ? null : selectedState(); return candidate && (!state || visibleTargetTech(candidate, state)) ? candidate : null;
  }
  function targetFromInput(value) {
    if (!value.trim() || !definitions) { render(); return; }
    const tech = findTarget(value);
    if (tech) { targetRequirements([tech.id]).forEach(id => excludedTechs.delete(id)); targets.add(tech.id); selectedTarget = tech.id; area = tech.area; document.querySelectorAll('[data-tech-area]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.techArea === area))); plannerCache.clear(); } render();
  }
  function init() {
    document.querySelector('#tech-empire').addEventListener('change', () => { simulated.clear(); simulatedLevels.clear(); consumedOfferAreas.clear(); history = []; plannerCache.clear(); render(); });
    document.querySelector('#tech-target').addEventListener('change', event => targetFromInput(event.target.value));
    document.querySelector('#tech-target').addEventListener('search', event => targetFromInput(event.target.value));
    document.querySelector('#tech-add-target').addEventListener('click', () => targetFromInput(document.querySelector('#tech-target').value));
    document.querySelector('#tech-clear-target').addEventListener('click', () => { targets.clear(); document.querySelector('#tech-target').value = ''; plannerCache.clear(); render(); });
    document.querySelector('#tech-export').addEventListener('click', () => { if (!definitions) { document.querySelector('#tech-status').textContent = 'Open a save before exporting a plan.'; return; } const blob = new Blob([JSON.stringify(serializePlan(), null, 2)], {type:'application/json'}); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'stellaris-tech-plan.json'; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 0); });
    document.querySelector('#tech-export-png').addEventListener('click', async () => { const status = document.querySelector('#tech-status'); try { status.textContent = 'Rendering unified technology tree…'; const scene = await exportPng(); status.textContent = `PNG exported · ${scene.cards.length} plan nodes across three sciences · ${scene.output.width}×${scene.output.height} · ${Math.max(1, Math.round(scene.output.bytes / 1024))} KB.`; } catch (error) { console.error('Technology PNG export failed:', error); status.textContent = `Could not export PNG: ${error.message}`; } });
    document.querySelector('#tech-import').addEventListener('change', async event => { try { const file = event.target.files[0]; if (!file) return; applyPlan(JSON.parse(await file.text())); render(); } catch { document.querySelector('#tech-status').textContent = 'Could not import technology plan.'; } finally { event.target.value = ''; } });
    document.querySelector('#tech-undo').addEventListener('click', () => { undoSimulation(); render(); });
    document.querySelector('#tech-reset').addEventListener('click', () => { simulated.clear(); simulatedLevels.clear(); consumedOfferAreas.clear(); history = []; plannerCache.clear(); render(); });
    document.querySelectorAll('[data-tech-area]').forEach(button => button.addEventListener('click', () => { if (area === button.dataset.techArea) return; area = button.dataset.techArea; document.querySelectorAll('[data-tech-area]').forEach(b => b.setAttribute('aria-pressed', String(b === button))); render(); })); const redrawTree = () => { const tree = document.querySelector('#tech-tree'); if (tree) { sizeTreeRows(tree); drawConnectors(tree); } }; window.addEventListener('resize', redrawTree); if (root.ResizeObserver) new root.ResizeObserver(redrawTree).observe(document.querySelector('#tech-tree'));
  }
  const api = {entries, parseDefinitions, stateFromSave, condition, identityValue, impossibleForCountry, evaluate, weight, cost, closure, buildReducedPlan, gateProgress, unifiedGateProgress, plannedNodeEffects, rankFillerAlternatives, filterFillerAlternatives, rankAvailableFillers, layoutTree, buildExportScene, exportScale, drawExportScene, exportText, poolImpactByArea, consumeAreaOffers, rankSideChoices, recommendation, planSearch, targetPlan, chanceText, applySimulation, serializePlan, validatePlan, applyPlan, canExcludeTech, excludeTech, restoreExcludedTech, clearExcludedTechs, findTarget, setSave, clear, exportPng, redraw: () => drawConnectors(document.querySelector('#tech-tree')), _renderExportImage: renderExportImage, _cachedPlannerModel: cachedPlannerModel, _clearPlannerCaches: clearPlannerCaches, _plannerBuilds: () => plannerBuilds, _markResearched: markResearched, _undoSimulation: undoSimulation, init, _setDefinitions: value => { definitions = value; plannerCache.clear(); impossibleCache.clear(); tierCountCache = new WeakMap(); techScriptCache.clear(); }, _setVariables: value => { scriptedVariables = value; plannerCache.clear(); }, _setImmutableCivics: value => { immutableCivics = value; plannerCache.clear(); }, _setSave: value => { save = value; clearPlannerCaches(); }, _setPlan: value => { targets = new Set(value.targets || []); excludedTechs = new Set(value.excludedTechs || []); simulatedLevels = new Map(value.simulatedLevels || []); simulated = new Set(simulatedLevels.keys()); history = [...(value.history || [])]; consumedOfferAreas = new Set(value.consumedOfferAreas || []); plannerCache.clear(); }};
  root.TechPlanner = api;
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof document !== 'undefined') init();
})(globalThis);
