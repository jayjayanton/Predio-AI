import {getExteriorContour, measureSelection, pointInExteriorContour} from './drawingMeasurements.js';

// All editable dimensions are metres. Shape centres alone use the imported
// drawing's display coordinates (Y down); zoom is never a unit conversion.
export const PLANNING_LIMITS = Object.freeze({maxShapes: 60, maxHistory: 40, maxVertices: 128, minDimension: 0.01, maxDimension: 200, maxFootprintSpan: 5000});
export const SHAPE_PRESETS = Object.freeze({
  table: {kind: 'rectangle', label: 'Mesa', role: 'furniture', widthMetres: 1.6, depthMetres: 0.9},
  circle: {kind: 'circle', label: 'Círculo', role: 'furniture', widthMetres: 1, depthMetres: 1},
  extension: {kind: 'rectangle', label: 'Ampliación', role: 'extension', widthMetres: 3, depthMetres: 4},
});
const finitePoint = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const positive = n => typeof n === 'number' && Number.isFinite(n) && n > 0;
const zero = value => Object.is(value, -0) ? 0 : value;
const validDimension = value => positive(value) && value >= PLANNING_LIMITS.minDimension && value <= PLANNING_LIMITS.maxDimension;
const boundsOf = points => points.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
const cornersOf = bounds => [[bounds[0], bounds[1]], [bounds[2], bounds[1]], [bounds[2], bounds[3]], [bounds[0], bounds[3]]];
const samePoint = (a, b) => a[0] === b[0] && a[1] === b[1];
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
  if (!shape || !['circle', 'rectangle', 'polygon'].includes(shape.kind) || !['furniture', 'extension'].includes(shape.role)
      || !finitePoint(shape.center) || !validDimension(shape.widthMetres) || !validDimension(shape.depthMetres)
      || !Number.isFinite(shape.rotationDegrees) || typeof shape.id !== 'string' || typeof shape.label !== 'string') return false;
  if (shape.kind === 'circle') return shape.widthMetres === shape.depthMetres;
  if (shape.kind !== 'polygon') return true;
  const points = shape.verticesMetres;
  if (!Array.isArray(points) || points.length < 3 || points.length > PLANNING_LIMITS.maxVertices || points.some(p => !finitePoint(p))
      || samePoint(points[0], points.at(-1))) return false;
  const bounds = boundsOf(points);
  const closeEnough = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, a, b);
  if (!closeEnough(bounds[2] - bounds[0], shape.widthMetres) || !closeEnough(bounds[3] - bounds[1], shape.depthMetres)) return false;
  // Reuse the source measurement engine's crossing, overlap and degeneracy
  // guards. A drawn outline gets no silent snapping or topology repair.
  const measured = measureSelection([{id: shape.id, kind: 'polyline', closed: true, points}], {metresPerUnit: 1, maxAreaSegments: PLANNING_LIMITS.maxVertices});
  return positive(measured.metric?.area);
}
export function createPlanningShape(preset, id, center) {
  if (!SHAPE_PRESETS[preset] || !finitePoint(center)) return null;
  const shape = {...SHAPE_PRESETS[preset], id, center: [...center], rotationDegrees: 0};
  return validPlanningShape(shape) ? shape : null;
}

const angleFor = shape => {
  const angle = normalizeRotation(shape.rotationDegrees) * Math.PI / 180;
  return [Math.cos(angle), Math.sin(angle)];
};
function localToDrawing(shape, point, metresPerUnit) {
  const [c, s] = angleFor(shape);
  return [shape.center[0] + (point[0] * c - point[1] * s) / metresPerUnit,
    shape.center[1] + (point[0] * s + point[1] * c) / metresPerUnit];
}
function drawingToLocal(shape, point, metresPerUnit) {
  const [c, s] = angleFor(shape);
  const x = (point[0] - shape.center[0]) * metresPerUnit, y = (point[1] - shape.center[1]) * metresPerUnit;
  return [zero(x * c + y * s), zero(-x * s + y * c)];
}
function polygonWithVertices(shape, vertices) {
  if (!Array.isArray(vertices) || vertices.length < 3 || vertices.length > PLANNING_LIMITS.maxVertices || vertices.some(p => !finitePoint(p))) return null;
  const bounds = boundsOf(vertices);
  // Retain the transform origin when editing corners: every other world point
  // must stay put. The local bounding box need not remain centred on [0, 0].
  const candidate = {...shape, verticesMetres: vertices.map(p => p.map(zero)), widthMetres: bounds[2] - bounds[0], depthMetres: bounds[3] - bounds[1]};
  return validPlanningShape(candidate) ? candidate : null;
}

