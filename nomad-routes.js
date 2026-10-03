'use strict';

const NomadRoutes = (() => {
  const formatApi = typeof module !== 'undefined' ? require('./save-format.js') : SaveFormat;
  const threatApi = typeof module !== 'undefined' ? require('./map-threats.js') : MapThreats;
  let catalog = {stars: new Map(), modifiers: new Map()}, unityRules, loading;
  function initialize(starText, modifierTexts, rewardText = '') {
    const read = (text, nested) => new Map(formatApi.entries(text).filter(entry => entry.key && entry.block !== undefined).map(entry => {
      const block = nested ? formatApi.block(entry.block, 'modifier') : entry.block;
      return [entry.key, Number(formatApi.scalar(block, 'ship_speed_reduction')) || 0];
    }));
    catalog = {stars: read(starText, true), modifiers: new Map(modifierTexts.flatMap(text => [...read(text, false)]))};
    const values = ['@tier1unityreward', '@tier1unitymin', '@tier1unitymax'].map(key => {
      const raw = formatApi.scalar(rewardText, key);
      return raw === '' ? NaN : Number(raw);
    });
    unityRules = rewardText && values.every(Number.isFinite) && values[0] > 0 && values[2] >= values[1] ? {multiplier: values[0], minimum: values[1], maximum: values[2]} : undefined;
    return catalog;
  }
  function load() {
    if (!loading) loading = Promise.all(['../common/star_classes/00_star_classes.txt', '../common/static_modifiers/02_static_modifiers.txt', '../common/static_modifiers/10_static_modifiers_ancient_relics.txt', '../common/static_modifiers/23_static_modifiers_biogenesis.txt', '../common/scripted_variables/00_scripted_variables.txt'].map(async path => {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`Cannot load route speed modifiers: ${path}`);
      return response.text();
    })).then(([stars, first, second, third, rewards]) => initialize(stars, [first, second, third], rewards)).catch(error => {loading = undefined; throw error;});
    return loading;
  }
  function reduction(system) {
    return Math.max(0, Math.min(.95, (catalog.stars.get(system.starClass) || 0) + (system.modifiers || []).reduce((sum, key) => sum + (catalog.modifiers.get(key) || 0), 0)));
  }
  function edgeCost(a, b) {
    // Условное время перехода: базовый прыжок плюс транзит с системными штрафами.
    return 1 + .5 / (1 - reduction(a)) + .5 / (1 - reduction(b));
  }
  function unityReward(country, sites) {
    const income = country?.resources?.find(resource => resource.key === 'unity')?.income;
    if (!unityRules || !Number.isFinite(income)) return {total: null, reason: 'Monthly Unity income or reward rules unavailable.'};
    const perSite = Math.max(unityRules.minimum, Math.min(unityRules.maximum, income * unityRules.multiplier));
    return {total: perSite * sites, perSite, income, reason: `Potential visit rewards at current monthly Unity income (${income.toFixed(1)}), held constant. ${unityRules.multiplier}× income per system, clamped to ${unityRules.minimum}–${unityRules.maximum}. Wanderlust requirements and completion are ignored. Not monthly income; future income changes are not simulated.`};
  }
  function shortest(graph, byId, origin, blocked) {
    const distance = new Map([[origin, 0]]), previous = new Map(), settled = new Set();
    while (true) {
      let current, best = Infinity;
      for (const [id, cost] of distance) if (!settled.has(id) && cost < best) {current = id; best = cost;}
      if (current === undefined) break;
      settled.add(current);
      for (const target of graph.get(current) || []) {
        if (blocked.has(target) || settled.has(target)) continue;
        const next = best + edgeCost(byId.get(current), byId.get(target));
        if (next < (distance.get(target) ?? Infinity)) {distance.set(target, next); previous.set(target, current);}
      }
    }
    return {distance, previous};
  }
  function categoryState(model, countryId) {
    const country = (model.countries || []).find(item => item.id === countryId), saved = new Map((country?.wanderlust?.categories || []).map(category => [category.id, category]));
    const allMarkers = model.pois || [], markers = allMarkers.map(marker => ({marker, categoryId: marker.categoryIds?.[0]})).filter(item => item.categoryId);
    const labels = new Map(markers.map(({marker, categoryId}) => [categoryId, marker.categories?.[0] || categoryId]));
    return formatApi.wanderlustCategories.map(category => {
      const data = saved.get(category.id), total = allMarkers.filter(marker => marker.categoryIds?.includes(category.id)).length;
      const visited = markers.filter(item => item.categoryId === category.id && item.marker.visitedBy.includes(countryId)).length;
      const required = data?.required ?? Math.round(total * .8), seen = data?.seen ?? visited;
      return {id: category.id, label: labels.get(category.id) || category.id.replaceAll('_', ' '), required, seen, completed: !!data?.completed || required === 0 || seen >= required};
    });
  }
  function threatSeverity(risk, capitalPower, multiplier = 3) {
    if (!risk || (!(risk.threats || []).length && !(risk.potential || []).length)) return '';
    if ((risk.potential || []).length || !Number.isFinite(capitalPower) || capitalPower <= 0) return 'unknown';
    const powers = (risk.threats || []).map(marker => marker.fleet?.power);
    if (!powers.length || powers.some(power => !Number.isFinite(power) || power < 0)) return 'unknown';
    const total = powers.reduce((sum, power) => sum + power, 0);
    return total > capitalPower * multiplier ? 'major' : 'minor';
  }
  function plan(model, countryId, options = {}) {
    const start = model.nomadStarts?.[countryId];
    if (!start?.systemId) throw new Error('Capital arkship location was not found. Select a nomadic empire with a saved capital arkship.');
    const byId = new Map(model.systems.map(system => [system.id, system]));
    if (!byId.has(start.systemId)) throw new Error('Capital arkship is not located in a known system.');
    const graph = new Map(model.systems.map(system => [system.id, new Set()]));
    for (const system of model.systems) for (const target of system.links) if (byId.has(target)) {graph.get(system.id).add(target); graph.get(target).add(system.id);}
    const risks = threatApi.systems(model, countryId), blocked = new Set(), severities = new Map();
    const legacyAvoid = options.avoidThreats !== false;
    const avoidMajor = options.avoidMajorThreats ?? legacyAvoid, avoidMinor = options.avoidMinorThreats ?? legacyAvoid;
    for (const [id, risk] of risks) {
      const severity = threatSeverity(risk, start.power);
      if (severity) severities.set(id, severity);
      if ((severity === 'minor' && avoidMinor) || (severity !== 'minor' && severity && avoidMajor)) blocked.add(id);
    }
    // Алгоритм может выйти из заблокированной стартовой системы, но не прокладывает возврат через неё.
    const threatResult = route => {
      const unique = [...new Set(route)];
      const systems = severity => unique.filter(id => severities.get(id) === severity);
      return {
        capitalPower: start.power, threatMultiplier: 3, dangerSystems: unique.filter(id => severities.has(id)),
        minorThreatSystems: systems('minor'), majorThreatSystems: systems('major'), unknownThreatSystems: systems('unknown'),
        startThreat: severities.get(start.systemId) || '', startDanger: severities.has(start.systemId)
      };
    };
    const limit = Math.max(1, Math.min(100, Math.floor(Number(options.limit) || 20))), budget = Number(options.budget) > 0 ? Number(options.budget) : Infinity;
    if (options.objective === 'categories4') {
      const categories = categoryState(model, countryId), progress = new Map(categories.map(category => [category.id, category.seen]));
      const completed = new Set(categories.filter(category => category.completed).map(category => category.id)), completedBefore = completed.size, goal = 4;
      const categoryById = new Map(categories.map(category => [category.id, category]));
      const targetMarkers = new Map((model.pois || []).filter(marker => !marker.visitedBy.includes(countryId) && marker.categoryIds?.[0] && !completed.has(marker.categoryIds[0])).map(marker => [marker.system.id, marker]));
      const targets = new Set(targetMarkers.keys()), available = targets.size, route = [start.systemId], stops = [], collected = new Set();
      const collect = (id, localProgress = progress, localCompleted = completed, localCollected = collected, localStops = stops) => {
        const marker = targetMarkers.get(id), category = categoryById.get(marker?.categoryIds?.[0]);
        if (!category || localCollected.has(id) || localCompleted.has(category.id)) return {progress: 0, completed: 0};
        localCollected.add(id); localStops.push(id);
        const before = localProgress.get(category.id) || 0, after = Math.min(category.required, before + 1);
        localProgress.set(category.id, after);
        if (after >= category.required) {localCompleted.add(category.id); return {progress: 1 / Math.max(1, category.required), completed: 1};}
        return {progress: 1 / Math.max(1, category.required), completed: 0};
      };
      if (completed.size < goal) collect(start.systemId);
      let cost = 0;
      const initial = shortest(graph, byId, start.systemId, blocked);
      const unreachable = [...targets].filter(id => !initial.distance.has(id)).length;
      while (completed.size < goal) {
        const origin = route[route.length - 1], search = shortest(graph, byId, origin, blocked);
        let chosen;
        for (const target of targets) {
          if (collected.has(target) || !search.distance.has(target)) continue;
          const segment = [target];
          while (segment[0] !== origin) segment.unshift(search.previous.get(segment[0]));
          const simulatedProgress = new Map(progress), simulatedCompleted = new Set(completed), simulatedCollected = new Set(collected), simulatedStops = [];
          let segmentCost = 0, progressGain = 0, completionGain = 0, end = 0;
          for (let i = 1; i < segment.length; i++) {
            segmentCost += edgeCost(byId.get(segment[i - 1]), byId.get(segment[i]));
            if (cost + segmentCost > budget) break;
            const gain = collect(segment[i], simulatedProgress, simulatedCompleted, simulatedCollected, simulatedStops);
            progressGain += gain.progress; completionGain += gain.completed;
            if (gain.progress) end = i;
            if (simulatedCompleted.size >= goal) break;
          }
          if (!progressGain) continue;
          const path = segment.slice(0, end + 1), pathCost = path.slice(1).reduce((sum, id, index) => sum + edgeCost(byId.get(path[index]), byId.get(id)), 0);
          // Закрытие категории важнее разрозненного прогресса; среди равных вариантов выбираем меньшую стоимость.
          const score = pathCost / (progressGain + completionGain * 10);
          if (!chosen || score < chosen.score) chosen = {path, cost: pathCost, score};
        }
        if (!chosen) break;
        route.push(...chosen.path.slice(1)); cost += chosen.cost;
        for (const id of chosen.path) collect(id);
      }
      const unique = [...new Set(route)], categoryProgress = categories.map(category => ({...category, plannedSeen: progress.get(category.id) || 0, completedAfter: completed.has(category.id)}));
      return {countryId, start, path: route, stops, cost, available, unreachable, remaining: available - collected.size, categoryGoal: {target: goal, before: completedBefore, after: completed.size, reached: completed.size >= goal}, categoryProgress, slowSystems: unique.filter(id => reduction(byId.get(id)) > 0), ...threatResult(route)};
    }
    const targets = new Set((model.pois || []).filter(marker => !marker.visitedBy.includes(countryId)).map(marker => marker.system.id));
    const available = targets.size, route = [start.systemId], stops = [], collected = new Set();
    if (targets.has(start.systemId)) {collected.add(start.systemId); stops.push(start.systemId);}
    let cost = 0;
    const initial = shortest(graph, byId, start.systemId, blocked);
    const unreachable = [...targets].filter(id => !initial.distance.has(id)).length;
    while (collected.size < limit) {
      const origin = route[route.length - 1], search = shortest(graph, byId, origin, blocked);
      let chosen;
      for (const target of targets) {
        if (collected.has(target) || !search.distance.has(target)) continue;
        const segment = [target];
        while (segment[0] !== origin) segment.unshift(search.previous.get(segment[0]));
        let segmentCost = 0, gain = 0, end = 0;
        for (let i = 1; i < segment.length; i++) {
          segmentCost += edgeCost(byId.get(segment[i - 1]), byId.get(segment[i]));
          if (cost + segmentCost > budget) break;
          if (targets.has(segment[i]) && !collected.has(segment[i])) {gain++; end = i;}
          if (collected.size + gain >= limit) break;
        }
        if (!gain) continue;
        const path = segment.slice(0, end + 1);
        const pathCost = path.slice(1).reduce((sum, id, index) => sum + edgeCost(byId.get(path[index]), byId.get(id)), 0);
        const score = pathCost / gain;
        if (!chosen || score < chosen.score) chosen = {path, cost: pathCost, score};
      }
      if (!chosen) break;
      route.push(...chosen.path.slice(1)); cost += chosen.cost;
      for (const id of chosen.path) if (targets.has(id) && !collected.has(id)) {collected.add(id); stops.push(id);}
    }
    const unique = [...new Set(route)];
    return {countryId, start, path: route, stops, cost, available, unreachable, remaining: available - collected.size, slowSystems: unique.filter(id => reduction(byId.get(id)) > 0), ...threatResult(route)};
  }
  function findEnclaves(model, countryId, options = {}) {
    const country = (model.countries || []).find(country => country.id === countryId);
    const start = country?.isNomadic ? model.nomadStarts?.[countryId] : model.capitalStarts?.[countryId];
    if (!start?.systemId) throw new Error('Capital system / capital arkship location not found.');
    const byId = new Map(model.systems.map(system => [system.id, system]));
    if (!byId.has(start.systemId)) throw new Error('Capital is not in a known system.');
    const graph = new Map(model.systems.map(system => [system.id, new Set()]));
    for (const system of model.systems) for (const target of system.links) if (byId.has(target)) {graph.get(system.id).add(target); graph.get(target).add(system.id);}
    const blocked = new Set();
    if (!country?.isNomadic) for (const system of model.systems) if (threatApi.hostility(model, system.ownerId, countryId) === 'closed') blocked.add(system.id);
    for (const [id, risk] of threatApi.systems(model, countryId)) {
      if ((!country?.isNomadic && risk.level === 'closed') || (options.avoidThreats !== false && (['hostile', 'war'].includes(risk.level) || risk.potential.length))) blocked.add(id);
    }
    const search = shortest(graph, byId, start.systemId, blocked), groups = new Map();
    // Филиалы объединяем по сохранённому типу правительства, а не по локализованному имени.
    for (const marker of model.neutral || []) {
      if (marker.country.category !== 'enclave' || !marker.isEnclaveBranch) continue;
      const type = marker.country.governmentId || marker.country.type || marker.country.id;
      if (!groups.has(type)) groups.set(type, []);
      groups.get(type).push(marker);
    }
    return [...groups].map(([type, branches]) => {
      const reachable = branches.filter(marker => search.distance.has(marker.system.id)).sort((a, b) => search.distance.get(a.system.id) - search.distance.get(b.system.id));
      if (!reachable.length) return {type, country: branches[0].country, reachable: false};
      const marker = reachable[0], path = [marker.system.id];
      while (path[0] !== start.systemId) path.unshift(search.previous.get(path[0]));
      return {type, country: marker.country, reachable: true, system: marker.system, start, countryId, path, cost: search.distance.get(marker.system.id), stops: [marker.system.id]};
    }).sort((a, b) => (a.cost ?? Infinity) - (b.cost ?? Infinity));
  }
  return {load, initialize, reduction, edgeCost, threatSeverity, plan, unityReward, findEnclaves};
})();
if (typeof module !== 'undefined') module.exports = NomadRoutes;
