import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceForPage, requiresIrm, documentValidationError, MAX_DOCUMENT_BYTES } from '../src/documentWorkflow.js';

test('direct plan entry opens document inspection without a cadastral prerequisite', () => {
  assert.deepEqual(workspaceForPage('blueprints'), { audience: 'remodeler', step: 'project' });
  assert.deepEqual(workspaceForPage('property'), { audience: 'developer', step: 'property' });
  assert.deepEqual(workspaceForPage('explore'), { audience: 'explorer', step: 'property' });
});

test('only an isolated floor-finish task bypasses the remodeling IRM prerequisite', () => {
  assert.equal(requiresIrm('maintenance', ['paint_walls']), false);
  assert.equal(requiresIrm('remodel', ['replace_floor']), false);
  assert.equal(requiresIrm('remodel', ['replace_floor', 'change_layout']), true);
  assert.equal(requiresIrm('remodel', ['remodel_bathroom']), true);
  assert.equal(requiresIrm('remodel', []), true);
  assert.equal(requiresIrm('structural', ['modify_structural_wall']), true);
  assert.equal(requiresIrm('expansion', ['expand_room']), true);
});

test('uploads reject empty, oversized and unsupported documents before sending', () => {
  assert.match(documentValidationError({name: 'plano.pdf', size: 0}), /vacío/);
  assert.match(documentValidationError({name: 'plano.pdf', size: MAX_DOCUMENT_BYTES + 1}), /15 MB/);
  assert.match(documentValidationError({name: 'plano.dwg', size: 200}), /DWG/);
  assert.match(documentValidationError({name: 'plano.dxf', size: 200}, 'irm'), /PDF/);
  assert.equal(documentValidationError({name: 'Plano.PDF', size: MAX_DOCUMENT_BYTES}), '');
  assert.equal(documentValidationError({name: 'Plano.DXF', size: 200}), '');
  assert.equal(documentValidationError(null), '');
});
