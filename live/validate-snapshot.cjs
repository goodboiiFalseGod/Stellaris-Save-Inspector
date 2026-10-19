'use strict';
const assert = require('node:assert/strict');
const {reference} = require('./save-reference.cjs');

// Сравнение с сохранением применяется только в диагностике, не в живой карте.
function validate(saveText, snapshot) {
  const expected = reference(saveText);
  function compareTable(actual, records, label, compare) {
    assert.equal(actual.length, records.length, `${label}: количество объектов`);
    const byId = new Map(actual.map(record => [String(record.id), record]));
    assert.equal(byId.size, actual.length, `${label}: повторные ID`);
    for (const record of records) {
      assert.ok(byId.has(record.id), `${label}: отсутствует #${record.id}`);
      compare(byId.get(record.id), record);
    }
  }
  compareTable(snapshot.countries, expected.countries, 'Империи', (actual, record) => assert.equal(actual.type, record.type, `Империя #${record.id}: тип`));
  compareTable(snapshot.systems, expected.systems, 'Системы', (actual, record) => {
    assert.equal(actual.starClass, record.starClass, `Система #${record.id}: класс`);
    assert.deepEqual(actual.starbaseIds.map(String), record.starbaseIds, `Система #${record.id}: базы`);
    const owners = new Set(record.baseOwners.map(base => base.countryId));
    assert.ok(owners.size <= 1, `Система #${record.id}: неоднозначный эталон владельца`);
    assert.equal(actual.baseOwnerId == null ? undefined : String(actual.baseOwnerId), [...owners][0], `Система #${record.id}: владелец`);
  });
  compareTable(snapshot.fleets, expected.fleets, 'Флоты', (actual, record) => {
    assert.equal(actual.nameKey, record.nameKey, `Флот #${record.id}: имя`);
    assert.equal(actual.ownerId, record.ownerId, `Флот #${record.id}: владелец`);
    assert.equal(actual.systemId == null ? '4294967295' : String(actual.systemId), record.systemId, `Флот #${record.id}: система`);
    assert.deepEqual(actual.shipIds.map(String), record.shipIds, `Флот #${record.id}: корабли`);
  });
  return {systems: expected.systems.length, countries: expected.countries.length, fleets: expected.fleets.length};
}

if (require.main === module) {
  const input = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
  console.log('PASS: ' + JSON.stringify(validate(input.saveText, input.snapshot)));
}
module.exports = {validate};
