import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceForPage, requiresIrm, documentValidationError, MAX_DOCUMENT_BYTES, MAX_PACKAGE_BYTES, isProjectPackage, inspectionTimeoutMs, createInspectionForm } from '../src/documentWorkflow.js';

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
  assert.match(documentValidationError({name: 'plano.skp', size: 200}), /PDF, DXF o DWG/);
  assert.match(documentValidationError({name: 'plano.dxf', size: 200}, 'irm'), /PDF/);
  assert.match(documentValidationError({name: 'plano.dwg', size: 200}, 'irm'), /PDF/);
  assert.equal(documentValidationError({name: 'Plano.PDF', size: MAX_DOCUMENT_BYTES}), '');
  assert.equal(documentValidationError({name: 'Plano.DXF', size: 200}), '');
  assert.equal(documentValidationError({name: 'Plano.DWG', size: MAX_DOCUMENT_BYTES}), '');
  assert.match(documentValidationError({name: 'plano.dwg', size: MAX_DOCUMENT_BYTES + 1}), /15 MB/);
  assert.equal(documentValidationError(null), '');
});

test('ZIP packages have a separate 30 MiB upload limit and cannot replace the IRM PDF', () => {
  assert.equal(documentValidationError({ name: 'Proyecto.ZIP', size: MAX_PACKAGE_BYTES }), '');
  assert.match(documentValidationError({ name: 'proyecto.zip', size: MAX_PACKAGE_BYTES + 1 }), /paquete ZIP.*30 MB/);
  assert.match(documentValidationError({ name: 'proyecto.zip', size: 0 }), /paquete ZIP.*vacío/);
  assert.match(documentValidationError({ name: 'proyecto.zip', size: 200 }, 'irm'), /IRM en formato PDF/);
  assert.match(documentValidationError({ name: 'plano.dxf', size: MAX_DOCUMENT_BYTES + 1 }), /15 MB/);
  assert.equal(isProjectPackage({ name: 'planos.ZIP' }), true);
  assert.equal(isProjectPackage({ name: 'planos.zip.dwg' }), false);
  assert.equal(isProjectPackage(null), false);
});

test('a selected package entry preserves its exact path alongside the usual project fields', () => {
  const archive = new File(['zip fixture'], 'Proyecto.zip');
  const irm = new File(['pdf fixture'], 'IRM.pdf');
  const fields = {
    blueprint: archive, irm, buildingType: 'house', workType: 'remodel',
    activities: ['replace_floor', 'change_layout'], predioNumber: 1234,
    packageEntry: 'Plantas/Piso 2/plano.DWG',
  };
  const form = createInspectionForm(fields);
  assert.equal(form.get('blueprint'), archive);
  assert.equal(form.get('irm'), irm);
  assert.equal(form.get('building_type'), 'house');
  assert.equal(form.get('work_type'), 'remodel');
  assert.deepEqual(form.getAll('activities'), ['replace_floor', 'change_layout']);
  assert.equal(form.get('predio_number'), '1234');
  assert.equal(form.get('package_entry'), 'Plantas/Piso 2/plano.DWG');

  const initial = createInspectionForm({ ...fields, packageEntry: null, irm: null, predioNumber: null });
  assert.equal(initial.has('package_entry'), false);
  assert.equal(initial.has('irm'), false);
  assert.equal(initial.has('predio_number'), false);
  const drawing = createInspectionForm({ ...fields, blueprint: new File(['dxf fixture'], 'plano.dxf') });
  assert.equal(drawing.has('package_entry'), false);
});

test('ZIP and DWG requests allow conversion time without changing PDF and DXF timeouts', () => {
  assert.equal(inspectionTimeoutMs({ name: 'proyecto.ZIP' }), 120000);
  assert.equal(inspectionTimeoutMs({ name: 'plano.dwg' }), 120000);
  assert.equal(inspectionTimeoutMs({ name: 'plano.dxf' }), 90000);
  assert.equal(inspectionTimeoutMs({ name: 'plano.pdf' }), 90000);
});
