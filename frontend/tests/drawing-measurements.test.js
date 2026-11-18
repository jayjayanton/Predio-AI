import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calibrateScale, cadUnitFromCode, deriveScaleFromUnit, MAX_AREA_SEGMENTS,
  measureSelection, resetScaleForView, UNIT_OPTIONS,
} from '../src/drawingMeasurements.js';
import {prepareDrawing} from '../src/drawingGeometry.js';
import {createExampleDrawing} from '../src/exampleDrawing.js';

const line = (id, a, b, extra = {}) => ({id, kind: 'line', points: [a, b], ...extra});
const polygon = (id, points, extra = {}) => ({id, kind: 'polyline', points, closed: true, ...extra});
const box = (id, x, y, width, height) => polygon(id, [[x, y], [x + width, y], [x + width, y + height], [x, y + height]]);
const ring = (x, y, width, height) => box('', x, y, width, height).points;
const compound = rings => ({id: 'hatch', kind: 'hatch_boundary', points: [], rings, closed: true, filled: true, fill_rule: 'evenodd'});
const close = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance,
  'expected ' + actual + ' to be within ' + tolerance + ' of ' + expected);

test('known CAD unit metadata is only a suggestion until a scale is supplied', () => {
  assert.equal(deriveScaleFromUnit(4), 0.001);
  assert.equal(deriveScaleFromUnit('mm'), 0.001);
  assert.equal(deriveScaleFromUnit(2), 0.3048);
  assert.equal(deriveScaleFromUnit('yd'), 0.9144);
  assert.equal(deriveScaleFromUnit('in'), 0.0254);
  assert.equal(cadUnitFromCode(21).metresPerUnit, 1200 / 3937);
  assert.notEqual(cadUnitFromCode(21).metresPerUnit, deriveScaleFromUnit('ft'));
  for (const invalid of [0, 18, 20, 99, NaN, 4.5, '4', null]) assert.equal(cadUnitFromCode(invalid), null);
  assert.deepEqual(UNIT_OPTIONS.map(option => option.value), ['m', 'cm', 'mm', 'in', 'ft', 'yd', 'us-ft']);
  assert.equal(UNIT_OPTIONS.find(option => option.value === 'us-ft').metresPerUnit, 1200 / 3937);
  const source = line('source', [0, 0], [4000, 0], {units_code: 4, units_verified: false});
  const raw = measureSelection([source]);
  assert.equal(raw.raw.length, 4000);
  assert.equal(raw.metric, null);
  assert.equal(raw.metricReason, 'scale_unconfirmed');
  assert.equal(measureSelection([source], {metresPerUnit: deriveScaleFromUnit(4)}).metric.length, 4);
});

test('millimetres and feet convert lengths once and areas with squared scale', () => {
  const mm = measureSelection([box('room', 0, 0, 4000, 3000)], {metresPerUnit: 0.001});
  assert.deepEqual(mm.raw, {length: 14000, perimeter: 14000, area: 12000000});
  assert.deepEqual(mm.metric, {length: 14, perimeter: 14, area: 12});
  const feet = measureSelection([box('room', 0, 0, 10, 10)], {metresPerUnit: deriveScaleFromUnit('ft')});
  close(feet.metric.perimeter, 12.192);
  close(feet.metric.area, 9.290304);
});

test('shuffled reversed source paths form one degree-two loop', () => {
  const selection = [
    line('right', [4, 3], [4, 0]),
    line('left', [0, 0], [0, 3]),
    line('top', [4, 0], [0, 0]),
    line('bottom', [0, 3], [4, 3]),
  ];
  const result = measureSelection(selection);
  assert.deepEqual(result.raw, {length: 14, perimeter: 14, area: 12});
  assert.equal(result.areaMode, 'connected_loop');
  assert.equal(result.calibration.eligible, false);
  assert.equal(result.calibration.reason, 'multiple_paths');
});

test('winding reversal, display reflection and translation preserve absolute area', () => {
  const points = [[0, 0], [5, 0], [5, 2], [3, 2], [3, 4], [0, 4]];
  const native = measureSelection([polygon('native', points)]).raw;
  const transformed = points.toReversed().map(([x, y]) => [x + 1e9, 1e9 - y]);
  const displayed = measureSelection([polygon('display', transformed)]).raw;
  close(native.area, 16);
  assert.deepEqual(displayed, native);
});

