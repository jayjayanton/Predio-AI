import test, {before, beforeEach, afterEach, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import React, {act} from 'react';
import {JSDOM} from 'jsdom';
import {build} from 'vite';

const frontendRoot = fileURLToPath(new URL('..', import.meta.url));
const makeView = name => ({name, page: 1, extraction: {scope: 'modelspace'}, elements: [{id: 'footprint', kind: 'polyline', source_type: 'LWPOLYLINE', layer: 'Ground', closed: true, points: [[0, 0], [10000, 0], [10000, 6000], [0, 6000]]}]});
let dom, tempDirectory, Viewer, createRoot, root, container, props, snapshot, draft, calls;
const previousGlobals = new Map();
before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'https://predio.test/'});
  const globals = {window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement,
    requestAnimationFrame: () => 1, cancelAnimationFrame: () => {}, ResizeObserver: class {observe() {} disconnect() {}}, IS_REACT_ACT_ENVIRONMENT: true};
  for (const [name, value] of Object.entries(globals)) {
    previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, {value, configurable: true, writable: true});
  }
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  dom.window.HTMLElement.prototype.setPointerCapture = () => {};
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({left: 0, top: 0, width: 800, height: 560, right: 800, bottom: 560});
  ({createRoot} = await import('react-dom/client'));
  const output = await build({configFile: false, root: frontendRoot, logLevel: 'silent', build: {ssr: join(frontendRoot, 'src/components/BlueprintViewer.jsx'), write: false, target: 'node20', minify: false}});
  const cache = join(frontendRoot, 'node_modules/.cache/predio-component-tests'); await mkdir(cache, {recursive: true});
  tempDirectory = await mkdtemp(join(cache, 'scaled-planning-'));
  for (const item of output.output) if (item.type === 'chunk') {const path = join(tempDirectory, item.fileName); await mkdir(dirname(path), {recursive: true}); await writeFile(path, item.code);}
  const entry = output.output.find(item => item.type === 'chunk' && item.isEntry);
  ({default: Viewer} = await import(pathToFileURL(join(tempDirectory, entry.fileName)).href));
});
beforeEach(async () => {
  snapshot = null; draft = null; calls = 0; container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  props = {views: [makeView('Ground')], documentFormat: 'dwg', unitsCode: 4, documentName: 'ground.dwg'};
  await render();
});
afterEach(async () => {await act(async () => root.unmount()); container.remove();});
after(async () => {
  dom?.window.close(); for (const [name, descriptor] of previousGlobals) {if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];}
  if (tempDirectory) await rm(tempDirectory, {recursive: true, force: true});
});
async function render(extra = {}) {
  props = {...props, ...extra};
  await act(async () => root.render(React.createElement(Viewer, {...props, onPlanningChange: next => {snapshot = next; calls++;}, onDraftStateChange: next => {draft = next;}})));
}
function button(name) {
  const found = [...container.querySelectorAll('button')].find(item => (item.getAttribute('aria-label') || item.textContent).trim() === name);
  assert.ok(found, `button ${name}`); return found;
}
async function click(name) {await act(async () => button(name).click());}
function input(label) {const found = [...container.querySelectorAll('input,select')].find(item => item.getAttribute('aria-label') === label || item.labels?.[0]?.textContent.startsWith(label)); assert.ok(found, `input ${label}`); return found;}
async function setValue(element, value) {
  const prototype = element.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
  await act(async () => {Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value); element.dispatchEvent(new dom.window.Event(element.tagName === 'SELECT' ? 'change' : 'input', {bubbles: true}));});
}
async function extractFootprint() {
  await click('Capas'); await click('Seleccionar todo visible (1)'); await click('Huella');
  assert.equal(button('Usar como huella').disabled, true);
  await act(async () => container.querySelector('.cad-footprint-confirm input').click());
  await click('Usar como huella');
}
function lastShape() {return draft.records.find(record => record.view === props.views[0]).history.present.shapes.at(-1);}

