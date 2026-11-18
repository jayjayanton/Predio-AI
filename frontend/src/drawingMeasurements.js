// Geometric estimates from already transformed source coordinates. Display Y
// reflection preserves lengths and absolute areas; scale still needs confirmation.
export const MAX_AREA_SEGMENTS = 2000;

// INSUNITS codes: Autodesk's official reference:
// https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-LT/files/GUID-A58A87BB-482B-4042-A00A-EEF55A2B4FD8.htm
// Foot/inch and historical survey-foot factors: NIST.
// https://www.nist.gov/pml/us-surveyfoot/revised-unit-conversion-factors
// Astronomical codes18–20 are not offered as building units.
const CAD_UNITS = new Map([
  [1, ['in', 'Pulgadas', 0.0254]], [2, ['ft', 'Pies', 0.3048]],
  [3, ['mi', 'Millas', 1609.344]], [4, ['mm', 'Milímetros', 0.001]],
  [5, ['cm', 'Centímetros', 0.01]], [6, ['m', 'Metros', 1]],
  [7, ['km', 'Kilómetros', 1000]], [8, ['microin', 'Micropulgadas', 2.54e-8]],
  [9, ['mil', 'Milésimas de pulgada', 2.54e-5]], [10, ['yd', 'Yardas', 0.9144]],
  [11, ['angstrom', 'Ángstroms', 1e-10]], [12, ['nm', 'Nanómetros', 1e-9]],
  [13, ['um', 'Micrómetros', 1e-6]], [14, ['dm', 'Decímetros', 0.1]],
  [15, ['dam', 'Decámetros', 10]], [16, ['hm', 'Hectómetros', 100]],
  [17, ['gm', 'Gigámetros', 1e9]], [21, ['us-ft', 'Pies topográficos de EE. UU.', 1200 / 3937]],
  [22, ['us-in', 'Pulgadas topográficas de EE. UU.', 100 / 3937]],
  [23, ['us-yd', 'Yardas topográficas de EE. UU.', 3600 / 3937]],
  [24, ['us-mi', 'Millas topográficas de EE. UU.', 6336000 / 3937]],
]);
export const UNIT_OPTIONS = ['m', 'cm', 'mm', 'in', 'ft', 'yd', 'us-ft'].map(value => {
  const [, label, metresPerUnit] = [...CAD_UNITS.values()].find(unit => unit[0] === value);
  return Object.freeze({value, label, metresPerUnit});
});
export function cadUnitFromCode(code) {
  if (!Number.isInteger(code) || !CAD_UNITS.has(code)) return null;
  const [unit, label, metresPerUnit] = CAD_UNITS.get(code);
  return {code, unit, label, metresPerUnit};
}
export function deriveScaleFromUnit(unitOrCode) {
  if (typeof unitOrCode === 'number') return cadUnitFromCode(unitOrCode)?.metresPerUnit ?? null;
  const unit = [...CAD_UNITS.values()].find(candidate => candidate[0] === unitOrCode);
  return unit ? unit[2] : null;
}

const positiveFinite = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const samePoint = (a, b) => a[0] === b[0] && a[1] === b[1];
const finitePoint = point => Array.isArray(point) && point.length >= 2
  && Number.isFinite(point[0]) && Number.isFinite(point[1]);
const GEOMETRY_KINDS = new Set(['line', 'polyline', 'curve', 'hatch_boundary']);
const TEXT_TYPES = new Set(['TEXT', 'MTEXT', 'ATTRIB', 'ATTDEF']);
const CURVE_TYPES = new Set(['ARC', 'CIRCLE', 'ELLIPSE', 'SPLINE']);

