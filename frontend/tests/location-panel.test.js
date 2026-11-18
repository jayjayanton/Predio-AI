import test, {after, afterEach, before, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import React, {act} from 'react';
import {JSDOM} from 'jsdom';
import {build} from 'vite';

const frontendRoot = fileURLToPath(new URL('..', import.meta.url));
const previousGlobals = new Map();
let dom, tempDirectory, Panel, createRoot, root, container, requests, changes, reference, props;
const geographic = (latitude = -0.2, longitude = -78.5) => ({latitude, longitude, crs: 'EPSG:4326', point_role: 'reference_point', provenance: 'user_supplied_crs'});
const localDrawing = () => ({filename: 'planta.dwg', location: {status: 'unreferenced', source: 'cad', crs: null, point: null, geographic: null,
  extents: {min: [0, -2000, 0], max: [12000, 6000, 0], units_code: 4, source: 'header_cached'}, candidates: [],
  warnings: ['Se ignoran los valores de latitud y longitud de la cabecera; pueden ser valores predeterminados.'], verified: false}});
const sourceIrm = () => ({filename: 'irm.pdf', location: {status: 'needs_crs', source: 'irm', crs: null,
  point: {x: 500000, y: 9980000}, geographic: null, candidates: [{kind: 'predio', value: '12345', page: 1}], warnings: [], verified: false}});
const response = () => ({crs: {id: 'EPSG:4326', name: 'WGS 84', source: 'user_supplied'}, point: {x: -78.5, y: -0.2}, geographic: geographic(), verified: false, warnings: []});

before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'https://predio.test/'});
  const globals = {window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: (url, options) => new Promise((resolve, reject) => requests.push({url, ...options, resolve, reject}))};
  for (const [name, value] of Object.entries(globals)) {
    previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {value, configurable: true, writable: true});
  }
  ({createRoot} = await import('react-dom/client'));
  const output = await build({configFile: false, root: frontendRoot, logLevel: 'silent',
    build: {ssr: join(frontendRoot, 'src/components/DrawingLocationPanel.jsx'), write: false, target: 'node20', minify: false}});
  const entry = output.output.find(item => item.type === 'chunk' && item.isEntry);
  const cacheRoot = join(frontendRoot, 'node_modules/.cache/predio-component-tests');
  await mkdir(cacheRoot, {recursive: true});
  tempDirectory = await mkdtemp(join(cacheRoot, 'location-'));
  await writeFile(join(tempDirectory, entry.fileName), entry.code);
  ({default: Panel} = await import(pathToFileURL(join(tempDirectory, entry.fileName)).href));
});
beforeEach(async () => {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  requests = []; changes = []; reference = {};
  props = {blueprint: localDrawing(), irm: sourceIrm(), selectedPredio: '12345', apiBase: 'https://api.predio.test'};
  await render();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
after(async () => {
  dom?.window.close();
  for (const [name, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
  }
  if (tempDirectory) await rm(tempDirectory, {recursive: true, force: true});
});

async function render(extra = {}) {
  props = {...props, ...extra};
  await act(async () => root.render(React.createElement(Panel, {...props, reference,
    onReferenceChange: next => {reference = next; changes.push(next); root.render(React.createElement(Panel, {...props, reference: next, onReferenceChange: updated => {reference = updated; changes.push(updated);}}));}})));
}
function button(name) {
  const found = [...container.querySelectorAll('button')].find(element => (element.getAttribute('aria-label') || element.textContent).trim() === name);
  assert.ok(found, `button ${name} exists`); return found;
}
async function click(name) { await act(async () => button(name).click()); }
function input(label) {
  return [...container.querySelectorAll('input, select')].find(element => element.getAttribute('aria-label') === label || element.labels?.[0]?.textContent.startsWith(label));
}
async function setValue(label, value) {
  const element = input(label); assert.ok(element, `input ${label} exists`);
  const prototype = element.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new dom.window.Event(element.tagName === 'SELECT' ? 'change' : 'input', {bubbles: true}));
  });
}
async function complete(request, body, ok = true) { await act(async () => request.resolve({ok, json: async () => body})); }
async function fillReference() {
  await setValue('Latitud de referencia', '-0,2'); await setValue('Longitud de referencia', '-78,5');
  await setValue('Fuente de la referencia', 'Levantamiento aportado');
}