/** Create a figure from a drag in source drawing coordinates, never pixels. */
export function createDrawnPlanningShape(kind, id, start, end, metresPerUnit, options = {}) {
  if (!['rectangle', 'square', 'circle'].includes(kind) || !finitePoint(start) || !finitePoint(end) || !positive(metresPerUnit)) return null;
  let dx = end[0] - start[0], dy = end[1] - start[1];
  if (kind === 'square' || kind === 'circle' || options.preserveAspect) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx < 0 ? -1 : 1) * side; dy = (dy < 0 ? -1 : 1) * side;
  }
  const shape = {kind: kind === 'circle' ? 'circle' : 'rectangle', id,
    label: options.label || {rectangle: 'Rectángulo', square: 'Cuadrado', circle: 'Círculo'}[kind], role: options.role || 'furniture',
    center: [start[0] + dx / 2, start[1] + dy / 2], widthMetres: Math.abs(dx) * metresPerUnit, depthMetres: Math.abs(dy) * metresPerUnit, rotationDegrees: 0};
  return validPlanningShape(shape) ? shape : null;
}

/** Clicked vertices become an editable, simple polygon with a local metric origin. */
export function createPolygonPlanningShape(id, worldPoints, metresPerUnit, options = {}) {
  if (!positive(metresPerUnit) || !Array.isArray(worldPoints) || worldPoints.some(p => !finitePoint(p))) return null;
  const points = worldPoints.map(p => [...p]);
  if (points.length > 1 && samePoint(points[0], points.at(-1))) points.pop();
  if (points.length < 3 || points.length > PLANNING_LIMITS.maxVertices) return null;
  const bounds = boundsOf(points);
  const center = [bounds[0] + (bounds[2] - bounds[0]) / 2, bounds[1] + (bounds[3] - bounds[1]) / 2];
  const verticesMetres = points.map(([x, y]) => [(x - center[0]) * metresPerUnit, (y - center[1]) * metresPerUnit]);
  return polygonWithVertices({kind: 'polygon', id, label: options.label || (points.length === 3 ? 'Triángulo' : 'Polígono'), role: options.role || 'furniture', center, rotationDegrees: 0}, verticesMetres);
}

/** Immutable numeric edits; changing a polygon's dimensions scales its vertices. */
export function updatePlanningShape(shape, patch) {
  if (!validPlanningShape(shape) || !patch || typeof patch !== 'object') return null;
  const candidate = {...shape, ...patch};
  if (finitePoint(candidate.center)) candidate.center = [...candidate.center];
  if (candidate.kind === 'polygon') {
    const vertices = candidate.verticesMetres;
    if (!Array.isArray(vertices) || vertices.length < 3 || vertices.length > PLANNING_LIMITS.maxVertices || vertices.some(p => !finitePoint(p))) return null;
    const bounds = boundsOf(vertices), width = bounds[2] - bounds[0], depth = bounds[3] - bounds[1];
    const targetWidth = Object.hasOwn(patch, 'widthMetres') ? patch.widthMetres : width;
    const targetDepth = Object.hasOwn(patch, 'depthMetres') ? patch.depthMetres : depth;
    if (!validDimension(targetWidth) || !validDimension(targetDepth) || !positive(width) || !positive(depth)) return null;
    if (targetWidth === width && targetDepth === depth) return polygonWithVertices(candidate, vertices);
    const cx = bounds[0] + width / 2, cy = bounds[1] + depth / 2;
    return polygonWithVertices(candidate, vertices.map(([x, y]) => [cx + (x - cx) * targetWidth / width, cy + (y - cy) * targetDepth / depth]));
  }
  if (candidate.kind === 'circle') {
    if (Object.hasOwn(patch, 'widthMetres') && !Object.hasOwn(patch, 'depthMetres')) candidate.depthMetres = patch.widthMetres;
    if (Object.hasOwn(patch, 'depthMetres') && !Object.hasOwn(patch, 'widthMetres')) candidate.widthMetres = patch.depthMetres;
  }
  return validPlanningShape(candidate) ? candidate : null;
}

