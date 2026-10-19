'use strict';

const MapLayout = (() => {
  const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  function placeLabel(anchor, width, height, occupied, viewport, optional = false) {
    if (anchor.x < 0 || anchor.y < 0 || anchor.x > viewport.width || anchor.y > viewport.height) return null;
    const candidates = [
      {x: anchor.x - width / 2, y: anchor.y + 10},
      {x: anchor.x - width - 10, y: anchor.y - height / 2},
      {x: anchor.x - width / 2, y: anchor.y - height - 10},
      {x: anchor.x + 10, y: anchor.y + 10}
    ].map(position => ({...position, width, height}));
    const score = box => occupied.filter(other => overlaps(box, other)).length + (box.x < 0 || box.y < 0 || box.x + width > viewport.width || box.y + height > viewport.height ? 100 : 0);
    const box = candidates.sort((a, b) => score(a) - score(b))[0];
    if (score(box) >= 100 || (optional && score(box) > 0)) return null;
    occupied.push({...box, x: box.x - 3, width: box.width + 6});
    return box;
  }
  function starColor(starClass) {
    const primary = {sc_binary_1: 'sc_a', sc_binary_2: 'sc_b', sc_binary_3: 'sc_m', sc_binary_4: 'sc_m', sc_binary_5: 'sc_b', sc_binary_6: 'sc_m', sc_binary_7: 'sc_k', sc_binary_8: 'sc_g', sc_binary_9: 'sc_a', sc_binary_10: 'sc_a', sc_trinary_1: 'sc_g', sc_trinary_2: 'sc_b', sc_trinary_3: 'sc_k', sc_trinary_4: 'sc_b', sc_m_giant: 'sc_m'};
    return {sc_b: '#91caff', sc_a: '#c4dfff', sc_f: '#fff4cf', sc_g: '#ffdf91', sc_k: '#ffae70', sc_m: '#ff7562', sc_t: '#cc866e', sc_neutron_star: '#a9e6ff', sc_pulsar: '#b5c3ff', sc_black_hole: '#b899d8'}[primary[starClass] || starClass] || '#d8edff';
  }
  function starClasses(system) {
    if (system.starClasses?.length) return system.starClasses;
    const count = /trinary/.test(system.starClass || '') ? 3 : /binary/.test(system.starClass || '') ? 2 : 1;
    return Array(count).fill(system.starClass);
  }
  function starOffsets(count, radius) {
    if (count <= 1) return [{x: 0, y: 0}];
    if (count > 3) {
      const spacing = radius * 3.3, limit = Math.ceil(Math.sqrt(count)), candidates = [];
      for (let row = -limit; row <= limit; row++) {
        for (let column = -limit; column <= limit; column++) {
          candidates.push({x: spacing * (column + row / 2), y: spacing * row * Math.sqrt(3) / 2});
        }
      }
      candidates.sort((a, b) => (a.x * a.x + a.y * a.y) - (b.x * b.x + b.y * b.y) || Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x));
      const packed = candidates.slice(0, count);
      const centre = {x: packed.reduce((sum, point) => sum + point.x, 0) / count, y: packed.reduce((sum, point) => sum + point.y, 0) / count};
      return packed.map(point => ({x: point.x - centre.x, y: point.y - centre.y}));
    }
    const orbit = Math.max(radius * 1.8, radius * 1.65 / Math.sin(Math.PI / count));
    return Array.from({length: count}, (_, index) => {
      const angle = -Math.PI / 2 + index * Math.PI * 2 / count;
      return {x: Math.cos(angle) * orbit, y: Math.sin(angle) * orbit};
    });
  }
  function routeLanes(path) {
    const groups = new Map();
    const segments = path.slice(1).map((to, index) => {
      const from = path[index], key = JSON.stringify([from, to]);
      const group = groups.get(key) || [];
      const segment = {from, to, index, lane: group.length};
      group.push(segment); groups.set(key, group);
      return segment;
    });
    // Все проходы смещены от гиперлинии, включая единственный проход.
    for (const group of groups.values()) for (const segment of group) segment.offset = 12 + segment.lane * 16;
    return segments;
  }
  const routeColor = progress => `hsl(${Math.round(180 * (1 - Math.max(0, Math.min(1, progress))))}, 85%, 65%)`;
  const routeArrowSize = (length, zoomFactor) => Math.max(0, Math.min(7, 5 * zoomFactor, length * .22));
  function routeGeometry(path, pointFor) {
    const segments = routeLanes(path).map(segment => {
      const start = pointFor(segment.from), end = pointFor(segment.to);
      const length = Math.hypot(end.x - start.x, end.y - start.y) || 1;
      const direction = {x: (end.x - start.x) / length, y: (end.y - start.y) / length};
      const shift = {x: -direction.y * segment.offset, y: direction.x * segment.offset};
      const trim = Math.min(length * .35, segment.offset * 1.3 + 6);
      return {...segment, length, trim, direction, a: {x: start.x + shift.x + direction.x * trim, y: start.y + shift.y + direction.y * trim}, b: {x: end.x + shift.x - direction.x * trim, y: end.y + shift.y - direction.y * trim}};
    });
    for (let index = 1; index < segments.length; index++) {
      const previous = segments[index - 1], current = segments[index];
      const center = pointFor(current.from), from = previous.b, to = current.a;
      const startAngle = Math.atan2(from.y - center.y, from.x - center.x);
      const endAngle = Math.atan2(to.y - center.y, to.x - center.x);
      // Нормализованный угол выбирает короткую сторону, без оборота вокруг системы.
      const sweep = Math.atan2(Math.sin(endAngle - startAngle), Math.cos(endAngle - startAngle));
      // Только прямые изгибы. Обратный проход обходит центр системы угловым стыком.
      const turnBack = current.to === previous.from || previous.direction.x * current.direction.x + previous.direction.y * current.direction.y < -.95;
      const points = turnBack ? [
        from,
        {x: from.x + previous.direction.x * (previous.trim + 8), y: from.y + previous.direction.y * (previous.trim + 8)},
        {x: to.x - current.direction.x * (current.trim + 8), y: to.y - current.direction.y * (current.trim + 8)},
        to
      ] : [from, to];
      current.connector = {from, to, center, sweep, points};
    }
    return segments;
  }
  return {overlaps, placeLabel, starColor, starClasses, starOffsets, routeLanes, routeColor, routeGeometry, routeArrowSize};
})();
if (typeof module !== 'undefined') module.exports = MapLayout;
