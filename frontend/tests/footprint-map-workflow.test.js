import test, {after, afterEach, before, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import React, {act} from 'react';
import {JSDOM} from 'jsdom';
import {build} from 'vite';

const frontendRoot = fileURLToPath(new URL('..', import.meta.url));
const previousGlobals = new Map();
const parcel = {type: 'FeatureCollection', features: [{type: 'Feature', properties: {n_predio: '123456', tipo_propi: 'UNIPROPIEDAD', area_terre: 900},
  geometry: {type: 'Polygon', coordinates: [[[-78.50015, -.20015], [-78.49985, -.20015], [-78.49985, -.19985], [-78.50015, -.19985], [-78.50015, -.20015]]]}}]};
const blueprint = {filename: 'workflow-test.dxf', format: 'dxf', units_code: 4, drawing_views: [{name: 'Planta baja de prueba', page: 1,
  extraction: {scope: 'modelspace', status: 'supported_geometry', rendered_primitives: 1, omitted_entity_counts: {}},
  elements: [{id: 'test-footprint', kind: 'polyline', source_type: 'LWPOLYLINE', layer: 'Huella de prueba', closed: true,
    points: [[0, 0], [10000, 0], [10000, 6000], [0, 6000], [0, 0]]}]}]};
const irm = {filename: 'irm-test.pdf', pages: [], candidate_irm_fields: {predio: {raw: '123456'}}, planning_evidence: {property_regime: 'individual', flags: []}};
let dom, tempDirectory, App, createRoot, root, container, mapModuleUrl, inspection, requests, scrolls;

before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'https://predio.test/#planos'});
  const globals = {window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement,
    localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage, File: dom.window.File, FormData: dom.window.FormData,
    requestAnimationFrame: callback => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout,
    ResizeObserver: class {observe() {} disconnect() {}}, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url, options = {}) => {
      requests.push({url: String(url), ...options});
      const value = String(url).includes('/api/predios/') ? parcel : String(url).includes('/api/documents/analyze') ? inspection
        : String(url).includes('/api/planning/assess') ? {status: 'preliminary', metrics: {existing_footprint_m2: 60, extension_added_m2: 0, combined_footprint_m2: 60},
          checks: [], placed: {type: 'FeatureCollection', features: []}, warnings: []} : {};
      return {ok: true, json: async () => structuredClone(value)};
    }};
  for (const [name, value] of Object.entries(globals)) {
    previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {value, configurable: true, writable: true});
  }
  window.matchMedia = () => ({matches: true, addEventListener() {}, removeEventListener() {}});
  window.scrollTo = () => {};
  HTMLElement.prototype.scrollIntoView = function () {scrolls.push(this.id || this.className);};
  HTMLElement.prototype.getBoundingClientRect = () => ({left: 0, top: 0, width: 800, height: 560, right: 800, bottom: 560});
  HTMLElement.prototype.setPointerCapture = () => {};
  dom.window.HTMLCanvasElement.prototype.getContext = () => null;
  ({createRoot} = await import('react-dom/client'));
  // Exercise the actual App, viewer and planner. Only Leaflet is replaced;
  // tile rendering and browser layout are outside this state/focus regression.
  const output = await build({configFile: false, root: frontendRoot, logLevel: 'silent', plugins: [{name: 'workflow-map-boundaries', enforce: 'pre',
    resolveId(source) {if (source.endsWith('/FootprintMap.jsx') || source.endsWith('/ParcelMap.jsx')) return source.endsWith('/FootprintMap.jsx') ? '\0workflow-footprint-map' : '\0workflow-parcel-map';},
    load(id) {if (id.startsWith('\0workflow-')) return `import React from 'react';export default function Map(){return React.createElement('div',{'data-testid':'${id.slice(1)}'},'Mapa de prueba');}`;}}],
    build: {ssr: join(frontendRoot, 'src/App.jsx'), write: false, target: 'node20', minify: false}});
  const cache = join(frontendRoot, 'node_modules/.cache/predio-component-tests');
  await mkdir(cache, {recursive: true}); tempDirectory = await mkdtemp(join(cache, 'footprint-workflow-'));
  for (const item of output.output) if (item.type === 'chunk') {
    const path = join(tempDirectory, item.fileName); await mkdir(dirname(path), {recursive: true}); await writeFile(path, item.code);
  }
  const entry = output.output.find(item => item.type === 'chunk' && item.isEntry);
  const mapChunk = output.output.find(item => item.type === 'chunk' && Object.hasOwn(item.modules, '\0workflow-footprint-map'));
  assert.ok(mapChunk, 'the lazy map fixture is emitted');
  mapModuleUrl = pathToFileURL(join(tempDirectory, mapChunk.fileName)).href;
  ({default: App} = await import(pathToFileURL(join(tempDirectory, entry.fileName)).href));
});
beforeEach(async () => {
  requests = []; scrolls = []; inspection = {blueprint, irm, predio_number: '123456', activities: [{label: 'Ampliar habitación'}]};
  window.location.hash = 'planos';
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  await act(async () => root.render(React.createElement(App))); await flush();
});
afterEach(async () => {await act(async () => root.unmount()); container.remove();});
after(async () => {
  dom?.window.close();
  for (const [name, descriptor] of previousGlobals) {if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];}
  if (tempDirectory) await rm(tempDirectory, {recursive: true, force: true});
});

