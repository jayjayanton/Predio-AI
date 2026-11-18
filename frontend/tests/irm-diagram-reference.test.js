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
const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
let dom, directory, Reference, createRoot, root, container, requests, created, revoked;
before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'https://predio.test/'});
  const globals = {window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true,
    __readIrmDiagram: file => new Promise((resolve, reject) => requests.push({file, resolve, reject}))};
  for (const [name, value] of Object.entries(globals)) {
    previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {value, configurable: true, writable: true});
  }
  URL.createObjectURL = file => {const url = `blob:irm-${created.length}`; created.push({file, url}); return url;};
  URL.revokeObjectURL = url => revoked.push(url);
  ({createRoot} = await import('react-dom/client'));
  const output = await build({configFile: false, root: frontendRoot, logLevel: 'silent', plugins: [{
    name: 'diagram-reader-boundary', enforce: 'pre',
    resolveId(source) {if (source.endsWith('/irmBrowser.js')) return '\0diagram-reader-test';},
    load(id) {if (id === '\0diagram-reader-test') return 'export const inspectIrmDiagramInBrowser = file => globalThis.__readIrmDiagram(file);';},
  }], build: {ssr: join(frontendRoot, 'src/components/IrmDiagramReference.jsx'), write: false, target: 'node20', minify: false}});
  const cache = join(frontendRoot, 'node_modules/.cache/predio-component-tests');
  await mkdir(cache, {recursive: true}); directory = await mkdtemp(join(cache, 'irm-diagram-'));
  for (const item of output.output) if (item.type === 'chunk') {
    const path = join(directory, item.fileName); await mkdir(dirname(path), {recursive: true}); await writeFile(path, item.code);
  }
  const reader = output.output.find(item => item.type === 'chunk' && Object.hasOwn(item.modules, '\0diagram-reader-test'));
  await import(pathToFileURL(join(directory, reader.fileName)).href);
  const entry = output.output.find(item => item.type === 'chunk' && item.isEntry);
  ({default: Reference} = await import(pathToFileURL(join(directory, entry.fileName)).href));
});
beforeEach(() => {container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); requests = []; created = []; revoked = [];});
afterEach(async () => {await act(async () => root.unmount()); container.remove();});
after(async () => {
  dom?.window.close(); URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke;
  for (const [name, descriptor] of previousGlobals) {if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];}
  if (directory) await rm(directory, {recursive: true, force: true});
});
const render = async file => act(async () => root.render(React.createElement(Reference, {file})));
const setOpen = async open => act(async () => {const details = container.querySelector('details'); details.open = open; details.dispatchEvent(new dom.window.Event('toggle'));});
const settle = async () => act(async () => new Promise(resolve => setTimeout(resolve, 0)));
const file = () => new dom.window.File(['%PDF-fixture'], 'irm.pdf', {type: 'application/pdf'});

test('the IRM reference is read only on expansion and reused for the exact same file', async () => {
  const source = file(); await render(source); assert.equal(requests.length, 0);
  await setOpen(true); await settle(); assert.equal(requests.length, 1); assert.equal(requests[0].file, source);
  assert.match(container.textContent, /Buscando el esquema/);
  await act(async () => requests[0].resolve({image: 'data:image/png;base64,YQ==', imagePage: 3}));
  assert.match(container.querySelector('img').alt, /página 3/);
  assert.match(container.querySelector('figcaption').textContent, /Imagen de referencia/);
  assert.equal(container.querySelector('a').getAttribute('href'), 'blob:irm-0#page=3');
  await setOpen(false); await setOpen(true); await settle(); assert.equal(requests.length, 1, 'reopening does not read the PDF again');
  await render(null); assert.equal(container.textContent, ''); assert.deepEqual(revoked, ['blob:irm-0']);
});

test('same-name replacement PDFs never reuse an old diagram or a late old result', async () => {
  const first = file(), second = file(); await render(first); await setOpen(true); await settle();
  await render(second); assert.equal(container.querySelector('details').open, false);
  assert.deepEqual(revoked, ['blob:irm-0']);
  await setOpen(true); await settle(); assert.equal(requests.length, 2);
  await act(async () => requests[0].resolve({image: 'data:image/png;base64,b2xk', imagePage: 1}));
  assert.equal(container.querySelector('img'), null, 'a stale crop never appears under the new IRM');
  await act(async () => requests[1].resolve(null));
  assert.match(container.textContent, /No se identificó un esquema/);
  assert.equal(container.querySelector('a').getAttribute('href'), 'blob:irm-1');
});