test('local CAD and legacy header settings show no map pin and preserve source extents', () => {
  assert.match(container.querySelector('.drawing-location-source-blueprint').textContent, /Coordenadas locales · ubicación no verificada/);
  assert.match(container.querySelector('.drawing-location-source-blueprint').textContent, /valores predeterminados/);
  assert.equal(container.querySelectorAll('a').length, 0);
  assert.equal(container.querySelectorAll('.drawing-location-coordinates').length, 0);
  assert.match(container.querySelector('.drawing-location-extents').textContent, /mm.*X.*0.*12000.*Y.*-2000.*6000/s);
  assert.match(container.querySelector('.drawing-location-predio-comparison').textContent, /plano todavía no aporta/);
});

test('manual references validate, post x as longitude, and display separately from document evidence', async () => {
  await click('Usar referencia');
  assert.equal(requests.length, 0); assert.match(container.querySelector('[role="alert"]').textContent, /dos coordenadas/);
  await fillReference(); await click('Usar referencia');
  assert.equal(requests.length, 1);
  assert.deepEqual(JSON.parse(requests[0].body), {x: -78.5, y: -0.2, source_crs: 'EPSG:4326'});
  await complete(requests[0], response());
  assert.equal(changes.length, 1); assert.equal(reference.blueprint.source, 'user_reference');
  const drawingCard = container.querySelector('.drawing-location-source-blueprint');
  assert.match(drawingCard.textContent, /Coordenadas locales · ubicación no verificada/);
  assert.match(drawingCard.textContent, /Referencia declarada por ti · sin verificar/);
  assert.match(drawingCard.textContent, /Levantamiento aportado/);
  assert.match(drawingCard.querySelector('a').href, /mlat=-0\.200000&mlon=-78\.500000/);
  assert.equal(container.querySelector('.drawing-location-distance'), null);
  await click('Quitar referencia del Plano');
  assert.equal(reference.blueprint, undefined);
});

test('IRM coordinate prefill leaves unknown CRS blank and failed conversion creates no reference', async () => {
  await setValue('Documento de la referencia', 'irm');
  await click('Usar X/Y extraídos del IRM');
  assert.equal(input('Coordenada X de referencia').value, '500000');
  assert.equal(input('Coordenada Y de referencia').value, '9980000');
  assert.equal(input('Sistema de coordenadas de origen').value, '');
  await click('Usar referencia'); assert.equal(requests.length, 0);
  assert.match(container.querySelector('[role="alert"]').textContent, /código EPSG/);
  await setValue('Sistema de coordenadas de origen', 'SIRES-DMQ');
  await click('Usar referencia');
  assert.equal(JSON.parse(requests[0].body).source_crs, 'SIRES-DMQ');
  await complete(requests[0], {detail: 'El punto no corresponde al área de uso del sistema.'}, false);
  assert.match(container.querySelector('[role="alert"]').textContent, /área de uso/);
  assert.equal(changes.length, 0); assert.equal(container.querySelector('a'), null);
});

test('editing coordinates or replacing the document invalidates an in-flight result', async () => {
  await fillReference(); await click('Usar referencia');
  const first = requests[0];
  await setValue('Latitud de referencia', '-0,3');
  assert.equal(first.signal.aborted, true);
  await complete(first, response()); assert.equal(changes.length, 0);
  await click('Usar referencia'); const second = requests[1];
  await render({blueprint: localDrawing()});
  assert.equal(second.signal.aborted, true);
  await complete(second, response()); assert.equal(changes.length, 0);
  assert.equal(input('Latitud de referencia').value, '');
  assert.equal(container.querySelector('a'), null);
});

test('two source points show a qualified distance and compact report keeps references read-only', async () => {
  reference = {blueprint: {...response(), label: 'Punto del levantamiento', source: 'user_reference'}};
  const irm = sourceIrm(); irm.location.geographic = geographic(-0.21, -78.5); irm.location.status = 'geographic_available';
  await render({irm, compact: true});
  assert.match(container.querySelector('.drawing-location-distance').textContent, /1,11 km/);
  assert.match(container.querySelector('.drawing-location-distance').textContent, /Plano: referencia declarada; IRM: punto del documento/);
  assert.match(container.querySelector('.drawing-location-distance').textContent, /no confirma/);
  assert.equal(container.querySelector('form'), null);
  assert.equal(container.querySelector('.drawing-location-remove'), null);
  assert.equal(container.querySelectorAll('.drawing-location-coordinates').length, 2);
});
