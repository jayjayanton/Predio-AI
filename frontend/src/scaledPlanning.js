import {getExteriorContour, measureSelection, pointInExteriorContour} from './drawingMeasurements.js';

// All editable dimensions are metres. Shape centres alone use the imported
// drawing's display coordinates (Y down); zoom is never a unit conversion.
export const PLANNING_LIMITS = Object.freeze({maxShapes: 60, maxHistory: 40, minDimension: 0.01, maxDimension: 200, maxFootprintSpan: 5000});
export const SHAPE_PRESETS = Object.freeze({
  table: {kind: 'rectangle', label: 'Mesa', role: 'furniture', widthMetres: 1.6, depthMetres: 0.9},
  circle: {kind: 'circle', label: 'Círculo', role: 'furniture', widthMetres: 1, depthMetres: 1},
  extension: {kind: 'rectangle', label: 'Ampliación', role: 'extension', widthMetres: 3, depthMetres: 4},
});
const finitePoint = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const positive = n => typeof n === 'number' && Number.isFinite(n) && n > 0;
const zero = value => Object.is(value, -0) ? 0 : value;
const close = points => {
  const ring = points.map(p => p.slice(0, 2));
  if (ring.length && (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1])) ring.push([...ring[0]]);
  return ring;
};
const signedArea = ring => {
  const origin = ring[0];
  return ring.reduce((sum, p, index) => {
    const q = ring[(index + 1) % ring.length];
    return sum + (p[0] - origin[0]) * (q[1] - origin[1]) - (q[0] - origin[0]) * (p[1] - origin[1]);
  }, 0) / 2;
};
export const normalizeRotation = value => ((value % 360) + 360) % 360;
export function parseDimension(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+(?:[.,]\d+)?$/.test(text)) return null;
  const n = Number(text.replace(',', '.'));
  return Number.isFinite(n) && n >= PLANNING_LIMITS.minDimension && n <= PLANNING_LIMITS.maxDimension ? n : null;
}
export function validPlanningShape(shape) {
  return shape && ['circle', 'rectangle'].includes(shape.kind) && ['furniture', 'extension'].includes(shape.role)
    && finitePoint(shape.center) && positive(shape.widthMetres) && positive(shape.depthMetres)
    && shape.widthMetres >= PLANNING_LIMITS.minDimension && shape.depthMetres >= PLANNING_LIMITS.minDimension
    && shape.widthMetres <= PLANNING_LIMITS.maxDimension && shape.depthMetres <= PLANNING_LIMITS.maxDimension
    && Number.isFinite(shape.rotationDegrees) && typeof shape.id === 'string' && typeof shape.label === 'string'
    && (shape.kind !== 'circle' || shape.widthMetres === shape.depthMetres);
}
export function createPlanningShape(preset, id, center) {
  if (!SHAPE_PRESETS[preset] || !finitePoint(center)) return null;
  return {...SHAPE_PRESETS[preset], id, center: [...center], rotationDegrees: 0};
}
export function shapeDrawingRing(shape, metresPerUnit, circleSegments = 96) {
  if (!validPlanningShape(shape) || !positive(metresPerUnit)) return null;
  const width = shape.widthMetres / metresPerUnit, depth = shape.depthMetres / metresPerUnit;
  if (!Number.isFinite(width) || !Number.isFinite(depth)) return null;
  const angle = shape.rotationDegrees * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  const segmentCount = Math.max(24, Math.min(192, Number.isFinite(circleSegments) ? Math.round(circleSegments) : 96));
  const points = shape.kind === 'circle'
    ? Array.from({length: segmentCount}, (_, i) => [Math.cos(i * 2 * Math.PI / segmentCount) * width / 2, Math.sin(i * 2 * Math.PI / segmentCount) * width / 2])
    : [[-width / 2, -depth / 2], [width / 2, -depth / 2], [width / 2, depth / 2], [-width / 2, depth / 2]];
  return close(points.map(([x, y]) => [shape.center[0] + x * c - y * s, shape.center[1] + x * s + y * c]));
}
export function shapeBounds(shape, metresPerUnit) {
  const ring = shapeDrawingRing(shape, metresPerUnit);
  if (!ring) return null;
  return ring.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
}
export function hitPlanningShape(shapes, point, metresPerUnit, tolerance = 0) {
  if (!positive(metresPerUnit) || !finitePoint(point)) return null;
  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i];
    if (!validPlanningShape(shape)) continue;
    const dx = point[0] - shape.center[0], dy = point[1] - shape.center[1];
    if (shape.kind === 'circle') {
      if (Math.hypot(dx, dy) <= shape.widthMetres / metresPerUnit / 2 + tolerance) return shape;
    } else {
      const angle = shape.rotationDegrees * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
      if (Math.abs(dx * c + dy * s) <= shape.widthMetres / metresPerUnit / 2 + tolerance
          && Math.abs(-dx * s + dy * c) <= shape.depthMetres / metresPerUnit / 2 + tolerance) return shape;
    }
  }
  return null;
}
export const createDesignHistory = present => ({past: [], present: present || {shapes: [], footprint: null}, future: []});
export function commitDesign(history, present) {
  if (JSON.stringify(history.present) === JSON.stringify(present)) return history;
  return {past: [...history.past, history.present].slice(-PLANNING_LIMITS.maxHistory), present, future: []};
}
export function undoDesign(history) {
  return history.past.length ? {past: history.past.slice(0, -1), present: history.past.at(-1), future: [history.present, ...history.future]} : history;
}
export function redoDesign(history) {
  return history.future.length ? {past: [...history.past, history.present], present: history.future[0], future: history.future.slice(1)} : history;
}

