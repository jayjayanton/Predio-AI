import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSpatialIndex, filterDrawingItems, fitTransform, hitTest, intersects, prepareDrawing,
  rectangle, selectInRectangle, toScreen, toWorld, updateSelection, zoomAt,
} from '../src/drawingGeometry.js';

const line = (id, points, rest = {}) => ({id, kind: 'line', points, ...rest});
const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test('CAD text elements replace their legacy summaries while PDF/source-label-only views survive', () => {
  const label = {id: 'label-a', text: 'Dormitorio 10 m²', position: [50, 40], text_height: 2, kind: 'source_area', layer: 'Notas'};
  const drawing = prepareDrawing({elements: [{id: 'a', kind: 'text', source_label_id: 'label-a', text: label.text, position: label.position, height: 2, layer: 'Notas'}], source_labels: [label]});
  assert.equal(drawing.items.length, 1);
  assert.equal(drawing.textCount, 1);
  assert.equal(drawing.invalidCount, 0);
  const textOnly = prepareDrawing({source_labels: [label]});
  assert.equal(textOnly.items.length, 1);
  assert.ok(textOnly.bounds[0] <= 50 && textOnly.bounds[2] > 50);
  assert.equal(textOnly.items[0].annotation_kind, 'source_area');
  const pdf = prepareDrawing({elements: [line('pdf-p1-d1', [[0, 0], [4, 6]])], bounds: [0, 0, 200, 300]});
  assert.deepEqual(pdf.items[0].points, [[0, 0], [4, 6]]);
  assert.deepEqual(pdf.bounds, [0, 0, 200, 300]);
});

test('invalid vertices do not connect unrelated endpoints or silently count as imported', () => {
  const drawing = prepareDrawing({elements: [line('valid', [[0, 0], [2, 2]]), line('invalid', [[0, 0], [NaN, 9], [5, 0]])]});
  assert.equal(drawing.items.length, 1);
  assert.equal(drawing.invalidCount, 1);
  assert.equal(drawing.items[0].source_id, 'valid');
});

test('letterboxed fit and anchored zoom retain the world point beneath the cursor', () => {
  const transform = fitTransform([100, -50, 1100, 150], 400, 700, 20);
  near(transform.scale, 0.36);
  const world = [460, 87];
  const screen = toScreen(world, transform);
  assert.ok(screen[1] > 200 && screen[1] < 500);
  toWorld(screen, transform).forEach((value, index) => near(value, world[index]));
  const zoomed = zoomAt(transform, 4, screen);
  toWorld(screen, zoomed).forEach((value, index) => near(value, world[index]));
  const clamped = zoomAt(transform, 1000, screen, 0.1, 2);
  assert.equal(clamped.scale, 2);
  toWorld(screen, clamped).forEach((value, index) => near(value, world[index]));
});

test('rectangle selection follows actual paths, including crossing lines and closed edges', () => {
  const drawing = prepareDrawing({elements: [
    line('crossing', [[-5, 1], [5, 1]]),
    line('bbox-only', [[-4, 2], [2, -4]]),
    {id: 'closed', kind: 'polyline', closed: true, points: [[5, 0], [7, 0], [7, 2]]},
  ]});
  assert.deepEqual(selectInRectangle(drawing.items, [0, 0, 2, 2]).map(item => item.id), ['crossing']);
  assert.deepEqual(selectInRectangle(drawing.items, [5.8, 0.8, 6.2, 1.2]).map(item => item.id), ['closed']);
  assert.equal(hitTest(drawing.items, [6, 1], 0.05)?.id, 'closed');
});

test('solid hatch holes remain empty for point and rectangle selection', () => {
  const drawing = prepareDrawing({elements: [{id: 'hatch', kind: 'hatch_boundary', filled: true, closed: true, points: [], rings: [
    [[0, 0], [10, 0], [10, 10], [0, 10]], [[3, 3], [7, 3], [7, 7], [3, 7]],
  ]}]});
  assert.equal(hitTest(drawing.items, [1, 1], 0.05)?.id, 'hatch');
  assert.equal(hitTest(drawing.items, [5, 5], 0.05), null);
  assert.equal(selectInRectangle(drawing.items, [4, 4, 6, 6]).length, 0);
  assert.equal(selectInRectangle(drawing.items, [1, 1, 2, 2]).length, 1);
  assert.equal(selectInRectangle(drawing.items, [2.9, 4, 3.1, 6]).length, 1);
  assert.equal(drawing.segmentCount, 8);
});

