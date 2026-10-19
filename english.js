'use strict';

(function (root) {
  let dictionary = new Map(), loading;
  function add(text, target = dictionary) {
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*([^\s:#]+):\s*\d*\s*"(.*)"\s*(?:#.*)?$/.exec(line);
      if (match) target.set(match[1], match[2].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
    }
  }
  async function load() {
    if (!loading) loading = (async () => {
      const manifest = await fetch('english-files.json');
      if (!manifest.ok) throw new Error('English localization file list is unavailable');
      const files = await manifest.json(), sources = new Array(files.length);
      let next = 0;
      await Promise.all(Array.from({ length: 8 }, async () => {
        while (next < files.length) {
          const index = next++, response = await fetch(files[index]);
          if (!response.ok) throw new Error(`English localization unavailable: ${files[index]}`);
          sources[index] = await response.text();
        }
      }));
      const result = new Map();
      for (const source of sources) add(source, result);
      dictionary = result;
    })().catch(error => { loading = undefined; throw error; });
    return loading;
  }
  function expand(key, variables = {}, depth = 0, literal = false) {
    if (depth > 24) return `[Unresolved: ${key}]`;
    if (literal) return key;
    const values = Object.fromEntries(Object.entries(variables).map(([name, value]) => [name.toLowerCase(), value]));
    const value = dictionary.get(key) ?? key;
    const resolved = value.replace(/\$([^$]+)\$|%([^%]+)%|\[([^\]]+)\]|<([^<>]+)>/g, (whole, a, b, c, d) => {
      const name = a || b || c || d;
      if (Object.hasOwn(values, name.toLowerCase())) return values[name.toLowerCase()];
      return dictionary.has(name) ? expand(name, values, depth + 1) : whole;
    });
    return resolved.replace(/§./g, '').replace(/£[^£]+£/g, '').trim();
  }
  function name(text, context = {}, depth = 0) {
    if (depth > 24) return '[Unresolved name]';
    const fields = SaveFormat.entries(text);
    const key = fields.find(entry => entry.key === 'key')?.scalar ?? '';
    const literal = fields.find(entry => entry.key === 'literal')?.scalar === 'yes';
    if (literal) return key;
    const variables = { ...context }, parts = [];
    const variableBlock = fields.find(entry => entry.key === 'variables')?.block || '';
    for (const entry of SaveFormat.entries(variableBlock)) {
      if (entry.block === undefined) continue;
      const variable = SaveFormat.scalar(entry.block, 'key');
      const value = SaveFormat.field(entry.block, 'value');
      if (!variable || !value) continue;
      const resolved = value.block !== undefined ? name(value.block, context, depth + 1) : value.scalar;
      variables[variable] = resolved;
      parts.push({ variable, resolved });
    }
    if (/^%(ADJECTIVE|ADJ)%$/i.test(key)) {
      const adj = parts.find(part => /^adjective$|^adj$/i.test(part.variable));
      const numbered = parts.filter(part => /^\d+$/.test(part.variable)).sort((a, b) => Number(a.variable) - Number(b.variable));
      const rest = parts.filter(part => part !== adj && !/^\d+$/.test(part.variable));
      const composed = [...(adj ? [adj] : []), ...numbered, ...rest].map(part => part.resolved).filter(Boolean).join(' ').trim();
      if (composed) return composed;
    }
    const template = dictionary.get(key) ?? key;
    const used = new Set();
    template.replace(/\$([^$]+)\$|%([^%]+)%|\[([^\]]+)\]|<([^<>]+)>/g, (whole, a, b, c, d) => { used.add((a || b || c || d).toLowerCase()); return ''; });
    const resolved = expand(key, variables, depth);
    const extra = parts.filter(part => /^\d+$/.test(part.variable) && !used.has(part.variable.toLowerCase()))
      .sort((a, b) => Number(a.variable) - Number(b.variable))
      .map(part => part.resolved).filter(Boolean);
    return extra.length ? [resolved, ...extra].filter(Boolean).join(' ').trim() : resolved;
  }
  function saved(text, field = 'name', context = {}) {
    const entry = SaveFormat.field(text, field);
    return entry?.block !== undefined ? name(entry.block, context) : expand(entry?.scalar || '', context);
  }
  function label(key) {
    const result = expand(key);
    return dictionary.has(key) ? result : key.replace(/^(?:auth|gov|origin|civic|trait|SPEC)_/, '').replace(/_/g, ' ').replace(/^./, character => character.toUpperCase());
  }
  const api = { add, load, expand, name, saved, label, has: key => dictionary.has(key) };
  root.English = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
