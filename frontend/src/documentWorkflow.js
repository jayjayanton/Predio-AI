// Inspection requirements describe this pilot's workflow, not municipal permits.
export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
export const MAX_PACKAGE_BYTES = 30 * 1024 * 1024;

export function isProjectPackage(file) {
  return /\.zip$/i.test(file?.name || '');
}

export function inspectionTimeoutMs(file) {
  return /\.(dwg|zip)$/i.test(file?.name || '') ? 120000 : 90000;
}

export function createInspectionForm({ blueprint, irm, buildingType, workType, activities, predioNumber, packageEntry, reviewScope = 'drawing_study' }) {
  const form = new FormData();
  form.append('blueprint', blueprint);
  if (irm) form.append('irm', irm);
  form.append('building_type', buildingType);
  form.append('work_type', workType);
  // Visual studies remain available before an IRM exists. Regulatory checks
  // have their own evidence gates and are never enabled by this scope.
  form.append('review_scope', reviewScope);
  activities.forEach(activity => form.append('activities', activity));
  if (predioNumber) form.append('predio_number', String(predioNumber));
  // Entry paths come from the server's inventory; preserve the full relative path.
  if (isProjectPackage(blueprint) && typeof packageEntry === 'string' && packageEntry) {
    form.append('package_entry', packageEntry);
  }
  return form;
}

export function workspaceForPage(page) {
  if (page === 'blueprints') return { audience: 'remodeler', step: 'project' };
  if (page === 'explore') return { audience: 'explorer', step: 'property' };
  return { audience: 'developer', step: 'property' };
}

export function requiresIrm(workType, activities) {
  if (workType === 'remodel') {
    return !(activities.length === 1 && activities[0] === 'replace_floor');
  }
  return ['structural', 'expansion'].includes(workType);
}

export function documentValidationError(file, role = 'blueprint') {
  if (!file) return '';
  const isPackage = role !== 'irm' && isProjectPackage(file);
  const label = role === 'irm' ? 'El IRM' : isPackage ? 'El paquete ZIP' : 'El plano';
  if (file.size === 0) return `${label} está vacío. Selecciona otro archivo.`;
  if (file.size > (isPackage ? MAX_PACKAGE_BYTES : MAX_DOCUMENT_BYTES)) return `${label} supera el límite de ${isPackage ? 30 : 15} MB. Selecciona un archivo más pequeño.`;
  const supported = role === 'irm' ? /\.pdf$/i : /\.(pdf|dxf|dwg|zip)$/i;
  if (!supported.test(file.name)) return role === 'irm'
    ? 'Selecciona el IRM en formato PDF.'
    : 'Selecciona un plano en formato PDF, DXF o DWG, o un paquete ZIP.';
  return '';
}
