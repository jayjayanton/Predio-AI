import test, { after, afterEach, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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
  // Keep Vite's lazy chunks and relative import paths so the reconstruction is
  // tested through the same Suspense boundary used by the application.
  for (const item of output.output) {
    if (item.type === 'chunk') {
      const path = join(tempDirectory, item.fileName);
      await mkdir(dirname(path), {recursive: true});
      await writeFile(path, item.code);
    }
  }
  const modulePath = join(tempDirectory, chunk.fileName);
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

const floorWithInterior = () => ({
  id: 'floor', kind: 'hatch_boundary', source_type: 'HATCH', layer: 'Floor', closed: true,
  rings: [[[0, 0], [10000, 0], [10000, 6000], [0, 6000]],
    [[2000, 2000], [4000, 2000], [4000, 4000], [2000, 4000]]],
});
const illustrationInput = label => container.querySelector(`[aria-label="${label}"]`);
const illustrationMetric = name => container.querySelector(`.cad-illustration-${name}`)?.textContent;

async function openIllustration() {
  await click('Ilustración 3D');
  const deadline = Date.now() + 3000;
  // Cold dynamic imports can take many event-loop turns on CI. Wait for the
  // observable panel, with a time limit, while flushing each React update.
  for (;;) {
    const failure = container.querySelector('.cad-illustration-error[role="alert"], .cad-illustration-render-error[role="alert"]');
    assert.equal(failure, null, `the illustration opens without an error: ${failure?.textContent || ''}`);
    if (container.querySelector('.cad-illustration')) return;
    assert.ok(Date.now() < deadline, 'the lazy reconstruction panel opens within 3 seconds');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  }
}

async function openFloorIllustration() {
  await click('Seleccionar capa Floor');
  await click('Aplicar unidad');
  await openIllustration();
}

test('illustration requires one visible closed source contour and an explicitly applied scale', async () => {
  await render([view('Model', [floorWithInterior(), line('wall')])]);
  assert.equal(button('Ilustración 3D').disabled, true);
  await click('Seleccionar capa Floor');
  assert.equal(button('Ilustración 3D').disabled, true, 'a suggested CAD unit is not a confirmed scale');
  await click('Aplicar unidad');
  assert.equal(button('Ilustración 3D').disabled, false);
  await click('Ocultar todas');
  assert.equal(button('Ilustración 3D').disabled, true, 'hidden source geometry cannot start a reconstruction');
  await click('Mostrar todas');
  assert.equal(button('Ilustración 3D').disabled, false);
  await click('Seleccionar todo visible (2)');
  assert.equal(button('Ilustración 3D').disabled, true, 'multiple selected entities have no single footprint');
  await click('Limpiar');
  await click('Seleccionar capa Walls');
  assert.equal(button('Ilustración 3D').disabled, true, 'an open wall line does not become a building');
});

test('height and roof assumptions change the illustration without rewriting the source area or measurement convention', async () => {
  await render([view('Model', [floorWithInterior()])]);
  await openFloorIllustration();
  const source = { area: value('area'), perimeter: value('perimeter') };
  assert.deepEqual(source, { area: '56m²', perimeter: '40m' });
  assert.match(illustrationMetric('area'), /60\s*m²/);
  assert.match(container.querySelector('.cad-illustration').textContent, /supuest/i);
  assert.match(container.querySelector('.cad-illustration').textContent, /ilustrativ/i);
  const surface = container.querySelector('.cad-illustration-renderer svg');
  assert.ok(surface?.querySelector('path'), 'the actual Three SVG fallback renders the illustrative geometry');
  const initialProjection = surface.innerHTML;

  await setValue(illustrationInput('Altura supuesta en metros'), '3');
  await setValue(illustrationInput('Cubierta supuesta'), 'gable');
  await setValue(illustrationInput('Pendiente supuesta en grados'), '30');
  await click('Actualizar ilustración');
  const maximumHeight = Number.parseFloat(illustrationMetric('height').replace(',', '.'));
  assert.ok(Math.abs(maximumHeight - (3 + 3 * Math.tan(Math.PI / 6))) < 0.0001);
  assert.notEqual(surface.innerHTML, initialProjection, 'the rendered model changes with its assumptions');
  assert.match(illustrationMetric('area'), /60\s*m²/);
  assert.equal(value('area'), source.area);
  assert.equal(value('perimeter'), source.perimeter);

  const angledProjection = surface.innerHTML;
  await click('Frente ilustrativo');
  assert.equal(button('Frente ilustrativo').getAttribute('aria-pressed'), 'true');
  assert.notEqual(surface.innerHTML, angledProjection);
  assert.match(container.querySelector('.cad-illustration-help').textContent, /no es un corte constructivo/);
  await click('Lado ilustrativo');
  assert.equal(button('Lado ilustrativo').getAttribute('aria-pressed'), 'true');
  assert.equal(value('area'), source.area);
  assert.equal(container.querySelector('[aria-label="Área a medir"]').value, 'source');

  await setValue(illustrationInput('Altura supuesta en metros'), '4,5');
  await setValue(illustrationInput('Cubierta supuesta'), 'flat');
  await click('Actualizar ilustración');
  assert.match(illustrationMetric('height'), /4[,.]5\s*m/);
  assert.match(illustrationMetric('area'), /60\s*m²/);
  assert.equal(value('area'), source.area);
  assert.equal(value('perimeter'), source.perimeter);

  await click('Volver al plano fuente');
  assert.equal(document.activeElement, container.querySelector('.cad-drawing-canvas'));
  assert.equal(value('area'), source.area);
  assert.equal(value('perimeter'), source.perimeter);
  assert.ok(container.querySelector('.cad-scale-current'));
  assert.equal(container.querySelectorAll('.cad-item-list input:checked').length, 1);
});

test('invalid reconstruction drafts stay editable and report an error without changing measured geometry', async () => {
  await render([view('Model', [floorWithInterior()])]);
  await openFloorIllustration();
  const sourceArea = value('area');
  const appliedHeight = illustrationMetric('height');
  const height = illustrationInput('Altura supuesta en metros');
  await setValue(height, '0');
  await click('Actualizar ilustración');
  assert.equal(height.value, '0', 'an invalid assumption is not silently clamped or replaced');
  assert.match(container.querySelector('.cad-illustration [role="alert"]').textContent, /altura/i);
  assert.equal(value('area'), sourceArea);
  assert.equal(illustrationMetric('height'), appliedHeight, 'the last applied model survives an invalid draft');

  await setValue(height, '3,2');
  await click('Actualizar ilustración');
  assert.equal(container.querySelector('.cad-illustration [role="alert"]'), null);
  await setValue(illustrationInput('Cubierta supuesta'), 'gable');
  const pitch = illustrationInput('Pendiente supuesta en grados');
  await setValue(pitch, '75');
  await click('Actualizar ilustración');
  assert.equal(pitch.value, '75');
  assert.match(container.querySelector('.cad-illustration [role="alert"]').textContent, /pendiente/i);
  assert.equal(value('area'), sourceArea);
  await setValue(pitch, '25');
  await click('Actualizar ilustración');
  assert.equal(container.querySelector('.cad-illustration [role="alert"]'), null);
  assert.match(illustrationMetric('area'), /60\s*m²/);
});

test('selection, scale and view changes discard the illustration and reset its draft assumptions', async () => {
  const views = [view('Model', [floorWithInterior()]), view('Other', [floorWithInterior()])];
  await render(views);
  await openFloorIllustration();
  const initialHeight = illustrationInput('Altura supuesta en metros').value;
  const initialRoof = illustrationInput('Cubierta supuesta').value;
  await setValue(illustrationInput('Altura supuesta en metros'), '4,1');
  await setValue(illustrationInput('Cubierta supuesta'), 'gable');
  await click('Actualizar ilustración');

  await click('Limpiar');
  assert.equal(container.querySelector('.cad-illustration'), null);
  await click('Seleccionar capa Floor');
  await openIllustration();
  assert.equal(illustrationInput('Altura supuesta en metros').value, initialHeight);
  assert.equal(illustrationInput('Cubierta supuesta').value, initialRoof);

  await click('Restablecer escala');
  assert.equal(container.querySelector('.cad-illustration'), null);
  assert.equal(button('Ilustración 3D').disabled, true);
  await click('Aplicar unidad');
  await openIllustration();
  assert.equal(illustrationInput('Altura supuesta en metros').value, initialHeight);

  await setValue(container.querySelector('.cad-view-choice select'), '1');
  assert.equal(container.querySelector('.cad-illustration'), null);
  assert.equal(button('Ilustración 3D').disabled, true);
  pending();
  await openFloorIllustration();
  assert.equal(illustrationInput('Altura supuesta en metros').value, initialHeight);
  await render([view('Model', [floorWithInterior()])]);
  assert.equal(container.querySelector('.cad-illustration'), null, 'replacement source imports also discard reconstruction state');
  pending();
});

test('the illustrative top view preserves the source plan orientation and closes its asymmetric outline', async () => {
  const source = [[0, 0], [6000, 0], [6000, 2000], [2000, 2000], [2000, 5000], [0, 5000]];
  await render([view('Model', [{
    id: 'asymmetric-footprint', kind: 'polyline', source_type: 'LWPOLYLINE',
    layer: 'Floor', closed: true, points: source,
  }])]);
  await openFloorIllustration();
  await click('Planta');
  const outlines = [...container.querySelectorAll('.cad-illustration-renderer svg path')]
    .filter(path => path.style.stroke.replace(/\s/g, '') === 'rgb(212,92,30)');
  assert.ok(outlines.length, 'the selected exterior outline is visible in the top projection');

  // Read observable SVG segments. Their order, path grouping, drawing origin
  // and fitted screen size are deliberately irrelevant to this comparison.
  const segments = [];
  for (const path of outlines) {
    const tokens = path.getAttribute('d').match(/[MLZ]|[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?/gi);
    let current = [0, 0]; let start; let command;
    for (let index = 0; index < tokens.length;) {
      if (/^[MLZ]$/i.test(tokens[index])) command = tokens[index++];
      if (command.toUpperCase() === 'Z') {
        segments.push([current, start]); current = start; continue;
      }
      let next = [Number(tokens[index++]), Number(tokens[index++])];
      if (command === command.toLowerCase()) next = next.map((value, axis) => value + current[axis]);
      if (command.toUpperCase() === 'M') {
        start = next;
        command = command === 'M' ? 'L' : 'l';
      } else segments.push([current, next]);
      current = next;
    }
  }
  const points = segments.flat();
  const xs = points.map(point => point[0]); const ys = points.map(point => point[1]);
  const minX = Math.min(...xs); const minY = Math.min(...ys);
  const width = Math.max(...xs) - minX; const height = Math.max(...ys) - minY;
  assert.ok(width > 0 && height > 0);
  const normalized = segments.map(segment => segment.map(([x, y]) => [
    (x - minX) * 6000 / width, (y - minY) * 5000 / height,
  ]));
  const close = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.01;
  const hasEdge = (a, b) => normalized.some(([from, to]) =>
    (close(from, a) && close(to, b)) || (close(from, b) && close(to, a)));
  assert.ok(hasEdge(source.at(-1), source[0]), 'the last source vertex connects back to the first');
  assert.equal(normalized.length, source.length, 'every source boundary edge is rendered once');
  for (let index = 0; index < source.length; index++) {
    assert.ok(hasEdge(source[index], source[(index + 1) % source.length]),
      `source edge ${index + 1} retains X rightward and Y downward in the top view`);
  }
});