test('compound source rings subtract holes by nesting parity regardless of winding', () => {
  const outer = ring(0, 0, 10, 10);
  const hole = ring(2, 2, 6, 6).toReversed();
  const island = ring(4, 4, 2, 2);
  const result = measureSelection([compound([hole, island, outer])]);
  close(result.raw.area, 68);
  close(result.raw.perimeter, 72);
  assert.equal(result.areaMode, 'compound_rings');
  assert.equal(result.calibration.eligible, false);
  const reflected = [hole, island, outer].map(path => path.toReversed().map(([x, y]) => [x, 100 - y]));
  assert.deepEqual(measureSelection([compound(reflected)]).raw, result.raw);
});

test('independent rings and unrelated closed entities never become a summed room area', () => {
  const separate = measureSelection([box('room', 0, 0, 4, 3), box('furniture', 1, 1, 1, 1)]);
  assert.equal(separate.raw.length, 18);
  assert.equal(separate.raw.area, null);
  assert.equal(separate.areaReason, 'multiple_contours');
  const disjointCompound = measureSelection([compound([ring(0, 0, 2, 2), ring(5, 5, 2, 2)])]);
  assert.equal(disjointCompound.areaReason, 'disconnected');
  assert.equal(disjointCompound.raw.area, null);
});

test('overlapping, crossing or touching compound rings are rejected', () => {
  for (const inner of [ring(8, 8, 4, 4), ring(0, 2, 3, 3), ring(-1, 2, 2, 3)]) {
    const result = measureSelection([compound([ring(0, 0, 10, 10), inner])]);
    assert.equal(result.raw.area, null);
    assert.equal(result.areaReason, 'overlapping_rings');
  }
  assert.equal(measureSelection([compound([ring(0, 0, 10, 10), ring(0, 0, 10, 10)])]).areaReason, 'duplicate_edges');
});

test('open, branching and self-crossing geometry never uses bounding-box area', () => {
  const open = measureSelection([{id: 'open', kind: 'polyline', points: [[0, 0], [4, 0], [4, 3]]}]);
  assert.equal(open.raw.length, 7);
  assert.equal(open.raw.area, null);
  assert.equal(open.areaReason, 'open_path');
  const branch = measureSelection([box('square', 0, 0, 4, 3), line('branch', [0, 0], [-1, 0])]);
  assert.equal(branch.areaReason, 'branching');
  const crossing = measureSelection([polygon('bowtie', [[0, 0], [3, 3], [0, 3], [3, 0]])]);
  assert.equal(crossing.raw.area, null);
  assert.equal(crossing.areaReason, 'self_intersection');
  const backtrack = measureSelection([polygon('overlap', [[0, 0], [3, 0], [1, 0], [1, 2]])]);
  assert.equal(backtrack.areaReason, 'self_intersection');
});

test('duplicate edges retain their length but block area rather than silently deduplicating', () => {
  const result = measureSelection([box('square', 0, 0, 4, 3), line('copy', [4, 0], [0, 0])]);
  assert.equal(result.raw.length, 18);
  assert.equal(result.raw.area, null);
  assert.equal(result.areaReason, 'duplicate_edges');
});

test('source closure creates its actual closing edge, while material gaps stay open', () => {
  const sourceClosed = polygon('closed', [[0, 0], [4, 0], [4, 3], [0, 3]]);
  assert.equal(measureSelection([sourceClosed]).raw.length, 14);
  const gap = {id: 'gap', kind: 'polyline', points: [[0, 0], [4, 0], [4, 3], [0, 3], [0, 1e-7]]};
  assert.equal(measureSelection([gap]).areaReason, 'open_path');
  const large = {id: 'large-gap', kind: 'polyline', points: [[0, 0], [1e15, 0], [1e15, 1e15], [0, 1e15], [0, 1]]};
  assert.equal(measureSelection([large]).areaReason, 'open_path');
});

test('only floating-point roundoff is matched at nominally identical endpoints', () => {
  const result = measureSelection([
    line('a', [0, 0], [0.1 + 0.2, 0]),
    line('b', [0.3, 0], [0.3, 1]),
    line('c', [0.3, 1], [0, 1]),
    line('d', [0, 1], [0, 0]),
  ]);
  close(result.raw.area, 0.3);
  assert.equal(result.approximate.area, true);
  assert.ok(result.warnings.includes('roundoff_endpoint_matching'));
});