// Compensated sums retain small segments alongside large ones. No edge is
// silently deduplicated or unioned, even if area must be rejected.
class Sum {
  constructor() { this.value = 0; this.correction = 0; }
  add(value) {
    const adjusted = value - this.correction;
    const next = this.value + adjusted;
    this.correction = (next - this.value) - adjusted;
    this.value = next;
  }
}
function exclusionFor(item) {
  if (!item || typeof item !== 'object') return 'invalid';
  if (item.dimension_handle || item.source_type === 'DIMENSION'
      || item.block_path?.some?.(part => String(part).startsWith('DIMENSION#'))) return 'dimension';
  if (item.kind === 'text' || TEXT_TYPES.has(item.source_type)) return 'text';
  if (item.hatch_pattern) return 'hatchPattern';
  return GEOMETRY_KINDS.has(item.kind) ? null : 'unsupported';
}
function collect(elements, segmentLimit) {
  const excluded = {text: 0, dimension: 0, hatchPattern: 0, invalid: 0, unsupported: 0, degenerate: 0};
  const eligible = []; const paths = []; const segments = [];
  const total = new Sum();
  let segmentCount = 0; let approximate = false; let numericalFailure = false;
  for (const item of elements) {
    const excludedAs = exclusionFor(item);
    if (excludedAs) { excluded[excludedAs] += 1; continue; }
    const compound = Array.isArray(item.rings) && item.rings.length > 0;
    const rawPaths = compound ? item.rings : [item.points];
    if (rawPaths.some(path => !Array.isArray(path) || path.length < 2 || path.some(point => !finitePoint(point)))) {
      excluded.invalid += 1; continue;
    }
    const itemLength = new Sum(); const itemSegments = [];
    let itemSegmentCount = 0;
    const pathStart = paths.length;
    const itemPaths = rawPaths.map((points, offset) => ({
      points, closed: compound || item.closed === true, group: pathStart + offset,
    }));
    for (const path of itemPaths) {
      const edges = path.points.length - 1
        + (path.closed && path.points.length > 2 && !samePoint(path.points[0], path.points.at(-1)) ? 1 : 0);
      for (let index = 0; index < edges; index += 1) {
        const a = path.points[index]; const b = path.points[(index + 1) % path.points.length];
        itemLength.add(Math.hypot(b[0] - a[0], b[1] - a[1]));
        itemSegmentCount += 1;
        if (segments.length + itemSegments.length <= segmentLimit) itemSegments.push({a, b, group: path.group});
      }
    }
    if (!Number.isFinite(itemLength.value)) { excluded.invalid += 1; numericalFailure = true; continue; }
    if (itemLength.value <= 0) { excluded.degenerate += 1; continue; }
    const itemApproximate = Boolean(item.approximation) || item.kind === 'curve' || CURVE_TYPES.has(item.source_type);
    eligible.push({item, paths: itemPaths, length: itemLength.value, approximate: itemApproximate, compound});
    // A single imported compound may have many rings. Avoid function-argument
    // limits before the area segment guard can reject its topology workload.
    for (const path of itemPaths) paths.push(path);
    for (const segment of itemSegments) segments.push(segment);
    segmentCount += itemSegmentCount; total.add(itemLength.value); approximate ||= itemApproximate;
  }
  if (!Number.isFinite(total.value)) numericalFailure = true;
  return {excluded, eligible, paths, segments, segmentCount, approximate, numericalFailure,
    length: Number.isFinite(total.value) ? total.value : null};
}
function calibrationEligibility(collection) {
  const {eligible, excluded, numericalFailure} = collection;
  const unavailable = reason => ({eligible: false, reason, referenceElementId: null,
    lengthDrawingUnits: null, approximate: false});
  if (numericalFailure) return unavailable('numerical_range');
  if (excluded.invalid || excluded.unsupported) return unavailable('invalid_geometry');
  if (!eligible.length) return unavailable(excluded.degenerate ? 'degenerate' : 'no_geometry');
  if (eligible.length !== 1 || eligible[0].paths.length !== 1) return unavailable('multiple_paths');
  const candidate = eligible[0];
  return {eligible: true, reason: null, referenceElementId: candidate.item.id ?? candidate.item.source_id ?? null,
    lengthDrawingUnits: candidate.length, approximate: candidate.approximate};
}
function orientation(a, b, c) {
  const ux = b[0] - a[0]; const uy = b[1] - a[1];
  const vx = c[0] - a[0]; const vy = c[1] - a[1];
  const p = ux * vy; const q = uy * vx; const cross = p - q;
  const roundoff = (Math.abs(p) + Math.abs(q)) * Number.EPSILON * 8;
  return Math.abs(cross) <= roundoff ? 0 : cross > 0 ? 1 : -1;
}
const inRange = (v, a, b, t) => v >= Math.min(a, b) - t && v <= Math.max(a, b) + t;
const onSegment = (p, a, b, t) => inRange(p[0], a[0], b[0], t) && inRange(p[1], a[1], b[1], t);
function segmentRelation(first, second, tolerance) {
  const {a, b} = first; const {a: c, b: d} = second;
  if (Math.max(a[0], b[0]) < Math.min(c[0], d[0]) - tolerance
      || Math.max(c[0], d[0]) < Math.min(a[0], b[0]) - tolerance
      || Math.max(a[1], b[1]) < Math.min(c[1], d[1]) - tolerance
      || Math.max(c[1], d[1]) < Math.min(a[1], b[1]) - tolerance) return 'none';
  const o1 = orientation(a, b, c); const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a); const o4 = orientation(c, d, b);
  if (!o1 && !o2 && !o3 && !o4) {
    const axis = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? 0 : 1;
    const low = Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]));
    const high = Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis]));
    return high < low - tolerance ? 'none' : high > low + tolerance ? 'overlap' : 'touch';
  }
  if (o1 * o2 < 0 && o3 * o4 < 0) return 'cross';
  if ((!o1 && onSegment(c, a, b, tolerance)) || (!o2 && onSegment(d, a, b, tolerance))
      || (!o3 && onSegment(a, c, d, tolerance)) || (!o4 && onSegment(b, c, d, tolerance))) return 'touch';
  return 'none';
}
function signedArea(points) {
  // A local origin and span avoid absolute-coordinate cancellation/overflow.
  const [ox, oy] = points[0]; let span = 0;
  for (const [x, y] of points) span = Math.max(span, Math.abs(x - ox), Math.abs(y - oy));
  if (span === 0) return null;
  if (!positiveFinite(span)) return NaN;
  const sum = new Sum(); const magnitudes = new Sum();
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]; const b = points[(i + 1) % points.length];
    const term = ((a[0] - ox) / span) * ((b[1] - oy) / span)
      - ((b[0] - ox) / span) * ((a[1] - oy) / span);
    sum.add(term); magnitudes.add(Math.abs(term));
  }
  if (Math.abs(sum.value) <= Number.EPSILON * 32 * magnitudes.value) return null;
  const result = (sum.value / 2 * span) * span;
  return Number.isFinite(result) && result !== 0 ? result : NaN;
}
function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i]; const b = ring[j];
    if ((a[1] > point[1]) !== (b[1] > point[1])) {
      const crossX = a[0] + (point[1] - a[1]) / (b[1] - a[1]) * (b[0] - a[0]);
      if (point[0] < crossX) inside = !inside;
    }
  }
  return inside;
}
function computeArea(collection, segmentLimit) {
  const unavailable = reason => ({area: null, perimeter: null, reason, mode: null, snapped: false});
  const {eligible, excluded, segments, paths, segmentCount} = collection;
  if (collection.numericalFailure) return unavailable('numerical_range');
  if (excluded.invalid || excluded.unsupported) return unavailable('invalid_geometry');
  if (!eligible.length) return unavailable(excluded.degenerate ? 'degenerate' : 'no_geometry');
  if (excluded.degenerate) return unavailable('degenerate');
  // Lengths have already been scanned O(n). Pairwise work has a fixed cap.
  if (segmentCount > segmentLimit) return unavailable('complexity_limit');
  if (segmentCount < 3) return unavailable('open_path');
  const compound = eligible.length === 1 && eligible[0].compound;
  if (!compound && eligible.some(entry => entry.paths.length > 1)) return unavailable('multiple_contours');
  let maxCoordinate = 0; let minimumLength = Infinity;
  const origin = segments[0].a; let span = 0;
  for (const segment of segments) {
    const length = Math.hypot(segment.b[0] - segment.a[0], segment.b[1] - segment.a[1]);
    if (!positiveFinite(length)) return unavailable('degenerate');
    minimumLength = Math.min(minimumLength, length);
    for (const point of [segment.a, segment.b]) {
      maxCoordinate = Math.max(maxCoordinate, Math.abs(point[0]), Math.abs(point[1]));
      span = Math.max(span, Math.abs(point[0] - origin[0]), Math.abs(point[1] - origin[1]));
    }
  }
  if (!positiveFinite(span)) return unavailable('numerical_range');
  // Only roundoff-sized matches, never drawing-span-based gap closing.
  const tolerance = Math.min(1e-9, minimumLength * 1e-12, maxCoordinate * Number.EPSILON * 8);
  const nodes = []; const exact = new Map(); let snapped = false;
  function nodeFor(point) {
    const key = JSON.stringify(point.slice(0, 2));
    if (exact.has(key)) return exact.get(key);
    if (tolerance > 0) {
      const found = nodes.findIndex(node => Math.abs(node[0] - point[0]) <= tolerance
        && Math.abs(node[1] - point[1]) <= tolerance);
      if (found >= 0) { exact.set(key, found); snapped = true; return found; }
    }
    const index = nodes.length; nodes.push(point); exact.set(key, index); return index;
  }
  const edges = []; const seenEdges = new Set();
  for (const segment of segments) {
    const start = nodeFor(segment.a); const end = nodeFor(segment.b);
    if (start === end) return unavailable('degenerate');
    const key = start < end ? start + ':' + end : end + ':' + start;
    if (seenEdges.has(key)) return unavailable('duplicate_edges');
    seenEdges.add(key); edges.push({...segment, start, end});
  }
  function loopFor(groupEdges) {
    const adjacency = new Map();
    for (const edge of groupEdges) {
      for (const [node, other] of [[edge.start, edge.end], [edge.end, edge.start]]) {
        if (!adjacency.has(node)) adjacency.set(node, []);
        adjacency.get(node).push(other);
      }
    }
    if ([...adjacency.values()].some(n => n.length > 2)) return {reason: 'branching'};
    if ([...adjacency.values()].some(n => n.length !== 2)) return {reason: 'open_path'};
    const start = groupEdges[0].start; const order = [];
    let current = start; let previous = -1;
    do {
      order.push(current);
      const neighbours = adjacency.get(current);
      const next = neighbours[0] === previous ? neighbours[1] : neighbours[0];
      previous = current; current = next;
      if (order.length > groupEdges.length) return {reason: 'branching'};
    } while (current !== start);
    if (order.length !== adjacency.size) return {reason: 'disconnected'};
    return {points: order.map(index => nodes[index])};
  }
  const loops = [];
  if (compound) {
    for (const path of paths) {
      const loop = loopFor(edges.filter(edge => edge.group === path.group));
      if (loop.reason) return unavailable(loop.reason);
      loops.push(loop.points);
    }
  } else {
    const loop = loopFor(edges);
    if (loop.reason) return unavailable(loop.reason === 'disconnected' && paths.filter(p => p.closed).length > 1
      ? 'multiple_contours' : loop.reason);
    loops.push(loop.points);
  }
  const normalized = edges.map(edge => ({...edge,
    a: [(edge.a[0] - origin[0]) / span, (edge.a[1] - origin[1]) / span],
    b: [(edge.b[0] - origin[0]) / span, (edge.b[1] - origin[1]) / span],
  }));
  for (let i = 0; i < normalized.length; i += 1) {
    for (let j = i + 1; j < normalized.length; j += 1) {
      const a = normalized[i]; const b = normalized[j];
      const relation = segmentRelation(a, b, tolerance / span);
      if (relation === 'none') continue;
      const shared = a.start === b.start || a.start === b.end || a.end === b.start || a.end === b.end;
      if (relation === 'touch' && shared && (!compound || a.group === b.group)) continue;
      return unavailable(compound && a.group !== b.group ? 'overlapping_rings' : 'self_intersection');
    }
  }
  const areas = loops.map(signedArea);
  if (areas.some(Number.isNaN)) return unavailable('numerical_range');
  if (areas.some(area => area === null)) return unavailable('degenerate');
  const depths = loops.map((loop, index) => loops.reduce((depth, other, otherIndex) =>
    depth + (index !== otherIndex && pointInRing(loop[0], other) ? 1 : 0), 0));
  if (depths.filter(depth => depth === 0).length !== 1) return unavailable('disconnected');
  const sum = new Sum();
  areas.forEach((area, index) => sum.add(Math.abs(area) * (depths[index] % 2 ? -1 : 1)));
  if (!positiveFinite(sum.value)) return unavailable('numerical_range');
  return {area: sum.value, perimeter: collection.length, reason: null, snapped,
    mode: compound ? 'compound_rings' : eligible.length === 1 ? 'single_path' : 'connected_loop'};
}

