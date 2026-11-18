import test from 'node:test';
import assert from 'node:assert/strict';
import {localGeometryScreenPath} from '../src/setbackOverlay.js';

const ring = [[0, 0], [2, 0], [2, 3], [0, 3], [0, 0]];
const space = {origin: [100, 200], metresPerUnit: .001};
const transform = {scale: .1, x: 20, y: 30};

test('metric setback guide follows CAD origin, millimetre scale, Y inversion and zoom without changing geometry', () => {
  const geometry = {type: 'Polygon', coordinates: [ring]};
  const original = JSON.stringify(geometry);
  assert.equal(localGeometryScreenPath(geometry, space, transform), 'M30,50 L230,50 L230,-250 L30,-250 L30,50 Z');
  assert.equal(localGeometryScreenPath(geometry, space, {...transform, scale: .2}), 'M40,70 L440,70 L440,-530 L40,-530 L40,70 Z');
  assert.equal(JSON.stringify(geometry), original);
});

test('a multipart setback guide preserves separate rings and holes for even-odd rendering', () => {
  const hole = ring.map(([x, y]) => [x / 4 + .5, y / 4 + .5]);
  const other = ring.map(([x, y]) => [x + 5, y]);
  const path = localGeometryScreenPath({type: 'MultiPolygon', coordinates: [[ring, hole], [other]]}, space, transform);
  assert.equal((path.match(/M/g) || []).length, 3);
  assert.equal((path.match(/Z/g) || []).length, 3);
});

test('unknown scale, unclosed or nonfinite geometry never draws a pretend limit', () => {
  const geometry = {type: 'Polygon', coordinates: [ring]};
  assert.equal(localGeometryScreenPath(geometry, {...space, metresPerUnit: null}, transform), '');
  assert.equal(localGeometryScreenPath(geometry, space, {...transform, scale: Infinity}), '');
  assert.equal(localGeometryScreenPath({type: 'Polygon', coordinates: [ring.slice(0, -1)]}, space, transform), '');
  assert.equal(localGeometryScreenPath({type: 'Polygon', coordinates: [[[0, 0], [NaN, 1], [1, 1], [0, 0]]]}, space, transform), '');
  assert.equal(localGeometryScreenPath(null, space, transform), '');
});
