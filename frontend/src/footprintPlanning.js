import { parseCoordinateInput, predioCandidates } from './locationAnalysis.js';

export const PLANNING_FIELDS = [
  {key: 'area_terreno', label: 'Área de terreno del IRM', unit: 'm²', min: 0.01, max: 100000000},
  {key: 'cos_pb', label: 'COS en planta baja', unit: '%', min: 0, max: 100},
  {key: 'retiro_frontal', label: 'Retiro frontal', unit: 'm', min: 0, max: 1000},
  {key: 'retiro_lateral', label: 'Retiro lateral', unit: 'm', min: 0, max: 1000},
  {key: 'retiro_posterior', label: 'Retiro posterior', unit: 'm', min: 0, max: 1000},
  {key: 'cos_total', label: 'COS total', unit: '%', min: 0, max: 10000},
  {key: 'altura', label: 'Altura máxima permitida', unit: 'm', min: 0, max: 1000},
  {key: 'pisos', label: 'Número de pisos permitidos', unit: '', min: 0, max: 200, integer: true},
];

const finite = value => typeof value === 'number' && Number.isFinite(value);
const point = value => Array.isArray(value) && value.length >= 2 && finite(value[0]) && finite(value[1]);
const polygon = value => value?.type === 'Polygon' && Array.isArray(value.coordinates)
  && value.coordinates.length > 0 && value.coordinates.every(ring => Array.isArray(ring) && ring.length >= 4 && ring.every(point));

export function usableFootprint(snapshot) {
  return snapshot?.coordinateSpace === 'local_metres' && polygon(snapshot.footprint)
    && finite(snapshot.scale?.metresPerUnit) && snapshot.scale.metresPerUnit > 0;
}

export function polygonArea(geometry) {
  if (!polygon(geometry)) return null;
  const areas = geometry.coordinates.map(ring => {
    const [ox, oy] = ring[0];
    let area = 0;
    for (let i = 1; i < ring.length; i += 1) {
      area += (ring[i - 1][0] - ox) * (ring[i][1] - oy) - (ring[i][0] - ox) * (ring[i - 1][1] - oy);
    }
    return Math.abs(area) / 2;
  });
  const value = areas[0] - areas.slice(1).reduce((sum, area) => sum + area, 0);
  return finite(value) && value > 0 ? value : null;
}

export function planningBounds(snapshot) {
  const geometries = [snapshot?.footprint, ...(snapshot?.shapes || []).map(shape => shape.geometry)].filter(polygon);
  const points = geometries.flatMap(geometry => geometry.coordinates.flat());
  if (!points.length) return null;
  return [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])),
    Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))];
}