export function planningShapeMetrics(shape) {
  if (!validPlanningShape(shape)) return {areaM2: null, perimeterM: null};
  if (shape.kind === 'circle') return {areaM2: Math.PI * (shape.widthMetres / 2) ** 2, perimeterM: Math.PI * shape.widthMetres};
  if (shape.kind === 'rectangle') return {areaM2: shape.widthMetres * shape.depthMetres, perimeterM: 2 * (shape.widthMetres + shape.depthMetres)};
  return {areaM2: Math.abs(signedArea(shape.verticesMetres)),
    perimeterM: shape.verticesMetres.reduce((sum, p, i, points) => sum + Math.hypot(p[0] - points[(i + 1) % points.length][0], p[1] - points[(i + 1) % points.length][1]), 0)};
}

/** Handles are source coordinates, so their screen radius can stay independent of zoom. */
export function planningEditHandles(shape, metresPerUnit, mode = 'vertices') {
  if (!validPlanningShape(shape) || !positive(metresPerUnit)) return [];
  const handle = (kind, index, point) => ({id: `${kind}-${index}`, kind, index, point: localToDrawing(shape, point, metresPerUnit)});
  if (shape.kind === 'circle') {
    const r = shape.widthMetres / 2;
    return [[r, 0], [0, r], [-r, 0], [0, -r]].map((point, i) => handle('resize', i, point));
  }
  if (shape.kind === 'polygon' && mode !== 'resize') {
    const handles = shape.verticesMetres.map((point, i) => handle('vertex', i, point));
    if (shape.verticesMetres.length < PLANNING_LIMITS.maxVertices) {
      shape.verticesMetres.forEach((point, i, points) => {
        const next = points[(i + 1) % points.length];
        handles.push(handle('insert', i, [(point[0] + next[0]) / 2, (point[1] + next[1]) / 2]));
      });
    }
    return handles;
  }
  const bounds = shape.kind === 'polygon' ? boundsOf(shape.verticesMetres) : [-shape.widthMetres / 2, -shape.depthMetres / 2, shape.widthMetres / 2, shape.depthMetres / 2];
  return cornersOf(bounds).map((point, i) => handle('resize', i, point));
}

