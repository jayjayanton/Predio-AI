import test, { after, afterEach, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { build } from 'vite';

const frontendRoot = fileURLToPath(new URL('..', import.meta.url));
const line = (id, length = 4000, extra = {}) => ({
  id, kind: 'line', source_type: 'LINE', layer: 'Walls',
  points: [[0, 0], [length, 0]], ...extra,
});
const view = (name, elements) => ({name, page: 1, elements, extraction: {scope: 'modelspace'}});
let dom, tempDirectory, BlueprintViewer, createRoot, root, container;
const previousGlobals = new Map();
const scrollTargets = [];

before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'https://predio.test/'});
  // React state, effects, controls and focus are exercised here. Canvas painting
  // and responsive layout are checked separately in the live browser.
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
    ResizeObserver: class { observe() {} disconnect() {} },
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [name, value] of Object.entries(globals)) {
    previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {value, configurable: true, writable: true});
  }
  dom.window.HTMLElement.prototype.scrollIntoView = function () { scrollTargets.push(this); };
  ({createRoot} = await import('react-dom/client'));
  // Use the project's own Vite JSX transformation without starting a server.
  const output = await build({
    configFile: false, root: frontendRoot, logLevel: 'silent',
    build: {ssr: join(frontendRoot, 'src/components/BlueprintViewer.jsx'),
      write: false, target: 'node20', minify: false},
  });
  const chunk = output.output.find(item => item.type === 'chunk' && item.isEntry);
  assert.ok(chunk, 'Vite produces the actual viewer module');
  const cacheRoot = join(frontendRoot, 'node_modules/.cache/predio-component-tests');
  await mkdir(cacheRoot, {recursive: true});
  tempDirectory = await mkdtemp(join(cacheRoot, 'measurement-'));
  const modulePath = join(tempDirectory, 'viewer.mjs');
  await writeFile(modulePath, chunk.code);
  ({default: BlueprintViewer} = await import(pathToFileURL(modulePath).href));
});

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  scrollTargets.length = 0;
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
after(async () => {
  dom?.window.close();
  for (const [name, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
  if (tempDirectory) await rm(tempDirectory, {recursive: true, force: true});
});

async function render(views, extra = {}) {
  await act(async () => root.render(React.createElement(BlueprintViewer, {
    views, documentFormat: 'dwg', unitsCode: 4, ...extra,
  })));
}
function button(name) {
  const result = [...container.querySelectorAll('button')].find(element =>
    (element.getAttribute('aria-label') || element.textContent).trim() === name);
  assert.ok(result, `button ${name} exists`);
  return result;
}
async function click(name) { await act(async () => button(name).click()); }
async function setValue(element, value) {
  const prototype = element.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new dom.window.Event(element.tagName === 'SELECT' ? 'change' : 'input', {bubbles: true}));
  });
}
function value(key) { return container.querySelector(`.cad-measurement-${key} > strong`).textContent; }
function pending() {
  assert.equal(container.querySelector('.cad-measurement-heading > span').textContent, 'Escala pendiente');
  assert.equal(container.querySelector('.cad-scale-current'), null);
}

