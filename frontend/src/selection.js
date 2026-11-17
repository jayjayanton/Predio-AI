export const SELECTION_KEY = 'predioai-selection-v1';
export const SELECTION_LIMIT = 100;
export const COMPARISON_LIMIT = 4;

const numeric = value => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : null;
};

// Deliberately persist only cadastral comparison fields and non-sensitive
// workflow metadata. The imported PDF and extracted raw text stay ephemeral.
export function selectionRecord(parcel, savedAt = new Date().toISOString()) {
  if (!parcel || !/^\d{1,25}$/.test(String(parcel.n_predio || ''))) return null;
  const source = parcel.source === 'pdf' ? 'pdf' : 'catastro';
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
    source,
    irmReview: parcel.irmReview === 'manual_reviewed' ? 'manual_reviewed' : 'pending',
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

export function mergeSelection(existing, additions) {
  const saved = parseSelection(JSON.stringify(existing));
  const seen = new Set(saved.map(p => p.n_predio));
  const result = [...saved];
  let duplicates = 0;
  let rejected = 0;
  let full = 0;
  for (const candidate of additions) {
    const record = selectionRecord(candidate);
    if (!record) { rejected++; continue; }
    if (seen.has(record.n_predio)) { duplicates++; continue; }
    if (result.length >= SELECTION_LIMIT) { full++; continue; }
    result.push(record);
    seen.add(record.n_predio);
  }
  return { records: result, added: result.length - saved.length, duplicates, rejected, full };
}

export function selectionCSV(records) {
  const rows = [
    ['Predio', 'Clave catastral', 'Parroquia', 'Regimen de propiedad', 'Suelo registrado', 'Area lote / lote matriz m2', 'Area atribuida PH m2', 'Construccion m2', 'Frente m', 'Guardado el', 'Fuente', 'Estado IRM manual'],
    ...records.map(p => [p.n_predio, p.clave_cata, p.parroquia, p.tipo_propi, p.zonificaci, p.area_terre, p.tipo_propi.trim().toUpperCase() === 'PROPIEDAD HORIZONTAL' ? p.area_ter_1 : null, p.area_const, p.frente, p.savedAt, p.source === 'pdf' ? 'PDF importado; sin verificación municipal' : 'Catastro municipal de Quito, atributos 2024', p.irmReview === 'manual_reviewed' ? 'Marcado revisado por usuario' : 'Pendiente']),
  ];
  const escape = value => {
    const raw = String(value ?? '');
    const safe = /^[=+@\-\t\r\n]/.test(raw) ? "'" + raw : raw;
    return '"' + safe.replace(/"/g, '""') + '"';
  };
  return '\uFEFF' + rows.map(row => row.map(escape).join(',')).join('\r\n');
}