export function insertPlanningVertex(shape, edgeIndex) {
  if (!validPlanningShape(shape) || shape.kind !== 'polygon' || !Number.isInteger(edgeIndex)
      || edgeIndex < 0 || edgeIndex >= shape.verticesMetres.length || shape.verticesMetres.length >= PLANNING_LIMITS.maxVertices) return null;
  const vertices = shape.verticesMetres.map(p => [...p]), a = vertices[edgeIndex], b = vertices[(edgeIndex + 1) % vertices.length];
  vertices.splice(edgeIndex + 1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  return polygonWithVertices(shape, vertices);
}
export function removePlanningVertex(shape, index) {
  if (!validPlanningShape(shape) || shape.kind !== 'polygon' || shape.verticesMetres.length <= 3
      || !Number.isInteger(index) || index < 0 || index >= shape.verticesMetres.length) return null;
  return polygonWithVertices(shape, shape.verticesMetres.filter((_, i) => i !== index));
}

export function resizePlanningShape(shape, handle, worldPoint, metresPerUnit, {preserveAspect = false} = {}) {
  if (!validPlanningShape(shape) || !positive(metresPerUnit) || !finitePoint(worldPoint) || !handle || !Number.isInteger(handle.index)) return null;
  const point = drawingToLocal(shape, worldPoint, metresPerUnit);
  if (shape.kind === 'polygon' && ['vertex', 'insert'].includes(handle.kind)) {
    const base = handle.kind === 'insert' ? insertPlanningVertex(shape, handle.index) : shape;
    const index = handle.index + (handle.kind === 'insert' ? 1 : 0);
    if (!base || index < 0 || index >= base.verticesMetres.length) return null;
    return polygonWithVertices(base, base.verticesMetres.map((p, i) => i === index ? point : [...p]));
  }
  if (handle.kind !== 'resize' || handle.index < 0 || handle.index > 3) return null;
  if (shape.kind === 'circle') {
    const diameter = 2 * Math.hypot(...point);
    return updatePlanningShape(shape, {widthMetres: diameter, depthMetres: diameter});
  }
  const bounds = shape.kind === 'polygon' ? boundsOf(shape.verticesMetres) : [-shape.widthMetres / 2, -shape.depthMetres / 2, shape.widthMetres / 2, shape.depthMetres / 2];
  const corners = cornersOf(bounds), original = corners[handle.index], opposite = corners[(handle.index + 2) % 4];
  let dx = point[0] - opposite[0], dy = point[1] - opposite[1];
  if (preserveAspect) {
    const factor = Math.max(Math.abs(dx) / shape.widthMetres, Math.abs(dy) / shape.depthMetres);
    dx = (dx < 0 ? -1 : 1) * shape.widthMetres * factor; dy = (dy < 0 ? -1 : 1) * shape.depthMetres * factor;
  }
  if (!validDimension(Math.abs(dx)) || !validDimension(Math.abs(dy))) return null;
  if (shape.kind === 'polygon') {
    const sx = dx / (original[0] - opposite[0]), sy = dy / (original[1] - opposite[1]);
    return polygonWithVertices(shape, shape.verticesMetres.map(([x, y]) => [opposite[0] + (x - opposite[0]) * sx, opposite[1] + (y - opposite[1]) * sy]));
  }
  const center = localToDrawing(shape, [opposite[0] + dx / 2, opposite[1] + dy / 2], metresPerUnit);
  return updatePlanningShape(shape, {center, widthMetres: Math.abs(dx), depthMetres: Math.abs(dy)});
}

export function shapeDrawingRing(shape, metresPerUnit, circleSegments = 96) {
  if (!validPlanningShape(shape) || !positive(metresPerUnit)) return null;
  const width = shape.widthMetres / metresPerUnit, depth = shape.depthMetres / metresPerUnit;
  if (!Number.isFinite(width) || !Number.isFinite(depth)) return null;
  const [c, s] = angleFor(shape);
  const segmentCount = Math.max(24, Math.min(192, Number.isFinite(circleSegments) ? Math.round(circleSegments) : 96));
  const points = shape.kind === 'circle'
    ? Array.from({length: segmentCount}, (_, i) => [Math.cos(i * 2 * Math.PI / segmentCount) * width / 2, Math.sin(i * 2 * Math.PI / segmentCount) * width / 2])
    : shape.kind === 'polygon' ? shape.verticesMetres.map(([x, y]) => [x / metresPerUnit, y / metresPerUnit])
      : [[-width / 2, -depth / 2], [width / 2, -depth / 2], [width / 2, depth / 2], [-width / 2, depth / 2]];
  const ring = close(points.map(([x, y]) => [shape.center[0] + x * c - y * s, shape.center[1] + x * s + y * c]));
  return ring.every(finitePoint) ? ring : null;
}
export function shapeBounds(shape, metresPerUnit) {
  const ring = shapeDrawingRing(shape, metresPerUnit);
  if (!ring) return null;
  return boundsOf(ring);
}
const distanceToSegment = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], length2 = dx * dx + dy * dy;
  const t = length2 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
