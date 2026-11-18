import assert from 'node:assert/strict';
import test from 'node:test';
import {evaluatePlanningShape, evaluateSetbackGeometry, setbackContextKey, setbackSourceKey} from '../src/liveSetbacks.js';
import {createPlanningShape, createPlanningSnapshot, extractPlanningFootprint} from '../src/scaledPlanning.js';

const close = points => [...points, [...points[0]]];
const polygon = (x0 = -10, y0 = -10, x1 = 10, y1 = 10, holes = []) => ({type: 'Polygon', coordinates: [
  [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]], ...holes]});
const near = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
function context(parcel = polygon(), required = 5) {
  const parts = parcel.type === 'Polygon' ? [parcel.coordinates] : parcel.coordinates;
  return {version: 1, coordinate_space: 'local_metres', ready: true, complete: !parts.some(rings => rings.length > 1), tolerance_m: 1e-6,
    parcel, pending_reasons: parts.some(rings => rings.length > 1) ? ['parcel_holes'] : [],
    edges: parts.flatMap((rings, part) => rings[0].slice(0, -1).map((start, i) => ({polygon: part, ring: 0, edge: i,
      kind: i === 0 ? 'front' : i === 2 ? 'rear' : 'side', required_m: required, points: [start, rings[0][i + 1]]})))};
}

test('reaching a minimum setback is amber, passing it is a conflict, and retreating clears it', () => {
  const rules = context();
  const exact = evaluateSetbackGeometry(polygon(-5, -5, 5, 5), rules);
  assert.equal(exact.status, 'at_limit');
  assert.ok(exact.setback_edges.every(edge => edge.status === 'at_limit' && edge.actual_m === 5 && edge.shortfall_m === 0));
  const intruding = evaluateSetbackGeometry(polygon(-4, -4, 6, 4), rules);
  assert.equal(intruding.status, 'conflict');
  const right = intruding.setback_edges.find(edge => edge.edge === 1);
  assert.equal(right.actual_m, 4); assert.equal(right.shortfall_m, 1);
  assert.equal(evaluateSetbackGeometry(polygon(-4, -4, 4, 4), rules).status, 'within_reviewed_limits');
});

test('computational equality tolerance never becomes a centimetre-sized allowance', () => {
  assert.equal(evaluateSetbackGeometry(polygon(-4, -4, 5 + 5e-7, 4), context()).status, 'at_limit');
  assert.equal(evaluateSetbackGeometry(polygon(-4, -4, 5.00001, 4), context()).status, 'conflict');
});

test('individual extension feedback does not inherit an existing footprint violation', () => {
  const rules = context();
  const existing = evaluateSetbackGeometry(polygon(-4, -4, 8, 4), rules, {id: 'existing-footprint', role: 'existing'});
  const addition = evaluateSetbackGeometry(polygon(-4, -4, -2, -2), rules, {id: 'new-room', role: 'extension'});
  assert.equal(existing.status, 'conflict'); assert.equal(addition.status, 'within_reviewed_limits');
  assert.equal(existing.id, 'existing-footprint'); assert.equal(addition.id, 'new-room');
});

test('furniture does not trigger setbacks or containment even outside the parcel', () => {
  const result = evaluateSetbackGeometry(polygon(100, 100, 120, 120), context(), {id: 'table', role: 'furniture', label: 'Mesa'});
  assert.equal(result.status, 'not_applicable'); assert.equal(result.containment_status, 'not_applicable');
  assert.deepEqual(result.setback_edges, []); assert.equal(result.label, 'Mesa');
});

test('missing or unreviewed context never evaluates a regulatory pass', () => {
  for (const rules of [null, {}, {...context(), ready: false, pending_reasons: ['identity']}, {...context(), coordinate_space: 'EPSG:4326'}]) {
    const result = evaluateSetbackGeometry(polygon(-4, -4, 4, 4), rules);
    assert.equal(result.status, 'pending'); assert.equal(result.complete, false); assert.deepEqual(result.setback_edges, []);
  }
});

test('partial classification may identify a conflict but cannot report an all-clear', () => {
  const base = context();
  const partial = {...base, complete: false, edges: [base.edges[1]], pending_reasons: ['unclassified_edges']};
  assert.equal(evaluateSetbackGeometry(polygon(-4, -4, 6, 4), partial).status, 'conflict');
  const inside = evaluateSetbackGeometry(polygon(-4, -4, 4, 4), partial);
  assert.equal(inside.status, 'pending'); assert.equal(inside.complete, false);
  assert.deepEqual(inside.pending_reasons, ['unclassified_edges']);
  assert.equal(evaluateSetbackGeometry(polygon(-4, -4, 4, 4), {...partial, complete: true}).status, 'pending', 'coverage is independently checked');
});

