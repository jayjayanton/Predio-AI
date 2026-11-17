// Inspection requirements describe this pilot's workflow, not municipal permits.
export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;

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
  const label = role === 'irm' ? 'El IRM' : 'El plano';
  if (file.size === 0) return `${label} está vacío. Selecciona otro archivo.`;
  if (file.size > MAX_DOCUMENT_BYTES) return `${label} supera el límite de 15 MB. Selecciona un archivo más pequeño.`;
  const supported = role === 'irm' ? /\.pdf$/i : /\.(pdf|dxf|dwg)$/i;
  if (!supported.test(file.name)) return role === 'irm'
    ? 'Selecciona el IRM en formato PDF.'
    : 'Selecciona un plano en formato PDF, DXF o DWG.';
  return '';
}