function polygonContains(points, point, tolerance) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if (distanceToSegment(point, a, b) <= tolerance) return true;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
export function hitPlanningShape(shapes, point, metresPerUnit, tolerance = 0) {
  if (!positive(metresPerUnit) || !finitePoint(point)) return null;
  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i];
    if (!validPlanningShape(shape)) continue;
    const dx = point[0] - shape.center[0], dy = point[1] - shape.center[1];
    if (shape.kind === 'circle') {
      if (Math.hypot(dx, dy) <= shape.widthMetres / metresPerUnit / 2 + tolerance) return shape;
    } else if (shape.kind === 'polygon') {
      if (polygonContains(shape.verticesMetres, drawingToLocal(shape, point, metresPerUnit), Math.max(0, tolerance) * metresPerUnit)) return shape;
    } else {
      const [c, s] = angleFor(shape);
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
      const ring = shapeDrawingRing(shape, scale.metresPerUnit).map(([x, y]) => [zero((x - origin[0]) * scale.metresPerUnit), zero(-(y - origin[1]) * scale.metresPerUnit)]);
      // Users may trace a polygon in either direction. GeoJSON exteriors use
      // counterclockwise winding after the CAD display's Y axis is reflected.
      if (signedArea(ring) < 0) ring.reverse();
      return {id: shape.id, label: shape.label, role: shape.role, kind: shape.kind,
        geometry: {type: 'Polygon', coordinates: [ring]},
        dimensions: {widthMetres: shape.widthMetres, depthMetres: shape.depthMetres, rotationDegrees: shape.rotationDegrees,
          ...(shape.kind === 'circle' ? {diameterMetres: shape.widthMetres, circleSegments: 96} : {}),
          ...(shape.kind === 'polygon' ? {vertexCount: shape.verticesMetres.length} : {})}};
    })};
}

export function paintPlanningOverlay(context, transform, shapes, metresPerUnit, selectedId, footprint = null, showShapes = true, shapeChecks = {}) {
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
    const status = extension ? shapeChecks[shape.id]?.status : null;
    const conflict = status === 'conflict', atLimit = status === 'at_limit';
    const stroke = conflict ? '#b53535' : atLimit ? '#a56b16' : extension ? '#ae6728' : '#246c5c';
    context.save(); context.beginPath(); context.moveTo(...ring[0]); ring.slice(1).forEach(p => context.lineTo(...p)); context.closePath();
    context.fillStyle = conflict ? '#d64b4b40' : atLimit ? '#e3ad403d' : extension ? '#d78a3e30' : '#287c6a2c'; context.fill();
    context.strokeStyle = stroke; context.lineWidth = (active || conflict ? 2.8 : 1.8) / transform.scale;
    if (extension) context.setLineDash([7 / transform.scale, 4 / transform.scale]); context.stroke(); context.setLineDash([]);
    if (active) {
      context.beginPath(); context.arc(shape.center[0], shape.center[1], 4.5 / transform.scale, 0, Math.PI * 2); context.fillStyle = '#fff'; context.fill(); context.stroke();
    }
    const bounds = shapeBounds(shape, metresPerUnit);
    const screenWidth = (bounds[2] - bounds[0]) * transform.scale;
    if (active || screenWidth > 70) {
      const format = n => n.toLocaleString('es-EC', {maximumFractionDigits: 2});
      const dimensions = shape.kind === 'circle' ? `Ø ${format(shape.widthMetres)} m`
        : shape.kind === 'polygon' ? `${format(planningShapeMetrics(shape).areaM2)} m² · ${shape.verticesMetres.length} vértices`
          : `${format(shape.widthMetres)} × ${format(shape.depthMetres)} m`;
      const text = `${conflict ? '⚠ Conflicto · ' : atLimit ? 'En el límite · ' : ''}${shape.label} · ${dimensions}`;
      context.font = `${11 / transform.scale}px Arial, sans-serif`; context.textAlign = 'center'; context.textBaseline = 'bottom';
      const x = shape.center[0], y = bounds[1] - 8 / transform.scale, width = context.measureText(text).width;
      context.fillStyle = '#ffffffed'; context.fillRect(x - width / 2 - 5 / transform.scale, y - 14 / transform.scale, width + 10 / transform.scale, 17 / transform.scale);
      context.fillStyle = conflict || atLimit ? stroke : extension ? '#8b521e' : '#1c5549'; context.fillText(text, x, y);
    }
    context.restore();
  }
}
