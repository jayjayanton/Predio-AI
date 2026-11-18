import test from 'node:test';
import assert from 'node:assert/strict';
import {PLANNING_LIMITS, createDesignHistory, commitDesign, createDrawnPlanningShape, createPlanningShape,
  createPlanningSnapshot, createPolygonPlanningShape, extractPlanningFootprint, hitPlanningShape, insertPlanningVertex,
  normalizeRotation, parseDimension, planningEditHandles, planningShapeMetrics, redoDesign, removePlanningVertex,
  resizePlanningShape, shapeBounds, shapeDrawingRing, undoDesign, updatePlanningShape, validPlanningShape} from '../src/scaledPlanning.js';
import {toScreen, toWorld, zoomAt} from '../src/drawingGeometry.js';

const rectangle = (x = 0, y = 0, w = 10000, h = 6000) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const element = (points = rectangle(), extra = {}) => ({id: 'ground', kind: 'polyline', closed: true, source_type: 'LWPOLYLINE', layer: 'Footprint', points, ...extra});
const near = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} ≠ ${b}`);
const extent = ring => ring.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
const nearPoint = (actual, expected, tolerance) => actual.forEach((value, i) => near(value, expected[i], tolerance));
const drawingPoint = (shape, point, factor) => {
  const radians = shape.rotationDegrees * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians);
  return [shape.center[0] + (point[0] * c - point[1] * s) / factor,
    shape.center[1] + (point[0] * s + point[1] * c) / factor];
};
const ringArea = ring => ring.reduce((total, p, i) => {
  const next = ring[(i + 1) % ring.length];
  return total + p[0] * next[1] - next[0] * p[1];
}, 0) / 2;

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

test('dragged figures follow source coordinates at any CAD scale or viewport zoom', () => {
  for (const factor of [1, 0.01, 0.001, 0.3048]) {
    const start = [1200, -800], end = [1200 - 4 / factor, -800 + 2.5 / factor];
    for (const transform of [{scale: 0.07, x: 200, y: 170}, {scale: 3.5, x: -600, y: 850}]) {
      const drawn = createDrawnPlanningShape('rectangle', 'drag', toWorld(toScreen(start, transform), transform),
        toWorld(toScreen(end, transform), transform), factor, {role: 'extension', label: 'Estudio'});
      assert.ok(drawn); near(drawn.widthMetres, 4); near(drawn.depthMetres, 2.5);
      nearPoint(shapeBounds(drawn, factor), [end[0], start[1], start[0], end[1]]);
      near(planningShapeMetrics(drawn).areaM2, 10); near(planningShapeMetrics(drawn).perimeterM, 13);
      assert.equal(drawn.role, 'extension'); assert.equal(drawn.label, 'Estudio');
    }
  }
  const square = createDrawnPlanningShape('square', 'square', [10, 10], [8, 13], 1);
  assert.equal(square.kind, 'rectangle'); assert.equal(square.widthMetres, 3); assert.equal(square.depthMetres, 3);
  assert.deepEqual(shapeBounds(square, 1), [7, 10, 10, 13]);
  const circle = createDrawnPlanningShape('circle', 'circle', [0, 0], [2, 3], 1);
  assert.equal(circle.widthMetres, 3); assert.equal(circle.depthMetres, 3);
  near(planningShapeMetrics(circle).areaM2, Math.PI * 2.25);
  near(planningShapeMetrics(circle).perimeterM, Math.PI * 3);
  for (const [kind, end, scale] of [['rectangle', [0, 3], 1], ['rectangle', [0.001, 1], 1],
    ['rectangle', [201, 1], 1], ['circle', [1, 1], 0], ['square', [NaN, 3], 1], ['triangle', [3, 4], 1]]) {
    assert.equal(createDrawnPlanningShape(kind, 'invalid', [0, 0], end, scale), null);
  }
});

test('custom concave polygons have true area and hit targets that exclude the empty notch', () => {
  const points = [[0, 0], [6, 0], [6, 2], [2, 2], [2, 5], [0, 5]];
  const original = structuredClone(points);
  for (const factor of [1, 0.001, 0.3048]) {
    const world = points.map(([x, y]) => [10000 + x / factor, -5000 + y / factor]);
    const shape = createPolygonPlanningShape('concave', world, factor, {role: 'extension'});
    assert.ok(shape); assert.equal(shape.kind, 'polygon'); assert.equal(shape.verticesMetres.length, 6);
    near(shape.widthMetres, 6); near(shape.depthMetres, 5);
    const metrics = planningShapeMetrics(shape);
    near(metrics.areaM2, 18); near(metrics.perimeterM, 22);
    shapeDrawingRing(shape, factor).slice(0, -1).forEach((point, i) => nearPoint(point, world[i]));
    assert.equal(hitPlanningShape([shape], [10000 + 1 / factor, -5000 + 4 / factor], factor)?.id, 'concave');
    assert.equal(hitPlanningShape([shape], [10000 + 4 / factor, -5000 + 4 / factor], factor), null);
    assert.equal(hitPlanningShape([shape], [10000 + 2.02 / factor, -5000 + 3 / factor], factor, 0.03 / factor)?.id, 'concave');
    const rotated = updatePlanningShape(shape, {rotationDegrees: 37});
    assert.equal(hitPlanningShape([rotated], drawingPoint(rotated, [-2, 1.5], factor), factor)?.id, 'concave');
    assert.equal(hitPlanningShape([rotated], drawingPoint(rotated, [1, 1.5], factor), factor), null);
  }
  assert.deepEqual(points, original);
  const triangle = createPolygonPlanningShape('triangle', [[0, 0], [4, 0], [0, 3]], 1);
  assert.equal(triangle.label, 'Triángulo');
  assert.deepEqual(planningShapeMetrics(triangle), {areaM2: 6, perimeterM: 12});
});

test('polygon validation rejects crossings, repeated corners, overlaps, degeneracy and excessive size', () => {
  const invalid = [
    [[0, 0], [4, 4], [0, 4], [4, 0]],
    [[0, 0], [4, 0], [4, 0], [4, 4], [0, 4]],
    [[0, 0], [4, 0], [4, 4], [0, 4], [4, 0]],
    [[0, 0], [4, 0], [2, 0], [4, 4], [0, 4]],
    [[0, 0], [4, 0], [2, 2], [4, 4], [0, 4], [2, 2]],
    [[0, 0], [1, 1], [2, 2]],
    [[0, 0], [0.001, 0], [0, 1]],
    [[0, 0], [201, 0], [0, 1]],
    [[0, 0], [4, 0], [0, Infinity]],
    [[0, 0], [4, 0]],
  ];
  for (const points of invalid) assert.equal(createPolygonPlanningShape('invalid', points, 1), null, JSON.stringify(points));
  const closed = [[0, 0], [3, 0], [0, 4], [0, 0]];
  const shape = createPolygonPlanningShape('closed', closed, 1);
  assert.equal(shape.verticesMetres.length, 3); assert.equal(closed.length, 4);
  assert.equal(validPlanningShape({...shape, widthMetres: 7}), false, 'dimensions cannot disagree with polygon geometry');
  const many = count => Array.from({length: count}, (_, i) => [20 * Math.cos(2 * Math.PI * i / count), 20 * Math.sin(2 * Math.PI * i / count)]);
  const limit = createPolygonPlanningShape('limit', many(PLANNING_LIMITS.maxVertices), 1);
  assert.ok(limit); assert.equal(insertPlanningVertex(limit, 0), null);
  assert.equal(planningEditHandles(limit, 1).some(handle => handle.kind === 'insert'), false);
  assert.equal(createPolygonPlanningShape('excess', many(PLANNING_LIMITS.maxVertices + 1), 1), null);
});

test('rotated rectangle resizing holds the opposite corner and supports proportional resizing', () => {
  for (const factor of [1, 0.001]) {
    const shape = {...createDrawnPlanningShape('rectangle', 'r', [0, 0], [4 / factor, 2 / factor], factor),
      center: [700, -300], rotationDegrees: 37};
    const original = structuredClone(shape);
    const handles = planningEditHandles(shape, factor);
    for (let index = 0; index < 4; index++) {
      const xSign = index === 1 || index === 2 ? 1 : -1;
      const ySign = index >= 2 ? 1 : -1;
      const target = drawingPoint(shape, [4 * xSign, 2 * ySign], factor);
      const resized = resizePlanningShape(shape, handles[index], target, factor);
      assert.ok(resized); near(resized.widthMetres, 6); near(resized.depthMetres, 3);
      nearPoint(planningEditHandles(resized, factor)[index].point, target);
      nearPoint(planningEditHandles(resized, factor)[(index + 2) % 4].point, handles[(index + 2) % 4].point);
      assert.equal(resized.rotationDegrees, 37);
    }
    const proportional = resizePlanningShape(shape, handles[2], drawingPoint(shape, [6, 1.25], factor), factor, {preserveAspect: true});
    near(proportional.widthMetres / proportional.depthMetres, 2);
    nearPoint(planningEditHandles(proportional, factor)[0].point, handles[0].point);
    assert.equal(resizePlanningShape(shape, handles[2], handles[0].point, factor), null);
    assert.deepEqual(shape, original);
  }
});

test('circle handles resize the diameter around a stationary centre', () => {
  const shape = {...createPlanningShape('circle', 'c', [2000, 3000]), rotationDegrees: 61};
  const handle = planningEditHandles(shape, 0.001)[0];
  const resized = resizePlanningShape(shape, handle, [5000, 7000], 0.001);
  near(resized.widthMetres, 10); assert.equal(resized.depthMetres, resized.widthMetres);
  assert.deepEqual(resized.center, shape.center);
  const numeric = updatePlanningShape(shape, {depthMetres: 4});
  assert.equal(numeric.widthMetres, 4); assert.equal(numeric.depthMetres, 4);
  assert.equal(updatePlanningShape(shape, {widthMetres: 4, depthMetres: 3}), null);
});

test('dragging a rotated polygon corner preserves all other vertices and rejects a crossing edit', () => {
  const factor = 0.001;
  const shape = updatePlanningShape(createPolygonPlanningShape('p', rectangle(0, 0, 4000, 3000), factor), {rotationDegrees: 28});
  const original = structuredClone(shape), before = shapeDrawingRing(shape, factor);
  const handle = planningEditHandles(shape, factor).find(item => item.kind === 'vertex' && item.index === 0);
  const target = drawingPoint(shape, [-3, -2], factor);
  const resized = resizePlanningShape(shape, handle, target, factor);
  assert.ok(resized); assert.equal(resized.rotationDegrees, shape.rotationDegrees);
  assert.deepEqual(resized.center, shape.center);
  const after = shapeDrawingRing(resized, factor);
  nearPoint(after[0], target);
  for (let i = 1; i < before.length - 1; i++) nearPoint(after[i], before[i]);
  near(resized.widthMetres, 5); near(resized.depthMetres, 3.5);
  const crossingTarget = drawingPoint(shape, [3, 0], factor);
  assert.equal(resizePlanningShape(shape, handle, crossingTarget, factor), null);
  assert.deepEqual(shape, original);
});

test('polygon corner insertion and removal preserve geometry and can be undone as complete edits', () => {
  const shape = updatePlanningShape(createPolygonPlanningShape('p', [[0, 0], [4, 0], [4, 3], [0, 3]], 1), {rotationDegrees: 35});
  const original = structuredClone(shape);
  const insertion = planningEditHandles(shape, 1).find(handle => handle.kind === 'insert' && handle.index === 0);
  const withCorner = insertPlanningVertex(shape, 0);
  assert.equal(withCorner.verticesMetres.length, 5);
  nearPoint(shapeDrawingRing(withCorner, 1)[1], insertion.point);
  near(planningShapeMetrics(withCorner).areaM2, 12); near(planningShapeMetrics(withCorner).perimeterM, 14);
  const dragged = resizePlanningShape(shape, insertion, drawingPoint(shape, [0, -2.5], 1), 1);
  assert.ok(dragged); assert.equal(dragged.verticesMetres.length, 5);
  near(planningShapeMetrics(dragged).areaM2, 14);
  const removed = removePlanningVertex(withCorner, 1);
  assert.deepEqual(removed, original);
  const triangle = removePlanningVertex(shape, 0);
  assert.equal(triangle.verticesMetres.length, 3); assert.equal(removePlanningVertex(triangle, 0), null);
  const triangleRing = shapeDrawingRing(triangle, 1), originalRing = shapeDrawingRing(shape, 1);
  triangleRing.slice(0, -1).forEach((point, i) => nearPoint(point, originalRing[i + 1]));
  let history = commitDesign(createDesignHistory({shapes: [shape], footprint: null}), {shapes: [dragged], footprint: null});
  history = undoDesign(history); assert.deepEqual(history.present.shapes[0], original);
  history = redoDesign(history); assert.deepEqual(history.present.shapes[0], dragged);
  assert.deepEqual(shape, original);
});

test('numeric dimensions and bounding handles reshape actual polygon vertices', () => {
  const factor = 0.001;
  const base = createPolygonPlanningShape('p', [[0, 0], [6, 0], [6, 2], [2, 2], [2, 5], [0, 5]], 1);
  const shape = updatePlanningShape(base, {center: [2000, 4000], rotationDegrees: 53});
  const doubled = updatePlanningShape(shape, {widthMetres: 12, depthMetres: 10});
  near(planningShapeMetrics(doubled).areaM2, 72); near(planningShapeMetrics(doubled).perimeterM, 44);
  doubled.verticesMetres.forEach((point, i) => nearPoint(point, shape.verticesMetres[i].map(value => value * 2)));
  const handles = planningEditHandles(shape, factor, 'resize');
  const target = drawingPoint(shape, [9, 7.5], factor);
  const resized = resizePlanningShape(shape, handles[2], target, factor);
  near(resized.widthMetres, 12); near(resized.depthMetres, 10);
  near(planningShapeMetrics(resized).areaM2, 72);
  nearPoint(planningEditHandles(resized, factor, 'resize')[0].point, handles[0].point);
  nearPoint(planningEditHandles(resized, factor, 'resize')[2].point, target);
  assert.deepEqual(resized.center, shape.center);
  for (const patch of [{widthMetres: null}, {depthMetres: NaN}, {widthMetres: 201}, {center: [Infinity, 0]},
    {rotationDegrees: NaN}, {role: 'unknown'}, {verticesMetres: [[0, 0], [1, 0], [0, 0]]}]) {
    assert.equal(updatePlanningShape(shape, patch), null);
  }
});

test('polygon label and role edits preserve arbitrary offset vertices exactly', () => {
  const verticesMetres = [[1.23456789012345, -2.34567890123456], [4.56789012345678, -2.23456789012345],
    [5.45678901234567, 1.87654321098765], [2.87654321098765, 2.76543210987654]];
  const bounds = extent(verticesMetres);
  const shape = {kind: 'polygon', id: 'precise', label: 'Polígono', role: 'furniture', center: [12345, -67890],
    rotationDegrees: 27, verticesMetres, widthMetres: bounds[2] - bounds[0], depthMetres: bounds[3] - bounds[1]};
  const original = structuredClone(shape);
  for (const patch of [{label: 'Sala', role: 'extension'},
    {label: 'Ampliación', widthMetres: shape.widthMetres, depthMetres: shape.depthMetres}]) {
    const updated = updatePlanningShape(shape, patch);
    assert.ok(updated);
    assert.deepEqual(updated.verticesMetres, original.verticesMetres);
    assert.deepEqual(shapeDrawingRing(updated, 0.001), shapeDrawingRing(shape, 0.001));
    assert.equal(updated.widthMetres, original.widthMetres); assert.equal(updated.depthMetres, original.depthMetres);
    assert.equal(updated.label, patch.label);
  }
  assert.equal(updatePlanningShape(shape, {role: 'invalid'}), null, 'metadata-only edits still validate');
  assert.deepEqual(shape, original);
});

test('custom polygon exports share footprint origin and keep valid exterior winding in either drawing direction', () => {
  const scale = {metresPerUnit: 0.001, method: 'unit', unit: 'mm'};
  const offset = [1e9, -1e9];
  const footprint = extractPlanningFootprint(element(rectangle(...offset)), scale.metresPerUnit);
  const points = [[10500, 1000], [14500, 1000], [14500, 3000], [12500, 3000], [12500, 5000], [10500, 5000]]
    .map(([x, y]) => [offset[0] + x, offset[1] + y]);
  for (const sourcePoints of [points, [...points].reverse()]) {
    const shape = createPolygonPlanningShape('extension', sourcePoints, scale.metresPerUnit, {role: 'extension'});
    const snapshot = createPlanningSnapshot({footprint, shapes: [shape], scale, source: {documentName: 'ground.dwg'}});
    const proposal = snapshot.shapes[0], ring = proposal.geometry.coordinates[0];
    assert.equal(proposal.role, 'extension'); assert.equal(proposal.kind, 'polygon');
    assert.equal(proposal.dimensions.vertexCount, 6);
    assert.deepEqual(extent(ring), [5.5, -2, 9.5, 2]);
    assert.deepEqual(ring[0], ring.at(-1)); near(ringArea(ring), 12);
    assert.equal(snapshot.source.entityId, 'ground');
    assert.deepEqual(snapshot.origin, footprint.origin);
  }
});
