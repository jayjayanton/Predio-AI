import test, { after, afterEach, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { build } from 'vite';

const frontendRoot = fileURLToPath(new URL('..', import.meta.url));
const entryPaths = ['Plantas/Piso 1/plano.dxf', 'Plantas/Piso 2/plano.dxf', 'Secciones/corte.dwg'];
const entries = entryPaths.map(path => ({ path, filename: path.split('/').at(-1), format: path.split('.').at(-1), size_bytes: 2048 }));
const previousGlobals = new Map();
let dom, tempDirectory, App, createRoot, root, container;
let requests = [];

function inspectionFor(path = entryPaths[0], { failure = false, archiveName = 'Casa.zip', length = 4000 } = {}) {
  const entry = entries.find(item => item.path === path);
  return {
    activities: [{ id: 'repair_wall', label: 'Reparar muro' }],
    blueprint: {
      filename: entry.filename, format: entry.format, units_code: 4,
      package: { filename: archiveName, entries, selected_entry: path, skipped_count: 1, warnings: ['Los archivos de imagen no se inspeccionan.'] },
      ...(failure ? { inspection_status: 'failed', inspection_error: 'No se pudo convertir el dibujo seleccionado.', drawing_views: [] } : {
        drawing_views: [{ name: 'Model', page: 1, extraction: { scope: 'modelspace' }, elements: [{
          id: 'wall', kind: 'line', source_type: 'LINE', layer: 'Walls', points: [[0, 0], [length, 0]],
        }] }],
      }),
    },
  };
}

before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://predio.test/#planos' });
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, localStorage: dom.window.localStorage,
    sessionStorage: dom.window.sessionStorage, FormData: dom.window.FormData,
    requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
    ResizeObserver: class { observe() {} disconnect() {} },
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: (url, options) => {
      assert.match(url, /\/api\/(?:documents\/analyze|coordinates\/transform)$/, 'this workflow only inspects documents and converts explicit references');
      return new Promise((resolve, reject) => requests.push({ url, ...options, resolve, reject }));
    },
  };
  for (const [name, value] of Object.entries(globals)) {
    previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  dom.window.scrollTo = () => {};
  dom.window.matchMedia = () => ({ matches: false });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  ({ createRoot } = await import('react-dom/client'));
  // Exercise the real App, package chooser and measurement panel. The unrelated
  // cadastral map is omitted; canvas painting/layout are covered in browser QA.
  const output = await build({
    configFile: false, root: frontendRoot, logLevel: 'silent',
    plugins: [{
      name: 'omit-unrelated-map-in-package-test',
      resolveId(id) { if (id.endsWith('/ParcelMap.jsx')) return '\0package-test-map'; },
      load(id) { if (id === '\0package-test-map') return 'export default function ParcelMap() { return null; }'; },
    }],
    build: { ssr: join(frontendRoot, 'src/App.jsx'), write: false, target: 'node20', minify: false },
  });
  const chunk = output.output.find(item => item.type === 'chunk' && item.isEntry);
  assert.ok(chunk, 'Vite produces the actual App module');
  const cacheRoot = join(frontendRoot, 'node_modules/.cache/predio-component-tests');
  await mkdir(cacheRoot, { recursive: true });
  tempDirectory = await mkdtemp(join(cacheRoot, 'package-'));
  for (const item of output.output) {
    if (item.type === 'chunk') {
      const path = join(tempDirectory, item.fileName);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, item.code);
    }
  }
  ({ default: App } = await import(pathToFileURL(join(tempDirectory, chunk.fileName)).href));
});

beforeEach(async () => {
  requests = [];
  dom.window.history.replaceState(null, '', '#planos');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(React.createElement(App)));
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
  if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true });
});