test('unknown limits stay pending, while a reviewed zero remains a real numerical limit', () => {
  const base = context();
  const unknown = {...base, complete: false, edges: base.edges.map((edge, i) => ({...edge, required_m: i === 1 ? null : edge.required_m}))};
  const result = evaluateSetbackGeometry(polygon(-4, -4, 4, 4), unknown);
  assert.equal(result.status, 'pending'); assert.equal(result.setback_edges[1].status, 'pending');
  assert.equal(evaluateSetbackGeometry(polygon(), context(polygon(), 0)).status, 'at_limit');
  assert.equal(evaluateSetbackGeometry(polygon(-11, -1, -9, 1), context(polygon(), 0)).status, 'conflict');
});

test('distance is to the filled polygon, including a boundary segment enclosed by the proposal', () => {
  const result = evaluateSetbackGeometry(polygon(-15, -15, 15, 15), context());
  assert.equal(result.status, 'conflict'); assert.equal(result.containment_status, 'conflict');
  assert.ok(result.setback_edges.every(edge => edge.actual_m === 0));
  near(result.outside_parcel_m2, 500);
});

test('finite edge endpoint distance is used, not distance to an infinite supporting line', () => {
  const rules = context(polygon(0, 0, 20, 20), 0);
  const result = evaluateSetbackGeometry(polygon(23, 24, 25, 26), rules);
  near(result.setback_edges[1].actual_m, 5);
  assert.equal(result.containment_status, 'conflict');
});

test('a concave parcel catches a bridge that has every proposal vertex inside', () => {
  const parcel = {type: 'Polygon', coordinates: [close([[0, 0], [10, 0], [10, 10], [7, 10], [7, 3], [3, 3], [3, 10], [0, 10]])]};
  const result = evaluateSetbackGeometry(polygon(2, 6, 8, 8), context(parcel, 0));
  assert.equal(result.containment_status, 'conflict'); assert.equal(result.status, 'conflict');
  near(result.outside_parcel_m2, 8);
});

test('an enclosed parcel hole is detected even without any boundary crossing', () => {
  const hole = close([[8, 8], [8, 12], [12, 12], [12, 8]]);
  const parcel = polygon(0, 0, 20, 20, [hole]);
  const result = evaluateSetbackGeometry(polygon(6, 6, 14, 14), context(parcel, 0));
  assert.equal(result.containment_status, 'conflict'); near(result.outside_parcel_m2, 16);
  assert.equal(result.complete, false); assert.deepEqual(result.pending_reasons, ['parcel_holes']);
  const matchingHole = evaluateSetbackGeometry(polygon(6, 6, 14, 14, [hole]), context(parcel, 0));
  assert.equal(matchingHole.containment_status, 'within_reviewed_limits');
  assert.equal(matchingHole.status, 'pending', 'parcel holes still require additional regulatory review');
});

test('multipart parcels do not accept a proposal bridging the gap between parts', () => {
  const parcel = {type: 'MultiPolygon', coordinates: [polygon(0, 0, 4, 4).coordinates, polygon(6, 0, 10, 4).coordinates]};
  const result = evaluateSetbackGeometry(polygon(2, 1, 8, 3), context(parcel, 0));
  assert.equal(result.containment_status, 'conflict'); near(result.outside_parcel_m2, 4);
  assert.equal(evaluateSetbackGeometry(polygon(1, 1, 3, 3), context(parcel, 0)).status, 'within_reviewed_limits');
});

test('valid concave proposals preserve their notch rather than checking their bounding box', () => {
  const parcel = {type: 'Polygon', coordinates: [close([[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]])]};
  const proposal = {type: 'Polygon', coordinates: [close([[1, 1], [9, 1], [9, 3], [3, 3], [3, 9], [1, 9]])]};
  const result = evaluateSetbackGeometry(proposal, context(parcel, 0));
  assert.equal(result.containment_status, 'within_reviewed_limits'); assert.equal(result.status, 'within_reviewed_limits');
});

test('tiny clipping slivers match the backend area tolerance without hiding larger excursions', () => {
  const rules = context(polygon(0, 0, 20, 20), 0);
  const tiny = evaluateSetbackGeometry(polygon(19, 5, 20 + 1e-8, 6), rules);
  assert.equal(tiny.containment_status, 'within_reviewed_limits'); assert.ok(tiny.outside_parcel_m2 < 1e-6);
  const visible = evaluateSetbackGeometry(polygon(19, 5, 20.001, 6), rules);
  assert.equal(visible.containment_status, 'conflict'); near(visible.outside_parcel_m2, .001);
});

