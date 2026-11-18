import test, {before, beforeEach, afterEach, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import React, {act} from 'react';
import {JSDOM} from 'jsdom';
import {build} from 'vite';
import {fitTransform, prepareDrawing} from '../src/drawingGeometry.js';
import {planningShapeMetrics, shapeDrawingRing} from '../src/scaledPlanning.js';

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
function history() {return draft.records.find(record => record.view === props.views[0]).history;}
function canvas() {return container.querySelector('canvas.cad-drawing-canvas');}
async function pointer(type, point, options = {}) {
  await act(async () => {
    const event = new dom.window.MouseEvent(type, {bubbles: true, cancelable: true, clientX: point[0], clientY: point[1], button: 0, ...options});
    Object.defineProperty(event, 'pointerId', {value: options.pointerId || 1});
    Object.defineProperty(event, 'pointerType', {value: options.pointerType || 'mouse'});
    canvas().dispatchEvent(event);
  });
}
async function key(value, options = {}) {
  await act(async () => canvas().dispatchEvent(new dom.window.KeyboardEvent('keydown', {key: value, bubbles: true, cancelable: true, ...options})));
}
async function pointClick(point) {await pointer('pointerdown', point); await pointer('pointerup', point);}
async function drawPolygon(points, finish = true) {
  await click('Dibujar polígono libre');
  for (const point of points) await pointClick(point);
  if (finish) await key('Enter');
}
function handlePoint(kind, index) {
  const handle = container.querySelector(`[data-handle-kind="${kind}"][data-handle-index="${index}"]`);
  assert.ok(handle, `${kind} handle ${index}`);
  const circle = handle.querySelector('circle'), rect = handle.querySelector('rect');
  return circle ? [Number(circle.getAttribute('cx')), Number(circle.getAttribute('cy'))]
    : [Number(rect.getAttribute('x')) + 5, Number(rect.getAttribute('y')) + 5];
}
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≈ ${expected}`);

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

test('dragging creates chosen dimensions, square constraints, and one history entry independent of zoom', async () => {
  assert.equal(button('Dibujar polígono libre').disabled, true);
  await click('Aplicar unidad');
  const initialScale = fitTransform(prepareDrawing(props.views[0]).bounds, 800, 560).scale;
  await click('Dibujar rectángulo');
  await pointer('pointerdown', [200, 180]); await pointer('pointermove', [350, 270]);
  assert.equal(snapshot.shapes.length, 0); assert.equal(history().past.length, 0);
  assert.match(container.querySelector('.cad-sketch-hud').textContent, /Dibujo en curso/);
  await key('ArrowRight'); await key('+');
  assert.equal(container.querySelector('.cad-zoom').textContent, '100 %', 'view controls cannot disrupt an active draw gesture');
  await pointer('pointerup', [350, 270]);
  closeTo(lastShape().widthMetres, 150 / initialScale * 0.001);
  closeTo(lastShape().depthMetres, 90 / initialScale * 0.001);
  assert.equal(history().past.length, 1);
  await click('Acercar dibujo'); await click('Dibujar cuadrado');
  await pointer('pointerdown', [300, 200]); await pointer('pointermove', [375, 245]); await pointer('pointerup', [375, 245]);
  closeTo(lastShape().widthMetres, 75 / (initialScale * 1.5) * 0.001);
  closeTo(lastShape().widthMetres, lastShape().depthMetres);
  await click('↶ Deshacer'); assert.equal(snapshot.shapes.length, 1);
  await click('↷ Rehacer'); assert.equal(snapshot.shapes.length, 2);
});

test('custom concave polygons and triangles commit only after completion; draft undo preserves committed figures', async () => {
  await click('Aplicar unidad'); await click('▭ Mesa');
  const before = snapshot;
  const points = [[160, 160], [460, 160], [460, 240], [300, 240], [300, 360], [160, 360]];
  await drawPolygon(points, false);
  assert.strictEqual(snapshot, before); assert.equal(history().present.shapes.length, 1);
  await key('z', {ctrlKey: true}); assert.match(container.querySelector('.cad-sketch-progress-heading').textContent, /5 puntos/);
  assert.strictEqual(snapshot, before);
  await pointClick(points.at(-1)); await pointClick(points[0]);
  assert.equal(snapshot.shapes.length, 2); assert.equal(lastShape().kind, 'polygon'); assert.equal(lastShape().verticesMetres.length, 6);
  assert.ok(planningShapeMetrics(lastShape()).areaM2 < lastShape().widthMetres * lastShape().depthMetres);
  const completed = snapshot;
  await click('Dibujar triángulo'); await pointClick([250, 150]); await pointClick([400, 300]);
  assert.strictEqual(snapshot, completed);
  await pointClick([250, 300]);
  assert.equal(lastShape().verticesMetres.length, 3); assert.equal(snapshot.shapes.length, 3);
});

test('corner edits preview without publishing, retain other corners, and undo as one scaled gesture', async () => {
  await click('Aplicar unidad');
  await drawPolygon([[200, 180], [400, 180], [400, 380], [200, 380]]);
  await setValue(input('Rotación (°)'), '30'); await click('Aplicar medidas'); await click('Acercar dibujo');
  const original = structuredClone(lastShape()), before = snapshot, ring = shapeDrawingRing(original, 0.001), steps = history().past.length;
  const start = handlePoint('vertex', 0), end = [start[0] - 24, start[1] - 15];
  await pointer('pointerdown', start); await pointer('pointermove', end);
  assert.strictEqual(snapshot, before); assert.equal(history().past.length, steps);
  await key('Delete'); await key('ArrowRight'); assert.strictEqual(snapshot, before, 'keyboard edits cannot overwrite a pointer gesture');
  await pointer('pointerup', end);
  assert.equal(history().past.length, steps + 1);
  const nextRing = shapeDrawingRing(lastShape(), 0.001);
  for (let index = 1; index < 4; index++) nextRing[index].forEach((value, axis) => closeTo(value, ring[index][axis]));
  const initialScale = fitTransform(prepareDrawing(props.views[0]).bounds, 800, 560).scale;
  closeTo(nextRing[0][0] - ring[0][0], -24 / (initialScale * 1.5));
  closeTo(nextRing[0][1] - ring[0][1], -15 / (initialScale * 1.5));
  await key('ArrowRight');
  closeTo(shapeDrawingRing(lastShape(), 0.001)[0][0] - nextRing[0][0], 50);
  await click('↶ Deshacer'); await click('↶ Deshacer'); assert.deepEqual(lastShape(), original);
});

test('crossing outlines and canceled handle or drawing gestures never replace the committed proposal', async () => {
  await click('Aplicar unidad'); await drawPolygon([[200, 180], [400, 180], [400, 380], [200, 380]]);
  const original = structuredClone(snapshot), steps = history().past.length;
  await pointer('pointerdown', handlePoint('vertex', 0)); await pointer('pointermove', [450, 280]);
  assert.ok(container.querySelector('.cad-invalid-handle')); await pointer('pointerup', [450, 280]);
  assert.deepEqual(snapshot, original); assert.equal(history().past.length, steps);
  assert.match(container.querySelector('.cad-design-error').textContent, /no se guardó/);
  const edge = handlePoint('insert', 3);
  await pointer('pointerdown', edge); assert.equal(container.querySelectorAll('[data-handle-kind="vertex"]').length, 5);
  await pointer('pointercancel', edge);
  assert.deepEqual(snapshot, original); assert.equal(input('Punto del polígono').value, '');
  await pointer('pointerdown', edge); await key('Escape'); await pointer('pointerup', [edge[0] - 20, edge[1]]);
  assert.deepEqual(snapshot, original);
  await click('Dibujar rectángulo'); await pointer('pointerdown', [100, 100]); await pointer('pointermove', [180, 150]);
  assert.ok(container.querySelector('.cad-sketch-hud')); await pointer('lostpointercapture', [180, 150]);
  assert.equal(container.querySelector('.cad-sketch-hud'), null); assert.deepEqual(snapshot, original);
  await key('Escape');
  await drawPolygon([[150, 150], [350, 350], [350, 150], [150, 350]]);
  assert.deepEqual(snapshot, original); assert.match(container.querySelector('.cad-design-error').textContent, /contorno no es válido/);
  await click('Cancelar dibujo'); assert.deepEqual(snapshot, original);
});

test('edge insertion, polygon resizing, and extension exports preserve the accepted source footprint', async () => {
  await click('Aplicar unidad'); await extractFootprint(); const footprint = structuredClone(snapshot.footprint);
  await click('Figuras'); await setValue(input('Uso del nuevo dibujo'), 'extension');
  await drawPolygon([[220, 180], [400, 180], [400, 250], [320, 250], [320, 350], [220, 350]]);
  assert.equal(snapshot.shapes[0].role, 'extension'); assert.equal(snapshot.shapes[0].dimensions.vertexCount, 6);
  const originalRing = shapeDrawingRing(lastShape(), 0.001), edge = handlePoint('insert', 0), steps = history().past.length;
  await pointer('pointerdown', edge); await pointer('pointermove', [edge[0], edge[1] - 35]);
  assert.equal(snapshot.shapes[0].dimensions.vertexCount, 6);
  await pointer('pointerup', [edge[0], edge[1] - 35]);
  assert.equal(snapshot.shapes[0].dimensions.vertexCount, 7); assert.equal(history().past.length, steps + 1);
  const inserted = shapeDrawingRing(lastShape(), 0.001);
  originalRing.slice(1, -1).forEach((point, i) => point.forEach((value, axis) => closeTo(inserted[i + 2][axis], value)));
  await click('Eliminar punto'); assert.equal(lastShape().verticesMetres.length, 6);
  await click('Cambiar tamaño'); const anchor = handlePoint('resize', 0), opposite = handlePoint('resize', 2);
  await pointer('pointerdown', opposite); await pointer('pointermove', [opposite[0] + 70, opposite[1] + 40]); await pointer('pointerup', [opposite[0] + 70, opposite[1] + 40]);
  handlePoint('resize', 0).forEach((value, axis) => closeTo(value, anchor[axis]));
  assert.deepEqual(snapshot.footprint, footprint); assert.equal(snapshot.shapes[0].role, 'extension');
  await setValue(input('Ancho (m)'), '5'); await setValue(input('Fondo (m)'), '3'); await click('Aplicar medidas');
  closeTo(lastShape().widthMetres, 5); closeTo(lastShape().depthMetres, 3);
  assert.deepEqual(snapshot.footprint, footprint);
});

test('pinch cancellation, view changes, and scale changes cannot retain uncommitted geometry', async () => {
  await click('Aplicar unidad'); await drawPolygon([[200, 180], [400, 180], [400, 380], [200, 380]]);
  const before = structuredClone(snapshot), edge = handlePoint('insert', 3);
  await pointer('pointerdown', edge, {pointerType: 'touch'});
  await pointer('pointerdown', [600, 400], {pointerType: 'touch', pointerId: 2});
  await pointer('pointermove', [650, 430], {pointerType: 'touch', pointerId: 2});
  await pointer('pointerup', [650, 430], {pointerType: 'touch', pointerId: 2}); await pointer('pointerup', edge, {pointerType: 'touch'});
  assert.deepEqual(snapshot, before); assert.equal(input('Punto del polígono').value, '');
  await drawPolygon([[100, 100], [180, 100]], false);
  await click('Medidas'); await click('Restablecer escala');
  assert.equal(Boolean(container.querySelector('.cad-draft-path')), false); assert.equal(snapshot, null);
  await click('Aplicar unidad'); assert.equal(snapshot.shapes.length, 1);
  await drawPolygon([[100, 100], [180, 100]], false);
  await render({views: [makeView('Replacement')]});
  assert.equal(Boolean(container.querySelector('.cad-draft-path')), false); assert.equal(snapshot, null);
  await click('Aplicar unidad'); assert.equal(snapshot.shapes.length, 0);
});
