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
let dom, directory, Feedback, Example, featureStyle, createRoot, root, container, requests;
before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'https://predio.test/'});
  const globals = {window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: () => {requests++; throw new Error('The detached example must not contact an API.');}};
  for (const [name, value] of Object.entries(globals)) {
    previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {value, configurable: true, writable: true});
  }
  ({createRoot} = await import('react-dom/client'));
  const output = await build({configFile: false, root: frontendRoot, logLevel: 'silent', build: {
    ssr: true, write: false, target: 'node20', minify: false, rollupOptions: {input: {
      feedback: join(frontendRoot, 'src/components/SetbackFeedback.jsx'),
      example: join(frontendRoot, 'src/components/SetbackExample.jsx'),
      map: join(frontendRoot, 'src/components/FootprintMap.jsx'),
    }},
  }});
  const cache = join(frontendRoot, 'node_modules/.cache/predio-component-tests');
  await mkdir(cache, {recursive: true}); directory = await mkdtemp(join(cache, 'setback-feedback-'));
  for (const item of output.output) if (item.type === 'chunk') {
    const path = join(directory, item.fileName); await mkdir(dirname(path), {recursive: true}); await writeFile(path, item.code);
  }
  const module = async name => import(pathToFileURL(join(directory, output.output.find(item => item.type === 'chunk' && item.isEntry && item.name === name).fileName)).href);
  ({default: Feedback} = await module('feedback'));
  ({default: Example} = await module('example'));
  ({footprintFeatureStyle: featureStyle} = await module('map'));
});
beforeEach(() => {container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); requests = 0;});
afterEach(async () => {await act(async () => root.unmount()); container.remove();});
after(async () => {
  dom?.window.close();
  for (const [name, descriptor] of previousGlobals) {if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];}
  if (directory) await rm(directory, {recursive: true, force: true});
});
const render = async (Component, props = {}) => act(async () => root.render(React.createElement(Component, props)));
const edge = (actual, status) => ({polygon: 0, ring: 0, edge: 1, kind: 'side', actual_m: actual, required_m: 5, shortfall_m: Math.max(0, 5 - actual), status});

test('the detached 5 m tutorial shows inside, equal, and exceeded limits without altering project data', async () => {
  const saved = '{"project":"unchanged","irm":null}'; dom.window.localStorage.setItem('project-test', saved);
  await render(Example);
  assert.equal(container.querySelector('details').open, false, 'the optional tutorial starts collapsed');
  assert.match(container.textContent, /EJEMPLO FICTICIO/);
  assert.match(container.textContent, /no se aplican a tu archivo/);
  const shape = () => container.querySelector('[data-example-shape="extension"]');
  const clickPreset = async value => act(async () => container.querySelector(`[aria-label^="Ejemplo de ${value} m:"]`).click());
  assert.equal(shape().getAttribute('data-setback-status'), 'within_reviewed_limits');
  assert.equal(shape().getAttribute('d'), 'M10 8 H14 V12 H10 Z');
  await clickPreset(5);
  assert.equal(shape().getAttribute('data-setback-status'), 'at_limit');
  assert.equal(shape().getAttribute('d'), 'M10 8 H15 V12 H10 Z');
  assert.equal(container.querySelectorAll('.setback-feedback.is-conflict').length, 0, 'equality must not be a violation');
  await clickPreset(6);
  assert.equal(shape().getAttribute('data-setback-status'), 'conflict');
  assert.equal(shape().getAttribute('d'), 'M10 8 H16 V12 H10 Z');
  assert.match(container.textContent, /La ampliación invade el retiro revisado/);
  assert.match(container.querySelector('.setback-feedback-shortfall').textContent, /Faltan1 m/);
  await act(async () => {
    const slider = container.querySelector('input[type="range"]');
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(slider, '6.3');
    slider.dispatchEvent(new dom.window.Event('input', {bubbles: true}));
  });
  assert.equal(shape().getAttribute('d'), 'M10 8 H16.3 V12 H10 Z', 'dragging the range uses actual metric geometry');
  assert.equal(shape().getAttribute('data-setback-status'), 'conflict');
  await clickPreset(4);
  assert.equal(shape().getAttribute('data-setback-status'), 'within_reviewed_limits', 'correcting a conflict clears the red state');
  assert.equal(requests, 0);
  assert.equal(dom.window.localStorage.getItem('project-test'), saved);
});

test('feedback identifies each figure and never displays a real positive deficit as zero', async () => {
  const check = {id: 'garden', role: 'extension', label: 'Ampliación del jardín', status: 'conflict', containment_status: 'within_reviewed_limits',
    setback_edges: [edge(4.99998, 'conflict')], complete: true, pending_reasons: []};
  await render(Feedback, {check, live: true});
  assert.equal(container.querySelector('.setback-feedback-name').textContent, 'Ampliación del jardín');
  assert.match(container.querySelector('.setback-feedback-shortfall').textContent, /< 0,0001 m/);
  assert.equal(container.querySelector('[role="status"]').textContent, 'La ampliación invade el retiro revisado');
  assert.match(container.textContent, /Vista previa geométrica/);
  await render(Feedback, {check: {...check, role: 'existing', label: 'Huella extraída'}});
  assert.match(container.textContent, /La huella existente invade el retiro revisado/);
  assert.doesNotMatch(container.textContent, /La ampliación invade/);
});

test('missing evidence stays pending and furniture has no regulatory conflict card', async () => {
  await render(Feedback, {check: {role: 'extension', status: 'pending', pending_reasons: ['identity', 'placement'], setback_edges: []}});
  assert.match(container.textContent, /Retiros por revisar/);
  assert.match(container.textContent, /Vincula el IRM al mismo predio/);
  assert.match(container.textContent, /Confirma la ubicación/);
  assert.equal(container.querySelectorAll('.setback-feedback-values').length, 0, 'unknown clearance is never shown as zero');
  await render(Feedback, {check: {role: 'furniture', status: 'conflict', setback_edges: [edge(1, 'conflict')]}});
  assert.equal(container.textContent, '');
});

test('map colors attach to the specific figure, leaving unrelated extensions and furniture separate', () => {
  const feature = (id, role, status) => ({properties: {id, role, setback_status: status}});
  const checks = [{id: 'existing-footprint', role: 'existing', status: 'conflict'}, {id: 'north', role: 'extension', status: 'within_reviewed_limits'},
    {id: 'east', role: 'extension', status: 'at_limit'}, {id: 'table', role: 'furniture', status: 'conflict'}];
  assert.equal(featureStyle(feature('existing-footprint', 'existing'), checks).color, '#af3441');
  assert.equal(featureStyle(feature('north', 'extension'), checks).color, '#287152');
  assert.equal(featureStyle(feature('east', 'extension'), checks).color, '#97651b');
  assert.equal(featureStyle(feature('table', 'furniture', 'conflict'), checks).color, '#5d6c8a');
  assert.equal(featureStyle(feature('new', 'extension'), checks).color, '#b56a21', 'pending figures keep the unreviewed proposal style');
});