test('malformed or unsupported geometry stays pending without non-finite measurements', () => {
  const crossing = {type: 'Polygon', coordinates: [close([[0, 0], [4, 4], [0, 4], [4, 0], [5, -1]])]};
  for (const geometry of [null, {type: 'Point', coordinates: [0, 0]}, polygon(NaN, 0, 4, 4), crossing]) {
    const result = evaluateSetbackGeometry(geometry, context());
    assert.equal(result.status, 'pending'); assert.deepEqual(result.setback_edges, []);
  }
  const wrongEdge = context(); wrongEdge.edges[1] = {...wrongEdge.edges[1], points: [[500, 500], [500, 510]]};
  assert.equal(evaluateSetbackGeometry(polygon(-4, -4, 4, 4), wrongEdge).status, 'pending');
  assert.equal(evaluateSetbackGeometry(polygon(-4, -4, 4, 4), {...context(), parcel: {type: 'Polygon', coordinates: [null]}}).status, 'pending');
  assert.equal(evaluateSetbackGeometry(polygon(-4, -4, 4, 4), {...context(), edges: [null]}).status, 'pending');
});

test('CAD origin, millimetres, Y reflection and shape rotation exactly match the committed snapshot', () => {
  const scale = {metresPerUnit: .001, method: 'unit', unit: 'mm'};
  const footprint = extractPlanningFootprint({id: 'base', kind: 'polyline', closed: true, points: [[0, 0], [10000, 0], [10000, 6000], [0, 6000]]}, scale.metresPerUnit);
  assert.equal(footprint.ok, true);
  const figure = {...createPlanningShape('extension', 'new-room', [8000, 7000]), rotationDegrees: 37};
  const snapshot = createPlanningSnapshot({footprint, shapes: [figure], scale, source: {documentName: 'synthetic.dwg'}});
  const original = structuredClone(figure), rules = context(polygon(-20, -20, 20, 20), 5);
  const live = evaluatePlanningShape(figure, {origin: snapshot.origin, metresPerUnit: scale.metresPerUnit}, rules);
  const committed = evaluateSetbackGeometry(snapshot.shapes[0].geometry, rules, figure);
  assert.equal(live.status, committed.status); assert.equal(live.containment_status, committed.containment_status);
  live.setback_edges.forEach((edge, index) => near(edge.actual_m, committed.setback_edges[index].actual_m));
  assert.deepEqual(figure, original, 'measurement never mutates the proposed geometry');
});

test('source freshness ignores figures but invalidates a changed view, scale, footprint or origin', () => {
  const snapshot = {source: {documentName: 'a.dwg', viewName: 'ground'}, scale: {metresPerUnit: .001}, origin: [10, 20],
    coordinateSpace: 'local_metres', axisMapping: 'x_right_y_up', footprint: polygon(-4, -4, 4, 4), shapes: []};
  const key = setbackSourceKey(snapshot);
  assert.equal(setbackSourceKey({...snapshot, shapes: [{id: 'new'}]}), key);
  for (const changed of [{source: {...snapshot.source, viewName: 'upper'}}, {scale: {metresPerUnit: .01}}, {origin: [11, 20]}, {footprint: polygon(-3, -4, 4, 4)}]) {
    assert.notEqual(setbackSourceKey({...snapshot, ...changed}), key);
  }
});

test('context freshness retains reviewed setbacks through proposal edits but rejects changed evidence or placement', () => {
  const snapshot = {source: {documentName: 'a.dwg'}, scale: {metresPerUnit: 1}, origin: [0, 0], footprint: polygon(-4, -4, 4, 4)};
  const request = {footprint: snapshot.footprint, shapes: [], parcel: polygon(), placement: {confirmed: true, rotation_degrees: 0},
    irm: {reviewed: true, selected_predio: '123', irm_predio: '123', constraints: {retiro_lateral: 5}}, edges: context().edges,
    proposal: {ground_floor_confirmed: true, existing_footprint_complete: true, footprint_is_counted_area: true, ground_floor_counted_area_m2: 64}};
  const key = setbackContextKey({snapshot, request, contextKey: 'document-A'});
  assert.equal(setbackContextKey({snapshot: {...snapshot, shapes: [{id: 'new'}]}, contextKey: 'document-A',
    request: {...request, shapes: [{id: 'new'}], proposal: {...request.proposal, footprint_is_counted_area: false, ground_floor_counted_area_m2: null, height_m: 10}}}), key);
  for (const changed of [{placement: {...request.placement, confirmed: false}}, {placement: {...request.placement, rotation_degrees: 12}},
    {irm: {...request.irm, reviewed: false}}, {irm: {...request.irm, irm_predio: '456'}}, {edges: request.edges.slice(1)},
    {proposal: {...request.proposal, existing_footprint_complete: false}}]) {
    assert.notEqual(setbackContextKey({snapshot, request: {...request, ...changed}, contextKey: 'document-A'}), key);
  }
  assert.notEqual(setbackContextKey({snapshot, request, contextKey: 'document-B'}), key);
  assert.equal(setbackContextKey({snapshot, request: null}), '');
});
