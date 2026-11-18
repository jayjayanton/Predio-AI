import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesignHistory, commitDesign, createPlanningShape, createPlanningSnapshot, extractPlanningFootprint,
  hitPlanningShape, normalizeRotation, parseDimension, redoDesign, shapeBounds, shapeDrawingRing, undoDesign} from '../src/scaledPlanning.js';
import {toScreen, toWorld, zoomAt} from '../src/drawingGeometry.js';

const rectangle = (x = 0, y = 0, w = 10000, h = 6000) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const element = (points = rectangle(), extra = {}) => ({id: 'ground', kind: 'polyline', closed: true, source_type: 'LWPOLYLINE', layer: 'Footprint', points, ...extra});
const near = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} ≠ ${b}`);
const extent = ring => ring.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);

test('table and circle dimensions are metric regardless of CAD units or viewport zoom', () => {
  const shape = createPlanningShape('table', 'table-1', [11000, -3500]);
  const original = structuredClone(shape);
  for (const factor of [1, 0.01, 0.001, 0.3048]) {
    const box = shapeBounds(shape, factor);
    near((box[2] - box[0]) * factor, 1.6); near((box[3] - box[1]) * factor, 0.9);
    const before = {scale: 0.02, x: 300, y: 220};
    const after = zoomAt(before, 5, [530, 190], 0.0001, 100);
    const ring = shapeDrawingRing(shape, factor);
    const pixelsBefore = Math.hypot(...toScreen(ring[1], before).map((v, i) => v - toScreen(ring[0], before)[i]));
    const pixelsAfter = Math.hypot(...toScreen(ring[1], after).map((v, i) => v - toScreen(ring[0], after)[i]));
    near(pixelsAfter / pixelsBefore, 5);
    toWorld(toScreen(shape.center, after), after).forEach((v, i) => near(v, shape.center[i]));
  }
  assert.deepEqual(shape, original);
  const circle = createPlanningShape('circle', 'round-1', [0, 0]);
  const ring = shapeDrawingRing(circle, 0.001);
  assert.equal(ring.length, 97); assert.deepEqual(ring[0], ring.at(-1));
  ring.slice(0, -1).forEach(p => near(Math.hypot(...p) * 0.001, 0.5));
});

test('rotated hit testing selects the frontmost proposal without testing its axis-aligned box', () => {
  const shape = {...createPlanningShape('table', 'a', [0, 0]), rotationDegrees: 45};
  assert.equal(hitPlanningShape([shape], [0, 0], 1)?.id, 'a');
  assert.equal(hitPlanningShape([shape], [0.75, -0.75], 1), null);
  const second = {...shape, id: 'b'};
  assert.equal(hitPlanningShape([shape, second], [0.3, 0.3], 1)?.id, 'b');
  const round = createPlanningShape('circle', 'round', [0, 0]);
  assert.equal(hitPlanningShape([round], [0.49, 0.49], 1), null);
  assert.equal(hitPlanningShape([round], [0.51, 0], 1, 0.02)?.id, 'round');
});

test('footprint keeps holes, removes source offsets, and converts downward drawing Y to local north', () => {
  const source = element([], {kind: 'hatch_boundary', source_type: 'HATCH', points: [],
    rings: [rectangle(1e9, -1e9), rectangle(1e9 + 1000, -1e9 + 1000, 2000, 2000).reverse()]});
  const original = structuredClone(source);
  const result = extractPlanningFootprint(source, 0.001);
  assert.equal(result.ok, true); assert.equal(result.holes, 1); near(result.areaM2, 56);
  assert.deepEqual(result.origin, [1e9 + 5000, -1e9 + 3000]);
  assert.deepEqual(extent(result.geometry.coordinates[0]), [-5, -3, 5, 3]);
  assert.deepEqual(extent(result.geometry.coordinates[1]), [-4, 0, -2, 2]);
  assert.deepEqual(source, original);
  for (const ring of result.geometry.coordinates) assert.deepEqual(ring[0], ring.at(-1));
});

test('disjoint, crossing and nested-island contours never become a single footprint', () => {
  assert.equal(extractPlanningFootprint(element(), null).reason, 'scale_required');
  assert.equal(extractPlanningFootprint(element(rectangle(), {closed: false}), 0.001).reason, 'open_path');
  const compound = rings => element([], {kind: 'hatch_boundary', rings});
  assert.equal(extractPlanningFootprint(compound([rectangle(), rectangle(20000, 0)]), 0.001).ok, false);
  assert.equal(extractPlanningFootprint(compound([rectangle(), rectangle(1000, 1000, 3000, 3000), rectangle(2000, 2000, 3000, 3000)]), 0.001).ok, false);
  assert.equal(extractPlanningFootprint(compound([rectangle(), rectangle(1000, 1000, 4000, 4000), rectangle(2000, 2000, 1000, 1000)]), 0.001).reason, 'nested_islands');
  assert.equal(extractPlanningFootprint(element([[0, 0], [100, 100], [0, 100], [100, 0]]), 1).ok, false);
  assert.equal(extractPlanningFootprint(element(rectangle(), {kind: 'text'}), 0.001).ok, false);
  assert.equal(extractPlanningFootprint(element(), 1).reason, 'size_range');
});

test('snapshot shares one metric origin for existing footprint and future extensions and identifies furniture', () => {
  const scale = {metresPerUnit: 0.001, method: 'unit', unit: 'mm'};
  const footprint = extractPlanningFootprint(element(), scale.metresPerUnit);
  const table = createPlanningShape('table', 'table', [5000, 3000]);
  const extension = createPlanningShape('extension', 'extension', [11500, 3000]);
  const result = createPlanningSnapshot({footprint, scale, shapes: [table, extension], source: {documentName: 'ground.dwg'}});
  assert.equal(result.coordinateSpace, 'local_metres'); assert.equal(result.axisMapping, 'x_right_y_up');
  assert.equal(result.footprintDeclaration, 'user_selected_ground_footprint');
  assert.equal(result.source.entityId, 'ground');
  assert.equal(result.shapes[0].role, 'furniture'); assert.equal(result.shapes[1].role, 'extension');
  assert.deepEqual(extent(result.shapes[1].geometry.coordinates[0]), [5, -2, 8, 2]);
  const movedScale = createPlanningSnapshot({footprint, scale: {...scale, metresPerUnit: 0.01}, shapes: [table], source: {}});
  assert.equal(movedScale.footprint, null, 'a revised scale cannot reuse previously accepted footprint coordinates');
  const dimensions = extent(movedScale.shapes[0].geometry.coordinates[0]);
  near(dimensions[2] - dimensions[0], 1.6); near(dimensions[3] - dimensions[1], 0.9);
  assert.equal(createPlanningSnapshot({footprint, scale: null, shapes: [table], source: {}}), null);
});

test('design history undoes whole edits and a new edit branches away from stale redo', () => {
  const first = createPlanningShape('table', 'a', [0, 0]);
  let history = createDesignHistory();
  history = commitDesign(history, {shapes: [first], footprint: null});
  history = commitDesign(history, {shapes: [{...first, center: [1000, 0]}], footprint: null});
  history = undoDesign(history); assert.deepEqual(history.present.shapes[0].center, [0, 0]);
  history = redoDesign(history); assert.deepEqual(history.present.shapes[0].center, [1000, 0]);
  history = undoDesign(history);
  history = commitDesign(history, {shapes: [{...first, widthMetres: 2}], footprint: null});
  assert.equal(history.future.length, 0);
  assert.equal(undoDesign(history).present.shapes[0].widthMetres, 1.6);
});

test('dimensions reject nonfinite, unit-suffixed and malformed values but accept decimal commas', () => {
  assert.equal(parseDimension('1,60'), 1.6); assert.equal(parseDimension('0.01'), 0.01);
  for (const value of ['', null, '0', '-1', '1e3', '1m', '1,000.0', 'Infinity', 'NaN', '201', '0.001']) assert.equal(parseDimension(value), null);
  assert.equal(normalizeRotation(-90), 270); assert.equal(normalizeRotation(450), 90);
  assert.equal(shapeDrawingRing({...createPlanningShape('circle', 'c', [0, 0]), depthMetres: 2}, 1), null);
});