function button(name) {
  const element = [...container.querySelectorAll('button')].find(candidate =>
    (candidate.getAttribute('aria-label') || candidate.textContent).trim() === name);
  assert.ok(element, `button ${name} exists`);
  return element;
}
async function click(name) { await act(async () => button(name).click()); }
async function setValue(element, value) {
  assert.ok(element, 'input exists');
  const prototype = element.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new dom.window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
}
async function upload(name = 'Casa.zip', selector = '#blueprint-upload') {
  const file = new dom.window.File(['document fixture'], name);
  const input = container.querySelector(selector);
  await act(async () => {
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
  return file;
}
async function finish(request, body, status = 200) {
  await act(async () => request.resolve({ ok: status >= 200 && status < 300, status, json: async () => body }));
}
async function openPackage() {
  const archive = await upload();
  await click('Inspeccionar mi proyecto');
  assert.equal(requests[0].body.get('blueprint'), archive);
  assert.equal(requests[0].body.has('package_entry'), false);
  await finish(requests[0], inspectionFor());
  return archive;
}

test('the mounted app searches package paths, opens only on request and resets measurements between same-name drawings', async () => {
  const archive = await openPackage();
  assert.equal(container.querySelector('.project-package h3').textContent, 'Casa.zip');
  assert.equal(container.querySelectorAll('.project-package-files option').length, 3);
  await click('Seleccionar todo visible (1)');
  await click('Aplicar unidad');
  assert.ok(container.querySelector('.cad-scale-current'));
  assert.equal(container.querySelector('.cad-measurement-length > strong').textContent, '4m');

  await setValue(container.querySelector('.project-package-search'), 'PISO 2');
  assert.equal(container.querySelectorAll('.project-package-files option').length, 1);
  assert.equal(container.querySelector('.project-package-files').value, entryPaths[1]);
  assert.equal(requests.length, 1, 'searching and choosing do not start inspection');
  await click('Abrir dibujo');
  assert.equal(requests[1].body.get('blueprint'), archive, 'the original ZIP File is reused');
  assert.equal(requests[1].body.get('package_entry'), entryPaths[1]);
  assert.equal(container.querySelector('.cad-measurements'), null, 'previous measurements disappear during loading');
  assert.ok(container.querySelector('.project-package'), 'the package browser survives the switch');
  await finish(requests[1], inspectionFor(entryPaths[1], { length: 2000 }));
  assert.equal(container.querySelector('.cad-scale-current'), null);
  assert.equal(container.querySelector('.cad-measurement-heading > span').textContent, 'Escala pendiente');
  assert.equal(container.querySelectorAll('.cad-item-list input:checked').length, 0);
  await click('Seleccionar todo visible (1)');
  assert.equal(container.querySelector('.cad-measurement-length > strong').textContent, '2.000u');

  await setValue(container.querySelector('.project-package-search'), 'inexistente');
  assert.equal(button('Abrir dibujo').disabled, true);
  assert.match(container.querySelector('.project-package-choice').textContent, /No se encontraron dibujos/);
});

test('a failed package member keeps the inventory usable and clears its predecessor geometry', async () => {
  const archive = await openPackage();
  await setValue(container.querySelector('.project-package-files'), entryPaths[2]);
  await click('Abrir dibujo');
  await finish(requests[1], inspectionFor(entryPaths[2], { failure: true }));
  assert.match(container.querySelector('.inspection-result-header [role="alert"]').textContent, /No se pudo convertir/);
  assert.equal(container.querySelector('.cad-measurements'), null);
  assert.equal(container.querySelectorAll('.project-package-files option').length, 3);
  assert.equal(button('Abrir dibujo').disabled, false, 'the failed entry can be retried');
  await setValue(container.querySelector('.project-package-files'), entryPaths[1]);
  await click('Abrir dibujo');
  assert.equal(requests[2].body.get('blueprint'), archive);
  assert.equal(requests[2].body.get('package_entry'), entryPaths[1]);
  await finish(requests[2], inspectionFor(entryPaths[1]));
  assert.ok(container.querySelector('.cad-measurements'));
  assert.equal(container.querySelector('.inspection-result-header [role="alert"]'), null);
});

test('replacing the source aborts the package request and ignores a late response even if fetch resolves after abort', async () => {
  await openPackage();
  await setValue(container.querySelector('.project-package-files'), entryPaths[1]);
  await click('Abrir dibujo');
  const replacement = await upload('Otro.dxf');
  assert.equal(requests[1].signal.aborted, true);
  assert.equal(container.querySelector('.project-package'), null);
  assert.equal(container.querySelector('.cad-measurements'), null);
  await click('Inspeccionar mi plano');
  assert.equal(requests[2].body.get('blueprint'), replacement);
  assert.equal(requests[2].body.has('package_entry'), false);
  const next = inspectionFor(entryPaths[1], { length: 8000 });
  delete next.blueprint.package;
  next.blueprint.filename = 'Otro.dxf';
  await finish(requests[2], next);
  await finish(requests[1], inspectionFor(entryPaths[1]));
  assert.equal(container.querySelector('.project-package'), null, 'the old package cannot reattach');
  await click('Seleccionar todo visible (1)');
  assert.equal(container.querySelector('.cad-measurement-length > strong').textContent, '8.000u');
});

test('choosing the example cancels pending package work and reopening the ZIP starts a fresh inventory', async () => {
  await openPackage();
  await setValue(container.querySelector('.project-package-files'), entryPaths[1]);
  await click('Abrir dibujo');
  await click('Ver plano de ejemplo');
  assert.equal(requests[1].signal.aborted, true);
  assert.equal(container.querySelector('.project-package'), null);
  await finish(requests[1], inspectionFor(entryPaths[1]));
  assert.match(container.querySelector('#drawing-workspace').textContent, /Ejemplo interactivo/);
  assert.equal(container.querySelector('.project-package'), null);
  await click('Cerrar ejemplo');
  assert.equal(container.querySelector('.cad-measurements'), null);
  await click('Inspeccionar mi proyecto');
  assert.equal(requests[2].body.has('package_entry'), false, 'example selection cleared the package selection');
  await finish(requests[2], inspectionFor());
  assert.ok(container.querySelector('.project-package'));
});

test('package navigation respects the same activity and IRM gate as individual drawings', async () => {
  const archive = await openPackage();
  await setValue(container.querySelector('#work-type'), 'structural');
  assert.equal(button('Abrir dibujo').disabled, true);
  assert.equal(button('Inspeccionar mi proyecto').disabled, true);
  assert.equal(container.querySelector('.cad-measurements'), null);
  const irm = await upload('IRM.pdf', '#irm-upload');
  assert.equal(button('Abrir dibujo').disabled, false);
  await click('Abrir dibujo');
  assert.equal(requests[1].body.get('blueprint'), archive);
  assert.equal(requests[1].body.get('irm'), irm);
  assert.equal(requests[1].body.get('work_type'), 'structural');
  assert.deepEqual(requests[1].body.getAll('activities'), ['modify_structural_wall']);
  await finish(requests[1], inspectionFor());
});

test('an optional IRM travels with a repair drawing and each subsequent ZIP member', async () => {
  const archive = await upload();
  assert.match(container.querySelector('label[for="irm-upload"]').textContent, /opcional/);
  assert.equal(button('Inspeccionar mi proyecto').disabled, false);
  const irm = await upload('IRM-opcional.pdf', '#irm-upload');
  await click('Inspeccionar mi proyecto');
  assert.equal(requests[0].body.get('blueprint'), archive);
  assert.equal(requests[0].body.get('irm'), irm);
  assert.equal(requests[0].body.get('work_type'), 'repair');
  const result = inspectionFor();
  result.irm = { filename: 'IRM-opcional.pdf', format: 'pdf', pages: [{ page: 1 }], candidate_irm_fields: {} };
  await finish(requests[0], result);
  assert.ok(container.querySelector('.drawing-location-panel'));
  await setValue(container.querySelector('.project-package-files'), entryPaths[1]);
  await click('Abrir dibujo');
  assert.equal(requests[1].body.get('irm'), irm, 'the optional IRM remains part of the project analysis');
  assert.equal(container.querySelector('.drawing-location-panel'), null, 'location evidence clears while the next member is inspected');
  await finish(requests[1], { ...inspectionFor(entryPaths[1]), irm: result.irm });
  assert.ok(container.querySelector('.drawing-location-panel'));
});

test('a declared location survives the documentary summary but cannot transfer to another drawing', async () => {
  await openPackage();
  await setValue(container.querySelector('[aria-label="Latitud de referencia"]'), '0');
  await setValue(container.querySelector('[aria-label="Longitud de referencia"]'), '-78,5');
  await setValue(container.querySelector('.drawing-location-form-grid input[id$="-source"]'), 'Referencia ficticia para prueba');
  await click('Usar referencia');
  assert.match(requests[1].url, /\/coordinates\/transform$/);
  assert.deepEqual(JSON.parse(requests[1].body), {x: -78.5, y: 0, source_crs: 'EPSG:4326'});
  await finish(requests[1], {
    crs: {id: 'EPSG:4326', name: 'WGS 84', source: 'user_supplied'}, point: {x: -78.5, y: 0},
    geographic: {latitude: 0, longitude: -78.5, crs: 'EPSG:4326', point_role: 'reference_point', provenance: 'user_supplied_crs'},
    verified: false, warnings: [],
  });
  assert.match(container.querySelector('.drawing-location-declared').textContent, /Referencia ficticia para prueba/);
  await click('Ver resumen documental →');
  assert.ok(container.querySelector('.drawing-location-compact .drawing-location-declared'));
  assert.equal(container.querySelector('.drawing-location-reference-form'), null, 'the summary presents the applied reference');
  await click('← Revisar planos');
  assert.ok(container.querySelector('.drawing-location-declared'), 'returning to the same inspection preserves the reference');
  await setValue(container.querySelector('.project-package-files'), entryPaths[1]);
  await click('Abrir dibujo');
  await finish(requests[2], inspectionFor(entryPaths[1]));
  assert.equal(container.querySelector('.drawing-location-declared'), null, 'the next ZIP member has its own location context');
  assert.equal(container.querySelector('[aria-label="Latitud de referencia"]').value, '');
});

test('an inspection HTTP error leaves the existing package available for another entry', async () => {
  await openPackage();
  await setValue(container.querySelector('.project-package-files'), entryPaths[2]);
  await click('Abrir dibujo');
  await finish(requests[1], { detail: 'El servicio de conversión está ocupado. Inténtalo de nuevo.' }, 503);
  assert.match(container.querySelector('#drawing-workspace [role="alert"]').textContent, /servicio de conversión está ocupado/);
  assert.equal(container.querySelector('.cad-measurements'), null);
  assert.equal(button('Abrir dibujo').disabled, false);
});
