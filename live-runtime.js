'use strict';

const LiveRuntime = (() => {
  function createRuntime({read, onSnapshot, onError, schedule = setTimeout, cancel = clearTimeout, intervalMs = 2000}) {
    if (typeof read !== 'function' || typeof onSnapshot !== 'function' || typeof onError !== 'function' || !Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error('Некорректные параметры обновления памяти.');
    let running = false;
    let generation = 0;
    let timer = null;
    let operation = null;
    let failures = 0;

    function clearTimer() {
      if (timer !== null) cancel(timer.id);
      timer = null;
    }

    function queue(delay) {
      const queuedGeneration = generation;
      const queuedTimer = {id: null};
      timer = queuedTimer;
      queuedTimer.id = schedule(() => {
        if (timer !== queuedTimer) return;
        timer = null;
        if (running && queuedGeneration === generation) launch();
      }, delay);
    }

    function launch() {
      if (!running || operation) return;
      const current = {generation, controller: new AbortController()};
      operation = current;
      void capture(current);
    }

    async function capture(current) {
      try {
        const snapshot = await read(current.controller.signal);
        if (!running || current.generation !== generation) return;
        failures = 0;
        onSnapshot(snapshot);
      } catch (error) {
        if (!running || current.generation !== generation) return;
        failures = Math.min(failures + 1, 30);
        onError(error);
      } finally {
        operation = null;
        if (running) {
          // Отмена не гарантирует завершение запроса: новый цикл ждёт старый.
          if (current.generation !== generation) launch();
          else queue(failures ? Math.min(15000, intervalMs * 2 ** failures) : intervalMs);
        }
      }
    }

    function start() {
      if (running) return;
      running = true;
      generation++;
      failures = 0;
      clearTimer();
      launch();
    }

    function stop() {
      running = false;
      generation++;
      clearTimer();
      if (operation) operation.controller.abort();
    }

    return {start, stop, get running() { return running; }};
  }

  return {createRuntime};
})();

if (typeof module !== 'undefined') module.exports = LiveRuntime;
