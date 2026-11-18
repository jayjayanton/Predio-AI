import test from 'node:test';
import assert from 'node:assert/strict';
import {buildIllustrativeModel, RECONSTRUCTION_LIMITS} from '../src/illustrativeReconstruction.js';

const rectangle = (width = 10000, depth = 6000) => [[0, 0], [width, 0], [width, depth], [0, depth]];
const element = (points = rectangle(), extra = {}) => ({
  id: 'footprint', kind: 'polyline', source_type: 'LWPOLYLINE', layer: 'Outline', closed: true, points, ...extra,
});
const build = (options = {}) => buildIllustrativeModel({element: element(), metresPerUnit: 0.001, heightMetres: 2.6, ...options});
const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance,
  `${actual} differs from ${expected}`);
const subtract = (a, b) => a.map((value, index) => value - b[index]);
const vectorCross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function triangles(mesh) {
  const result = [];
  for (let index = 0; index < mesh.indices.length; index += 3) {
    result.push(mesh.indices.slice(index, index + 3).map(vertex => mesh.positions.slice(vertex * 3, vertex * 3 + 3)));
  }
  return result;
}
function surfaceArea(mesh, projected = false) {
  return triangles(mesh).reduce((sum, [a, b, c]) => {
    const normal = vectorCross(subtract(b, a), subtract(c, a));
    return sum + (projected ? Math.abs(normal[1]) : Math.hypot(...normal)) / 2;
  }, 0);
}
function signedVolume(model) {
  return Object.values(model.meshes).reduce((sum, part) => sum + triangles(part).reduce((subtotal, [a, b, c]) => {
    const normal = vectorCross(b, c);
    return subtotal + a.reduce((dot, coordinate, index) => dot + coordinate * normal[index], 0) / 6;
  }, 0), 0);
}

test('a metric footprint produces a centered volume with explicit height and roof assumptions', () => {
  const source = element(); const original = structuredClone(source);
  const result = build({element: source, roofType: 'flat'});
  assert.equal(result.ok, true);
  assert.equal(result.sourceId, 'footprint');
  assert.deepEqual(result.dimensions, {widthMetres: 10, depthMetres: 6});
  assert.deepEqual(result.bounds, {min: [-5, 0, -3], max: [5, 2.6, 3]});
  near(result.areaM2, 60); near(result.perimeterM, 32);
  near(surfaceArea(result.meshes.base), 60);
  near(surfaceArea(result.meshes.roof), 60);
  near(surfaceArea(result.meshes.walls), 32 * 2.6);
  near(signedVolume(result), 60 * 2.6);
  assert.equal(result.assumptions.illustrative, true);
  assert.equal(result.assumptions.footprintSource, 'selected_exterior_contour');
  assert.equal(result.assumptions.heightSource, 'user_assumption');
  assert.equal(result.assumptions.roofSource, 'user_assumption');
  assert.equal(result.assumptions.openingsAndInteriorWalls, 'not_modelled');
  assert.equal(result.assumptions.roofPitchDegrees, null);
  assert.deepEqual(source, original, 'the model never writes assumed heights into its CAD source');
});

test('none leaves the footprint open above while flat and gable are distinct explicit choices', () => {
  const none = build({roofType: 'none', roofPitchDegrees: NaN, ridgeAxis: 'unused'});
  assert.equal(none.ok, true);
  assert.equal(none.meshes.roof.positions.length, 0);
  assert.equal(none.meshes.roof.indices.length, 0);
  assert.equal(none.assumptions.roofSource, 'not_modelled');
  assert.equal(none.roofRiseMetres, 0);
  assert.equal(none.maxHeightMetres, 2.6);
  near(surfaceArea(none.meshes.walls), 32 * 2.6);
  assert.equal(build({roofType: 'flat'}).assumptions.roofType, 'flat');
});

test('gable pitch and ridge direction determine the roof rise and the closed volume', () => {
  const pitch = 30; const tangent = Math.tan(Math.PI / 6);
  const x = build({roofType: 'gable', roofPitchDegrees: pitch, ridgeAxis: 'x'});
  const y = build({roofType: 'gable', roofPitchDegrees: pitch, ridgeAxis: 'y'});
  assert.equal(x.ok, true); assert.equal(y.ok, true);
  near(x.roofRiseMetres, 3 * tangent); near(y.roofRiseMetres, 5 * tangent);
  near(x.maxHeightMetres, 2.6 + 3 * tangent);
  near(y.maxHeightMetres, 2.6 + 5 * tangent);
  near(surfaceArea(x.meshes.roof), 60 / Math.cos(Math.PI / 6));
  near(surfaceArea(y.meshes.roof), 60 / Math.cos(Math.PI / 6));
  near(signedVolume(x), 60 * (2.6 + x.roofRiseMetres / 2));
  near(signedVolume(y), 60 * (2.6 + y.roofRiseMetres / 2));
  assert.ok(triangles(x.meshes.walls).flat().some(point => Math.abs(point[1] - x.maxHeightMetres) < 1e-10),
    'the gable wall includes its ridge apex even when the original edge has no midpoint');
  assert.equal(x.assumptions.roofPitchDegrees, pitch);
  assert.equal(y.assumptions.ridgeAxis, 'y');
});