export function localSvgPath(geometry) {
  if (!polygon(geometry)) return '';
  return geometry.coordinates.map(ring => ring.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${-y}`).join(' ') + ' Z').join(' ');
}

export function parcelIdentifier(properties) {
  const value = String(properties?.n_predio ?? properties?.predio ?? '').trim();
  return /^\d{1,25}$/.test(value) ? value : '';
}

export function selectedParcelGeometry(parcel, properties) {
  if (!parcel) return null;
  if (['Polygon', 'MultiPolygon'].includes(parcel.type)) return parcel;
  if (parcel.type === 'Feature') return ['Polygon', 'MultiPolygon'].includes(parcel.geometry?.type) ? parcel.geometry : null;
  if (parcel.type !== 'FeatureCollection' || !Array.isArray(parcel.features)) return null;
  const identifier = parcelIdentifier(properties);
  const features = parcel.features.filter(feature => ['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)
    && (!identifier || parcelIdentifier(feature.properties) === identifier));
  if (features.length === 1) return features[0].geometry;
  // Several features are combined only when they explicitly belong to the same selected predio.
  if (identifier && features.length > 1) return {type: 'MultiPolygon', coordinates: features.flatMap(feature =>
    feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates)};
  return null;
}

export function parcelBounds(geometry) {
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  const points = polygons.flat(2);
  if (!points.length || !points.every(p => point(p) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90)) return null;
  return [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])),
    Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))];
}

export function parcelEdges(geometry) {
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polygons.flatMap((rings, polygonIndex) => (rings[0] || []).slice(0, -1).map((start, edge) => ({
    id: `${polygonIndex}:0:${edge}`, polygon: polygonIndex, ring: 0, edge,
    label: `${polygons.length > 1 ? `Parte ${polygonIndex + 1} · ` : ''}Lado ${edge + 1}`,
    positions: [[start[1], start[0]], [rings[0][edge + 1][1], rings[0][edge + 1][0]]],
  })));
}

export function readCandidateNumber(value) {
  if (finite(value)) return value;
  let text = String(value ?? '').trim();
  // Explicit mixed thousands/decimal notation, as printed in municipal documents.
  if (/^\d{1,3}(?:\.\d{3})+,\d+$/.test(text)) text = text.replaceAll('.', '').replace(',', '.');
  else if (/^\d{1,3}(?:,\d{3})+\.\d+$/.test(text)) text = text.replaceAll(',', '');
  return parseCoordinateInput(text);
}

export function candidateField(irm, key) {
  const item = irm?.candidate_irm_fields?.[key];
  const raw = item?.raw ?? item?.value;
  if (item?.ambiguous || item?.status === 'ambiguous') return {text: '', evidence: 'Varios valores extraídos: revisar el IRM.', page: item?.page ?? null};
  const value = readCandidateNumber(raw);
  return {text: value === null ? '' : String(value), evidence: item?.evidence || item?.source_text || '', page: item?.page ?? null};
}

export function planningIdentity(blueprint, irm, properties) {
  const selected = parcelIdentifier(properties);
  const drawing = predioCandidates(blueprint), report = predioCandidates(irm);
  const identifiers = [...new Set([...drawing, ...report, ...(selected ? [selected] : [])])];
  return {selected, drawing, report, mismatch: identifiers.length > 1,
    ambiguous: drawing.length > 1 || report.length > 1};
}

export function initialPlannerDraft({geometry, properties, irm}) {
  const bounds = parcelBounds(geometry);
  const fields = Object.fromEntries(PLANNING_FIELDS.map(field => [field.key, candidateField(irm, field.key).text]));
  return {
    placement: bounds ? {latitude: String((bounds[1] + bounds[3]) / 2), longitude: String((bounds[0] + bounds[2]) / 2), rotation_degrees: '0', confirmed: false} : null,
    fields, reviewed: false, associationConfirmed: false, fullGroundFootprint: false,
    regime: /horizontal/i.test(String(properties?.tipo_propi || '')) || irm?.planning_evidence?.property_regime === 'horizontal' ? 'horizontal' : 'unknown',
    zone: 'unknown', restrictions: 'unknown', sourceLabel: '', manualIrmPredio: '', edgeKinds: {},
    footprintIsCountedArea: false,
    proposal: {ground_floor_counted_area_m2: '', height_m: '', floors: '', total_floor_area_m2: ''}, activeTab: geometry ? 'placement' : 'footprint',
  };
}

export function plannerContextKey(snapshot, geometry, irm, properties) {
  return JSON.stringify({source: snapshot?.source, scale: snapshot?.scale, origin: snapshot?.origin,
    footprint: snapshot?.footprint, parcel: geometry, selectedPredio: parcelIdentifier(properties),
    irm: irm ? {fields: irm.candidate_irm_fields, evidence: irm.planning_evidence, location: irm.location?.candidates} : null});
}

export function plannerSpatialKey(snapshot, geometry, properties) {
  return plannerContextKey(snapshot, geometry, null, properties);
}

export function preserveSpatialDraft(defaults, previousRecord, spatialContextKey) {
  if (!previousRecord || previousRecord.spatialContextKey !== spatialContextKey) return defaults;
  return {...defaults, placement: previousRecord.draft.placement, edgeKinds: previousRecord.draft.edgeKinds,
    fullGroundFootprint: previousRecord.draft.fullGroundFootprint, activeTab: previousRecord.draft.activeTab,
    documentChanged: true};
}

export function extensionGeometryKey(snapshot) {
  return JSON.stringify((snapshot?.shapes || []).filter(shape => shape.role === 'extension')
    .map(shape => ({id: String(shape.id), geometry: shape.geometry})).sort((a, b) => a.id.localeCompare(b.id)));
}

export function invalidateCountedAreas(draft) {
  return {...draft, footprintIsCountedArea: false, proposalChanged: true,
    proposal: {...draft.proposal, ground_floor_counted_area_m2: '', total_floor_area_m2: ''}};
}

export function buildPlanningRequest({snapshot, geometry, properties, blueprint, irm, draft}) {
  if (!usableFootprint(snapshot)) return {request: null, error: ''};
  const identity = planningIdentity(blueprint, irm, properties);
  const manualIrmPredio = String(draft.manualIrmPredio || '').trim();
  if (!identity.report.length && manualIrmPredio && !/^\d{1,25}$/.test(manualIrmPredio)) {
    return {request: null, error: 'Introduce el número de predio que consta en el IRM, usando solo dígitos.'};
  }
  const irmPredio = identity.report[0] || manualIrmPredio || null;
  const manualMismatch = Boolean(irmPredio && identity.selected && irmPredio !== identity.selected);
  let placement = null;
  if (geometry && draft.placement) {
    const latitude = parseCoordinateInput(draft.placement.latitude), longitude = parseCoordinateInput(draft.placement.longitude);
    const rotation = parseCoordinateInput(draft.placement.rotation_degrees);
    if (latitude === null || Math.abs(latitude) >= 85 || longitude === null || Math.abs(longitude) > 180 || rotation === null || Math.abs(rotation) > 360) {
      return {request: null, error: 'Revisa la latitud, la longitud y el giro (entre −360° y 360°).'};
    }
    placement = {latitude, longitude, rotation_degrees: rotation, confirmed: Boolean(draft.placement.confirmed)};
  }
  const constraints = {};
  for (const field of PLANNING_FIELDS) {
    const text = String(draft.fields[field.key] ?? '').trim();
    const value = text === '' ? null : parseCoordinateInput(text);
    if (text !== '' && (value === null || value < field.min || value > field.max || (field.integer && !Number.isInteger(value)))) {
      return {request: null, error: `Revisa «${field.label}»: introduce un valor válido o deja el campo vacío.`};
    }
    constraints[field.key] = value;
  }
  const proposal = {ground_floor_confirmed: Boolean(draft.fullGroundFootprint), existing_footprint_complete: Boolean(draft.fullGroundFootprint),
    footprint_is_counted_area: Boolean(draft.footprintIsCountedArea)};
  for (const [key, maximum] of [['ground_floor_counted_area_m2', 100000000], ['height_m', 1000], ['floors', 200], ['total_floor_area_m2', 100000000]]) {
    const text = String(draft.proposal[key] ?? '').trim();
    const value = text === '' ? null : parseCoordinateInput(text);
    if (text !== '' && (value === null || (key === 'ground_floor_counted_area_m2' ? value < 0 : value <= 0) || value > maximum || (key === 'floors' && !Number.isInteger(value)))) {
      return {request: null, error: 'Revisa las áreas computables, la altura o el número de pisos final de la propuesta.'};
    }
    proposal[key] = value;
  }
  if (proposal.footprint_is_counted_area) proposal.ground_floor_counted_area_m2 = null;
  const edges = parcelEdges(geometry).filter(edge => ['front', 'side', 'rear'].includes(draft.edgeKinds[edge.id])).map(edge => ({
    polygon: edge.polygon, ring: edge.ring, edge: edge.edge, kind: draft.edgeKinds[edge.id],
  }));
  return {error: '', request: {
    footprint: snapshot.footprint,
    shapes: (snapshot.shapes || []).map(shape => ({id: String(shape.id), label: String(shape.label || ''), role: shape.role, geometry: shape.geometry})),
    parcel: geometry, placement, proposal, edges,
    irm: {provided: Boolean(irm), reviewed: Boolean(irm && draft.reviewed), association_confirmed: Boolean(irm && draft.associationConfirmed && !identity.mismatch && !manualMismatch),
      selected_predio: identity.selected || null, irm_predio: irmPredio, drawing_predio: identity.drawing[0] || null,
      property_regime: /horizontal/i.test(String(properties?.tipo_propi || '')) || irm?.planning_evidence?.property_regime === 'horizontal' ? 'horizontal' : draft.regime,
      evidence_flags: [...new Set((irm?.planning_evidence?.flags || []).map(flag => flag.kind)
        .filter(kind => ['horizontal_property', 'multiple_parameter_sets', 'special_restrictions'].includes(kind)))],
      single_zone_confirmed: draft.zone === 'single',
      restrictions_reviewed: draft.restrictions !== 'unknown', has_special_restrictions: draft.restrictions === 'unknown' ? null : draft.restrictions === 'special',
      source_label: draft.sourceLabel.trim() || (irm ? 'IRM aportado en esta inspección; campos revisados por el usuario' : ''), constraints},
  }};
}

export function nudgePlacement(placement, east, north) {
  const latitude = parseCoordinateInput(placement?.latitude), longitude = parseCoordinateInput(placement?.longitude);
  if (latitude === null || longitude === null || Math.abs(latitude) >= 85) return null;
  // Small UI steps only; final geometry and all checks use the server's projected metric calculation.
  const dLat = north / 111320, dLon = east / (111320 * Math.cos(latitude * Math.PI / 180));
  return {...placement, latitude: String(latitude + dLat), longitude: String(longitude + dLon), confirmed: false};
}

export function localPlanningExport(snapshot) {
  if (!usableFootprint(snapshot)) return null;
  return {format: 'PredioAI local footprint', version: 1, coordinate_space: 'local_metres', geographic_crs: null,
    axes: 'x right, y up; no geographic orientation established', source: snapshot.source, scale: snapshot.scale,
    drawing_origin: snapshot.origin, footprint: snapshot.footprint, shapes: snapshot.shapes || [],
    verified: false, note: 'Coordenadas locales en metros. Requieren una implantación revisada para ubicarlas geográficamente.'};
}

export function placedPlanningExport(result, snapshot, properties) {
  if (result?.placed?.type !== 'FeatureCollection' || !Array.isArray(result.placed.features)) return null;
  return {...result.placed, properties: {source: snapshot?.source, selected_predio: parcelIdentifier(properties) || null,
    placement_method: 'user_positioned', verified: false, note: 'Implantación propuesta por el usuario; no es un levantamiento ni una validación municipal.'}};
}

export function downloadPlanningJson(value, filename) {
  if (!value) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], {type: 'application/json'}));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