/** A declared ground footprint, not automatic semantic building extraction. */
export function extractPlanningFootprint(element, metresPerUnit) {
  if (!positive(metresPerUnit)) return {ok: false, reason: 'scale_required'};
  const exterior = getExteriorContour(element);
  if (!exterior.available) return {ok: false, reason: exterior.reason};
  const measurement = measureSelection([element], {metresPerUnit});
  if (!positive(measurement.metric?.area)) return {ok: false, reason: measurement.areaReason || 'invalid_geometry'};
  const paths = (element.rings?.length ? element.rings : [element.points]).map(close);
  paths.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
  // Nested islands need MultiPolygon topology. Do not silently turn an island
  // into another hole or discard source rings when emitting a Polygon.
  for (let i = 1; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) {
    const contour = {available: true, element: {points: paths[i]}};
    if (pointInExteriorContour(contour, paths[j][0])) return {ok: false, reason: 'nested_islands'};
  }
  const bounds = paths[0].reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
  if (Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]) * metresPerUnit > PLANNING_LIMITS.maxFootprintSpan) return {ok: false, reason: 'size_range'};
  const origin = [bounds[0] + (bounds[2] - bounds[0]) / 2, bounds[1] + (bounds[3] - bounds[1]) / 2];
  const coordinates = paths.map((ring, index) => {
    const metric = ring.map(([x, y]) => [zero((x - origin[0]) * metresPerUnit), zero(-(y - origin[1]) * metresPerUnit)]);
    return (signedArea(metric) > 0) === (index === 0) ? metric : metric.reverse();
  });
  return {ok: true, origin, geometry: {type: 'Polygon', coordinates}, drawingRings: paths,
    entityId: element.source_id || element.id, layer: element.layer || 'Sin capa',
    areaM2: measurement.metric.area, holes: paths.length - 1, approximate: Boolean(element.approximation),
    metresPerUnit, declaration: 'user_selected_ground_footprint'};
}
export function createPlanningSnapshot({footprint, shapes, scale, source}) {
  if (!positive(scale?.metresPerUnit)) return null;
  const activeFootprint = footprint?.ok && footprint.metresPerUnit === scale.metresPerUnit ? footprint : null;
  const origin = activeFootprint?.origin || [0, 0];
  return {source: {...source, entityId: activeFootprint?.entityId || null, approximate: activeFootprint?.approximate || false},
    scale: {metresPerUnit: scale.metresPerUnit, method: scale.method, ...(scale.unit ? {unit: scale.unit} : {})},
    origin, originCoordinateSpace: 'imported_display_units', coordinateSpace: 'local_metres', axisMapping: 'x_right_y_up',
    footprint: activeFootprint?.geometry || null, footprintAreaM2: activeFootprint?.areaM2 ?? null,
    footprintDeclaration: activeFootprint?.declaration || null,
    shapes: shapes.filter(validPlanningShape).map(shape => {
      const ring = shapeDrawingRing(shape, scale.metresPerUnit).map(([x, y]) => [zero((x - origin[0]) * scale.metresPerUnit), zero(-(y - origin[1]) * scale.metresPerUnit)]).reverse();
      return {id: shape.id, label: shape.label, role: shape.role, kind: shape.kind,
        geometry: {type: 'Polygon', coordinates: [ring]},
        dimensions: {widthMetres: shape.widthMetres, depthMetres: shape.depthMetres, rotationDegrees: shape.rotationDegrees,
          ...(shape.kind === 'circle' ? {diameterMetres: shape.widthMetres, circleSegments: 96} : {})}};
    })};
}