test('the mounted panel requires Apply unit and explains which selected objects contribute', async () => {
  await render([view('Model', [
    line('wall'),
    {id: 'note', kind: 'text', source_type: 'TEXT', layer: 'Notes', position: [0, 0], height: 100, text: '4 m'},
    line('dimension', 4000, {dimension_handle: 'D1'}),
    line('pattern', 4000, {source_type: 'HATCH', hatch_pattern: true}),
  ])]);
  pending();
  assert.equal(container.querySelector('[aria-label="Unidad del dibujo"]').value, 'mm');
  await click('Seleccionar todo visible (4)');
  pending();
  assert.equal(value('length'), '4.000u');
  assert.match(container.querySelector('.cad-measurement-scope').textContent, /4 elementos seleccionados.*1 elemento compatible.*3 excluidos/);
  const excluded = container.querySelector('.cad-measurement-excluded');
  const values = container.querySelector('.cad-measurement-values');
  assert.ok(excluded.compareDocumentPosition(values) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  await click('Aplicar unidad');
  assert.equal(value('length'), '4m');
  assert.equal(value('area'), '—');
});

test('calibration is applied by the panel and cleared on view switches and replacement imports', async () => {
  const views = [view('Model', [line('reference', 10000)]), view('Other', [line('other', 2000)])];
  await render(views);
  await click('Seleccionar todo visible (1)');
  await setValue(container.querySelector('.cad-calibration-form input'), '3,10');
  await click('Aplicar calibración');
  assert.equal(value('length'), '3,1m');
  assert.match(container.querySelector('.cad-scale-current').textContent, /1 u = 0,00031 m/);

  await setValue(container.querySelector('.cad-view-choice select'), '1');
  pending();
  await click('Seleccionar todo visible (1)');
  assert.equal(value('length'), '2.000u');
  await setValue(container.querySelector('.cad-view-choice select'), '0');
  pending();
  await click('Aplicar unidad');
  assert.ok(container.querySelector('.cad-scale-current'));

  // A replacement file may reuse the same view name, page and source IDs.
  await render([view('Model', [line('reference', 5000)]), views[1]]);
  pending();
  await click('Seleccionar todo visible (1)');
  assert.equal(value('length'), '5.000u');
});

test('returning from measurements focuses the drawing without losing selected geometry, zoom or scale', async () => {
  await render([view('Model', [{
    id: 'room', kind: 'polyline', layer: 'Walls', closed: true,
    points: [[0, 0], [10000, 0], [10000, 5000], [0, 5000]],
  }])]);
  await click('Seleccionar todo visible (1)');
  await click('Aplicar unidad');
  await click('Acercar dibujo');
  const previous = {area: value('area'), perimeter: value('perimeter'), zoom: container.querySelector('.cad-zoom').textContent};
  assert.equal(previous.area, '50m²');
  await click('Medidas');
  assert.equal(document.activeElement, container.querySelector('.cad-measurements'));
  await click('Volver al plano');
  assert.equal(document.activeElement, container.querySelector('.cad-drawing-canvas'));
  assert.equal(scrollTargets.at(-1), container.querySelector('.cad-stage'));
  assert.equal(value('area'), previous.area);
  assert.equal(value('perimeter'), previous.perimeter);
  assert.equal(container.querySelector('.cad-zoom').textContent, previous.zoom);
  assert.equal(container.querySelectorAll('.cad-item-list input:checked').length, 1);
});

test('a conflicting source unit remains visible and can be corrected without changing selection', async () => {
  await render([view('Model', [line('wall')])]);
  await click('Seleccionar todo visible (1)');
  assert.match(container.querySelector('.cad-unit-form label').textContent, /Unidad de las coordenadas CAD/);
  await setValue(container.querySelector('[aria-label="Unidad del dibujo"]'), 'm');
  await click('Aplicar unidad');
  assert.equal(value('length'), '4.000m');
  assert.equal(container.querySelector('.cad-measurement-heading > span').textContent, 'Revisar unidad');
  const warning = container.querySelector('.cad-unit-mismatch');
  assert.match(warning.textContent, /archivo declara milímetros/);
  assert.ok(warning.compareDocumentPosition(container.querySelector('.cad-measurement-values')) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  await click('Volver al plano');
  assert.ok(container.querySelector('.cad-unit-mismatch'), 'the warning survives navigation');
  await click('Usar milímetros del archivo');
  assert.equal(value('length'), '4m');
  assert.equal(container.querySelector('.cad-unit-mismatch'), null);
  assert.equal(container.querySelector('.cad-measurement-heading > span').textContent, 'Escala aplicada');
  assert.equal(container.querySelectorAll('.cad-item-list input:checked').length, 1);
});

test('outer contour area is an explicit selection-scoped convention and preserves the applied scale', async () => {
  await render([view('Model', [{
    id: 'floor', kind: 'hatch_boundary', source_type: 'HATCH', layer: 'Floor', closed: true,
    rings: [[[0, 0], [10000, 0], [10000, 6000], [0, 6000]],
      [[2000, 2000], [4000, 2000], [4000, 4000], [2000, 4000]]],
  }])]);
  await click('Seleccionar capa Floor');
  await click('Aplicar unidad');
  assert.equal(value('area'), '56m²');
  assert.equal(value('perimeter'), '40m');
  assert.equal(container.querySelector('[aria-label="Área a medir"]').value, 'source');
  await setValue(container.querySelector('[aria-label="Área a medir"]'), 'exterior');
  assert.equal(value('area'), '60m²');
  assert.equal(value('perimeter'), '32m');
  assert.equal(container.querySelector('.cad-measurement-area > span').textContent, 'Área del contorno exterior');
  assert.match(container.querySelector('.cad-area-convention').textContent, /recortes interiores no se descuentan/);
  await click('Volver al plano');
  assert.equal(value('area'), '60m²');
  await click('Limpiar');
  await click('Seleccionar capa Floor');
  assert.equal(container.querySelector('[aria-label="Área a medir"]').value, 'source');
  assert.equal(value('area'), '56m²', 'a new selection returns to the source convention and keeps millimetres');
});

test('an open selection explains the missing area and starts closed-contour selection from the panel', async () => {
  await render([view('Model', [line('wall')])]);
  await click('Seleccionar todo visible (1)');
  const reason = container.querySelector('.cad-area-reason');
  assert.match(reason.textContent, /trazado está abierto/);
  assert.ok(reason.compareDocumentPosition(container.querySelector('.cad-measurement-values')) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  await click('Elegir contorno cerrado');
  assert.equal(button('Área de contorno').getAttribute('aria-pressed'), 'true');
  assert.ok(container.querySelector('.cad-controls input[type="checkbox"]').disabled);
  assert.equal(document.activeElement, container.querySelector('.cad-drawing-canvas'));
  assert.match(container.querySelector('.cad-contour-help').textContent, /sin descontar recortes interiores/);
  assert.equal(value('area'), '—', 'changing the tool never fabricates a closed area');
});