test('text, dimension decorations and hatch pattern strokes are excluded with counts', () => {
  const selected = [
    line('source', [0, 0], [4, 0]),
    {id: 'label', kind: 'text', text: '4000 mm', position: [0, 0]},
    line('dimension', [0, 0], [999, 0], {dimension_handle: 'D1'}),
    line('pattern', [0, 0], [777, 0], {hatch_pattern: true}),
  ];
  const result = measureSelection(selected, {metresPerUnit: 1});
  assert.equal(result.raw.length, 4);
  assert.equal(result.excludedCount, 3);
  assert.deepEqual(result.excluded, {text: 1, dimension: 1, hatchPattern: 1, invalid: 0, unsupported: 0, degenerate: 0});
  assert.equal(result.calibration.referenceElementId, 'source');
  const onlyAnnotations = measureSelection(selected.slice(1), {metresPerUnit: 1});
  assert.equal(onlyAnnotations.metric, null);
  assert.equal(onlyAnnotations.metricReason, 'no_geometry');
  assert.equal(onlyAnnotations.calibration.eligible, false);
  assert.equal(measureSelection([], {metresPerUnit: 1}).metric, null);
});

test('hatch boundaries remain eligible independently of excluded pattern strokes', () => {
  const result = measureSelection([
    compound([[[23250, 2750], [23250, 3750], [23000, 3750], [23000, 2750], [23250, 2750]]]),
    line('pattern', [23000, 3000], [23250, 3000], {hatch_pattern: true}),
  ], {metresPerUnit: 0.001});
  assert.deepEqual(result.raw, {length: 2500, perimeter: 2500, area: 250000});
  assert.deepEqual(result.metric, {length: 2.5, perimeter: 2.5, area: 0.25});
});

test('sampled curves retain sampled length and mark derived quantities approximate', () => {
  const points = Array.from({length: 129}, (_, i) => [Math.cos(i * 2 * Math.PI / 128), Math.sin(i * 2 * Math.PI / 128)]);
  points[128] = points[0];
  const result = measureSelection([polygon('circle', points, {kind: 'curve', source_type: 'CIRCLE', approximation: {method: 'sampled'}})]);
  assert.ok(result.raw.length < 2 * Math.PI && result.raw.length > 6.28);
  assert.ok(result.raw.area < Math.PI && result.raw.area > 3.14);
  assert.deepEqual(result.approximate, {length: true, perimeter: true, area: true});
  assert.equal(calibrateScale([polygon('circle', points, {kind: 'curve'})], 10).approximate, true);
});

test('invalid geometry blocks area without connecting across missing vertices', () => {
  const result = measureSelection([box('valid', 0, 0, 4, 3),
    {id: 'broken', kind: 'polyline', points: [[0, 0], [NaN, 4], [1, 1]]}]);
  assert.equal(result.raw.length, 14);
  assert.equal(result.excluded.invalid, 1);
  assert.equal(result.raw.area, null);
  assert.equal(result.areaReason, 'invalid_geometry');
  for (const point of [[Infinity, 0], [0, NaN], ['1', 2]]) {
    const invalid = measureSelection([line('bad', [0, 0], point)], {metresPerUnit: 1});
    assert.equal(invalid.metric, null);
    assert.equal(invalid.calibration.eligible, false);
  }
  assert.equal(measureSelection([line('zero', [1, 1], [1, 1])]).excluded.degenerate, 1);
});

test('translated small loops and very small drawing units keep finite geometric areas', () => {
  const x = 1e9; const width = (x + 0.1) - x; const height = (x + 0.2) - x;
  close(measureSelection([box('tiny-at-large-origin', x, x, width, height)]).raw.area, width * height, 1e-15);
  const tiny = measureSelection([box('tiny', 0, 0, 1e-100, 2e-100)]);
  assert.ok(Number.isFinite(tiny.raw.area) && tiny.raw.area > 0);
  close(tiny.raw.area / 2e-200, 1);
  const huge = measureSelection([box('huge', 0, 0, 1e150, 2e150)]);
  assert.ok(Number.isFinite(huge.raw.area) && huge.raw.area > 0);
  close(huge.raw.area / 2e300, 1);
});