function closedSegments(points) {
  const count = points.length - (samePoint(points[0], points.at(-1)) ? 1 : 0);
  const segments = [];
  for (let index = 0; index < count; index += 1) {
    segments.push({a: points[index], b: points[(index + 1) % count]});
  }
  return segments;
}

function pointOnBoundary(point, segments) {
  return segments.some(({a, b}) => orientation(a, b, point) === 0 && onSegment(point, a, b, 0));
}

// Interior hatch islands can be masks for furniture, rather than floor holes.
// Exterior measurement is therefore an explicit convention, never the default
// net hatch calculation. It retains a real source ring, not its bounding box.
export function getExteriorContour(element) {
  const sourceElementId = element?.id ?? element?.source_id ?? null;
  const unavailable = reason => ({available: false, reason, element: null,
    ignoredRingCount: 0, sourceElementId, rawArea: null, rawPerimeter: null});
  const excluded = exclusionFor(element);
  if (excluded) return unavailable(['text', 'dimension', 'hatchPattern'].includes(excluded) ? 'no_geometry' : 'invalid_geometry');
  const compound = Array.isArray(element.rings) && element.rings.length > 0;
  const paths = compound ? element.rings : [element.points];
  let segmentCount = 0;
  for (const path of paths) {
    if (!Array.isArray(path) || path.length < 3
        || !finitePoint(path[0]) || !finitePoint(path.at(-1))) return unavailable('invalid_geometry');
    const repeatedEnd = samePoint(path[0], path.at(-1));
    if (!compound && element.closed !== true && !repeatedEnd) return unavailable('open_path');
    segmentCount += path.length - (repeatedEnd ? 1 : 0);
    if (segmentCount > MAX_AREA_SEGMENTS) return unavailable('complexity_limit');
    if (path.some(point => !finitePoint(point))) return unavailable('invalid_geometry');
  }

  // Validate each possible exterior using the same area/topology guards as the
  // normal measurement engine. Their combined quadratic work stays bounded by
  // the total source-segment cap; invalid internal islands are never promoted.
  const candidates = [];
  let firstFailure = 'invalid_geometry';
  for (let index = 0; index < paths.length; index += 1) {
    const candidate = {...element, points: paths[index].map(point => point.slice(0, 2)), rings: [], closed: true};
    const collection = collect([candidate], MAX_AREA_SEGMENTS);
    const area = computeArea(collection, MAX_AREA_SEGMENTS);
    if (area.area !== null) candidates.push({index, element: candidate, area});
    else if (index === 0) firstFailure = area.reason;
  }
  if (!candidates.length) return unavailable(firstFailure);
  candidates.sort((a, b) => b.area.area - a.area.area);
  const exterior = candidates[0];
  if (paths.length === 1) return {available: true, reason: null, element: exterior.element,
    ignoredRingCount: 0, sourceElementId, rawArea: exterior.area.area, rawPerimeter: exterior.area.perimeter};

  const origin = paths[0][0];
  let span = 0;
  for (const path of paths) for (const point of path) {
    span = Math.max(span, Math.abs(point[0] - origin[0]), Math.abs(point[1] - origin[1]));
  }
  if (!positiveFinite(span)) return unavailable('numerical_range');
  const normalized = paths.map(path => path.map(point => [(point[0] - origin[0]) / span, (point[1] - origin[1]) / span]));
  const normalizedSegments = normalized.map(closedSegments);
  const complexity = {};
  let work = 0;
  const spend = count => { work += count; if (work > MAX_AREA_SEGMENTS * MAX_AREA_SEGMENTS) throw complexity; };
  const containsPoint = (point, ringIndex) => {
    spend(normalized[ringIndex].length + normalizedSegments[ringIndex].length);
    return pointOnBoundary(point, normalizedSegments[ringIndex]) || pointInRing(point, normalized[ringIndex]);
  };
  const containsPath = (outerIndex, innerIndex) => {
    const outerEdges = normalizedSegments[outerIndex];
    if (!normalized[innerIndex].every(point => containsPoint(point, outerIndex))) return false;
    for (const segment of normalizedSegments[innerIndex]) {
      const {a, b} = segment;
      if (samePoint(a, b)) continue;
      const cuts = [0, 1];
      const axis = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? 0 : 1;
      for (const edge of outerEdges) {
        spend(1);
        const relation = segmentRelation(segment, edge, 0);
        if (relation === 'cross') return false;
        if (relation === 'touch' || relation === 'overlap') {
          for (const point of [edge.a, edge.b]) {
            if (orientation(a, b, point) === 0 && onSegment(point, a, b, 0)) {
              const position = (point[axis] - a[axis]) / (b[axis] - a[axis]);
              if (position > 0 && position < 1) cuts.push(position);
            }
          }
        }
      }
      // Checking only vertices would admit a chord that leaves a concave
      // exterior through a corner. Check every interval between boundary hits.
      cuts.sort((left, right) => left - right);
      for (let index = 1; index < cuts.length; index += 1) {
        if (cuts[index] === cuts[index - 1]) continue;
        const position = cuts[index - 1] + (cuts[index] - cuts[index - 1]) / 2;
        const middle = [a[0] + position * (b[0] - a[0]), a[1] + position * (b[1] - a[1])];
        if (!containsPoint(middle, outerIndex)) return false;
      }
    }
    return true;
  };
  try {
    for (let index = 0; index < paths.length; index += 1) {
      if (index !== exterior.index && !containsPath(exterior.index, index)) return unavailable('multiple_contours');
    }
    // Two source rings describing the same outside edge are ambiguous, even
    // when their winding or intermediate collinear vertices differ.
    for (const other of candidates.slice(1)) {
      if (containsPath(other.index, exterior.index)) return unavailable('multiple_contours');
    }
  } catch (error) {
    if (error === complexity) return unavailable('complexity_limit');
    throw error;
  }
  return {available: true, reason: null, element: exterior.element,
    ignoredRingCount: paths.length - 1, sourceElementId,
    rawArea: exterior.area.area, rawPerimeter: exterior.area.perimeter};
}

