import test from 'node:test';
import assert from 'node:assert/strict';
import {comparePredioEvidence, coordinateCopyText, distanceBetweenLocations, effectiveLocation,
  locationMapUrl, normalizeSourceCrs, parseCoordinateInput, predioCandidates, validGeographic,
  validateReferenceDraft} from '../src/locationAnalysis.js';

const point = (latitude, longitude) => ({latitude, longitude, crs: 'EPSG:4326'});
const withPredio = number => ({location: {candidates: [{kind: 'predio', value: number}]}});

test('coordinate inputs preserve signs and zero without accepting ambiguous separators or nonfinite values', () => {
  assert.equal(parseCoordinateInput('0'), 0);
  assert.equal(parseCoordinateInput('-0,25'), -0.25);
  assert.equal(parseCoordinateInput(' -.5 '), -0.5);
  for (const value of ['', '1,234.5', '1 234', '1e9', 'NaN', Infinity, '−12']) assert.equal(parseCoordinateInput(value), null);
  assert.equal(normalizeSourceCrs('4326'), 'EPSG:4326');
  assert.equal(normalizeSourceCrs('sires-dmq'), 'SIRES-DMQ');
  assert.equal(normalizeSourceCrs('esri:103985'), 'ESRI:103985');
  assert.equal(normalizeSourceCrs('ESRI:102100'), null);
  assert.equal(normalizeSourceCrs('https://example.test/crs'), null);
});

test('map links and comparisons require valid WGS84 coordinate evidence, not CAD metadata', () => {
  const drawing = {location: {status: 'unreferenced', point: {x: 20000, y: 6000},
    candidates: [{kind: 'legacy_header', value: '37.795, -122.394'}]}};
  assert.equal(effectiveLocation(drawing), null);
  assert.equal(validGeographic({latitude: '0', longitude: 0, crs: 'EPSG:4326'}), null);
  assert.equal(validGeographic({latitude: 0, longitude: 0, crs: 'EPSG:3857'}), null);
  assert.equal(locationMapUrl(point(91, 0)), null);
  assert.equal(distanceBetweenLocations(point(0, 0), null), null);
  assert.equal(coordinateCopyText(point(0, -78.5)), '0.000000, -78.500000');
  assert.match(locationMapUrl(point(0, -78.5)), /mlat=0\.000000&mlon=-78\.500000/);
  const declared = {geographic: point(-0.2, -78.5)};
  assert.equal(effectiveLocation(drawing, declared).source, 'user_reference');
  assert.equal(effectiveLocation(null, declared), null);
  assert.equal(effectiveLocation({location: {geographic: point(-0.25, -78.5)}}, declared).source, 'document');
  assert.ok(Math.abs(distanceBetweenLocations(point(0, 0), point(0, 1)) - 111195.08) < 0.1);
});

test('identifier comparisons do not turn a matching IRM and selected predio into a matched drawing', () => {
  const drawing = {filename: '123456.dwg', location: {candidates: [{kind: 'cadastral_key', value: '123456'}]}};
  assert.deepEqual(predioCandidates(drawing), []);
  assert.equal(comparePredioEvidence(drawing, withPredio('123456'), '123456').status, 'partial');
  assert.match(comparePredioEvidence(drawing, withPredio('123456'), '123456').text, /plano todavía no aporta/);
  assert.equal(comparePredioEvidence(withPredio('123456'), withPredio('654321'), null).status, 'mismatch');
  assert.equal(comparePredioEvidence(withPredio('123456'), withPredio('123456'), null).status, 'match');
  assert.equal(comparePredioEvidence(drawing, null, '123456').status, 'pending');
  assert.deepEqual(predioCandidates({candidate_irm_fields: {predio: {raw: '123456'}}}), ['123456']);
});

test('manual reference validation uses longitude as x and requires a recorded source and explicit CRS', () => {
  assert.deepEqual(validateReferenceDraft({mode: 'geographic', x: '-78,5', y: '0', label: 'Punto del levantamiento'}),
    {x: -78.5, y: 0, source_crs: 'EPSG:4326', label: 'Punto del levantamiento'});
  assert.ok(validateReferenceDraft({mode: 'geographic', x: '0', y: '91', label: 'IRM'}).error);
  assert.ok(validateReferenceDraft({mode: 'projected', x: '500000', y: '9980000', crs: '', label: 'IRM'}).error);
  assert.equal(validateReferenceDraft({mode: 'projected', x: '500000', y: '9980000', crs: 'SIRES-DMQ', label: 'IRM'}).source_crs, 'SIRES-DMQ');
  assert.ok(validateReferenceDraft({mode: 'geographic', x: '0', y: '0', label: ''}).error);
});