test('area complexity is bounded even if a caller requests an unlimited check', () => {
  const count = MAX_AREA_SEGMENTS + 1;
  const points = Array.from({length: count}, (_, i) => [Math.cos(i * 2 * Math.PI / count), Math.sin(i * 2 * Math.PI / count)]);
  const result = measureSelection([polygon('complex', points)], {maxAreaSegments: 1e9});
  assert.ok(result.raw.length > 6);
  assert.equal(result.raw.area, null);
  assert.equal(result.areaReason, 'complexity_limit');
});

test('many rings reach the area guard without exceeding JavaScript argument limits', () => {
  const rings = Array.from({length: 130000}, () => [[0, 0], [1, 0]]);
  const result = measureSelection([compound(rings)]);
  assert.equal(result.raw.length, 130000);
  assert.equal(result.raw.area, null);
  assert.equal(result.areaReason, 'complexity_limit');
});

test('a representable loop whose squared area overflows or underflows reports numerical range', () => {
  for (const size of [1e200, 1e-200]) {
    const result = measureSelection([box('numeric-range', 0, 0, size, size)]);
    assert.ok(Number.isFinite(result.raw.length) && result.raw.length > 0);
    assert.equal(result.raw.area, null);
    assert.equal(result.areaReason, 'numerical_range');
  }
});

test('metric overflow or positive underflow never reports Infinity, NaN or a false zero', () => {
  for (const scale of [1e308, Number.MIN_VALUE]) {
    const result = measureSelection([box('small', 0, 0, 2, 2)], {metresPerUnit: scale});
    assert.equal(result.metric, null);
    assert.equal(result.metricReason, 'numerical_range');
    assert.ok(result.warnings.includes('metric_numerical_range'));
  }
  const tinyLength = measureSelection([line('tiny', [0, 0], [1e-200, 0])], {metresPerUnit: 1e-200});
  assert.equal(tinyLength.metric, null);
  for (const scale of [0, -1, Infinity, NaN, '1']) {
    const result = measureSelection([line('line', [0, 0], [4, 0])], {metresPerUnit: scale});
    assert.equal(result.metric, null);
  }
});

test('calibration uses one actual path and rejects invalid input and unsafe ratios', () => {
  const reference = line('reference', [10, 20], [4010, 20]);
  const calibration = calibrateScale([reference], 4);
  assert.equal(calibration.ok, true);
  assert.equal(calibration.metresPerUnit, 0.001);
  assert.equal(calibration.referenceElementId, 'reference');
  assert.equal(measureSelection([reference], calibration).metric.length, 4);
  for (const length of [0, -1, Infinity, NaN, '4', null]) assert.equal(calibrateScale([reference], length).ok, false);
  assert.equal(calibrateScale([reference, line('other', [0, 0], [1, 0])], 1).reason, 'multiple_paths');
  assert.equal(calibrateScale([line('zero', [0, 0], [0, 0])], 1).reason, 'degenerate');
  assert.equal(calibrateScale([line('tiny', [0, 0], [1e-300, 0])], 1e300).reason, 'numerical_range');
  assert.equal(calibrateScale([line('huge', [0, 0], [1e300, 0])], 1e-300).reason, 'numerical_range');
});

test('scale does not survive changing, clearing or reuploading a view', () => {
  const view = {}; const anotherView = {};
  const state = {metresPerUnit: 0.001, method: 'unit', unit: 'mm'};
  assert.equal(resetScaleForView(state, view, view), state);
  for (const [before, after] of [[view, anotherView], [view, null], [null, view], [undefined, undefined]]) {
    assert.deepEqual(resetScaleForView(state, before, after), {metresPerUnit: null, method: null});
  }
  assert.equal(resetScaleForView({metresPerUnit: Infinity}, view, view).metresPerUnit, null);
});

test('fictional measurement fixture produces the advertised area only after explicit centimetre scale', () => {
  const blueprint = createExampleDrawing();
  const drawing = prepareDrawing(blueprint.drawing_views[0]);
  const element = drawing.items.find(item => item.measurement_demo);
  assert.ok(element);
  const unscaled = measureSelection([element]);
  assert.equal(unscaled.metric, null);
  close(unscaled.raw.area, 442 * 244);
  const measured = measureSelection([element], {metresPerUnit: deriveScaleFromUnit(5)});
  close(measured.metric.area, 10.7848);
  close(measured.metric.perimeter, 13.72);
});