/** Hit-testing a validated exterior; tolerance affects picking, never its area. */
export function pointInExteriorContour(contour, point, tolerance = 0) {
  if (!contour?.available || !finitePoint(point) || !Number.isFinite(tolerance) || tolerance < 0) return false;
  const points = contour.element?.points;
  if (!Array.isArray(points) || points.length < 3 || points.length > MAX_AREA_SEGMENTS + 1) return false;
  const origin = points[0];
  let span = 0;
  for (const vertex of points) span = Math.max(span, Math.abs(vertex[0] - origin[0]), Math.abs(vertex[1] - origin[1]));
  if (!positiveFinite(span)) return false;
  const ring = points.map(vertex => [(vertex[0] - origin[0]) / span, (vertex[1] - origin[1]) / span]);
  const candidate = [(point[0] - origin[0]) / span, (point[1] - origin[1]) / span];
  const normalizedTolerance = tolerance / span;
  if (!finitePoint(candidate) || !Number.isFinite(normalizedTolerance)) return false;
  const segments = closedSegments(ring);
  if (pointOnBoundary(candidate, segments) || pointInRing(candidate, ring)) return true;
  if (normalizedTolerance === 0) return false;
  return segments.some(({a, b}) => {
    const dx = b[0] - a[0]; const dy = b[1] - a[1];
    const squaredLength = dx * dx + dy * dy;
    const position = squaredLength === 0 ? 0 : Math.max(0, Math.min(1,
      ((candidate[0] - a[0]) * dx + (candidate[1] - a[1]) * dy) / squaredLength));
    return Math.hypot(candidate[0] - (a[0] + position * dx), candidate[1] - (a[1] + position * dy)) <= normalizedTolerance;
  });
}