test('concave notches remain empty when a ridge crosses the footprint multiple times', () => {
  // 10×6 rectangle with a 4×4 open notch; the ridge crosses both separate arms.
  const points = [[0, 0], [10, 0], [10, 6], [7, 6], [7, 2], [3, 2], [3, 6], [0, 6]];
  const pitch = 35; const tangent = Math.tan(pitch * Math.PI / 180);
  const result = build({element: element(points), metresPerUnit: 1, roofType: 'gable', roofPitchDegrees: pitch, ridgeAxis: 'x'});
  assert.equal(result.ok, true);
  near(result.areaM2, 44); near(surfaceArea(result.meshes.base), 44);
  near(surfaceArea(result.meshes.roof, true), 44);
  near(surfaceArea(result.meshes.roof), 44 / Math.cos(pitch * Math.PI / 180));
  // Integrate the symmetric gable over the large rectangle, then subtract the
  // notch: 90*tan(pitch) - 28*tan(pitch) above the assumed rectangular walls.
  near(signedVolume(result), 44 * 2.6 + 62 * tangent);
  for (const part of [result.meshes.base, result.meshes.roof]) {
    for (const triangle of triangles(part)) {
      const sourceX = triangle.reduce((sum, p) => sum + p[0], 0) / 3 + 5;
      const sourceY = -triangle.reduce((sum, p) => sum + p[2], 0) / 3 + 3;
      assert.ok(!(sourceX > 3 && sourceX < 7 && sourceY > 2 && sourceY < 6),
        'no base or roof triangle fills the exterior notch');
    }
  }
});

test('source translations, reversed winding, closure points and collinear vertices preserve the footprint', () => {
  const points = [[0, 0], [5000, 0], [10000, 0], [10000, 6000], [0, 6000], [0, 0]];
  const transformed = points.map(([x, y]) => [x + 1e12, y - 1e12]).reverse();
  const normal = build({element: element(points)});
  const translated = build({element: element(transformed)});
  for (const model of [normal, translated]) {
    assert.equal(model.ok, true); assert.equal(model.footprintPoints.length, 4);
    near(model.areaM2, 60); near(model.perimeterM, 32);
    near(signedVolume(model), 60 * 2.6);
    assert.deepEqual(model.bounds, {min: [-5, 0, -3], max: [5, 2.6, 3]});
  }
});

test('interior graphical masks are explicitly reported as ignored and source approximation is retained', () => {
  const source = element([], {kind: 'hatch_boundary', source_type: 'HATCH',
    rings: [rectangle(), [[1000, 1000], [4000, 1000], [4000, 4000], [1000, 4000]],
      [[3000, 1000], [5000, 1000], [5000, 4000], [3000, 4000]]],
    approximation: {method: 'source_curve_sampling'},
  });
  const original = structuredClone(source); const model = build({element: source});
  assert.equal(model.ok, true);
  assert.equal(model.ignoredRingCount, 2);
  assert.equal(model.assumptions.interiorCutouts, 'not_deducted');
  assert.equal(model.approximate, true);
  near(model.areaM2, 60); near(signedVolume(model), 60 * 2.6);
  assert.deepEqual(source, original);
});

test('unsafe assumptions and missing scale never produce an illustrative mesh', () => {
  for (const metresPerUnit of [undefined, null, 0, -1, NaN, Infinity]) {
    assert.deepEqual(build({metresPerUnit}), {ok: false, reason: 'scale_required'});
  }
  for (const heightMetres of [0, 0.2, 13, NaN, Infinity]) {
    assert.equal(build({heightMetres}).reason, 'invalid_height');
  }
  assert.equal(build({roofType: 'hip'}).reason, 'invalid_roof');
  for (const roofPitchDegrees of [0, 61, NaN, Infinity]) {
    assert.equal(build({roofType: 'gable', roofPitchDegrees}).reason, 'invalid_pitch');
  }
  assert.equal(build({roofType: 'gable', ridgeAxis: 'diagonal'}).reason, 'invalid_ridge_axis');
  assert.equal(build({metresPerUnit: 1}).reason, 'model_size_range', 'millimetres mistaken for metres need review');
  assert.equal(build({metresPerUnit: 1e-10}).reason, 'model_size_range');
});

test('open paths, ambiguous exteriors, annotations and excessive contours do not become buildings', () => {
  assert.equal(build({element: element(rectangle(), {closed: false})}).reason, 'open_path');
  assert.equal(build({element: element([[0, 0], [10000, 6000], [0, 6000], [10000, 0]])}).ok, false);
  assert.equal(build({element: element([], {kind: 'hatch_boundary', rings: [rectangle(), rectangle().map(([x, y]) => [x + 20000, y])]})}).reason, 'multiple_contours');
  assert.equal(build({element: element(rectangle(), {dimension_handle: 'D1'})}).reason, 'no_geometry');
  assert.equal(build({element: {kind: 'text', text: 'HEIGHT 2.6 m', position: [0, 0]}}).reason, 'no_geometry');
  const count = RECONSTRUCTION_LIMITS.maxFootprintPoints + 1;
  const circle = Array.from({length: count}, (_, index) => [1000 * Math.cos(index * 2 * Math.PI / count),
    1000 * Math.sin(index * 2 * Math.PI / count)]);
  assert.equal(build({element: element(circle)}).reason, 'complexity_limit');
});
