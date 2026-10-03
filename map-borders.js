'use strict';

const MapBorders = (() => {
  function labelAnchor(loops) {
    const points = loops.flat();
    if (!points.length) return null;
    const boxes = loops.filter(loop => loop.length).map(loop => ({minX: Math.min(...loop.map(p => p.x)), maxX: Math.max(...loop.map(p => p.x)), minY: Math.min(...loop.map(p => p.y)), maxY: Math.max(...loop.map(p => p.y))}));
    boxes.sort((a, b) => (b.maxX - b.minX) * (b.maxY - b.minY) - (a.maxX - a.minX) * (a.maxY - a.minY));
    let best = null;
    // Ищем просторную точку внутри территории, учитывая отдельные области и отверстия.
    for (const {minX, maxX, minY, maxY} of boxes.slice(0, 3)) for (let y = 0; y < 28; y++) for (let x = 0; x < 28; x++) {
      const p = {x: minX + (x + .5) / 28 * (maxX - minX), y: minY + (y + .5) / 28 * (maxY - minY)};
      let inside = false, distance = Infinity;
      for (const loop of loops) for (let i = 0; i < loop.length; i++) {
        const a = loop[i], b = loop[(i + 1) % loop.length], dx = b.x - a.x, dy = b.y - a.y;
        if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
        distance = Math.min(distance, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
      }
      if (inside && (!best || distance > best.clearance)) best = {...p, clearance: distance};
    }
    return best;
  }
  function smooth(loop) {
    // Усреднение вдоль контура убирает лестницу сетки до скругления углов.
    const softened = loop.map((_, index) => {
      const window = [-2, -1, 0, 1, 2].map(offset => loop[(index + offset + loop.length) % loop.length]);
      return {x: window.reduce((sum, point) => sum + point.x, 0) / 5, y: window.reduce((sum, point) => sum + point.y, 0) / 5};
    });
    let points = softened.filter((point, index) => {
      const before = softened[(index + softened.length - 1) % softened.length], after = softened[(index + 1) % softened.length];
      return Math.abs((point.x - before.x) * (after.y - point.y) - (point.y - before.y) * (after.x - point.x)) > 1e-9;
    });
    for (let pass = 0; pass < 2; pass++) {
      points = points.flatMap((a, index) => {
        const b = points[(index + 1) % points.length];
        const fraction = Math.min(.25, 1.2 / Math.max(1e-9, Math.hypot(b.x - a.x, b.y - a.y)));
        return [{x: a.x * (1 - fraction) + b.x * fraction, y: a.y * (1 - fraction) + b.y * fraction}, {x: a.x * fraction + b.x * (1 - fraction), y: a.y * fraction + b.y * (1 - fraction)}];
      });
    }
    return points;
  }
  function build(systems) {
    const sites = systems.filter(site => Number.isFinite(site.x) && Number.isFinite(site.y));
    if (!sites.some(site => site.ownerId)) return [];
    const distances = sites.map(site => Math.min(...sites.filter(other => other !== site).map(other => Math.hypot(site.x - other.x, site.y - other.y)))).filter(distance => distance > 0 && Number.isFinite(distance)).sort((a, b) => a - b);
    const spacing = Math.min(40, distances[Math.floor(distances.length / 2)] || 30), radius = spacing * 1.3;
    const minX = Math.min(...sites.map(site => site.x)) - radius - spacing, minY = Math.min(...sites.map(site => site.y)) - radius - spacing;
    const maxX = Math.max(...sites.map(site => site.x)) + radius + spacing, maxY = Math.max(...sites.map(site => site.y)) + radius + spacing;
    const step = Math.max(spacing / 8, (maxX - minX) / 350, (maxY - minY) / 350);
    const width = Math.ceil((maxX - minX) / step), height = Math.ceil((maxY - minY) / step);
    const buckets = new Map(), bucketKey = (x, y) => `${x},${y}`;
    for (const site of sites) {
      const key = bucketKey(Math.floor(site.x / radius), Math.floor(site.y / radius));
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(site);
    }
    const byId = new Map(sites.map(site => [site.id, site])), corridors = new Map(), seen = new Set();
    const corridorRadius = Math.max(spacing * .65, step * 2);
    for (const site of sites) for (const target of site.links || []) {
      const other = byId.get(target), key = JSON.stringify([site.id, target].sort());
      if (!site.ownerId || !other || other.ownerId !== site.ownerId || seen.has(key)) continue;
      seen.add(key);
      const lengthSquared = (other.x - site.x) ** 2 + (other.y - site.y) ** 2;
      if (!lengthSquared) continue;
      const corridor = {a: site, b: other, lengthSquared, ownerId: site.ownerId};
      // Индексируем полосу вдоль линии, а не весь прямоугольник длинной диагонали.
      const count = Math.ceil(Math.sqrt(lengthSquared) / (radius * .5)), padding = Math.ceil(corridorRadius / radius) + 1, covered = new Set();
      for (let sample = 0; sample <= count; sample++) {
        const t = sample / count, bx = Math.floor((site.x + (other.x - site.x) * t) / radius), by = Math.floor((site.y + (other.y - site.y) * t) / radius);
        for (let dy = -padding; dy <= padding; dy++) for (let dx = -padding; dx <= padding; dx++) covered.add(bucketKey(bx + dx, by + dy));
      }
      for (const bucket of covered) {
        if (!corridors.has(bucket)) corridors.set(bucket, []);
        corridors.get(bucket).push(corridor);
      }
    }
    const grid = Array(width * height).fill('');
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const px = minX + (x + .5) * step, py = minY + (y + .5) * step;
      const bx = Math.floor(px / radius), by = Math.floor(py / radius);
      let nearest, best = radius * radius;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        for (const site of buckets.get(bucketKey(bx + dx, by + dy)) || []) {
          const distance = (site.x - px) ** 2 + (site.y - py) ** 2;
          if (distance < best) {nearest = site; best = distance;}
        }
      }
      let owner = nearest?.ownerId || '';
      // Перемычки заполняют только пустоту между областями, не захватывая другие системы.
      if (!nearest) {
        let bestCorridor = corridorRadius * corridorRadius;
        for (const corridor of corridors.get(bucketKey(bx, by)) || []) {
          const dx = corridor.b.x - corridor.a.x, dy = corridor.b.y - corridor.a.y;
          const t = Math.max(0, Math.min(1, ((px - corridor.a.x) * dx + (py - corridor.a.y) * dy) / corridor.lengthSquared));
          const distance = (px - corridor.a.x - t * dx) ** 2 + (py - corridor.a.y - t * dy) ** 2;
          if (distance < bestCorridor) {bestCorridor = distance; owner = corridor.ownerId;}
        }
      }
      grid[y * width + x] = owner;
    }
    const groups = new Map(), value = (x, y) => x < 0 || y < 0 || x >= width || y >= height ? '' : grid[y * width + x];
    function edge(owner, ax, ay, bx, by) {
      if (!groups.has(owner)) groups.set(owner, []);
      groups.get(owner).push({a: {x: ax, y: ay}, b: {x: bx, y: by}, used: false});
    }
    // Только внешние рёбра объединённой территории: внутренних швов между системами нет.
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const owner = value(x, y);
      if (!owner) continue;
      if (value(x, y - 1) !== owner) edge(owner, x, y, x + 1, y);
      if (value(x + 1, y) !== owner) edge(owner, x + 1, y, x + 1, y + 1);
      if (value(x, y + 1) !== owner) edge(owner, x + 1, y + 1, x, y + 1);
      if (value(x - 1, y) !== owner) edge(owner, x, y + 1, x, y);
    }
    return [...groups].map(([ownerId, edges]) => {
      const starts = new Map(), loops = [];
      for (const edge of edges) {
        const key = bucketKey(edge.a.x, edge.a.y);
        if (!starts.has(key)) starts.set(key, []);
        starts.get(key).push(edge);
      }
      for (const first of edges) {
        if (first.used) continue;
        const loop = []; let current = first;
        while (current && !current.used) {
          current.used = true; loop.push(current.a);
          if (current.b.x === first.a.x && current.b.y === first.a.y) break;
          const candidates = (starts.get(bucketKey(current.b.x, current.b.y)) || []).filter(edge => !edge.used);
          const direction = {x: current.b.x - current.a.x, y: current.b.y - current.a.y};
          const turn = edge => Math.atan2(direction.x * (edge.b.y - edge.a.y) - direction.y * (edge.b.x - edge.a.x), direction.x * (edge.b.x - edge.a.x) + direction.y * (edge.b.y - edge.a.y));
          current = candidates.sort((a, b) => turn(b) - turn(a))[0];
        }
        if (loop.length >= 4) loops.push(smooth(loop).map(point => ({x: minX + point.x * step, y: minY + point.y * step})));
      }
      return {ownerId, loops, label: labelAnchor(loops)};
    });
  }
  function paint(country, palette) {
    const keys = country?.flag?.colors || [], custom = country?.flag?.useMapColor !== false;
    // В сохранении порядок цветов флага: основной, вторичный, граница, заливка.
    // Литеральный null означает отсутствие выбранного цвета, а не чёрный цвет палитры.
    const lookup = key => key && key !== 'null' ? palette.map?.[key] || palette[key] : null;
    const border = lookup(custom ? keys[2] : null) || lookup(keys[0]) || [100, 150, 125];
    const fill = lookup(custom ? keys[3] : null) || lookup(keys[1]) || border;
    return {border, fill};
  }
  return {build, paint};
})();
if (typeof module !== 'undefined') module.exports = MapBorders;
