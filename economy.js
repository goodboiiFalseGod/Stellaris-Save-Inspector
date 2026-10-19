(function (scope) {
  'use strict';

  // Сохраняем вложенность: одинаковое имя ресурса в бюджете и хранилище не означает одно значение.
  function entries(text) {
    let position = 0;
    function token() {
      while (position < text.length) {
        if (/\s/.test(text[position])) { position++; continue; }
        if (text[position] === '#') {
          while (position < text.length && text[position] !== '\n') position++;
          continue;
        }
        break;
      }
      if (position >= text.length) return null;
      const start = position, char = text[position++];
      if ('{}='.includes(char)) return { value: char, start, end: position };
      if (char === '"') {
        while (position < text.length) {
          if (text[position] === '\\') { position += 2; continue; }
          if (text[position++] === '"') break;
        }
        return { value: text.slice(start + 1, position - 1), start, end: position };
      }
      while (position < text.length && !/[\s{}=#]/.test(text[position])) position++;
      return { value: text.slice(start, position), start, end: position };
    }

    const result = [];
    let current;
    while ((current = token())) {
      const equals = token();
      if (!equals) break;
      if (equals.value !== '=') { position = equals.start; continue; }
      const value = token();
      if (!value) throw new Error('Incomplete economy assignment');
      if (text[value.start] !== '{') {
        result.push({ key: current.value, scalar: value.value });
        continue;
      }
      const start = value.end;
      let depth = 1, next;
      while (depth && (next = token())) {
        // Кавычки отличают литералы "{" от структурных скобок.
        if (text[next.start] === '{') depth++;
        if (text[next.start] === '}') depth--;
      }
      if (depth) throw new Error('Unclosed economy block');
      result.push({ key: current.value, block: text.slice(start, next.start) });
    }
    return result;
  }

  function child(text, key) {
    if (text === null) return null;
    return entries(text).find(entry => entry.key === key && entry.block !== undefined)?.block ?? null;
  }

  function path(text, keys) {
    return keys.reduce((block, key) => child(block, key), text);
  }

  function resourceTotals(text, resourceKeys, recursive) {
    if (text === null) return null;
    const values = Object.fromEntries(resourceKeys.map(key => [key, 0]));
    function collect(block) {
      for (const entry of entries(block)) {
        if (entry.block !== undefined) {
          if (recursive) collect(entry.block);
          continue;
        }
        if (!Object.hasOwn(values, entry.key)) continue;
        const value = Number(entry.scalar);
        if (!Number.isFinite(value)) throw new Error(`Invalid resource value: ${entry.key}=${entry.scalar}`);
        values[entry.key] += value;
      }
    }
    collect(text);
    return values;
  }

  function read(countryText, resourceKeys) {
    const countryEntries = entries(countryText);
    const rootBlock = key => countryEntries.find(entry => entry.key === key && entry.block !== undefined)?.block ?? null;
    const modules = rootBlock('modules');
    let storedBlock = path(modules, ['standard_economy_module', 'resources']);
    let stockpileSource = 'modules.standard_economy_module.resources';
    if (storedBlock === null) {
      storedBlock = rootBlock('resources');
      stockpileSource = storedBlock === null ? null : 'resources';
    }
    const stockpile = resourceTotals(storedBlock, resourceKeys, false);
    const budget = rootBlock('budget');
    let monthly = null;
    for (const month of ['current_month', 'last_month']) {
      const monthBlock = child(budget, month);
      const balance = resourceTotals(child(monthBlock, 'balance'), resourceKeys, true);
      const income = resourceTotals(child(monthBlock, 'income'), resourceKeys, true);
      const expenses = resourceTotals(child(monthBlock, 'expenses'), resourceKeys, true);
      if (balance === null && (income === null || expenses === null)) continue;
      monthly = { month, balance, income, expenses, source: `budget.${month}.${balance === null ? 'income - expenses' : 'balance'}` };
      break;
    }
    return resourceKeys.map(key => ({
      key,
      stockpile: stockpile?.[key] ?? null,
      balance: monthly ? monthly.balance?.[key] ?? monthly.income[key] - monthly.expenses[key] : null,
      income: monthly?.income?.[key] ?? null,
      expenses: monthly?.expenses?.[key] ?? null,
      month: monthly?.month ?? null,
      stockpileSource,
      balanceSource: monthly?.source ?? null
    }));
  }

  scope.SaveEconomy = { read };
  if (typeof module !== 'undefined') module.exports = scope.SaveEconomy;
})(globalThis);