test('units gate figures; editing, zoom, undo and redo preserve real dimensions', async () => {
  assert.equal(button('▭ Mesa').disabled, true); assert.equal(snapshot, null);
  await click('Aplicar unidad'); await click('▭ Mesa');
  assert.equal(snapshot.shapes.length, 1); assert.equal(snapshot.shapes[0].dimensions.widthMetres, 1.6);
  await setValue(input('Ancho (m)'), '2,4'); await setValue(input('Fondo (m)'), '1,2'); await setValue(input('Rotación (°)'), '30');
  await click('Aplicar medidas');
  assert.deepEqual(snapshot.shapes[0].dimensions, {widthMetres: 2.4, depthMetres: 1.2, rotationDegrees: 30});
  const saved = JSON.stringify(snapshot);
  await click('Acercar dibujo'); await click('Acercar dibujo'); await click('Alejar dibujo');
  assert.equal(JSON.stringify(snapshot), saved);
  await click('↶ Deshacer'); assert.equal(snapshot.shapes[0].dimensions.widthMetres, 1.6);
  await click('↷ Rehacer'); assert.equal(snapshot.shapes[0].dimensions.widthMetres, 2.4);
  await click('Duplicar'); assert.equal(snapshot.shapes.length, 2);
  await click('Eliminar figura'); assert.equal(snapshot.shapes.length, 1);
  assert.ok(calls < 25, 'callback updates do not trigger a render loop');
});

test('dragging and keyboard nudges update source position once per committed gesture', async () => {
  await click('Aplicar unidad'); await click('▭ Mesa');
  const original = {...lastShape(), center: [...lastShape().center]};
  const canvas = container.querySelector('canvas.cad-drawing-canvas');
  const dispatch = async (type, x, y) => act(async () => {
    const event = new dom.window.MouseEvent(type, {bubbles: true, clientX: x, clientY: y, button: 0});
    Object.defineProperty(event, 'pointerId', {value: 1}); canvas.dispatchEvent(event);
  });
  await dispatch('pointerdown', 400, 280); await dispatch('pointermove', 460, 310);
  assert.deepEqual(lastShape().center, original.center, 'preview does not create history entries');
  await dispatch('pointerup', 460, 310);
  assert.ok(lastShape().center[0] > original.center[0]); assert.ok(lastShape().center[1] > original.center[1]);
  assert.equal(lastShape().widthMetres, original.widthMetres);
  const moved = [...lastShape().center];
  await act(async () => canvas.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true})));
  assert.equal(lastShape().center[0], moved[0] + 50);
  await click('↶ Deshacer'); assert.deepEqual(lastShape().center, moved);
  await click('↶ Deshacer'); assert.deepEqual(lastShape().center, original.center);
});

test('footprint needs explicit ground declaration; scale edits invalidate it and retain metric figures', async () => {
  await click('Aplicar unidad'); await click('＋ Ampliación'); await extractFootprint();
  assert.equal(snapshot.footprintAreaM2, 60); assert.equal(snapshot.footprint.coordinates.length, 1);
  assert.equal(snapshot.shapes[0].role, 'extension');
  await click('Medidas');
  await click('Cambiar escala');
  await setValue(input('Unidad del dibujo'), 'm'); await click('Aplicar unidad');
  assert.equal(snapshot.footprint, null); assert.equal(snapshot.shapes[0].dimensions.widthMetres, 3);
  assert.match(container.querySelector('.cad-planning-notice').textContent, /La escala cambió/);
  assert.equal(button('↶ Deshacer').disabled, true, 'history cannot revive footprint from a previous scale');
});

test('same inspection can remount from its draft while a replacement file cannot inherit it', async () => {
  await click('Aplicar unidad'); await click('○ Círculo'); await extractFootprint();
  const savedDraft = draft; const savedSnapshot = structuredClone(snapshot);
  await act(async () => root.unmount()); root = createRoot(container);
  await render({draftState: savedDraft});
  assert.deepEqual(snapshot, savedSnapshot);
  const replacement = [makeView('Ground')];
  await render({views: replacement, draftState: savedDraft});
  assert.equal(snapshot, null); assert.equal(button('▭ Mesa').disabled, true);
  await click('Aplicar unidad'); assert.equal(snapshot.shapes.length, 0); assert.equal(snapshot.footprint, null);
});

test('each exact floor keeps its own scale and figures without carrying them into another floor', async () => {
  const first = props.views[0], second = makeView('Upper'); await render({views: [first, second]});
  await click('Aplicar unidad'); await click('▭ Mesa');
  await setValue(container.querySelector('.cad-view-choice select'), '1');
  assert.equal(snapshot, null); await click('Aplicar unidad'); await click('○ Círculo');
  assert.equal(snapshot.shapes[0].kind, 'circle');
  await setValue(container.querySelector('.cad-view-choice select'), '0');
  assert.equal(snapshot.shapes.length, 1); assert.equal(snapshot.shapes[0].kind, 'rectangle'); assert.equal(snapshot.source.viewIndex, 0);
});
