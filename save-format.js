'use strict';

// Читаем только текущий уровень: вложенные таблицы не подменяют корневые.
(function (root) {
  const wanderlustCategories = [
    {id: 'ancient_wonders', starFlag: 'ancient_wonders_system', localization: 'NOMAD_EXPLORATION_ANCIENT_WONDERS'},
    {id: 'antique_threat', starFlag: 'antique_threat_system', localization: 'NOMAD_EXPLORATION_ANTIQUE_THREAT'},
    {id: 'enclave', starFlag: 'enclave', localization: 'NOMAD_EXPLORATION_ENCLAVE'},
    {id: 'galactic_landmark', starFlag: 'galactic_landmark_system', localization: 'NOMAD_EXPLORATION_GALACTIC_LANDMARK'},
    {id: 'marauder', starFlag: 'marauder_system', localization: 'NOMAD_EXPLORATION_MARAUDER'},
    {id: 'natural_spectacle', starFlag: 'natural_spectacle_system', localization: 'NOMAD_EXPLORATION_NATURAL_SPECTACLE'},
    {id: 'precursor', starFlag: 'precursor_system', localization: 'NOMAD_EXPLORATION_PRECURSOR'},
    {id: 'space_ecology', starFlag: 'space_ecology_system', localization: 'NOMAD_EXPLORATION_SPACE_ECOLOGY'}
  ];
  function entries(text) {
    let index = 0;
    function skip() {
      while (index < text.length) {
        if (/\s/.test(text[index])) { index++; }
        else if (text[index] === '#') { while (index < text.length && text[index] !== '\n') index++; }
        else { break; }
      }
    }
    function token() {
      skip();
      if (index >= text.length) return null;
      const start = index, first = text[index++];
      if (first === '"') {
        let value = '';
        while (index < text.length) {
          const character = text[index++];
          if (character === '"') return { scalar: value };
          if (character === '\\') {
            const escaped = text[index++];
            value += escaped === 'n' ? '\n' : escaped;
          } else { value += character; }
        }
        throw new Error('Unterminated save string');
      }
      if (first === '{') {
        let depth = 1, quote = false;
        while (index < text.length) {
          const character = text[index++];
          if (quote && character === '\\') { index++; continue; }
          if (character === '"') { quote = !quote; continue; }
          if (quote) continue;
          if (character === '#') { while (index < text.length && text[index] !== '\n') index++; continue; }
          if (character === '{') depth++;
          if (character === '}' && --depth === 0) return { block: text.slice(start + 1, index - 1) };
        }
        throw new Error('Unterminated save block');
      }
      while (index < text.length && !/[\s{}=]/.test(text[index])) index++;
      return { scalar: text.slice(start, index) };
    }
    const result = [];
    while (index < text.length) {
      const first = token();
      if (!first) break;
      skip();
      if (first.scalar !== undefined && text[index] === '=') {
        index++;
        const value = token();
        if (!value) throw new Error(`Missing value for ${first.scalar}`);
        result.push({ key: first.scalar, ...value });
      } else { result.push(first); }
    }
    return result;
  }
  function field(text, key) { return entries(text).find(entry => entry.key === key); }
  function scalar(text, key) { return field(text, key)?.scalar || ''; }
  function block(text, key) { return field(text, key)?.block || ''; }
  function wanderlustStatus(text) {
    const perks = field(text, 'ascension_perks');
    const variables = block(text, 'variables'), flags = new Set(entries(block(text, 'flags')).map(entry => entry.key).filter(Boolean));
    function containsPerk(content) {
      return entries(content).some(entry => entry.scalar === 'ap_wanderlust' || entry.key === 'ap_wanderlust' || (entry.block !== undefined && containsPerk(entry.block)));
    }
    const number = key => {
      const value = scalar(variables, key);
      return value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
    };
    return {
      hasPerk: perks ? containsPerk(perks.block || perks.scalar || '') : null,
      complete: flags.has('nomad_exploration_complete'),
      categories: wanderlustCategories.map(category => ({...category, required: number(`${category.id}_system_count`), seen: number(`${category.id}_system_seen`), completed: flags.has(`${category.id}_completed`)}))
    };
  }
  function factionFlags(text) {
    const hostile = scalar(text, 'hostile'), neutral = scalar(text, 'neutral');
    const rawProperties = scalar(text, 'properties');
    const properties = rawProperties === '' ? 0 : Number(rawProperties);
    if (!Number.isSafeInteger(properties) || properties < 0) throw new Error(`Invalid faction properties: ${rawProperties}`);
    // Новые сохранения упаковывают hostile в бит 0, neutral — в бит 2.
    return {hostile: hostile !== '' ? hostile === 'yes' : (properties & 1) !== 0, neutral: neutral !== '' ? neutral === 'yes' : (properties & 4) !== 0};
  }
  const api = { entries, field, scalar, block, factionFlags, wanderlustStatus, wanderlustCategories };
  root.SaveFormat = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
