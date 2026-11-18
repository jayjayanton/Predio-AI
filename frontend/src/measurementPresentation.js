// UI parsing and scale scope. Physical units always require a user action.
export function parseKnownMetres(value) {
  const text = String(value ?? '').trim();
  if (!/^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(text)) return null;
  const number = Number(text.replace(',', '.'));
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function canConfirmDrawingUnit(documentFormat, scope) {
  const format = String(documentFormat || '').toLowerCase();
  return ['dwg', 'dxf', 'example'].includes(format)
    && (!scope || scope === 'modelspace' || scope === 'example');
}

export function scaleForView(record, view) {
  return view && record?.view === view && Number.isFinite(record.metresPerUnit) && record.metresPerUnit > 0 ? record : null;
}

export function formatDrawingNumber(value) {
  if (!Number.isFinite(value)) return '—';
  const normalized = Object.is(value, -0) ? 0 : value;
  return new Intl.NumberFormat('es-EC', {
    maximumFractionDigits: 4,
    ...(normalized !== 0 && Math.abs(normalized) < 0.0001 ? {notation: 'scientific'} : {}),
  }).format(normalized);
}
