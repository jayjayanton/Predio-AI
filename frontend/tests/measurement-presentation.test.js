import test from 'node:test';
import assert from 'node:assert/strict';
import { canConfirmDrawingUnit, formatDrawingNumber, formatScaleFactor, parseKnownMetres, scaleForView } from '../src/measurementPresentation.js';

test('known metres accept decimal comma or point without guessing thousands separators', () => {
  for (const [input, expected] of [['3,10', 3.1], ['3.10', 3.1], [' 0,025 ', 0.025], [',5', 0.5], ['.5', 0.5], ['4', 4]]) {
    assert.equal(parseKnownMetres(input), expected);
  }
  for (const input of ['', ' ', '0', '0,0', '-3', 'Infinity', 'NaN', '1.234,56', '1,234.56', '4 m', '1e5', '1 000', '1,2,3', true, null, '9'.repeat(400)]) {
    assert.equal(parseKnownMetres(input), null, String(input));
  }
});

test('PDF and paper layouts cannot apply model units; the example requires an explicit apply just like model CAD', () => {
  assert.equal(canConfirmDrawingUnit('pdf', 'modelspace'), false);
  assert.equal(canConfirmDrawingUnit('dwg', 'paperspace'), false);
  assert.equal(canConfirmDrawingUnit('dxf', 'paperspace'), false);
  assert.equal(canConfirmDrawingUnit('', undefined), false);
  assert.equal(canConfirmDrawingUnit('dwg', 'unknown_layout'), false);
  assert.equal(canConfirmDrawingUnit('dwg', 'modelspace'), true);
  assert.equal(canConfirmDrawingUnit('DXF', undefined), true);
  assert.equal(canConfirmDrawingUnit('example', 'example'), true);
});

test('applied scale belongs to the exact view, never a similarly named page or another file', () => {
  const view = {page: 1, name: 'Model'};
  const otherView = {page: 1, name: 'Model'};
  const record = {view, method: 'unit', unit: 'mm', metresPerUnit: 0.001};
  assert.equal(scaleForView(record, view), record);
  assert.equal(scaleForView(record, otherView), null);
  assert.equal(scaleForView(record, {page: 2}), null);
  assert.equal(scaleForView(null, view), null);
  for (const factor of [0, -1, Infinity, NaN, '0.001']) {
    assert.equal(scaleForView({...record, metresPerUnit: factor}, view), null);
  }
});

test('numeric presentation keeps unavailable values distinct from zero and tiny nonzero values', () => {
  assert.equal(formatDrawingNumber(4000), '4.000');
  assert.equal(formatDrawingNumber(10.7848), '10,7848');
  assert.equal(formatDrawingNumber(0), '0');
  assert.equal(formatDrawingNumber(-0), '0');
  for (const value of [undefined, null, NaN, Infinity]) assert.equal(formatDrawingNumber(value), '—');
  assert.match(formatDrawingNumber(0.000001), /E/);
  assert.notEqual(formatDrawingNumber(0.000001), '0');
});

test('scale summaries preserve small calibration factors and identify rounding', () => {
  // A 10,000-unit reference calibrated to 3.1 m must not imply a 3 m result.
  assert.deepEqual(formatScaleFactor(3.1 / 10000), {text: '0,00031', approximate: false});
  assert.deepEqual(formatScaleFactor(0.001), {text: '0,001', approximate: false});
  assert.deepEqual(formatScaleFactor(0.3048), {text: '0,3048', approximate: false});
  const recurring = formatScaleFactor(3.1 / 864);
  assert.equal(recurring.text, '0,003587963');
  assert.equal(recurring.approximate, true);
  for (const value of [1e-12, 1e12, Number.MIN_VALUE]) {
    const summary = formatScaleFactor(value);
    assert.match(summary.text, /E/);
    assert.equal(summary.approximate, false);
    assert.notEqual(summary.text, '0');
  }
  assert.equal(formatScaleFactor(1.234567891e-12).approximate, true);
  for (const value of [undefined, null, 0, -1, NaN, Infinity]) {
    assert.deepEqual(formatScaleFactor(value), {text: '—', approximate: false});
  }
});
