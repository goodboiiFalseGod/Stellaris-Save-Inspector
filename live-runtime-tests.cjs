'use strict';

const assert = require('node:assert/strict');
const {createRuntime} = require('./live-runtime.js');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

function fixture() {
  const requests = [], snapshots = [], errors = [], timers = new Map();
  let timerId = 0;
  const runtime = createRuntime({
    read(signal) { const request = deferred(); requests.push({...request, signal}); return request.promise; },
    onSnapshot: snapshot => snapshots.push(snapshot),
    onError: error => errors.push(error),
    schedule(callback, delay) { const id = ++timerId; timers.set(id, {callback, delay}); return id; },
    cancel: id => timers.delete(id)
  });
  function tick() {
    assert.equal(timers.size, 1);
    const [id, timer] = [...timers][0];
    timers.delete(id);
    timer.callback();
    return timer.delay;
  }
  return {runtime, requests, snapshots, errors, timers, tick};
}

const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

async function tests() {
  const f = fixture();
  f.runtime.start();
  assert.equal(f.runtime.running, true);
  assert.equal(f.requests.length, 1);
  f.runtime.start();
  assert.equal(f.requests.length, 1);
  assert.equal(f.timers.size, 0);
  f.requests[0].resolve('first');
  await settle();
  assert.deepEqual(f.snapshots, ['first']);
  assert.equal(f.tick(), 2000);
  assert.equal(f.requests.length, 2);
  f.runtime.stop();
  assert.equal(f.runtime.running, false);
  assert.equal(f.requests[1].signal.aborted, true);
  f.runtime.start();
  assert.equal(f.requests.length, 2);
  f.requests[1].resolve('stale');
  await settle();
  assert.deepEqual(f.snapshots, ['first']);
  assert.equal(f.requests.length, 3);
  assert.equal(f.timers.size, 0);
  f.requests[2].reject(new Error('read failed'));
  await settle();
  assert.equal(f.errors.length, 1);
  assert.equal(f.tick(), 4000);
  f.requests[3].reject(new Error('read failed again'));
  await settle();
  assert.equal(f.tick(), 8000);
  f.requests[4].reject(new Error('read failed third time'));
  await settle();
  assert.equal(f.tick(), 15000);
  f.requests[5].reject(new Error('read failed fourth time'));
  await settle();
  assert.equal(f.tick(), 15000);
  f.requests[6].resolve('recovered');
  await settle();
  assert.deepEqual(f.snapshots, ['first', 'recovered']);
  assert.equal([...f.timers.values()][0].delay, 2000);
  const oldTimer = [...f.timers.values()][0];
  f.runtime.stop();
  assert.equal(f.timers.size, 0);
  oldTimer.callback();
  assert.equal(f.requests.length, 7);

  const staleError = fixture();
  staleError.runtime.start();
  staleError.runtime.stop();
  staleError.requests[0].reject(new Error('ignored cancellation'));
  await settle();
  assert.equal(staleError.errors.length, 0);
  assert.equal(staleError.timers.size, 0);
  assert.throws(() => createRuntime({intervalMs: 0}), /Некорректные/);
  console.log('Проверки цикла чтения памяти пройдены.');
}

tests().catch(error => { console.error(error); process.exitCode = 1; });
