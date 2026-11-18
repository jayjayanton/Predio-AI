import test from 'node:test';
import assert from 'node:assert/strict';
import { hasPartialExtraction, drawingExtractionMessages, drawingRepresentationMessages, dwgConversionNotice } from '../src/drawingExtraction.js';

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


test('a capped source annotation view reports missing text without asserting coverage', () => {
  const extraction = {
    status: 'partial',
    source_label_limit_reached: true,
    source_label_limit: 250,
    rendered_source_labels: 250,
  };
  assert.equal(hasPartialExtraction(extraction), true);
  const messages = drawingExtractionMessages(extraction);
  assert.ok(messages.some(message => message.includes('250 etiquetas originales')));
  assert.ok(messages.some(message => message.includes('pueden faltar textos o cotas')));
});

test('a capped legacy label summary does not imply omitted text in a full text-element import', () => {
  const extraction = {status: 'supported_geometry', source_label_limit_reached: true,
    source_label_summary_only: true, source_label_summary_omitted: 500,
    rendered_text_elements: 750, rendered_primitives: 12000, limit_reached: false};
  assert.equal(hasPartialExtraction(extraction), false);
  assert.deepEqual(drawingExtractionMessages(extraction), []);
  assert.ok(drawingRepresentationMessages(extraction).some(message => message.includes('fuente sustituta')));
});

test('source omissions and incomplete styles remain explicit without claiming quantified coverage', () => {
  const extraction = {status: 'supported_geometry', partially_rendered_entity_counts: {HATCH: 2},
    omission_reasons: {gradient_fill_not_rendered: 2, external_reference_not_loaded: 1}, unexpanded_container_instances: 1};
  assert.equal(hasPartialExtraction(extraction), true);
  const messages = drawingExtractionMessages(extraction);
  assert.ok(messages.some(message => message.includes('Entidades representadas parcialmente: tramas: 2')));
  assert.ok(messages.some(message => message.includes('Degradados no representados')));
  assert.ok(messages.some(message => message.includes('entidades internas desconocidas')));
  assert.ok(messages.every(message => !message.includes('%') && !message.includes('gradient_fill')));
});

test('approximated curves are distinct from source straight segments and font substitution', () => {
  const messages = drawingRepresentationMessages({approximated_entity_counts: {ARC: 12, TEXT: 4}, rendered_text_elements: 4,
    rendering_limitations: ['Technical implementation wording']});
  assert.equal(messages.length, 3);
  assert.match(messages[0], /arcos: 12/);
  assert.doesNotMatch(messages[0], /textos: 4/);
  assert.match(messages[0], /no son segmentos rectos originales/);
  assert.match(messages[1], /fuente sustituta/);
  assert.match(messages[2], /vistas 3D/);
  assert.equal(drawingRepresentationMessages(undefined).length, 0);
});
