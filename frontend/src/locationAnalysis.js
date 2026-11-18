// Geographic evidence stays separate from CAD display coordinates and from
// user-declared reference points. Nothing here moves or georeferences a drawing.
export function parseCoordinateInput(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value ?? '').trim();
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(text)) return null;
  const number = Number(text.replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

export function normalizeSourceCrs(value) {
  const text = String(value ?? '').trim().toUpperCase();
  if (text === 'SIRES-DMQ' || text === 'ESRI:103985') return text;
  const match = /^(?:EPSG:)?([1-9]\d{2,5})$/.exec(text);
  return match ? `EPSG:${match[1]}` : null;
}

export function validGeographic(value) {
  return value && value.crs === 'EPSG:4326' &&
    typeof value.latitude === 'number' && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90 &&
    typeof value.longitude === 'number' && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180
    ? value : null;
}

export function formatLocationNumber(value, digits = 6) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('es-EC', {minimumFractionDigits: 0, maximumFractionDigits: digits, useGrouping: false}) : '—';
}

export function coordinateCopyText(point) {
  return validGeographic(point) ? `${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}` : '';
}

export function locationMapUrl(point) {
  if (!validGeographic(point)) return null;
  const lat = point.latitude.toFixed(6), lon = point.longitude.toFixed(6);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}`;
}

export function effectiveLocation(document, reference) {
  if (!document) return null;
  const extracted = validGeographic(document?.location?.geographic);
  if (extracted) return {point: extracted, source: 'document'};
  const declared = validGeographic(reference?.geographic);
  return declared ? {point: declared, source: 'user_reference'} : null;
}

export function distanceBetweenLocations(a, b) {
  if (!validGeographic(a) || !validGeographic(b)) return null;
  const radians = degrees => degrees * Math.PI / 180;
  const dLat = radians(b.latitude - a.latitude), dLon = radians(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(Math.min(1, Math.max(0, h))), Math.sqrt(Math.max(0, 1 - h)));
}

export function predioCandidates(document) {
  const values = (document?.location?.candidates || [])
    .filter(candidate => candidate.kind === 'predio')
    .map(candidate => String(candidate.value ?? '').trim());
  const extracted = document?.candidate_irm_fields?.predio?.raw;
  if (extracted != null) values.push(String(extracted).trim());
  return [...new Set(values.filter(value => /^\d{1,25}$/.test(value)))];
}

export function comparePredioEvidence(blueprint, irm, selectedPredio) {
  const drawing = predioCandidates(blueprint), report = predioCandidates(irm);
  const selected = /^\d{1,25}$/.test(String(selectedPredio ?? '').trim()) ? String(selectedPredio).trim() : '';
  const groups = [drawing, report, selected ? [selected] : []].filter(group => group.length);
  const unique = new Set(groups.flat());
  if (unique.size > 1) return {status: 'mismatch', text: 'Los números de predio disponibles no coinciden. Revisa los identificadores extraídos y la propiedad seleccionada antes de relacionar los documentos.'};
  if (drawing.length && report.length) return {status: 'match', text: 'El plano y el IRM contienen el mismo número de predio. La coincidencia es documental y todavía requiere revisión.'};
  if (report.length && selected) return {status: 'partial', text: 'El número extraído del IRM coincide con el predio seleccionado. El plano todavía no aporta un número que confirme esa relación.'};
  if (drawing.length && selected) return {status: 'partial', text: 'El número extraído del plano coincide con el predio seleccionado. Falta contrastarlo con el IRM.'};
  return {status: 'pending', text: 'La relación entre el plano y el IRM está pendiente de confirmar. Un nombre de archivo o un punto cercano no identifica por sí solo el predio.'};
}

export function validateReferenceDraft(draft) {
  const x = parseCoordinateInput(draft.x), y = parseCoordinateInput(draft.y);
  if (x === null || y === null) return {error: 'Introduce las dos coordenadas como números decimales. Puedes usar punto o coma decimal.'};
  if (draft.mode === 'geographic' && (Math.abs(y) > 90 || Math.abs(x) > 180)) return {error: 'La latitud debe estar entre −90 y 90 y la longitud entre −180 y 180.'};
  const sourceCrs = draft.mode === 'geographic' ? 'EPSG:4326' : normalizeSourceCrs(draft.crs);
  if (!sourceCrs) return {error: 'Indica el código EPSG del sistema de origen o SIRES-DMQ si esa referencia consta en el documento.'};
  const label = String(draft.label ?? '').trim();
  if (label.length < 3 || label.length > 160) return {error: 'Describe la fuente de la referencia en 3 a 160 caracteres, por ejemplo un levantamiento o el IRM.'};
  return {x, y, source_crs: sourceCrs, label};
}
