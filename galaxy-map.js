'use strict';

const GalaxyMap = (() => {
  let canvas = document.querySelector('#galaxy-map');
  let exporting = false;
  let exportControls;
  const detail = document.querySelector('#galaxy-map-detail');
  const systemPanel = document.querySelector('.system-panel');
  systemPanel.hidden = true;
  function showSystemPanel() {systemPanel.hidden = false; requestAnimationFrame(resize);}
  function closeSystemPanel() {systemPanel.hidden = true; selected = undefined; requestAnimationFrame(() => {resize(); draw();});}
  const count = document.querySelector('#galaxy-map-count');
  const filters = document.querySelector('.galaxy-map-filters');
  const povSelect = document.querySelector('#map-pov');
  const povToggle = document.querySelector('#map-perspective');
  const wanderlustSelect = document.querySelector('#map-wanderlust-perspective');
  const routeSelect = document.querySelector('#route-empire'), routeGoal = document.querySelector('#route-goal'), routeLimit = document.querySelector('#route-limit'), routeSummary = document.querySelector('#route-summary'), routeBuild = document.querySelector('#route-build');
  const routeItinerary = document.querySelector('#route-itinerary');
  let plannedRoute, routeRevision = 0;
  let enclaveRoutes = [], enclaveRevision = 0;
  let model = {systems: [], neutral: [], markers: [], pois: [], hiddenCutholoids: [], relations: {}, wars: [], countries: [], wanderlustCountries: []}, transform = {scale: 1, x: 0, y: 0}, fitScale = 1, selected, hoveredSystem, dragging, palette = {}, cells = [], hitTargets = [];
  const flags = new Map(), mapImages = new Map(), byId = new Map(), countriesById = new Map();
  let initialFitPending = true, pendingRouteFocus;
  fetch('../flags/colors.txt').then(response => response.ok ? response.text() : '').then(text => { if (text) palette = GameArt.parsePalette(text); draw(); }).catch(() => null);

  const category = marker => marker.mapCategory || marker.country.category;
  function controlActive(input) {
    const state = exportControls?.get(input);
    return Boolean(state ? state.checked && !state.disabled : input?.checked && !input?.disabled);
  }
  function controlValue(input) { return exportControls?.get(input)?.value ?? input?.value ?? ''; }
  function checked(id) { return controlActive(document.querySelector(id)); }
  function syncLiveControls() {
    const allowed = new Set(['map-lines']);
    if (model.liveCapabilities?.borders) allowed.add('map-borders');
    if (model.liveCapabilities?.fleets) allowed.add('map-fleets');
    for (const input of filters.querySelectorAll('input, select')) input.disabled = Boolean(model.live) && !allowed.has(input.id);
    const cutholoidCount = document.querySelector('#map-cutholoid-count');
    if (cutholoidCount) cutholoidCount.textContent = model.live ? '?' : model.hiddenCutholoids?.length || 0;
  }
  function perspectiveId() { return controlActive(povToggle) ? controlValue(povSelect) : ''; }
  function visibleNeutral() {
    const enabled = new Set([...filters.querySelectorAll('input[type="checkbox"][value]')].filter(controlActive).map(input => input.value));
    return (model.neutral || []).filter(marker => enabled.has(category(marker)));
  }
  function visibleAssets() {
    const kinds = [];
    if (checked('#map-fleets')) kinds.push('fleet');
    if (checked('#map-arkships')) kinds.push('arkship');
    if (checked('#map-waystations')) kinds.push('waystation');
    return (model.markers || []).filter(marker => kinds.includes(marker.kind));
  }
  function combineFleetMarkers(markers) {
    const combined = [], fleetsBySystem = new Map();
    for (const marker of markers) {
      if (marker.kind !== 'fleet') {
        combined.push(marker);
        continue;
      }
      if (!fleetsBySystem.has(marker.system.id)) {
        const group = {...marker, groupedFleets: []};
        fleetsBySystem.set(marker.system.id, group);
        combined.push(group);
      }
      fleetsBySystem.get(marker.system.id).groupedFleets.push(marker);
    }
    return combined;
  }
  function wanderlustPerspectiveId() { return controlValue(wanderlustSelect); }
  function visiblePois() {
    if (!checked('#map-wanderlust')) return [];
    const perspective = wanderlustPerspectiveId();
    return (model.pois || []).map(marker => ({
      ...marker,
      visited: perspective ? marker.visitedBy.includes(perspective) : false
    }));
  }
  function visibleCutholoids() { return checked('#map-cutholoids') ? (model.hiddenCutholoids || []) : []; }
  function bounds() {
    const points = model.systems;
    if (!points.length) return {minX: -1, maxX: 1, minY: -1, maxY: 1};
    return {minX: Math.min(...points.map(point => point.x)), maxX: Math.max(...points.map(point => point.x)), minY: Math.min(...points.map(point => point.y)), maxY: Math.max(...points.map(point => point.y))};
  }
  function fit() {
    const box = bounds(), width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) { initialFitPending = true; return; }
    initialFitPending = false;
    transform.scale = Math.min(width / Math.max(1, box.maxX - box.minX), height / Math.max(1, box.maxY - box.minY)) * .9;
    fitScale = transform.scale;
    transform.x = width / 2 + (box.minX + box.maxX) / 2 * transform.scale;
    transform.y = height / 2 - (box.minY + box.maxY) / 2 * transform.scale;
    draw();
  }
  function point(system) { return {x: -system.x * transform.scale + transform.x, y: system.y * transform.scale + transform.y}; }
  function resize() {
    const ratio = devicePixelRatio || 1, width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) return;
    if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
      const previousWidth = canvas.width / ratio, previousHeight = canvas.height / ratio;
      canvas.width = width * ratio; canvas.height = height * ratio;
      transform.x += (width - previousWidth) / 2; transform.y += (height - previousHeight) / 2;
      if (initialFitPending) fit(); else draw();
    }
    else if (initialFitPending) fit();
    if (pendingRouteFocus) focusRouteStart();
  }
  function focusRouteStart() {
    if (!plannedRoute || !canvas.clientWidth || !canvas.clientHeight) {pendingRouteFocus = !!plannedRoute; return;}
    pendingRouteFocus = false;
    const system = byId.get(plannedRoute.start.systemId);
    selected = {kind: 'system', system};
    transform.scale = Math.max(transform.scale, fitScale * 2);
    transform.x = canvas.clientWidth / 2 + system.x * transform.scale;
    transform.y = canvas.clientHeight / 2 - system.y * transform.scale;
    detail.innerHTML = systemDetailHtml(system); draw();
  }
  function mapRgb(key) {
    if (!key || key === 'null') return null;
    return palette.map?.[key] || palette[key] || null;
  }
  function countryPaint(id) {
    return MapBorders.paint(countriesById.get(id), palette);
  }
  function rgba(rgb, alpha) { return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`; }
  function mapImage(kind) {
    if (!mapImages.has(kind)) {
      const record = {image: null};
      mapImages.set(kind, record);
      record.promise = iconImage('mapIcon', kind).then(image => { record.image = GameArt.canvas(image); draw(); }).catch(error => console.warn('Map icon unavailable:', kind, error));
    }
    return mapImages.get(kind).image;
  }
  function drawMapImage(context, image, x, y, size, preserveAspect = true) {
    if (!image) return;
    const scale = size / Math.max(image.width, image.height), width = preserveAspect ? image.width * scale : size, height = preserveAspect ? image.height * scale : size;
    context.drawImage(image, x - width / 2, y - height / 2, width, height);
  }
  function markerIcon(marker) {
    if (marker.kind !== 'waystation') return marker.kind;
    const size = (marker.fleet?.ships || []).find(ship => /^starbase_waystation_\d$/.test(ship.size || ''))?.size || '';
    return size.endsWith('_3') ? 'waystation3' : size.endsWith('_2') ? 'waystation2' : 'waystation';
  }
  function rebuildCells() {
    cells = MapBorders.build(model.systems);
  }
  function worldPoint(p) { return {x: -p.x * transform.scale + transform.x, y: p.y * transform.scale + transform.y}; }
  function countryFlag(country) {
    if (!country.flag?.file) return null;
    if (!flags.has(country.id)) {
      const record = {image: null}; flags.set(country.id, record);
      record.promise = flagImage(country.flag).then(image => {record.image = GameArt.canvas(image); draw();}).catch(error => console.warn('Флаг страны недоступен:', country.id, error));
    }
    return flags.get(country.id).image;
  }
  function countryEmblem(country) {
    if (!country.flag?.file) return null;
    const key = `emblem:${country.id}`;
    if (!flags.has(key)) {
      const record = {image: null}; flags.set(key, record);
      record.promise = GameArt.load(`../flags/${assetSegment(country.flag.category)}/${assetSegment(country.flag.file)}`).then(image => {
        // Сохраняем прозрачность символа, убирая его исходную окраску.
        const data = new Uint8ClampedArray(image.data);
        for (let i = 0; i < data.length; i += 4) data[i] = data[i + 1] = data[i + 2] = 255;
        record.image = GameArt.canvas({...image, data}); draw();
      }).catch(error => console.warn('Эмблема страны недоступна:', country.id, error));
    }
    return flags.get(key).image;
  }
  function drawCountryLabels(context) {
    context.save(); context.textAlign = 'center'; context.textBaseline = 'middle';
    context.globalAlpha = .45;
    for (const territory of cells) {
      const country = countriesById.get(territory.ownerId), anchor = territory.label;
      if (!country?.name || !anchor) continue;
      const p = worldPoint(anchor), width = Math.min(420, anchor.clearance * transform.scale * 2);
      if (width < 55 || p.x < 0 || p.y < 0 || p.x > canvas.clientWidth || p.y > canvas.clientHeight) continue;
      const words = country.name.split(/\s+/), middle = Math.ceil(words.length / 2);
      let lines = [country.name];
      context.font = '600 32px sans-serif';
      if (context.measureText(country.name).width > width && words.length > 1) lines = [words.slice(0, middle).join(' '), words.slice(middle).join(' ')];
      const measured = Math.max(...lines.map(line => context.measureText(line).width));
      const size = Math.min(36, 32 * width / Math.max(1, measured));
      if (size < 10) continue;
      const emblemSize = Math.min(110, width * .45), height = emblemSize + 8 + lines.length * size * 1.2;
      const box = {x: p.x - width / 2, y: p.y - height / 2, width, height};
      drawMapImage(context, countryEmblem(country), p.x, box.y + emblemSize / 2, emblemSize);
      context.font = `600 ${size}px sans-serif`; context.fillStyle = '#fff';
      lines.forEach((line, index) => context.fillText(line, p.x, box.y + emblemSize + 8 + size * (.5 + index * 1.2)));
    }
    context.restore();
  }
  function drawOwnedBorders(context) {
    context.save();
    for (const territory of cells) {
      const colors = countryPaint(territory.ownerId);
      context.beginPath();
      for (const loop of territory.loops) {
        if (loop.length < 3) continue;
        const screen = loop.map(worldPoint);
        context.moveTo(screen[0].x, screen[0].y);
        for (let index = 1; index < screen.length; index++) context.lineTo(screen[index].x, screen[index].y);
        context.closePath();
      }
      context.fillStyle = rgba(colors.fill, .23); context.fill('evenodd');
      context.strokeStyle = rgba(colors.border, .9); context.lineWidth = 1.7;
      context.lineJoin = 'round'; context.stroke();
    }
    context.restore();
  }
  function atWar(a, b) {
    return (model.wars || []).some(war => (war.attackers.includes(a) && war.defenders.includes(b)) || (war.defenders.includes(a) && war.attackers.includes(b)));
  }
  function hostility(ownerId, pov) {
    return MapThreats.hostility(model, ownerId, pov);
  }
  function drawMarkerShape(context, x, y, kind, size) {
    context.beginPath();
    if (kind === 'arkship') {
      context.moveTo(x, y - size); context.lineTo(x + size * .7, y); context.lineTo(x, y + size); context.lineTo(x - size * .7, y); context.closePath();
    } else if (kind === 'waystation') {
      context.rect(x - size * .7, y - size * .7, size * 1.4, size * 1.4);
    } else if (kind === 'wanderlust') {
      context.moveTo(x, y - size); context.lineTo(x + size * .35, y - size * .35); context.lineTo(x + size, y);
      context.lineTo(x + size * .35, y + size * .35); context.lineTo(x, y + size); context.lineTo(x - size * .35, y + size * .35);
      context.lineTo(x - size, y); context.lineTo(x - size * .35, y - size * .35); context.closePath();
    } else {
      context.moveTo(x, y - size); context.lineTo(x + size * .85, y + size * .7); context.lineTo(x - size * .85, y + size * .7); context.closePath();
    }
    context.fill(); context.stroke();
  }
  function drawRoute(context, zoomFactor) {
    if (!plannedRoute) return;
    context.save(); context.lineWidth = 2.5;
    context.lineCap = 'butt'; context.lineJoin = 'bevel';
    for (const segment of MapLayout.routeGeometry(plannedRoute.path, id => point(byId.get(id)))) {
      const {a, b} = segment;
      const color = MapLayout.routeColor(segment.index / Math.max(1, plannedRoute.path.length - 2));
      context.strokeStyle = color;
      context.beginPath();
      if (segment.connector) {
        const {from, points} = segment.connector;
        context.moveTo(from.x, from.y);
        for (const point of points.slice(1)) context.lineTo(point.x, point.y);
      } else context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y); context.stroke();
      const angle = Math.atan2(b.y - a.y, b.x - a.x), x = (a.x + b.x) / 2, y = (a.y + b.y) / 2, size = MapLayout.routeArrowSize(Math.hypot(b.x - a.x, b.y - a.y), zoomFactor);
      context.beginPath(); context.moveTo(x + Math.cos(angle) * size, y + Math.sin(angle) * size);
      context.lineTo(x + Math.cos(angle + 2.5) * size, y + Math.sin(angle + 2.5) * size);
      context.lineTo(x + Math.cos(angle - 2.5) * size, y + Math.sin(angle - 2.5) * size); context.closePath(); context.fillStyle = color; context.fill();
    }
    context.restore();
  }
  function exportLegendItems() {
    const items = [];
    const active = selector => controlActive(document.querySelector(selector));
    const add = (selector, item) => {if (active(selector)) items.push(item);};
    add('#map-borders', {label: 'Empire borders', swatch: '#7bb892'});
    add('#map-lines', {label: 'Hyperlanes', line: '#367f80'});
    add('#map-wormholes', {label: 'Wormholes', icon: 'wormhole', line: '#b77be6', dashed: true});
    add('#map-fleets', {label: 'Fleets', icon: 'fleet'});
    add('#map-arkships', {label: 'Capital arkships', icon: 'arkship'});
    add('#map-waystations', {label: 'Waystations', icon: 'waystation'});
    add('.galaxy-map-filters input[value="preftl"]', {label: 'Pre-FTL civilizations', dot: '#87a9cf'});
    add('.galaxy-map-filters input[value="enclave"]', {label: 'Enclaves', dot: '#c79a55'});
    add('.galaxy-map-filters input[value="leviathan"]', {label: 'Leviathans', icon: 'leviathan'});
    add('.galaxy-map-filters input[value="other"]', {label: 'Neutral & special', dot: '#5d9e9d'});
    add('#map-cutholoids', {label: 'Hidden Cutholoids', icon: 'cutholoid'});
    if (active('#map-wanderlust')) {
      const perspective = wanderlustPerspectiveId(), country = (model.wanderlustCountries || []).find(item => item.id === perspective);
      items.push({label: perspective ? `Wanderlust · ${country?.name || 'selected perspective'}` : 'Wanderlust sites', icon: 'wanderlust'});
      if (perspective) items.push({label: 'Visited Wanderlust site', visited: true});
    }
    if (perspectiveId() && active('#map-hostile')) {
      items.push({label: 'Hostile presence', threat: {fill: '#d4453a66', stroke: '#f37765'}});
      items.push({label: 'Closed borders / hidden threat', threat: {fill: '#c47a3a66', stroke: '#d6a366'}});
    }
    add('#map-player-threats', {label: 'Universal threats', threat: {fill: '#d4453a66', stroke: '#f37765'}});
    if (plannedRoute) items.push({label: 'Planned route', line: '#5aeaea'});
    return items;
  }
  function exportLegendHeight(items, width) {
    if (!items.length) return 0;
    const columns = Math.max(1, Math.min(4, Math.floor((width - 48) / 390)));
    return 58 + Math.ceil(items.length / columns) * 42;
  }
  function drawExportLegend(context, items, width, top, height) {
    if (!items.length) return;
    const padding = 24, columns = Math.max(1, Math.min(4, Math.floor((width - padding * 2) / 390))), columnWidth = (width - padding * 2) / columns;
    context.save();
    context.fillStyle = '#071510'; context.fillRect(0, top, width, height);
    context.strokeStyle = '#3c7768'; context.lineWidth = 2; context.beginPath(); context.moveTo(0, top); context.lineTo(width, top); context.stroke();
    context.fillStyle = '#e0cf8c'; context.font = 'bold 24px sans-serif'; context.textAlign = 'left'; context.fillText('VISIBLE MAP LAYERS', padding, top + 35);
    items.forEach((item, index) => {
      const column = index % columns, row = Math.floor(index / columns), x = padding + column * columnWidth, y = top + 59 + row * 42, iconX = x + 15, iconY = y + 4;
      let labelOffset = 42;
      if (item.icon) {
        drawMapImage(context, mapImage(item.icon), iconX, iconY, 28, item.icon === 'leviathan' || item.icon === 'cutholoid');
        if (item.line) {
          context.save(); context.strokeStyle = item.line; context.lineWidth = 4; context.setLineDash(item.dashed ? [10, 7] : []);
          context.beginPath(); context.moveTo(x + 32, iconY); context.lineTo(x + 62, iconY); context.stroke(); context.restore(); labelOffset = 74;
        }
      } else if (item.line) {
        context.save(); context.strokeStyle = item.line; context.lineWidth = 4; context.setLineDash(item.dashed ? [10, 7] : []);
        context.beginPath(); context.moveTo(x, iconY); context.lineTo(x + 30, iconY); context.stroke(); context.restore();
      } else if (item.swatch) {
        context.fillStyle = `${item.swatch}55`; context.strokeStyle = item.swatch; context.lineWidth = 2; context.fillRect(x, iconY - 10, 30, 20); context.strokeRect(x, iconY - 10, 30, 20);
      } else if (item.visited) {
        context.beginPath(); context.arc(iconX, iconY, 13, 0, Math.PI * 2); context.fillStyle = '#4dac71'; context.fill();
        context.fillStyle = '#07130f'; context.font = 'bold 18px sans-serif'; context.textAlign = 'center'; context.fillText('✓', iconX, iconY + 6);
      } else if (item.threat) {
        context.beginPath(); context.arc(iconX, iconY, 13, 0, Math.PI * 2); context.fillStyle = item.threat.fill; context.fill(); context.strokeStyle = item.threat.stroke; context.lineWidth = 2; context.stroke();
        context.fillStyle = '#ffe1b6'; context.font = 'bold 18px sans-serif'; context.textAlign = 'center'; context.fillText('!', iconX, iconY + 6);
      } else {
        context.beginPath(); context.arc(iconX, iconY, 8, 0, Math.PI * 2); context.fillStyle = item.dot || '#8ba99b'; context.fill();
      }
      context.fillStyle = '#c4d6cc'; context.font = '20px sans-serif'; context.textAlign = 'left';
      const availableWidth = Math.max(40, columnWidth - labelOffset - 10), ellipsis = '…';
      let label = item.label;
      while (label.length > 1 && context.measureText(label).width > availableWidth) label = label.slice(0, -1);
      if (label !== item.label) {while (label.length > 1 && context.measureText(label + ellipsis).width > availableWidth) label = label.slice(0, -1); label += ellipsis;}
      context.fillText(label, x + labelOffset, y + 10);
    });
    context.restore();
  }
  function draw() {
    const ratio = exporting ? 1 : devicePixelRatio || 1, context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    const background = context.createRadialGradient(canvas.clientWidth / 2, canvas.clientHeight / 2, 0, canvas.clientWidth / 2, canvas.clientHeight / 2, Math.max(canvas.clientWidth, canvas.clientHeight) * .65);
    background.addColorStop(0, '#12201f'); background.addColorStop(1, '#03090d');
    context.fillStyle = background; context.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    const occupied = [], labels = [];
    const queueLabel = (text, x, y, color, size = 11, priority = 0, optional = true) => labels.push({text, x, y, color, size, priority, optional});
    const zoomFactor = exporting ? 2 : Math.sqrt(transform.scale / Math.max(fitScale, .001));
    const pov = perspectiveId();
    const riskSystems = pov && checked('#map-hostile') ? MapThreats.systems(model, pov) : new Map();
    if (checked('#map-player-threats')) for (const [id, risk] of MapThreats.playerThreats(model)) {
      const previous = riskSystems.get(id);
      if (!previous) {riskSystems.set(id, risk); continue;}
      previous.level = previous.level === 'war' ? 'war' : 'hostile';
      for (const marker of risk.threats) if (!previous.threats.some(other => other.country.id === marker.country.id && other.fleet.id === marker.fleet.id)) previous.threats.push(marker);
    }
    const visibleAssetMarkers = visibleAssets(), assetsList = combineFleetMarkers(visibleAssetMarkers), poisList = visiblePois(), cutholoidsList = visibleCutholoids();
    const grouped = new Map();
    for (const marker of visibleNeutral()) {
      if (!grouped.has(marker.system.id)) grouped.set(marker.system.id, []);
      grouped.get(marker.system.id).push(marker);
    }
    const cutholoidsBySystem = new Map();
    for (const marker of cutholoidsList) {
      if (!cutholoidsBySystem.has(marker.system.id)) cutholoidsBySystem.set(marker.system.id, []);
      cutholoidsBySystem.get(marker.system.id).push(marker);
    }
    const wormholeSystems = checked('#map-wormholes') ? model.systems.filter(system => system.hasWormhole || (system.wormholes || []).length) : [];
    hitTargets = [];
    const overlays = new Map();
    const addOverlay = (system, key) => {
      if (!overlays.has(system.id)) overlays.set(system.id, []);
      overlays.get(system.id).push({key, system});
    };
    for (const system of wormholeSystems) addOverlay(system, 'wormhole');
    for (const marker of poisList) addOverlay(marker.system, 'wanderlust');
    for (const [systemId, markers] of cutholoidsBySystem) addOverlay(markers[0].system, `cutholoid:${systemId}`);
    for (const [systemId, markers] of grouped) addOverlay(markers[0].system, `neutral:${systemId}`);
    for (const [index, marker] of assetsList.entries()) addOverlay(marker.system, `asset:${index}`);
    const overlayPoint = (system, key) => {
      const items = overlays.get(system.id) || [], index = items.findIndex(item => item.key === key);
      const p = point(system);
      if (index < 0) return p;
      const spacing = Math.max(24, Math.min(48, 32 * zoomFactor));
      const starRadius = Math.max(2, Math.min(4, 2.4 * zoomFactor));
      const extent = Math.max(...MapLayout.starOffsets(MapLayout.starClasses(system).length, starRadius).map(offset => Math.hypot(offset.x, offset.y))) + starRadius * 1.4;
      const position = {x: p.x + Math.max(14, extent + 5) + spacing * (index % 4) + spacing / 2, y: p.y - 5 - Math.floor(index / 4) * spacing};
      if (plannedRoute?.start.systemId === system.id) {
        position.x = p.x + Math.max(46, extent + 5) + spacing * (index % 4) + spacing / 2;
        position.y = p.y + 40 + Math.floor(index / 4) * spacing;
      }
      return position;
    };
    for (const items of overlays.values()) for (const item of items) {
      const p = overlayPoint(item.system, item.key), radius = Math.max(12, Math.min(34, 19 * zoomFactor));
      occupied.push({x: p.x - radius, y: p.y - radius, width: radius * 2, height: radius * 2});
    }
    if (checked('#map-borders')) drawOwnedBorders(context);
    if (checked('#map-lines')) {
      context.strokeStyle = '#367f80'; context.lineWidth = Math.max(.7, Math.min(1.5, zoomFactor));
      context.beginPath();
      for (const system of model.systems) for (const target of system.links) {
        const other = byId.get(target);
        if (!other || system.id > other.id) continue;
        const a = point(system), b = point(other); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y);
      }
      context.stroke();
    }
    if (checked('#map-wormholes')) {
      context.strokeStyle = '#b77be6'; context.lineWidth = Math.max(1.5, 2 * zoomFactor); context.setLineDash([7, 5]);
      context.beginPath();
      for (const system of model.systems) for (const target of system.wormholes || []) {
        const other = byId.get(target);
        if (!other || system.id > other.id) continue;
        const a = point(system), b = point(other); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y);
      }
      context.stroke(); context.setLineDash([]);
      const image = mapImage('wormhole');
      for (const system of wormholeSystems) {
        const p = overlayPoint(system, 'wormhole');
        drawMapImage(context, image, p.x, p.y, Math.max(14, Math.min(34, 20 * zoomFactor)));
        if (exporting) queueLabel('Wormhole', p.x, p.y + 20, '#d1b3ee', 24);
        hitTargets.push({marker: {kind: 'system', system}, p});
      }
    }
    drawRoute(context, zoomFactor);
    if ((pov && checked('#map-hostile')) || checked('#map-player-threats')) {
      for (const {system, level, threats, potential} of riskSystems.values()) {
        const p = point(system), radius = Math.max(9, Math.min(25, 12 * zoomFactor));
        context.beginPath(); context.arc(p.x, p.y, radius, 0, Math.PI * 2);
        context.fillStyle = level === 'closed' || !level ? '#c47a3a66' : '#d4453a88';
        context.fill();
        context.strokeStyle = level === 'closed' || !level ? '#d6a366' : '#f37765'; context.lineWidth = 1.5; context.stroke();
        if (threats.length || potential.length) { context.fillStyle = '#ffe1b6'; context.font = 'bold 11px sans-serif'; context.textAlign = 'center'; context.fillText('!', p.x, p.y - radius - 3); }
      }
    }
    const iconSize = Math.max(22, Math.min(44, 30 * zoomFactor));
    const labelFont = exporting ? 28 : Math.max(10, Math.min(16, 12 * zoomFactor));
    context.fillStyle = '#66877a';
    context.font = `${labelFont}px sans-serif`; context.textAlign = 'left';
    for (const system of model.systems) {
      const p = point(system);
      if (p.x < -80 || p.y < -80 || p.x > canvas.clientWidth + 80 || p.y > canvas.clientHeight + 80) continue;
      const active = selected?.system.id === system.id, hovered = hoveredSystem?.id === system.id;
      const radius = Math.max(2, Math.min(4, 2.4 * zoomFactor)), stars = MapLayout.starClasses(system);
      const offsets = MapLayout.starOffsets(stars.length, radius);
      const extent = Math.max(...offsets.map(offset => Math.hypot(offset.x, offset.y))) + radius * 1.4;
      context.save();
      stars.forEach((starClass, index) => {
        const offsetX = offsets[index].x, offsetY = offsets[index].y;
        if (system.live && !system.starClass) {
          context.beginPath(); context.arc(p.x, p.y, radius, 0, Math.PI * 2);
          context.strokeStyle = '#b5c5cc'; context.lineWidth = 1; context.stroke();
          return;
        }
        if (starClass === 'sc_black_hole') {
          const holeRadius = radius * 1.3;
          context.shadowColor = '#ffdca6'; context.shadowBlur = 8;
          context.beginPath(); context.arc(p.x + offsetX, p.y + offsetY, holeRadius, 0, Math.PI * 2);
          context.strokeStyle = '#fff0c9'; context.lineWidth = Math.max(1, radius * .35); context.stroke();
          context.shadowBlur = 0;
          context.beginPath(); context.arc(p.x + offsetX, p.y + offsetY, holeRadius - .4, 0, Math.PI * 2);
          context.fillStyle = '#010204'; context.fill();
          return;
        }
        const color = MapLayout.starColor(starClass);
        context.shadowColor = color; context.shadowBlur = 9;
        context.beginPath(); context.arc(p.x + offsetX, p.y + offsetY, radius, 0, Math.PI * 2); context.fillStyle = color; context.fill();
        context.shadowBlur = 0; context.beginPath(); context.arc(p.x + offsetX, p.y + offsetY, radius * .45, 0, Math.PI * 2); context.fillStyle = '#fff'; context.fill();
      });
      if (active || hovered) { context.beginPath(); context.arc(p.x, p.y, extent + (active ? 7 : 4), 0, Math.PI * 2); context.strokeStyle = active ? '#e8d598' : '#89cbd0'; context.lineWidth = active ? 1.5 : 1; context.stroke(); }
      context.restore();
      occupied.push({x: p.x - extent - 2, y: p.y - extent - 2, width: (extent + 2) * 2, height: (extent + 2) * 2});
      queueLabel(system.name, p.x, p.y, active ? '#ffe6a5' : hovered ? '#ffffff' : '#b5cec9', labelFont, active ? 3 : hovered ? 2 : 1, !active && !hovered);
    }
    const poiSize = Math.max(7, Math.min(14, 9 * zoomFactor));
    for (const marker of poisList) {
      const p = overlayPoint(marker.system, 'wanderlust');
      hitTargets.push({marker, p});
      const isSelected = selected?.kind === 'wanderlust' && selected.system.id === marker.system.id;
      context.strokeStyle = isSelected ? '#f3ebbd' : '#1a2a22';
      context.lineWidth = isSelected ? 2 : 1;
      drawMapImage(context, mapImage('wanderlust'), p.x, p.y, poiSize * 2.5);
      if (marker.visited) {
        const badgeSize = Math.max(6, poiSize * .55);
        context.beginPath(); context.arc(p.x + poiSize, p.y + poiSize, badgeSize, 0, Math.PI * 2);
        context.fillStyle = '#4dac71'; context.fill();
        context.strokeStyle = '#e6f3c7'; context.lineWidth = 1; context.stroke();
        context.fillStyle = '#07130f'; context.font = `bold ${Math.max(9, badgeSize * 1.5)}px sans-serif`; context.textAlign = 'center';
        context.fillText('✓', p.x + poiSize, p.y + poiSize + badgeSize * .42);
      }
      context.fillStyle = marker.visited ? '#9ed383' : '#e0b45c'; context.font = `${labelFont}px sans-serif`; context.textAlign = 'left';
      const enclaveSystem = (model.neutral || []).some(object => object.system.id === marker.system.id && object.country.category === 'enclave');
      if (exporting || (!enclaveSystem && (zoomFactor >= 1.4 || selected?.system.id === marker.system.id || hoveredSystem?.id === marker.system.id))) queueLabel(marker.categories.join(', '), p.x, p.y + poiSize + 5, marker.visited ? '#9ed383' : '#e0b45c', exporting ? 24 : labelFont - 1);
    }
    for (const [systemId, markers] of cutholoidsBySystem) {
      const p = overlayPoint(markers[0].system, `cutholoid:${systemId}`), size = Math.max(14, Math.min(34, 20 * zoomFactor));
      hitTargets.push({marker: {kind: 'system', system: markers[0].system}, p});
      drawMapImage(context, mapImage('cutholoid'), p.x, p.y, size, true);
      if (markers.length > 1) {
        const badgeRadius = Math.max(6, Math.min(10, 7 * zoomFactor));
        context.beginPath(); context.arc(p.x + size * .35, p.y + size * .35, badgeRadius, 0, Math.PI * 2);
        context.fillStyle = '#d4c56c'; context.fill();
        context.fillStyle = '#07130f'; context.font = `bold ${Math.max(9, badgeRadius * 1.35)}px sans-serif`; context.textAlign = 'center';
        context.fillText(String(markers.length), p.x + size * .35, p.y + size * .35 + badgeRadius * .42);
      }
      context.fillStyle = '#cdbf91'; context.font = `${labelFont}px sans-serif`; context.textAlign = 'left';
      if (zoomFactor >= 1.4 || selected?.system.id === systemId || hoveredSystem?.id === systemId) queueLabel(markers.length > 1 ? `Hidden Cutholoids ×${markers.length}` : 'Hidden Cutholoid', p.x, p.y + size / 2, '#cdbf91', labelFont - 1);
    }
    for (const [id, markers] of grouped) {
      const p = overlayPoint(markers[0].system, `neutral:${id}`), isSelected = selected?.system.id === id && selected.kind === 'neutral';
      hitTargets.push({marker: {...markers[0], kind: 'neutral'}, p});
      if (isSelected) { context.beginPath(); context.arc(p.x, p.y, iconSize / 2 + 5, 0, Math.PI * 2); context.fillStyle = '#f3ebbd55'; context.fill(); }
      const country = markers[0].country;
      const leviathan = markers.some(marker => category(marker) === 'leviathan');
      if (leviathan) {
        drawMapImage(context, mapImage('leviathan'), p.x, p.y, Math.max(10, Math.min(18, 12 * zoomFactor)), true);
      } else if (country.flag?.file) {
        const image = countryFlag(country);
        if (image) context.drawImage(image, p.x - iconSize / 2, p.y - iconSize / 2, iconSize, iconSize);
      }
      if (markers.length > 1) { context.fillStyle = '#07130f'; context.font = `${Math.max(10, labelFont)}px sans-serif`; context.textAlign = 'center'; context.fillText(String(markers.length), p.x, p.y + labelFont / 3); }
      const factions = [...new Set(markers.filter(marker => exporting || marker.country.category !== 'enclave').map(marker => marker.country.name))].join(', ');
      if (factions && (zoomFactor >= 1.4 || selected?.system.id === id || hoveredSystem?.id === id)) queueLabel(factions, p.x, p.y + iconSize / 2, '#e0cf8c', labelFont - 1);
    }
    const assetSize = Math.max(5, Math.min(11, 7 * zoomFactor));
    for (const [index, marker] of assetsList.entries()) {
      const p = overlayPoint(marker.system, `asset:${index}`);
      hitTargets.push({marker, p});
      if (exporting) {
        const names = marker.groupedFleets ? `${marker.groupedFleets.length} fleets` : marker.fleet?.name || marker.name || ({arkship: 'Arkship', waystation: 'Waystation', fleet: 'Fleet'}[marker.kind] || marker.kind);
        queueLabel(names, p.x, p.y + 24, '#b5cec9', 24);
      }
      if (marker.kind === 'waystation') {
        drawMapImage(context, mapImage(markerIcon(marker)), p.x, p.y, Math.max(14, Math.min(32, 21 * zoomFactor)));
        continue;
      }
      if (marker.kind === 'fleet' || marker.kind === 'arkship') {
        const size = Math.max(14, Math.min(34, 22 * zoomFactor));
        drawMapImage(context, mapImage(marker.kind), p.x, p.y, size);
        const fleetCount = marker.groupedFleets?.length || 1;
        if (fleetCount > 1) {
          const badgeRadius = Math.max(6, Math.min(10, 7 * zoomFactor));
          context.beginPath(); context.arc(p.x + size * .36, p.y + size * .34, badgeRadius, 0, Math.PI * 2);
          context.fillStyle = '#d4c56c'; context.fill();
          context.strokeStyle = '#07130f'; context.lineWidth = 1.5; context.stroke();
          context.fillStyle = '#07130f'; context.font = `bold ${Math.max(9, badgeRadius * 1.35)}px sans-serif`; context.textAlign = 'center';
          context.fillText(String(fleetCount), p.x + size * .36, p.y + size * .34 + badgeRadius * .42);
        }
        continue;
      }
      context.fillStyle = marker.kind === 'arkship' ? '#c9a45c' : marker.kind === 'waystation' ? '#7ec4d4' : '#d7d4c4';
      context.strokeStyle = selected === marker ? '#f3ebbd' : '#1a2a22';
      context.lineWidth = selected === marker ? 2 : 1;
      drawMarkerShape(context, p.x, p.y, marker.kind, assetSize);
    }
    if (plannedRoute) {
      const system = byId.get(plannedRoute.start.systemId), p = point(system);
      context.save();
      context.beginPath(); context.arc(p.x, p.y, 22, 0, Math.PI * 2);
      context.strokeStyle = '#5aeaea'; context.lineWidth = 3; context.stroke();
      context.beginPath(); context.arc(p.x, p.y, 28, 0, Math.PI * 2);
      context.strokeStyle = '#5aeaea66'; context.lineWidth = 1; context.stroke();
      const title = `START · ${plannedRoute.start.name}`;
      context.font = 'bold 13px sans-serif';
      const width = context.measureText(title).width + 20, x = p.x - width / 2, y = p.y - 56;
      context.fillStyle = '#082124'; context.fillRect(x, y, width, 24);
      context.strokeStyle = '#5aeaea'; context.lineWidth = 1; context.strokeRect(x, y, width, 24);
      context.textAlign = 'center'; context.fillStyle = '#aaffff'; context.fillText(title, p.x, y + 17);
      occupied.push({x, y, width, height: 24});
      hitTargets.push({marker: {kind: 'system', system}, p: {x: p.x, y: y + 12}});
      context.restore();
    }
    if (plannedRoute) for (const [index, id] of plannedRoute.stops.entries()) {
      const p = point(byId.get(id)), x = p.x - (id === plannedRoute.start.systemId ? 42 : 14), y = p.y - 14;
      context.beginPath(); context.arc(x, y, 9, 0, Math.PI * 2); context.fillStyle = '#352a10'; context.fill(); context.strokeStyle = '#f4cb66'; context.lineWidth = 1; context.stroke();
      context.fillStyle = '#ffe2a0'; context.font = 'bold 10px sans-serif'; context.textAlign = 'center'; context.fillText(String(index + 1), x, y + 3);
      occupied.push({x: x - 10, y: y - 10, width: 20, height: 20});
      hitTargets.push({marker: {kind: 'system', system: byId.get(id)}, p: {x, y}});
    }
    for (const label of labels.sort((a, b) => b.priority - a.priority)) {
      context.font = `${label.size}px sans-serif`;
      const lines = [''];
      for (const word of String(label.text).split(/\s+/)) {
        const index = lines.length - 1, next = lines[index] ? `${lines[index]} ${word}` : word;
        if (exporting && lines[index] && context.measureText(next).width > 360) lines.push(word); else lines[index] = next;
      }
      const box = MapLayout.placeLabel({x: label.x, y: label.y}, Math.max(...lines.map(line => context.measureText(line).width)), (label.size + 3) * lines.length, occupied, {width: canvas.clientWidth, height: canvas.clientHeight}, exporting ? false : label.optional);
      if (!box) continue;
      context.textAlign = 'left'; context.lineJoin = 'round'; context.lineWidth = 3; context.strokeStyle = '#03090dee';
      context.fillStyle = label.color;
      lines.forEach((line, index) => {const y = box.y + label.size + index * (label.size + 3); context.strokeText(line, box.x, y); context.fillText(line, box.x, y);});
    }
    // Эмблемы и названия — верхний полупрозрачный слой, не участвующий в коллизиях подписей систем.
    if (checked('#map-borders')) drawCountryLabels(context);
    const assets = visibleAssetMarkers.length, pois = poisList.length, perspective = wanderlustPerspectiveId(), visitedPois = perspective ? poisList.filter(marker => marker.visited).length : null;
    const wormholes = model.systems.reduce((total, system) => total + (system.wormholes || []).filter(target => byId.has(target) && system.id < target).length, 0);
    const hostileSystems = [...riskSystems.values()].filter(risk => ['war', 'hostile'].includes(risk.level));
    const threatCount = hostileSystems.reduce((sum, risk) => sum + risk.threats.length, 0);
    const playerThreatCount = checked('#map-player-threats') ? MapThreats.playerThreats(model).size : null;
    count.textContent = model.live ? `RAM · ${model.systems.length} systems${model.liveCapabilities?.borders ? ` · ${model.systems.filter(system => system.ownerId).length} owned` : ''}${model.liveCapabilities?.fleets ? ` · ${model.liveFleetCount} fleets (${model.markers.length} located)` : ''} · positions, hyperlanes${model.systems.every(system => system.starClass) ? ', star classes' : ''} verified` : `${model.systems.length} stars · ${model.systems.filter(system => system.ownerId).length} owned · ${visibleNeutral().length} neutral · ${assets} ships/stations · ${pois} wanderlust${perspective ? ` (${visitedPois} visited)` : ''} · ${wormholes} wormholes${checked('#map-cutholoids') ? ` · ${cutholoidsList.length} hidden Cutholoids` : ''}${pov && checked('#map-hostile') ? ` · ${hostileSystems.length} hostile systems (${threatCount} threats)` : ''}`;
    if (playerThreatCount !== null) count.textContent += ` · ${playerThreatCount} universal threat systems`;
  }
  function relationLabel(system) {
    const pov = perspectiveId(), owner = countriesById.get(system.ownerId), level = hostility(system.ownerId, pov);
    if (!pov) return '';
    const risk = MapThreats.systems(model, pov).get(system.id);
    if (risk?.threats.length || risk?.potential.length) return `${risk.threats.length} hostile fleets/stations · ${risk.potential.length} hidden Cutholoids`;
    return {war: 'At war — ships fire on sight', hostile: 'Hostile — ships fire on sight', closed: 'Closed borders — entering is a trespass', '': owner ? 'Friendly or open' : 'Unclaimed'}[level];
  }
  function mapObjectHtml(marker) {
    const level = hostility(marker.country.id, perspectiveId());
    const kindLabel = ({fleet: 'Fleet', arkship: 'Arkship', waystation: 'Waystation', neutral: category(marker)}[marker.kind] || marker.kind) + (['war', 'hostile'].includes(level) ? ' · ⚠ Hostile to selected empire' : '');
    return `<article class="system-object-card"><div><span class="system-object-type">${escapeHtml(kindLabel)}</span><h4>${escapeHtml(marker.fleet.name)}</h4><p>${escapeHtml(marker.country.name)}</p></div><button type="button" data-open-country="${escapeHtml(marker.country.id)}">View empire</button></article>`;
  }
  function wanderlustObjectHtml(marker) {
    const perspective = wanderlustPerspectiveId(), empire = (model.wanderlustCountries || []).find(country => country.id === perspective);
    const visited = perspective && marker.visitedBy.includes(perspective);
    const status = perspective ? `<span class="detail-badge ${visited ? 'visited' : 'unvisited'}">${visited ? '✓ Visited' : 'Not visited'} · ${escapeHtml(empire?.name || 'selected nomad')}</span>` : '';
    return `<article class="system-object-card wanderlust-object"><div><span class="system-object-type">Wanderlust site</span><h4>${escapeHtml(marker.categories.join(', '))}</h4>${status}</div></article>`;
  }
  function cutholoidObjectHtml(marker) {
    return `<article class="system-object-card"><div><span class="system-object-type">Hidden Cutholoid</span><h4>${escapeHtml(marker.name)}</h4><p>Disguised asteroid · planet #${escapeHtml(marker.id)}</p></div></article>`;
  }
  function systemDetailHtml(system) {
    if (system.live) {
      const fleets = (model.markers || []).filter(marker => marker.system.id === system.id);
      const owner = countriesById.get(system.baseOwnerId);
      const objects = fleets.map(marker => `<article class="system-object-card"><div><span class="system-object-type">Флот · ${marker.fleet.shipIds.length} кораблей</span><h4>${escapeHtml(marker.fleet.name)}</h4><p>${escapeHtml(marker.country.name)}</p></div></article>`).join('');
      return `<article class="system-detail-card"><header class="system-detail-hero"><span class="system-detail-kicker">RAM · #${escapeHtml(system.id)}</span><h3>${escapeHtml(system.name)}</h3>${owner ? `<div class="system-owner"><span>${escapeHtml(owner.name)}</span></div>` : ''}</header><p>Гиперлинии: ${system.links.length}</p>${system.starClass ? `<p>Класс звезды: ${escapeHtml(system.starClass)}</p>` : ''}${objects ? `<section class="system-detail-section system-objects">${objects}</section>` : ''}<p>Дипломатия, угрозы, отдельные звёзды и специальные объекты пока не прочитаны. Границы вычисляются по принадлежности систем, не считываются как готовый контур игры.</p></article>`;
    }
    const owner = countriesById.get(system.ownerId), relation = relationLabel(system);
    const localAssets = (model.markers || []).filter(marker => marker.system.id === system.id && marker.kind !== 'neutral');
    const localNeutral = (model.neutral || []).filter(marker => marker.system.id === system.id);
    const localWanderlust = (model.pois || []).filter(marker => marker.system.id === system.id);
    const risk = MapThreats.systems(model, perspectiveId()).get(system.id);
    const localCutholoids = (perspectiveId() && checked('#map-hostile') ? model.hiddenCutholoids || [] : visibleCutholoids()).filter(marker => marker.system.id === system.id);
    const knownFleetIds = new Set([...localAssets, ...localNeutral].map(marker => `${marker.country.id}:${marker.fleet.id}`));
    for (const marker of risk?.threats || []) if (!knownFleetIds.has(`${marker.country.id}:${marker.fleet.id}`)) localAssets.push(marker);
    const objects = [...localNeutral.map(marker => mapObjectHtml({...marker, kind: 'neutral'})), ...localAssets.map(mapObjectHtml), ...localWanderlust.map(wanderlustObjectHtml), ...localCutholoids.map(cutholoidObjectHtml)];
    const riskLevel = risk?.level || (risk?.potential.length ? 'closed' : 'open');
    return `<article class="system-detail-card"><header class="system-detail-hero"><span class="system-detail-kicker">Star system · #${escapeHtml(system.id)}</span><h3>${escapeHtml(system.name)}</h3><div class="system-owner"><i class="${owner ? 'owned' : ''}"></i><span>${owner ? escapeHtml(owner.name) : 'Unclaimed system'}</span></div>${relation ? `<span class="detail-relation ${escapeHtml(riskLevel)}">${escapeHtml(relation)}</span>` : ''}</header><div class="system-route-stats"><span><strong>${system.links.length}</strong><small>Hyperlanes</small></span><span><strong>${(system.wormholes || []).length}</strong><small>Wormhole links</small></span><span><strong>${objects.length}</strong><small>Known objects</small></span></div>${objects.length ? `<section class="system-detail-section system-objects"><span class="system-detail-label">All objects in this system</span>${objects.join('')}</section>` : '<p class="system-detail-empty">No visible special objects in this system.</p>'}</article>`;
  }
  function selectAt(event) {
    const rect = canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    const hitRadius = Math.max(12, Math.min(38, 17 * Math.sqrt(transform.scale / Math.max(fitScale, .001))));
    const hits = hitTargets.map(item => ({...item, distance: Math.hypot(item.p.x - x, item.p.y - y)})).filter(item => item.distance < hitRadius).sort((a, b) => a.distance - b.distance);
    selected = hits[0]?.marker;
    if (selected) {
      showSystemPanel();
      detail.innerHTML = systemDetailHtml(selected.system);
      draw();
      return;
    }
    if (!selected) {
      const nearby = model.systems.map(system => ({system, p: point(system)})).filter(item => Math.hypot(item.p.x - x, item.p.y - y) < hitRadius);
      if (nearby[0]) {
        showSystemPanel();
        const system = nearby[0].system;
        detail.innerHTML = systemDetailHtml(system);
        selected = {kind: 'system', system};
        draw();
        return;
      }
      detail.innerHTML = '<div class="system-detail-placeholder"><span>✦</span><strong>Select a system</strong><small>Choose a star or marker to inspect its routes, owner and objects.</small></div>';
      closeSystemPanel();
      draw();
      return;
    }
  }
  function fillPerspective(countries) {
    const current = povSelect.value;
    const empires = countries.filter(country => ['player', 'ai'].includes(country.category));
    povSelect.innerHTML = `<option value="">Pick empire</option>${empires.map(country => `<option value="${escapeHtml(country.id)}">${escapeHtml(country.name)}</option>`).join('')}`;
    povSelect.value = empires.some(country => country.id === current) ? current : '';
    povSelect.disabled = !empires.length;
  }
  function fillWanderlustPerspective(countries) {
    const current = wanderlustSelect.value;
    wanderlustSelect.innerHTML = `<option value="">All nomadic empires</option>${countries.map(country => `<option value="${escapeHtml(country.id)}">${escapeHtml(country.name)}</option>`).join('')}`;
    wanderlustSelect.value = countries.some(country => country.id === current) ? current : '';
    wanderlustSelect.disabled = !countries.length;
  }
  function render(next) {
    model = next;
    document.body.classList.toggle('live-map-active', Boolean(model.live));
    syncLiveControls();
    clearRoute();
    const nomads = (model.countries || []).filter(country => country.isNomadic);
    routeSelect.innerHTML = `<option value="">Pick nomad</option>${nomads.map(country => `<option value="${escapeHtml(country.id)}">${escapeHtml(country.name)}</option>`).join('')}`;
    routeSelect.value = ''; routeSelect.disabled = !nomads.length;
    routeLimit.disabled = routeGoal.value === 'categories4';
    initialFitPending = true;
    byId.clear();
    countriesById.clear();
    for (const system of model.systems) byId.set(system.id, system);
    for (const country of model.countries || []) countriesById.set(country.id, country);
    for (const marker of model.neutral || []) if (marker.country) countriesById.set(marker.country.id, marker.country);
    selected = undefined; hoveredSystem = undefined; flags.clear();
    systemPanel.hidden = true;
    rebuildCells();
    enclaveRoutes = [];
    enclaveRevision++;
    document.querySelector('#enclave-results').innerHTML = '';
    document.querySelector('#enclave-empire').innerHTML = '<option value="">Pick empire</option>' + (model.countries || []).map(country => `<option value="${escapeHtml(country.id)}">${escapeHtml(country.name)}</option>`).join('');
    if (typeof SystemFinder !== 'undefined') SystemFinder.render(model);
    fillPerspective(model.countries || []);
    fillWanderlustPerspective(model.wanderlustCountries || []);
    detail.innerHTML = '<div class="system-detail-placeholder"><span>✦</span><strong>Select a system</strong><small>Choose a star or marker to inspect its routes, owner and objects.</small></div>';
    requestAnimationFrame(fit);
  }
  filters.addEventListener('change', event => {
    if (event.target === povToggle) {
      if (povToggle.checked && !povSelect.value) {
        const player = (model.countries || []).find(country => country.category === 'player');
        if (player) povSelect.value = player.id;
      }
    }
    if (selected?.system) detail.innerHTML = systemDetailHtml(selected.system);
    draw();
  });
  povSelect.addEventListener('change', () => { povToggle.checked = Boolean(povSelect.value); if (selected?.system) detail.innerHTML = systemDetailHtml(selected.system); draw(); });
  function clearRoute() {
    plannedRoute = undefined; pendingRouteFocus = false; routeRevision++;
    routeItinerary.innerHTML = ''; routeItinerary.hidden = true;
    routeSummary.textContent = routeGoal.value === 'categories4' ? 'Capital arkship → 4 total completed categories.' : 'Capital arkship → unvisited sites.';
    routeSummary.title = 'Hyperlanes only. Approximate travel cost, not days; heuristic, not a guaranteed global optimum. Closed borders are ignored for nomads.';
  }
  for (const id of ['#route-empire', '#route-avoid-major', '#route-avoid-minor', '#route-limit', '#route-budget', '#route-goal']) document.querySelector(id).addEventListener('change', () => {routeLimit.disabled = routeGoal.value === 'categories4'; clearRoute(); draw();});
  routeBuild.addEventListener('click', async () => {
    const countryId = routeSelect.value, revision = ++routeRevision;
    plannedRoute = undefined; pendingRouteFocus = false; routeItinerary.innerHTML = ''; routeItinerary.hidden = true; draw();
    if (!countryId) {routeSummary.textContent = 'Select a nomadic empire first.'; return;}
    routeBuild.disabled = true; routeSummary.textContent = 'Calculating route…';
    try {
      await NomadRoutes.load();
      if (revision !== routeRevision) return;
      plannedRoute = NomadRoutes.plan(model, countryId, {objective: routeGoal.value, avoidMajorThreats: checked('#route-avoid-major'), avoidMinorThreats: checked('#route-avoid-minor'), limit: routeLimit.value, budget: document.querySelector('#route-budget').value});
      povSelect.value = countryId; povToggle.checked = true; povSelect.disabled = false;
      if ((model.wanderlustCountries || []).some(country => country.id === countryId)) wanderlustSelect.value = countryId;
      focusRouteStart();
      const categoryGoal = plannedRoute.categoryGoal;
      const warnings = [plannedRoute.startDanger ? `Capital is in a ${plannedRoute.startThreat} threat system.` : '', !Number.isFinite(plannedRoute.capitalPower) || plannedRoute.capitalPower <= 0 ? 'Capital arkship power is unknown; unknown threats are treated as major.' : '', categoryGoal?.before >= categoryGoal?.target ? 'The 4-category milestone is already reached.' : '', categoryGoal && !categoryGoal.reached ? `The heuristic route reaches only ${categoryGoal.after}/${categoryGoal.target} categories with these limits.` : '', !categoryGoal && !plannedRoute.stops.length ? 'No reachable sites within budget.' : ''].filter(Boolean);
      routeSummary.innerHTML = categoryGoal ? `<strong>${categoryGoal.after} completed · target ${categoryGoal.target}</strong> · ${plannedRoute.stops.length} sites · ${plannedRoute.path.length - 1} jumps · ~${plannedRoute.cost.toFixed(1)} cost${warnings.length ? `<span class="route-warning">${warnings.join(' ')}</span>` : ''}` : `<strong>${plannedRoute.stops.length}/${plannedRoute.available} sites</strong> · ${plannedRoute.path.length - 1} jumps · ~${plannedRoute.cost.toFixed(1)} cost${warnings.length ? `<span class="route-warning">${warnings.join(' ')}</span>` : ''}`;
      const speedNotes = plannedRoute.slowSystems.map(id => `${byId.get(id).name}: −${Math.round(NomadRoutes.reduction(byId.get(id)) * 100)}% speed`).join('; ');
      const categoryNotes = categoryGoal ? `Category progress: ${plannedRoute.categoryProgress.map(category => `${category.label} ${Math.min(category.plannedSeen, category.required)}/${category.required}${category.completedAfter ? ' ✓' : ''}`).join('; ')}. ` : '';
      routeSummary.title = `${plannedRoute.start.name}${Number.isFinite(plannedRoute.capitalPower) && plannedRoute.capitalPower > 0 ? ` (${Math.round(plannedRoute.capitalPower).toLocaleString('en-US')} power)` : ' (power unknown)'}. ${plannedRoute.unreachable} unreachable; ${plannedRoute.slowSystems.length} slowed; ${plannedRoute.minorThreatSystems.length} minor, ${plannedRoute.majorThreatSystems.length} major and ${plannedRoute.unknownThreatSystems.length} unknown threat systems on route. Minor is ≤${plannedRoute.threatMultiplier}× capital arkship power; major is higher; unknown follows the major-threat setting. ${categoryNotes}${speedNotes ? `Speed penalties: ${speedNotes}. ` : ''}Cost is approximate, not days. Hyperlanes only; heuristic, not a guaranteed global optimum. Closed borders are ignored. Recalculate after loading a new save.`;
      const unity = NomadRoutes.unityReward(countriesById.get(countryId), plannedRoute.stops.length);
      routeSummary.innerHTML += ` · ${unity.total === null ? 'Unity —' : `~${Math.round(unity.total).toLocaleString('en-US')} Unity`}`;
      if (unity.total === null) routeSummary.innerHTML += `<span class="route-warning">${escapeHtml(unity.reason)}</span>`;
      routeSummary.title += ` Unity: ${unity.reason}`;
      // Список остановок отделён от настроек; порядок читается вниз по каждой колонке.
      const stops = [plannedRoute.start.systemId, ...plannedRoute.stops];
      const entries = stops.map((id, index) => `<button type="button" data-route-system="${escapeHtml(id)}" style="--stop-color:${MapLayout.routeColor(index / Math.max(1, stops.length - 1))}">${index ? `${index}.` : 'Start:'} ${escapeHtml(byId.get(id).name)}</button>`);
      const plannerHeight = document.querySelector('.nomad-route-tools').offsetHeight || 160;
      const legendHeight = document.querySelector('.map-legend').offsetHeight || 120;
      const capacity = Math.max(1, Math.floor((canvas.clientHeight - plannerHeight - legendHeight - 35) / 25));
      const split = entries.length > capacity ? Math.ceil(entries.length / 2) : entries.length;
      const columns = [entries.slice(0, split), entries.slice(split)].filter(column => column.length);
      routeItinerary.innerHTML = `<div class="route-stop-columns" style="grid-template-columns:repeat(${columns.length},minmax(0,1fr))">${columns.map((column, index) => `<div class="route-stop-column">${index ? '<span class="route-stop-arrow">↓ continued</span>' : ''}${column.join('<span class="route-stop-arrow">↓</span>')}</div>`).join('')}</div>`;
      routeItinerary.hidden = false;
      draw();
    } catch (error) {if (revision === routeRevision) routeSummary.textContent = error.message; console.warn('Nomadic route calculation failed:', error);}
    finally {routeBuild.disabled = false;}
  });
  document.querySelector('#route-clear').addEventListener('click', () => {clearRoute(); draw();});
  document.querySelector('#enclave-clear').addEventListener('click', () => {clearRoute(); draw();});
  for (const id of ['#enclave-empire', '#enclave-avoid']) document.querySelector(id).addEventListener('change', () => {
    enclaveRevision++; enclaveRoutes = []; document.querySelector('#enclave-results').innerHTML = '';
  });
  document.querySelector('#enclave-find').addEventListener('click', async () => {
    const countryId = document.querySelector('#enclave-empire').value, button = document.querySelector('#enclave-find'), results = document.querySelector('#enclave-results');
    if (!countryId) {results.textContent = 'Pick an empire first.'; return;}
    const revision = routeRevision, enclaveRequest = ++enclaveRevision;
    button.disabled = true; results.textContent = 'Calculating…';
    try {
      await NomadRoutes.load();
      if (revision !== routeRevision || enclaveRequest !== enclaveRevision) return;
      enclaveRoutes = NomadRoutes.findEnclaves(model, countryId, {avoidThreats: checked('#enclave-avoid')});
      results.innerHTML = enclaveRoutes.map((route, index) => `<button type="button" data-enclave-route="${index}" ${route.reachable ? '' : 'disabled'}><strong>${escapeHtml(route.country.government || route.country.name)}</strong><span>${route.reachable ? `${escapeHtml(route.system.name)} · ${route.path.length - 1} jumps · ~${route.cost.toFixed(1)} cost` : 'No reachable branch'}</span></button>`).join('') || 'No saved enclave branches found.';
    } catch (error) {if (revision === routeRevision && enclaveRequest === enclaveRevision) results.textContent = error.message; console.warn('Ошибка поиска анклавов:', error);}
    finally {button.disabled = false;}
  });
  document.querySelector('#enclave-results').addEventListener('click', event => {
    const button = event.target.closest('[data-enclave-route]'), route = enclaveRoutes[button?.dataset.enclaveRoute];
    if (!route?.reachable) return;
    clearRoute(); plannedRoute = route;
    routeSummary.textContent = `${route.start.name} → ${route.country.name} (${route.system.name}) · ${route.path.length - 1} jumps · ~${route.cost.toFixed(1)} cost`;
    routeItinerary.innerHTML = `<div class="route-stop-column">${route.path.map(id => `<button type="button" data-route-system="${escapeHtml(id)}">${escapeHtml(byId.get(id).name)}</button>`).join('<span class="route-stop-arrow">↓</span>')}</div>`;
    routeItinerary.hidden = false;
    focusRouteStart();
  });
  const selectRouteStop = event => {
    const button = event.target.closest('[data-route-system]'), system = byId.get(button?.dataset.routeSystem);
    if (!system) return;
    showSystemPanel();
    selected = {kind: 'system', system}; transform.x = canvas.clientWidth / 2 + system.x * transform.scale; transform.y = canvas.clientHeight / 2 - system.y * transform.scale;
    detail.innerHTML = systemDetailHtml(system); draw();
  };
  routeSummary.addEventListener('click', selectRouteStop);
  routeItinerary.addEventListener('click', selectRouteStop);
  document.querySelector('#finder-results').addEventListener('click', selectRouteStop);
  detail.addEventListener('click', event => {
    const button = event.target.closest('[data-open-country]');
    if (!button) return;
    const id = button.dataset.openCountry, country = countriesById.get(id);
    const categoryInput = [...document.querySelectorAll('.category-filters input')].find(input => input.value === country?.category);
    if (categoryInput && !categoryInput.checked) {
      categoryInput.checked = true;
      refreshCards();
    }
    document.querySelector('#empires-page').click();
    requestAnimationFrame(() => {
      const card = document.querySelector(`.empire[data-country-id="${CSS.escape(id)}"]`);
      if (!card) return;
      card.scrollIntoView({behavior: 'smooth', block: 'start'});
      card.classList.add('map-jump-highlight');
      const fleets = card.querySelector('.fleet-details');
      if (fleets) fleets.open = true;
    });
  });
  document.querySelector('#map-reset').addEventListener('click', fit);
  canvas.addEventListener('wheel', event => { event.preventDefault(); const scale = Math.max(fitScale * .5, Math.min(fitScale * 20, transform.scale * Math.exp(-event.deltaY * .0015))), ratio = scale / transform.scale, rect = canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top; transform.x = x - (x - transform.x) * ratio; transform.y = y - (y - transform.y) * ratio; transform.scale = scale; draw(); }, {passive: false});
  canvas.addEventListener('pointerdown', event => { if (event.button !== 0) return; dragging = {x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false}; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointermove', event => {
    if (!dragging) {
      const rect = canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
      const hits = [...hitTargets, ...model.systems.map(system => ({marker: {system}, p: point(system)}))].map(item => ({...item, distance: Math.hypot(item.p.x - x, item.p.y - y)})).filter(item => item.distance < 16).sort((a, b) => a.distance - b.distance);
      const next = hits[0]?.marker.system;
      canvas.style.cursor = next ? 'pointer' : 'grab'; canvas.title = next?.name || 'Drag to pan · Scroll to zoom · Double-click to centre';
      if (next !== hoveredSystem) { hoveredSystem = next; draw(); }
      return;
    }
    const dx = event.clientX - dragging.x, dy = event.clientY - dragging.y;
    if (Math.hypot(event.clientX - dragging.startX, event.clientY - dragging.startY) > 4) dragging.moved = true;
    if (dragging.moved) { transform.x += dx; transform.y += dy; }
    dragging.x = event.clientX; dragging.y = event.clientY; canvas.style.cursor = 'grabbing'; draw();
  });
  canvas.addEventListener('pointerup', event => { if (dragging && !dragging.moved) selectAt(event); dragging = undefined; canvas.style.cursor = 'grab'; });
  canvas.addEventListener('pointercancel', () => { dragging = undefined; canvas.style.cursor = 'grab'; });
  canvas.addEventListener('pointerleave', () => { hoveredSystem = undefined; draw(); });
  canvas.addEventListener('dblclick', event => {
    selectAt(event);
    if (!selected?.system) return;
    transform.scale = Math.min(fitScale * 20, Math.max(transform.scale, fitScale * 3));
    transform.x = canvas.clientWidth / 2 + selected.system.x * transform.scale;
    transform.y = canvas.clientHeight / 2 - selected.system.y * transform.scale;
    draw();
  });
  new ResizeObserver(resize).observe(canvas);
  async function exportImage() {
    const button = document.querySelector('#map-export');
    if (!model.systems.length) {alert('Сначала откройте сохранение.'); return;}
    button.disabled = true; button.textContent = 'Exporting…';
    exportControls = new Map([...filters.querySelectorAll('input, select')].map(input => [input, {checked: input.checked, disabled: input.disabled, value: input.value}]));
    try {
      const loaded = new Set(), legendItems = exportLegendItems();
      for (;;) {
        draw();
        for (const item of legendItems) if (item.icon) mapImage(item.icon);
        if (checked('#map-borders')) for (const country of countriesById.values()) countryEmblem(country);
        const pending = [...flags.values(), ...mapImages.values()].map(record => record.promise).filter(promise => promise && !loaded.has(promise));
        if (!pending.length) break;
        pending.forEach(promise => loaded.add(promise));
        await Promise.all(pending);
      }
      const points = [...model.systems, ...(checked('#map-borders') ? cells.flatMap(territory => territory.loops.flat()) : [])];
      const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x)), minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
      const spanX = Math.max(100, maxX - minX), spanY = Math.max(100, maxY - minY), margin = 180;
      // Большой PNG всей галактики; лимит площади защищает память браузера.
      const a = spanX * spanY, b = margin * 2 * (spanX + spanY), c = (margin * 2) ** 2 - 27900000;
      const areaScale = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
      let scale = Math.min(12, (6400 - margin * 2) / Math.max(spanX, spanY), areaScale), outputWidth, mapHeight, legendHeight;
      const measureOutput = () => {
        outputWidth = Math.ceil(spanX * scale + margin * 2); mapHeight = Math.ceil(spanY * scale + margin * 2);
        legendHeight = exportLegendHeight(legendItems, outputWidth);
        return outputWidth <= 6400 && mapHeight + legendHeight <= 6400 && outputWidth * (mapHeight + legendHeight) <= 27900000;
      };
      for (let iteration = 0; iteration < 100 && !measureOutput(); iteration++) scale *= .95;
      if (!measureOutput()) throw new Error('Карта с легендой превышает безопасный размер PNG.');
      const output = document.createElement('canvas');
      output.width = outputWidth; output.height = mapHeight + legendHeight;
      const original = {canvas, transform, fitScale, selected, hoveredSystem, hitTargets, count: count.textContent};
      try {
        canvas = {width: output.width, height: mapHeight, clientWidth: output.width, clientHeight: mapHeight, getContext: () => output.getContext('2d')};
        transform = {scale, x: output.width / 2 + (minX + maxX) / 2 * scale, y: mapHeight / 2 - (minY + maxY) / 2 * scale};
        fitScale = scale; selected = undefined; hoveredSystem = undefined; exporting = true;
        draw();
        drawExportLegend(output.getContext('2d'), legendItems, output.width, mapHeight, legendHeight);
      } finally {
        canvas = original.canvas; transform = original.transform; fitScale = original.fitScale; selected = original.selected; hoveredSystem = original.hoveredSystem; hitTargets = original.hitTargets; count.textContent = original.count; exporting = false;
      }
      const blob = await new Promise((resolve, reject) => output.toBlob(value => value ? resolve(value) : reject(new Error('Не удалось создать PNG')), 'image/png'));
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = 'stellaris-galaxy-map.png'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      console.error('Ошибка экспорта карты:', error); alert(`Ошибка экспорта карты: ${error.message}`);
    } finally {exportControls = undefined; button.disabled = false; button.textContent = 'Export PNG';}
  }
  document.querySelector('#map-export').addEventListener('click', exportImage);
  function updateLive(next) {
    if (!next.live) throw new Error('Ожидалась модель из памяти игры.');
    if (!model.live || next.sourceIdentity !== model.sourceIdentity || next.systems.length !== model.systems.length || next.systems.some(system => !byId.has(system.id))) {
      render(next);
      return;
    }
    model = next;
    byId.clear();
    for (const country of model.countries || []) {
      if (JSON.stringify(countriesById.get(country.id)?.flag) !== JSON.stringify(country.flag)) {
        flags.delete(country.id);
        flags.delete(`emblem:${country.id}`);
      }
    }
    countriesById.clear();
    for (const country of model.countries || []) countriesById.set(country.id, country);
    syncLiveControls();
    for (const system of model.systems) byId.set(system.id, system);
    if (selected?.system) {
      selected = {kind: 'system', system: byId.get(selected.system.id)};
      detail.innerHTML = systemDetailHtml(selected.system);
    }
    if (hoveredSystem) hoveredSystem = byId.get(hoveredSystem.id);
    rebuildCells();
    draw();
  }
  return {render, updateLive, resize, closeSystemPanel, exportImage};
})();
