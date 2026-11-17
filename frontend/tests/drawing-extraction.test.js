import test from 'node:test';
import assert from 'node:assert/strict';
import { hasPartialExtraction, drawingExtractionMessages, dwgConversionNotice } from '../src/drawingExtraction.js';

test('missing metadata and supported geometry do not imply a complete drawing', () => {
  for (const metadata of [undefined, null, {status: 'supported_geometry', rendered_primitives: 370}]) {
    assert.equal(hasPartialExtraction(metadata), false);
    assert.deepEqual(drawingExtractionMessages(metadata), []);
  }
});

test('a capped view reports observed omissions without converting them to coverage', () => {
  const metadata = {
    status: 'partial', scope: 'modelspace', rendered_primitives: 3000,
    limit_reached: true, primitive_limit: 3000,
    omitted_entity_counts: {LINE: 41, LWPOLYLINE: 7, ARC: 2},
    omitted_curved_polylines: 3,
  };
  const messages = drawingExtractionMessages(metadata);
  assert.equal(hasPartialExtraction(metadata), true);
  assert.ok(messages.some(message => message.includes('límite de visualización')));
  assert.ok(messages.some(message => message.includes('polilíneas ligeras: 7')));
  assert.ok(messages.some(message => message.includes('Entre las polilíneas omitidas, 3')));
  assert.ok(messages.every(message => !message.includes('%')));
});

test('processing guards and excluded presentations stay visible as separate limitations', () => {
  const metadata = {
    status: 'partial', rendered_primitives: 0,
    traversal_limit_reached: true, depth_limit_reached: true,
    omitted_nonempty_layouts: 2,
  };
  const messages = drawingExtractionMessages(metadata);
  assert.ok(messages.some(message => message.includes('Elementos extraídos para el visor: 0')));
  assert.equal(messages.filter(message => message.includes('más omisiones sin contar')).length, 1);
  assert.ok(messages.some(message => message.includes('no se incluyen: 2')));
});

test('detected omissions warn even when status is absent or inconsistent', () => {
  assert.equal(hasPartialExtraction({status: 'supported_geometry', omitted_entity_counts: {INSERT: 2}}), true);
  assert.equal(hasPartialExtraction({omitted_curved_polylines: 1}), true);
  assert.equal(hasPartialExtraction({depth_limit_reached: true}), true);
  assert.equal(hasPartialExtraction({omitted_entity_counts: {LINE: 0, ARC: -1, TEXT: '2'}}), false);
  assert.equal(hasPartialExtraction({status: 'partial'}), true);
});

test('DWG conversion notices require a successful conversion result', () => {
  assert.equal(dwgConversionNotice(undefined), null);
  assert.equal(dwgConversionNotice({format: 'dwg'}), null);
  assert.equal(dwgConversionNotice({format: 'dwg', conversion: {status: 'failed'}}), null);
  assert.equal(dwgConversionNotice({format: 'dxf', conversion: {status: 'converted'}}), null);
  const notice = dwgConversionNotice({format: 'dwg', converted_format: 'dxf', conversion: {status: 'converted'}});
  assert.equal(notice.title, 'DWG convertido para inspección.');
  assert.match(notice.detail, /archivo original/);
});

test('conversion warnings are explained in Spanish without exposing raw engine output', () => {
  const rawWarning = 'engine diagnostic with internal details';
  for (const metadata of [
    {status: 'converted_with_warnings'},
    {status: 'converted', converter_reported_warnings: true},
    {status: 'converted', diagnostics_truncated: true},
  ]) {
    const notice = dwgConversionNotice({format: 'dwg', conversion: {...metadata, warnings: [rawWarning]}});
    assert.equal(notice.title, 'DWG convertido con avisos.');
    assert.match(notice.detail, /vista puede ser parcial/);
    assert.equal(JSON.stringify(notice).includes(rawWarning), false);
  }
});

test('a generic review reminder does not mislabel a clean DWG conversion', () => {
  const notice = dwgConversionNotice({format: 'dwg', conversion: {
    status: 'converted', warnings: ['Review the original drawing'],
    converter_reported_warnings: false, diagnostics_truncated: false,
  }});
  assert.equal(notice.title, 'DWG convertido para inspección.');
});
