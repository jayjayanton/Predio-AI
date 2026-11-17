export const SELECTION_KEY = 'predioai-selection-v1';
export const SELECTION_LIMIT = 4;

const numeric = value => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : null;
};

// Retain public comparison attributes only. Uploaded documents and owner data
// are deliberately never included in a locally saved selection.
export function selectionRecord(parcel, savedAt = new Date().toISOString()) {
  if (!parcel || !/^\d{1,25}$/.test(String(parcel.n_predio || ''))) return null;
  return {
    n_predio: String(parcel.n_predio),
    clave_cata: String(parcel.clave_cata || ''),
    parroquia: String(parcel.parroquia || ''),
    tipo_propi: String(parcel.tipo_propi || ''),
    zonificaci: String(parcel.zonificaci || ''),
    area_terre: numeric(parcel.area_terre),
    area_ter_1: numeric(parcel.area_ter_1),
    area_const: numeric(parcel.area_const),
    frente: numeric(parcel.frente),
    savedAt: Number.isNaN(Date.parse(savedAt)) ? new Date().toISOString() : savedAt,
  };
}

export function parseSelection(raw) {
  try {
    const records = JSON.parse(raw);
    if (!Array.isArray(records)) return [];
    const seen = new Set();
    return records.map(item => selectionRecord(item, item?.savedAt)).filter(item => {
      if (!item || seen.has(item.n_predio)) return false;
      seen.add(item.n_predio);
      return true;
    }).slice(0, SELECTION_LIMIT);
  } catch { return []; }
}

export function selectionCSV(records) {
  const rows = [
    ['Predio', 'Clave catastral', 'Parroquia', 'Regimen de propiedad', 'Suelo registrado', 'Area lote / lote matriz m2', 'Area atribuida PH m2', 'Construccion m2', 'Frente m', 'Guardado el', 'Fuente'],
    ...records.map(p => [p.n_predio, p.clave_cata, p.parroquia, p.tipo_propi, p.zonificaci, p.area_terre, p.tipo_propi.trim().toUpperCase() === 'PROPIEDAD HORIZONTAL' ? p.area_ter_1 : null, p.area_const, p.frente, p.savedAt, 'Catastro municipal de Quito, atributos 2024']),
  ];
  const escape = value => {
    const raw = String(value ?? '');
    const safe = /^[=+@\-\t\r\n]/.test(raw) ? "'" + raw : raw;
    return '"' + safe.replace(/"/g, '""') + '"';
  };
  return '\uFEFF' + rows.map(row => row.map(escape).join(',')).join('\r\n');
}
