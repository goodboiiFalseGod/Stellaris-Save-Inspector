const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const events = new Map(), nodes = new Map();
function node(id) {
  if (!nodes.has(id)) {
    const classes = new Set();
    nodes.set(id, {textContent: '', attributes: {}, classList: {toggle(name) {if (classes.has(name)) {classes.delete(name); return false;} classes.add(name); return true;}, contains: name => classes.has(name)}, setAttribute(name, value) {this.attributes[name] = value;}, addEventListener(name, handler) {events.set(`${id}:${name}`, handler);}});
  }
  return nodes.get(id);
}
let resizes = 0, closes = 0;
const panel = node('.galaxy-map-panel');
const document = {body: node('body'), querySelector: node, addEventListener: (name, handler) => events.set(name, handler), fullscreenElement: null};
panel.requestFullscreen = async () => {document.fullscreenElement = panel; events.get('fullscreenchange')();};
document.exitFullscreen = async () => {document.fullscreenElement = null; events.get('fullscreenchange')();};
vm.runInNewContext(fs.readFileSync(`${__dirname}/map-interface.js`, 'utf8'), {document, console, requestAnimationFrame: callback => callback(), GalaxyMap: {resize: () => resizes++, closeSystemPanel: () => closes++}});
(async () => {
  events.get('#map-top-toggle:click')();
  assert.equal(document.body.classList.contains('map-top-hidden'), true);
  assert.equal(node('#map-top-toggle').attributes['aria-expanded'], 'false');
  events.get('#map-top-toggle:click')();
  assert.equal(document.body.classList.contains('map-top-hidden'), false);
  events.get('#map-detail-expand:click')();
  assert.equal(panel.classList.contains('system-panel-expanded'), true);
  events.get('#map-detail-toggle:click')();
  assert.equal(closes, 1);
  events.get('#map-detail-toggle:click')();
  assert.equal(closes, 2);
  await events.get('#map-fullscreen:click')();
  assert.equal(document.fullscreenElement, panel);
  assert.equal(node('#map-fullscreen').attributes['aria-pressed'], 'true');
  await document.exitFullscreen();
  assert.equal(node('#map-fullscreen').attributes['aria-pressed'], 'false');
  assert.equal(resizes, 5);
  console.log('PASS: top menu, system panel expansion/collapse, fullscreen entry/exit, resize');
})().catch(error => {console.error(error); process.exitCode = 1;});