export function paintPlanningOverlay(context, transform, shapes, metresPerUnit, selectedId, footprint = null, showShapes = true) {
  if (!positive(metresPerUnit)) return;
  if (footprint?.ok && footprint.metresPerUnit === metresPerUnit) {
    context.save(); context.beginPath();
    for (const ring of footprint.drawingRings) { context.moveTo(...ring[0]); ring.slice(1).forEach(p => context.lineTo(...p)); context.closePath(); }
    context.fillStyle = '#436fbd13'; context.fill('evenodd'); context.strokeStyle = '#416eb2';
    context.lineWidth = 2 / transform.scale; context.setLineDash([7 / transform.scale, 4 / transform.scale]); context.stroke(); context.restore();
  }
  if (!showShapes) return;
  for (const shape of shapes) {
    const ring = shapeDrawingRing(shape, metresPerUnit); if (!ring) continue;
    const active = shape.id === selectedId, extension = shape.role === 'extension';
    context.save(); context.beginPath(); context.moveTo(...ring[0]); ring.slice(1).forEach(p => context.lineTo(...p)); context.closePath();
    context.fillStyle = extension ? '#d78a3e30' : '#287c6a2c'; context.fill();
    context.strokeStyle = extension ? '#ae6728' : '#246c5c'; context.lineWidth = (active ? 2.8 : 1.8) / transform.scale;
    if (extension) context.setLineDash([7 / transform.scale, 4 / transform.scale]); context.stroke(); context.setLineDash([]);
    if (active) {
      context.beginPath(); context.arc(shape.center[0], shape.center[1], 4.5 / transform.scale, 0, Math.PI * 2); context.fillStyle = '#fff'; context.fill(); context.stroke();
    }
    const bounds = shapeBounds(shape, metresPerUnit);
    const screenWidth = (bounds[2] - bounds[0]) * transform.scale;
    if (active || screenWidth > 70) {
      const format = n => n.toLocaleString('es-EC', {maximumFractionDigits: 2});
      const text = `${shape.label} · ${shape.kind === 'circle' ? `Ø ${format(shape.widthMetres)} m` : `${format(shape.widthMetres)} × ${format(shape.depthMetres)} m`}`;
      context.font = `${11 / transform.scale}px Arial, sans-serif`; context.textAlign = 'center'; context.textBaseline = 'bottom';
      const x = shape.center[0], y = bounds[1] - 8 / transform.scale, width = context.measureText(text).width;
      context.fillStyle = '#ffffffed'; context.fillRect(x - width / 2 - 5 / transform.scale, y - 14 / transform.scale, width + 10 / transform.scale, 17 / transform.scale);
      context.fillStyle = extension ? '#8b521e' : '#1c5549'; context.fillText(text, x, y);
    }
    context.restore();
  }
}