const flush = async (milliseconds = 20) => act(async () => new Promise(resolve => setTimeout(resolve, milliseconds)));
const visible = element => !element.closest('[hidden]');
function button(label) {
  const found = [...container.querySelectorAll('button')].find(element => visible(element) && (element.getAttribute('aria-label') || element.textContent).trim() === label);
  assert.ok(found, `button ${label}`); return found;
}
async function click(label) {await act(async () => button(label).click()); await flush();}
async function value(id, text) {
  const element = document.getElementById(id); assert.ok(element, `field ${id}`);
  const prototype = element.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, text);
    element.dispatchEvent(new dom.window.Event(element.tagName === 'SELECT' ? 'change' : 'input', {bubbles: true}));
  }); await flush();
}
async function prepareFootprint() {
  await click('Vincular predio (opcional)'); await value('identifierType', 'n_predio'); await value('predio', '123456');
  await click('Buscar predio'); await click('Iniciar proyecto →'); await value('work-type', 'expansion');
  const fileInput = document.getElementById('blueprint-upload');
  Object.defineProperty(fileInput, 'files', {value: [new File(['0\nEOF\n'], 'workflow-test.dxf', {type: 'application/dxf'})], configurable: true});
  await act(async () => fileInput.dispatchEvent(new dom.window.Event('change', {bubbles: true}))); await flush();
  await click('Inspeccionar mi plano'); await click('Aplicar unidad'); await click('Capas');
  await click('Seleccionar todo visible (1)'); await click('Huella');
  await act(async () => container.querySelector('.cad-footprint-confirm input').click()); await flush();
  await click('Usar como huella');
  await act(async () => {await import(mapModuleUrl);}); await flush();
}

test('selecting a footprint reveals and focuses its parcel map without replaying on a report return', async () => {
  await prepareFootprint();
  assert.ok(container.querySelector('[data-testid="workflow-footprint-map"]'));
  assert.equal(document.activeElement.id, 'footprint-planner');
  assert.ok(scrolls.includes('footprint-planner'));
  assert.match(container.querySelector('.footprint-tabs .is-active').textContent, /Ubicar en el predio/);
  const before = scrolls.filter(id => id === 'footprint-planner').length;
  await click('03Revisar con el IRM'); await click('Ver resumen documental →'); await click('1 · Planos y actividades');
  assert.match(container.querySelector('.footprint-tabs .is-active').textContent, /Revisar con el IRM/);
  assert.equal(scrolls.filter(id => id === 'footprint-planner').length, before);
  assert.ok(requests.some(request => request.url.includes('/api/documents/analyze')));
});

test('the missing-IRM action reveals the actual upload controls and focuses the IRM file field', async () => {
  inspection = {...inspection, irm: null}; await prepareFootprint();
  assert.equal(document.getElementById('project-intake-content').hidden, true);
  await click('Añadir IRM');
  assert.equal(document.getElementById('project-intake-content').hidden, false);
  assert.equal(document.activeElement.id, 'irm-upload');
});
