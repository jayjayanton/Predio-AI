import {shapeDrawingRing} from './scaledPlanning.js';

// Preview calculations use the same local metres as the analysis service. The
// parcel and edges have already been projected and inverse-rotated by it; no
// longitude/latitude or screen pixel is ever interpreted as a metric distance.
const DISTANCE_TOLERANCE = 1e-6;
const AREA_TOLERANCE = 1e-6;
const COMPUTATION_TOLERANCE = 1e-9;
const MAX_SHAPE_EDGES = 512;
const MAX_PARCEL_EDGES = 4096;
const MAX_PAIR_TESTS = 400000;
const contextCache = new WeakMap();
const finite = value => typeof value === 'number' && Number.isFinite(value);
const point = value => Array.isArray(value) && value.length === 2 && value.every(finite);
const samePoint = (a, b) => a[0] === b[0] && a[1] === b[1];
const interpolate = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const bounds = points => points.reduce((box, p) => [Math.min(box[0], p[0]), Math.min(box[1], p[1]), Math.max(box[2], p[0]), Math.max(box[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
const boxesOverlap = (a, b) => a[0] <= b[2] + COMPUTATION_TOLERANCE && b[0] <= a[2] + COMPUTATION_TOLERANCE
  && a[1] <= b[3] + COMPUTATION_TOLERANCE && b[1] <= a[3] + COMPUTATION_TOLERANCE;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}

/** Proposed shapes deliberately do not change the reviewed spatial reference. */
export function setbackSourceKey(snapshot) {
  if (!snapshot) return '';
  return JSON.stringify(stable({source: snapshot.source, scale: snapshot.scale, origin: snapshot.origin,
    footprint: snapshot.footprint, footprintDeclaration: snapshot.footprintDeclaration,
    coordinateSpace: snapshot.coordinateSpace, axisMapping: snapshot.axisMapping}));
}

/** Counted COS areas/height and proposal edits are separate from setback review. */
export function setbackContextKey({snapshot, request, contextKey = ''} = {}) {
  if (!snapshot || !request) return '';
  return JSON.stringify(stable({source: setbackSourceKey(snapshot), contextKey,
    footprint: request.footprint, parcel: request.parcel, placement: request.placement,
    irm: request.irm, edges: request.edges,
    ground_floor_confirmed: request.proposal?.ground_floor_confirmed,
    existing_footprint_complete: request.proposal?.existing_footprint_complete}));
}

function signedArea(points) {
  const origin = points[0];
  return points.reduce((total, p, i) => {
    const next = points[(i + 1) % points.length];
    return total + (p[0] - origin[0]) * (next[1] - origin[1]) - (next[0] - origin[0]) * (p[1] - origin[1]);
  }, 0) / 2;
}

function orientation(a, b, c) {
  const first = (b[0] - a[0]) * (c[1] - a[1]), second = (b[1] - a[1]) * (c[0] - a[0]);
  const value = first - second;
  return Math.abs(value) <= (Math.abs(first) + Math.abs(second)) * Number.EPSILON * 8 ? 0 : Math.sign(value);
}

function pointSegmentDistance(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

// Parameters along AB where it meets CD, including collinear endpoints. Splitting
// here detects a concave-boundary excursion even when every vertex is inside.
function intersectionParameters(a, b, c, d) {
  if (!boxesOverlap(bounds([a, b]), bounds([c, d]))) return [];
  const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1];
  const denominator = rx * sy - ry * sx;
  const error = (Math.abs(rx * sy) + Math.abs(ry * sx)) * Number.EPSILON * 8;
  if (Math.abs(denominator) <= error) {
    if (orientation(a, b, c) || orientation(a, b, d)) return [];
    const lengthSquared = rx * rx + ry * ry;
    if (!lengthSquared) return [];
    return [c, d].map(p => ((p[0] - a[0]) * rx + (p[1] - a[1]) * ry) / lengthSquared)
      .filter(t => t >= 0 && t <= 1);
  }
  const qx = c[0] - a[0], qy = c[1] - a[1];
  const t = (qx * sy - qy * sx) / denominator, u = (qx * ry - qy * rx) / denominator;
  const parameterTolerance = Number.EPSILON * 64;
  return t >= -parameterTolerance && t <= 1 + parameterTolerance && u >= -parameterTolerance && u <= 1 + parameterTolerance
    ? [Math.max(0, Math.min(1, t))] : [];
}

function parseGeometry(geometry, maximumEdges, checkCrossings = false) {
  const coordinates = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : null;
  if (!Array.isArray(coordinates) || !coordinates.length) return null;
  let edgeCount = 0;
  const parts = [];
  for (const rings of coordinates) {
    if (!Array.isArray(rings) || !rings.length) return null;
    const parsedRings = [];
    for (const source of rings) {
      if (!Array.isArray(source) || source.length < 4 || !source.every(point) || !samePoint(source[0], source.at(-1))) return null;
      const points = source.slice(0, -1).filter((p, i) => !i || !samePoint(p, source[i - 1]));
      if (points.length < 3 || points.some(p => p.some(value => Math.abs(value) > 100000))) return null;
      edgeCount += points.length;
      if (edgeCount > maximumEdges) return null;
      const area = Math.abs(signedArea(points));
      if (!finite(area) || area <= Number.EPSILON) return null;
      const segments = points.map((p, i) => [p, points[(i + 1) % points.length]]);
      if (checkCrossings) {
        for (let i = 0; i < segments.length; i++) for (let j = i + 2; j < segments.length; j++) {
          if (i === 0 && j === segments.length - 1) continue;
          if (intersectionParameters(...segments[i], ...segments[j]).length) return null;
        }
      }
      parsedRings.push({points, segments, bounds: bounds(points), area});
    }
    const area = parsedRings[0].area - parsedRings.slice(1).reduce((sum, ring) => sum + ring.area, 0);
    if (area <= 0) return null;
    parts.push({rings: parsedRings, area});
  }
  return {parts, edgeCount, segments: parts.flatMap(part => part.rings.flatMap(ring => ring.segments)),
    area: parts.reduce((sum, part) => sum + part.area, 0)};
}

// -1 outside, 0 on the boundary, 1 in the filled area (not in a hole).
function ringLocation(p, ring) {
  if (p[0] < ring.bounds[0] - COMPUTATION_TOLERANCE || p[0] > ring.bounds[2] + COMPUTATION_TOLERANCE
      || p[1] < ring.bounds[1] - COMPUTATION_TOLERANCE || p[1] > ring.bounds[3] + COMPUTATION_TOLERANCE) return -1;
  let inside = false;
  for (const [a, b] of ring.segments) {
    if (pointSegmentDistance(p, a, b) <= COMPUTATION_TOLERANCE) return 0;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < a[0] + (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1])) inside = !inside;
  }
  return inside ? 1 : -1;
}

function geometryLocation(p, geometry) {
  let boundary = false;
  for (const part of geometry.parts) {
    const outer = ringLocation(p, part.rings[0]);
    if (outer === -1) continue;
    if (outer === 0) {boundary = true; continue;}
    let inHole = false, onHole = false;
    for (const hole of part.rings.slice(1)) {
      const location = ringLocation(p, hole);
      if (location === 1) {inHole = true; break;}
      if (location === 0) onHole = true;
    }
    if (!inHole && !onHole) return 1;
    if (!inHole && onHole) boundary = true;
  }
  return boundary ? 0 : -1;
}

function triangleContains(p, a, b, c) {
  return orientation(a, b, p) >= 0 && orientation(b, c, p) >= 0 && orientation(c, a, p) >= 0;
}

function triangulate(ring) {
  if (ring.triangles !== undefined) return ring.triangles;
  let points = signedArea(ring.points) < 0 ? [...ring.points].reverse() : [...ring.points];
  // Removing a collinear intermediate point affects only calculation, never
  // the stored drawing or exported geometry.
  let simplified = true;
  while (simplified && points.length > 3) {
    simplified = false;
    for (let i = 0; i < points.length; i++) {
      if (orientation(points[(i + points.length - 1) % points.length], points[i], points[(i + 1) % points.length]) === 0) {
        points.splice(i, 1); simplified = true; break;
      }
    }
  }
  if (points.length > 1024) {ring.triangles = null; return null;}
  const triangles = [];
  let comparisons = 0;
  while (points.length > 3) {
    let found = false;
    for (let i = 0; i < points.length; i++) {
      const previous = (i + points.length - 1) % points.length, next = (i + 1) % points.length;
      const a = points[previous], b = points[i], c = points[next];
      if (orientation(a, b, c) <= 0) continue;
      let occupied = false;
      for (let index = 0; index < points.length; index++) {
        if (++comparisons > MAX_PAIR_TESTS) {ring.triangles = null; return null;}
        if (index !== previous && index !== i && index !== next && triangleContains(points[index], a, b, c)) {occupied = true; break;}
      }
      if (occupied) continue;
      triangles.push([a, b, c]); points.splice(i, 1); found = true; break;
    }
    if (!found) {ring.triangles = null; return null;}
  }
  if (orientation(...points) <= 0) {ring.triangles = null; return null;}
  triangles.push(points);
  ring.triangles = triangles;
  return triangles;
}

function triangleIntersectionArea(subject, clip) {
  let output = subject;
  for (let i = 0; i < 3 && output.length; i++) {
    const a = clip[i], b = clip[(i + 1) % 3], input = output;
    output = [];
    let previous = input.at(-1), previousSide = cross(a, b, previous);
    for (const current of input) {
      const currentSide = cross(a, b, current), currentInside = currentSide >= 0, previousInside = previousSide >= 0;
      if (currentInside !== previousInside) output.push(interpolate(previous, current, previousSide / (previousSide - currentSide)));
      if (currentInside) output.push(current);
      previous = current; previousSide = currentSide;
    }
  }
  return output.length >= 3 ? Math.abs(signedArea(output)) : 0;
}

function trianglesFor(geometry) {
  const output = [];
  for (const part of geometry.parts) for (let i = 0; i < part.rings.length; i++) {
    const triangles = triangulate(part.rings[i]);
    if (!triangles) return null;
    output.push(...triangles.map(points => ({points, sign: i === 0 ? 1 : -1, bounds: bounds(points)})));
  }
  return output;
}

function outsideArea(shape, parcel) {
  const a = trianglesFor(shape), b = trianglesFor(parcel);
  if (!a || !b || a.length * b.length > MAX_PAIR_TESTS) return null;
  let insideArea = 0;
  for (const first of a) for (const second of b) {
    if (boxesOverlap(first.bounds, second.bounds)) insideArea += first.sign * second.sign * triangleIntersectionArea(first.points, second.points);
  }
  const value = shape.area - insideArea;
  if (!finite(value) || value < -AREA_TOLERANCE || value > shape.area + AREA_TOLERANCE) return null;
  return Math.max(0, Math.min(shape.area, value));
}

function containment(shape, parcel) {
  if (shape.edgeCount * parcel.edgeCount > MAX_PAIR_TESTS) return {status: 'pending', reason: 'complex_geometry'};
  let possibleOutside = false;
  let locationWork = 0;
  for (const [a, b] of shape.segments) {
    const cuts = [0, 1];
    for (const [c, d] of parcel.segments) cuts.push(...intersectionParameters(a, b, c, d));
    cuts.sort((x, y) => x - y);
    locationWork += (cuts.length + 2) * parcel.edgeCount;
    if (locationWork > MAX_PAIR_TESTS) return {status: 'pending', reason: 'complex_geometry'};
    if (geometryLocation(a, parcel) === -1 || geometryLocation(b, parcel) === -1) {possibleOutside = true; break;}
    for (let i = 1; i < cuts.length; i++) {
      if (cuts[i] > cuts[i - 1] && geometryLocation(interpolate(a, b, (cuts[i] + cuts[i - 1]) / 2), parcel) === -1) {possibleOutside = true; break;}
    }
    if (possibleOutside) break;
  }
  if (!possibleOutside) {
    // A proposal can enclose a parcel hole without crossing its boundary.
    for (const part of parcel.parts) for (const hole of part.rings.slice(1)) {
      const triangles = triangulate(hole);
      if (!triangles) return {status: 'pending', reason: 'complex_geometry'};
      const sample = triangles[0].reduce((p, next) => [p[0] + next[0] / 3, p[1] + next[1] / 3], [0, 0]);
      if (geometryLocation(sample, shape) === 1) possibleOutside = true;
    }
  }
  if (!possibleOutside) return {status: 'within_reviewed_limits', outside_parcel_m2: 0};
  const outside = outsideArea(shape, parcel);
  return outside === null ? {status: 'pending', reason: 'complex_geometry'}
    : {status: outside > AREA_TOLERANCE ? 'conflict' : 'within_reviewed_limits', outside_parcel_m2: outside};
}

function distanceToGeometry(a, b, geometry) {
  if (geometryLocation(a, geometry) >= 0 || geometryLocation(b, geometry) >= 0) return 0;
  let minimum = Infinity;
  for (const [c, d] of geometry.segments) {
    if (intersectionParameters(a, b, c, d).length) return 0;
    minimum = Math.min(minimum, pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
  }
  return minimum;
}

function preparedContext(context) {
  // Contexts are immutable server response objects in the React state. Caching
  // the projected parcel avoids reparsing it for every pointer movement.
  if (contextCache.has(context)) return contextCache.get(context);
  const parcel = parseGeometry(context.parcel, MAX_PARCEL_EDGES);
  if (!parcel) {contextCache.set(context, null); return null;}
  const edges = Array.isArray(context.edges) ? context.edges : [];
  const rawParts = context.parcel?.type === 'Polygon' ? [context.parcel.coordinates] : context.parcel?.coordinates || [];
  const validEdges = edges.every(edge => edge && Number.isInteger(edge.polygon) && edge.polygon >= 0 && edge.ring === 0
    && Number.isInteger(edge.edge) && edge.edge >= 0 && ['front', 'side', 'rear'].includes(edge.kind)
    && (edge.required_m === null || finite(edge.required_m) && edge.required_m >= 0)
    && Array.isArray(edge.points) && edge.points.length === 2 && edge.points.every(point)
    && edge.points.every((p, i) => {
      const expected = rawParts[edge.polygon]?.[0]?.[edge.edge + i];
      return point(expected) && Math.hypot(p[0] - expected[0], p[1] - expected[1]) <= COMPUTATION_TOLERANCE;
    }));
  const expected = new Set(rawParts.flatMap((rings, index) => (rings[0] || []).slice(0, -1).map((_, edge) => `${index}:0:${edge}`)));
  const provided = new Set(edges.map(edge => `${edge?.polygon}:${edge?.ring}:${edge?.edge}`));
  const complete = expected.size > 0 && expected.size === provided.size && provided.size === edges.length
    && [...expected].every(id => provided.has(id)) && edges.every(edge => finite(edge?.required_m))
    && rawParts.every(rings => rings.length === 1);
  const value = parcel && validEdges ? {parcel, edges, complete} : null;
  contextCache.set(context, value);
  return value;
}

/** Evaluate one committed or transient proposal independently of the existing building. */
export function evaluateSetbackGeometry(geometry, context, metadata = {}) {
  const base = {id: metadata.id || '', role: metadata.role || 'extension', label: metadata.label || '',
    status: 'pending', containment_status: 'pending', setback_edges: [], complete: false,
    pending_reasons: [...(Array.isArray(context?.pending_reasons) ? context.pending_reasons : [])]};
  if (base.role === 'furniture') return {...base, status: 'not_applicable', containment_status: 'not_applicable', pending_reasons: []};
  if (!context || context.version !== 1 || context.coordinate_space !== 'local_metres' || context.ready !== true) {
    return {...base, pending_reasons: base.pending_reasons.length ? base.pending_reasons : ['review_required']};
  }
  const prepared = preparedContext(context), shape = parseGeometry(geometry, MAX_SHAPE_EDGES, true);
  if (!prepared || !shape || shape.edgeCount * prepared.edges.length > MAX_PAIR_TESTS) {
    return {...base, pending_reasons: [...new Set([...base.pending_reasons, 'geometry_unavailable'])]};
  }
  const tolerance = DISTANCE_TOLERANCE;
  const contained = containment(shape, prepared.parcel);
  const setback_edges = prepared.edges.map(edge => {
    const actual = distanceToGeometry(...edge.points, shape), required = edge.required_m;
    const status = !finite(required) ? 'pending' : actual + tolerance < required ? 'conflict'
      : Math.abs(actual - required) <= tolerance ? 'at_limit' : 'within_reviewed_limits';
    const {points, ...identity} = edge;
    return {...identity, actual_m: actual, shortfall_m: !finite(required) ? null : status === 'conflict' ? required - actual : 0, status};
  });
  const pending_reasons = [...new Set([...base.pending_reasons, ...(contained.reason ? [contained.reason] : [])])];
  const complete = context.complete === true && prepared.complete && contained.status !== 'pending' && setback_edges.length > 0
    && setback_edges.every(edge => edge.status !== 'pending');
  const status = contained.status === 'conflict' || setback_edges.some(edge => edge.status === 'conflict') ? 'conflict'
    : !complete ? 'pending' : setback_edges.some(edge => edge.status === 'at_limit') ? 'at_limit' : 'within_reviewed_limits';
  return {...base, status, containment_status: contained.status, setback_edges, complete, pending_reasons,
    ...(finite(contained.outside_parcel_m2) ? {outside_parcel_m2: contained.outside_parcel_m2} : {})};
}

/** Convert the CAD's Y-down coordinates exactly as createPlanningSnapshot does. */
export function evaluatePlanningShape(shape, {origin = [0, 0], metresPerUnit} = {}, context) {
  const ring = point(origin) ? shapeDrawingRing(shape, metresPerUnit) : null;
  const geometry = ring ? {type: 'Polygon', coordinates: [ring.map(([x, y]) => [(x - origin[0]) * metresPerUnit, -(y - origin[1]) * metresPerUnit])]} : null;
  return evaluateSetbackGeometry(geometry, context, {id: shape?.id, role: shape?.role, label: shape?.label});
}