test('rotated, mirrored affine text uses its transformed region rather than its broad box', () => {
  const drawing = prepareDrawing({elements: [{id: 'rotated', kind: 'text', text: 'ABCD', position: [10, 10], height: 2, rotation: 90},
    {id: 'mirrored', kind: 'text', text: 'AB', position: [30, 10], height: 2, text_transform: [-3, 1, 1, 2], vertical_alignment: 'top'}]});
  const rotated = drawing.byId.get('rotated');
  near(rotated.bounds[0], 10); near(rotated.bounds[2], 12);
  assert.equal(hitTest([rotated], [11, 12], 0.01)?.id, 'rotated');
  assert.equal(hitTest([rotated], [9, 12], 0.01), null);
  const mirrored = drawing.byId.get('mirrored');
  // Center in normalized text coordinates, transformed with the full affine matrix.
  const center = [30 + 0.62 * -3 + 0.5, 10 + 0.62 + 1];
  assert.equal(hitTest([mirrored], center, 0.01)?.id, 'mirrored');
  assert.equal(selectInRectangle([mirrored], rectangle([center[0] - 0.1, center[1] - 0.1], [center[0] + 0.1, center[1] + 0.1])).length, 1);
});

test('multiline top, middle and bottom attachments align drawing and selection consistently', () => {
  const drawing = prepareDrawing({elements: ['top', 'middle', 'bottom', 'baseline'].map(vertical => ({
    id: vertical, kind: 'text', text: 'PLANTA\nALTA', position: [50, 100], height: 10,
    text_transform: [10, 0, 0, 10], vertical_alignment: vertical,
  }))});
  const top = drawing.byId.get('top'); const middle = drawing.byId.get('middle'); const bottom = drawing.byId.get('bottom');
  near(top.bounds[1], 100); near(top.bounds[3], 122);
  near((middle.bounds[1] + middle.bounds[3]) / 2, 100);
  near(bottom.bounds[3], 100);
  near(drawing.byId.get('baseline').baselineOffset, 0);
  assert.equal(hitTest([top], [55, 110], 0.01)?.id, 'top');
  assert.equal(hitTest([top], [55, 95], 0.01), null);
});

test('valid many-line CAD text does not exceed JavaScript argument limits', () => {
  const text = 'x\n'.repeat(150000) + 'longest';
  const drawing = prepareDrawing({elements: [{id: 'long-mtext', kind: 'text', text, position: [0, 0], height: 1}]});
  assert.equal(drawing.items.length, 1);
  assert.ok(drawing.bounds.every(Number.isFinite));
  near(drawing.bounds[2], 7 * 0.62);
});

test('spatial index and selection keep every item beyond the old 3,000 cap', () => {
  const elements = Array.from({length: 12000}, (_, i) => line(`entity-${i}`, [[i % 200, Math.floor(i / 200)], [i % 200 + 0.4, Math.floor(i / 200) + 0.4]], {layer: i % 2 ? 'A' : 'B'}));
  elements.push(line('broad', [[-20, -20], [250, 100]]));
  const drawing = prepareDrawing({elements});
  const index = buildSpatialIndex(drawing.items, drawing.bounds);
  assert.equal(index.query(drawing.bounds).length, 12001);
  const all = selectInRectangle(index.query(drawing.bounds), drawing.bounds);
  assert.equal(all.length, 12001);
  assert.equal(updateSelection(new Set(), all.map(item => item.id)).size, 12001);
  for (const box of [[0, 0, 10, 10], [150, 40, 190, 52], [-30, -30, -25, -25], [200, 59, 250, 100]]) {
    const expected = drawing.items.filter(item => intersects(item.bounds, box)).map(item => item.id).sort();
    assert.deepEqual(index.query(box).map(item => item.id).sort(), expected);
  }
});

test('layer/text/search filters and bulk selection retain identities and hidden selections', () => {
  const drawing = prepareDrawing({elements: [line('wall', [[0, 0], [1, 0]], {layer: 'A-WALL', source_handle: '42FF', block_path: ['INSERT#A:House']}),
    line('door', [[1, 0], [1, 1]], {layer: 'A-DOOR'}),
    {id: 'area', kind: 'text', text: 'Dormitorio 10,15 m²', position: [0, 0], height: 1, layer: 'Notes'}]});
  assert.deepEqual(filterDrawingItems(drawing.items, {query: '42ff'}).map(item => item.id), ['wall']);
  assert.deepEqual(filterDrawingItems(drawing.items, {query: 'dormitorio'}).map(item => item.id), ['area']);
  assert.deepEqual(filterDrawingItems(drawing.items, {query: 'house'}).map(item => item.id), ['wall']);
  const visible = filterDrawingItems(drawing.items, {hiddenLayers: new Set(['A-DOOR']), showText: false});
  assert.deepEqual(visible.map(item => item.id), ['wall']);
  const selected = updateSelection(new Set(['door']), visible.map(item => item.id), {additive: true});
  assert.deepEqual([...selected], ['door', 'wall']);
  assert.equal(updateSelection(selected, ['wall'], {additive: true, toggle: true}).has('wall'), false);
  assert.deepEqual([...updateSelection(selected, ['area'])], ['area']);
  assert.deepEqual([...selected], ['door', 'wall']);
});