function metricValues(raw, factor) {
  const result = {};
  for (const [name, value] of Object.entries(raw)) {
    if (value === null) { result[name] = null; continue; }
    const converted = name === 'area' ? (value * factor) * factor : value * factor;
    if (!Number.isFinite(converted) || (value > 0 && converted <= 0)) return null;
    result[name] = converted;
  }
  return result;
}

/** Caller supplies metresPerUnit only after explicit scale confirmation. */
export function measureSelection(elements = [], {metresPerUnit = null, maxAreaSegments = MAX_AREA_SEGMENTS} = {}) {
  const source = Array.isArray(elements) ? elements : [];
  const segmentLimit = Number.isInteger(maxAreaSegments)
    ? Math.max(3, Math.min(MAX_AREA_SEGMENTS, maxAreaSegments)) : MAX_AREA_SEGMENTS;
  const collection = collect(source, segmentLimit);
  const area = computeArea(collection, segmentLimit);
  const raw = {length: collection.length, perimeter: area.perimeter, area: area.area};
  const warnings = [];
  if (collection.approximate) warnings.push('curve_approximation');
  if (area.snapped) warnings.push('roundoff_endpoint_matching');
  if (collection.excluded.invalid || collection.excluded.unsupported) warnings.push('excluded_geometry');
  let metric = null; let metricReason = 'scale_unconfirmed';
  if (!collection.eligible.length) metricReason = 'no_geometry';
  else if (positiveFinite(metresPerUnit)) {
    metric = collection.numericalFailure ? null : metricValues(raw, metresPerUnit);
    metricReason = metric ? null : 'numerical_range';
    if (!metric) warnings.push('metric_numerical_range');
  } else if (metresPerUnit !== null && metresPerUnit !== undefined) warnings.push('invalid_scale');
  return {
    selectedCount: source.length, eligibleCount: collection.eligible.length,
    excludedCount: Object.values(collection.excluded).reduce((sum, count) => sum + count, 0),
    excluded: collection.excluded, raw, metric, metricReason,
    approximate: {length: collection.approximate,
      perimeter: area.perimeter !== null && (collection.approximate || area.snapped),
      area: area.area !== null && (collection.approximate || area.snapped)},
    areaStatus: area.area !== null ? 'available' : 'unavailable',
    areaReason: area.reason, areaMode: area.mode,
    calibration: calibrationEligibility(collection), warnings,
  };
}
export function calibrateScale(elements, knownLengthMetres) {
  if (!positiveFinite(knownLengthMetres)) return {ok: false, reason: 'invalid_known_length'};
  const selection = Array.isArray(elements) ? elements : elements ? [elements] : [];
  const reference = calibrationEligibility(collect(selection, 0));
  if (!reference.eligible) return {ok: false, reason: reference.reason};
  const metresPerUnit = knownLengthMetres / reference.lengthDrawingUnits;
  if (!positiveFinite(metresPerUnit)
      || !positiveFinite(reference.lengthDrawingUnits * metresPerUnit)) return {ok: false, reason: 'numerical_range'};
  return {ok: true, metresPerUnit, method: 'known_length', referenceElementId: reference.referenceElementId,
    referenceLengthDrawingUnits: reference.lengthDrawingUnits, knownLengthMetres, approximate: reference.approximate};
}
export function resetScaleForView(scale, previousView, nextView) {
  return previousView !== null && previousView !== undefined && previousView === nextView
    && positiveFinite(scale?.metresPerUnit) ? scale : {metresPerUnit: null, method: null};
}
