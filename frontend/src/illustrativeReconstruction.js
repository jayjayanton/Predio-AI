import {ShapeUtils, Vector2} from 'three';
import {getExteriorContour} from './drawingMeasurements.js';

// This is a bounded illustrative massing model, not inferred building geometry.
// The source provides only the selected outside footprint and confirmed scale.
export const RECONSTRUCTION_LIMITS = Object.freeze({
  minHeightMetres: 0.3,
  maxHeightMetres: 12,
  minRoofPitchDegrees: 1,
  maxRoofPitchDegrees: 60,
  minSpanMetres: 0.01,
  maxSpanMetres: 200,
  maxFootprintPoints: 1000,
  maxMeshTriangles: 12000,
});

const finitePositive = value => Number.isFinite(value) && value > 0;
const samePoint = (a, b) => a[0] === b[0] && a[1] === b[1];
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const mesh = () => ({positions: [], indices: []});

function signedArea(points) {
  let sum = 0; let correction = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]; const b = points[(index + 1) % points.length];
    const value = (a[0] * b[1] - b[0] * a[1]) / 2 - correction;
    const next = sum + value;
    correction = (next - sum) - value; sum = next;
  }
  return sum;
}

function cleanFootprint(input) {
  const points = [];
  for (const point of input) {
    if (!points.length || !samePoint(points.at(-1), point)) points.push([...point]);
  }
  if (points.length > 1 && samePoint(points[0], points.at(-1))) points.pop();
  // Remove only collinear middle vertices within floating-point roundoff. The
  // actual concave corners, including column notches, must remain in the model.
  let changed = true;
  while (changed && points.length > 3) {
    changed = false;
    for (let index = 0; index < points.length; index += 1) {
      const a = points[(index + points.length - 1) % points.length];
      const b = points[index]; const c = points[(index + 1) % points.length];
      const p = (b[0] - a[0]) * (c[1] - a[1]);
      const q = (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(p - q) <= (Math.abs(p) + Math.abs(q)) * Number.EPSILON * 8
          && b[0] >= Math.min(a[0], c[0]) && b[0] <= Math.max(a[0], c[0])
          && b[1] >= Math.min(a[1], c[1]) && b[1] <= Math.max(a[1], c[1])) {
        points.splice(index, 1); changed = true; break;
      }
    }
  }
  return points;
}

// Clip an already triangulated piece, rather than a complete concave polygon.
// A ridge can cross a concave footprint more than twice; clipping each triangle
// preserves every separated portion without bridging across an exterior notch.
function clipAtRidge(points, axis, side) {
  const result = [];
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]; const b = points[(index + 1) % points.length];
    const insideA = side * a[axis] >= 0; const insideB = side * b[axis] >= 0;
    if (insideA) result.push([...a]);
    if (insideA !== insideB) {
      const fraction = -a[axis] / (b[axis] - a[axis]);
      const intersection = [a[0] + fraction * (b[0] - a[0]), a[1] + fraction * (b[1] - a[1])];
      intersection[axis] = 0;
      result.push(intersection);
    }
  }
  return cleanFootprint(result);
}

/**
 * Extrude one validated source exterior with explicit vertical assumptions.
 *
 * footprintPoints use centered metric drawing XY coordinates. Meshes use the
 * renderer's right-handed coordinates [drawingX, height, -drawingY]. Every
 * triangle has separate vertices so computing vertex normals keeps hard edges.
 * A gable is two assumed planes with its ridge centered on the chosen axis;
 * footprint bounds set that roof's span, but never replace the source footprint.
 */
export function buildIllustrativeModel({
  element, metresPerUnit, heightMetres = 2.6, roofType = 'flat', roofPitchDegrees = 20, ridgeAxis = 'x',
} = {}) {
  const fail = reason => ({ok: false, reason});
  if (!finitePositive(metresPerUnit)) return fail('scale_required');
  if (!Number.isFinite(heightMetres) || heightMetres < RECONSTRUCTION_LIMITS.minHeightMetres
      || heightMetres > RECONSTRUCTION_LIMITS.maxHeightMetres) return fail('invalid_height');
  if (!['none', 'flat', 'gable'].includes(roofType)) return fail('invalid_roof');
  if (roofType === 'gable' && (!Number.isFinite(roofPitchDegrees)
      || roofPitchDegrees < RECONSTRUCTION_LIMITS.minRoofPitchDegrees
      || roofPitchDegrees > RECONSTRUCTION_LIMITS.maxRoofPitchDegrees)) return fail('invalid_pitch');
  if (roofType === 'gable' && !['x', 'y'].includes(ridgeAxis)) return fail('invalid_ridge_axis');

  const contour = getExteriorContour(element);
  if (!contour.available) return fail(contour.reason);
  const source = contour.element.points;
  if (source.length - (samePoint(source[0], source.at(-1)) ? 1 : 0) > RECONSTRUCTION_LIMITS.maxFootprintPoints) {
    return fail('complexity_limit');
  }
  const sourceOrigin = source[0];
  // Subtract in source coordinates before scaling, retaining local precision
  // for small buildings whose CAD origin is a very large survey coordinate.
  const relative = source.map(point => [(point[0] - sourceOrigin[0]) * metresPerUnit,
    (point[1] - sourceOrigin[1]) * metresPerUnit]);
  if (relative.some(point => !point.every(Number.isFinite))) return fail('numerical_range');
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [x, y] of relative) {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  const widthMetres = maxX - minX; const depthMetres = maxY - minY;
  if (![widthMetres, depthMetres].every(value => Number.isFinite(value)
      && value >= RECONSTRUCTION_LIMITS.minSpanMetres && value <= RECONSTRUCTION_LIMITS.maxSpanMetres)) {
    return fail('model_size_range');
  }
  const centre = [minX + widthMetres / 2, minY + depthMetres / 2];
  let footprintPoints = cleanFootprint(relative.map(point => [point[0] - centre[0], point[1] - centre[1]]));
  if (footprintPoints.length < 3) return fail('degenerate');
  const footprintArea = signedArea(footprintPoints);
  if (!Number.isFinite(footprintArea) || footprintArea === 0) return fail('numerical_range');
  if (footprintArea < 0) footprintPoints.reverse();
  const areaM2 = (contour.rawArea * metresPerUnit) * metresPerUnit;
  const perimeterM = contour.rawPerimeter * metresPerUnit;
  if (!finitePositive(areaM2) || !finitePositive(perimeterM)) return fail('numerical_range');

  let triangles;
  try {
    triangles = ShapeUtils.triangulateShape(footprintPoints.map(([x, y]) => new Vector2(x, y)), []);
  } catch {
    return fail('triangulation_failed');
  }
  if (!Array.isArray(triangles) || !triangles.length) return fail('triangulation_failed');
  const faces = []; let triangleArea = 0;
  for (const face of triangles) {
    if (face.length !== 3 || face.some(index => !Number.isInteger(index) || index < 0 || index >= footprintPoints.length)) {
      return fail('triangulation_failed');
    }
    const points = face.map(index => footprintPoints[index]);
    const twiceArea = cross(...points);
    if (!Number.isFinite(twiceArea)) return fail('numerical_range');
    if (twiceArea === 0) continue;
    if (twiceArea < 0) [points[1], points[2]] = [points[2], points[1]];
    triangleArea += Math.abs(twiceArea) / 2;
    faces.push(points);
  }
  const areaTolerance = Math.max(1e-10, areaM2 * 1e-9);
  if (!faces.length || Math.abs(triangleArea - areaM2) > areaTolerance) return fail('triangulation_failed');

  const crossAxis = ridgeAxis === 'x' ? 1 : 0;
  const halfRoofSpan = (crossAxis === 0 ? widthMetres : depthMetres) / 2;
  const roofSlope = roofType === 'gable' ? Math.tan(roofPitchDegrees * Math.PI / 180) : 0;
  const roofRiseMetres = halfRoofSpan * roofSlope;
  const maxHeightMetres = heightMetres + roofRiseMetres;
  const roofHeight = point => heightMetres + (roofType === 'gable'
    ? Math.max(0, halfRoofSpan - Math.abs(point[crossAxis])) * roofSlope : 0);
  const world = (point, height) => [point[0], height, -point[1]];
  const meshes = {base: mesh(), walls: mesh(), roof: mesh()};
  let triangleCount = 0;
  const complexity = {};
  const addTriangle = (target, a, b, c) => {
    triangleCount += 1;
    if (triangleCount > RECONSTRUCTION_LIMITS.maxMeshTriangles) throw complexity;
    const index = target.positions.length / 3;
    target.positions.push(...a, ...b, ...c); target.indices.push(index, index + 1, index + 2);
  };
  let roofProjectionArea = 0;
  try {
    for (const points of faces) {
      // The volume base faces down; a double-sided floor material can also show
      // the open model from above when no roof has been selected.
      addTriangle(meshes.base, world(points[0], 0), world(points[2], 0), world(points[1], 0));
      if (roofType === 'none') continue;
      const pieces = roofType === 'gable'
        ? [clipAtRidge(points, crossAxis, 1), clipAtRidge(points, crossAxis, -1)] : [points];
      for (const piece of pieces) {
        for (let index = 1; index < piece.length - 1; index += 1) {
          const triangle = [piece[0], piece[index], piece[index + 1]];
          const twiceArea = cross(...triangle);
          if (twiceArea === 0) continue;
          if (twiceArea < 0) [triangle[1], triangle[2]] = [triangle[2], triangle[1]];
          roofProjectionArea += Math.abs(twiceArea) / 2;
          addTriangle(meshes.roof, ...triangle.map(point => world(point, roofHeight(point))));
        }
      }
    }
    for (let index = 0; index < footprintPoints.length; index += 1) {
      const a = footprintPoints[index]; const b = footprintPoints[(index + 1) % footprintPoints.length];
      const edge = [a];
      if (roofType === 'gable' && a[crossAxis] * b[crossAxis] < 0) {
        const fraction = -a[crossAxis] / (b[crossAxis] - a[crossAxis]);
        const ridgePoint = [a[0] + fraction * (b[0] - a[0]), a[1] + fraction * (b[1] - a[1])];
        ridgePoint[crossAxis] = 0; edge.push(ridgePoint);
      }
      edge.push(b);
      for (let part = 0; part < edge.length - 1; part += 1) {
        const left = edge[part]; const right = edge[part + 1];
        const bottomLeft = world(left, 0); const bottomRight = world(right, 0);
        const topLeft = world(left, roofHeight(left)); const topRight = world(right, roofHeight(right));
        addTriangle(meshes.walls, bottomLeft, bottomRight, topRight);
        addTriangle(meshes.walls, bottomLeft, topRight, topLeft);
      }
    }
  } catch (error) {
    if (error === complexity) return fail('complexity_limit');
    throw error;
  }
  if (roofType !== 'none' && Math.abs(roofProjectionArea - areaM2) > areaTolerance) return fail('triangulation_failed');
  if (Object.values(meshes).some(part => part.positions.some(value => !Number.isFinite(value)))) return fail('numerical_range');

  return {
    ok: true, reason: null,
    sourceId: contour.sourceElementId,
    footprintPoints,
    areaM2, perimeterM,
    dimensions: {widthMetres, depthMetres},
    ignoredRingCount: contour.ignoredRingCount,
    approximate: Boolean(element.approximation) || element.kind === 'curve'
      || ['ARC', 'CIRCLE', 'ELLIPSE', 'SPLINE'].includes(element.source_type),
    assumptions: {
      illustrative: true,
      footprintSource: 'selected_exterior_contour',
      heightSource: 'user_assumption',
      heightMetres,
      roofSource: roofType === 'none' ? 'not_modelled' : 'user_assumption',
      roofType,
      roofPitchDegrees: roofType === 'gable' ? roofPitchDegrees : null,
      ridgeAxis: roofType === 'gable' ? ridgeAxis : null,
      interiorCutouts: 'not_deducted',
      openingsAndInteriorWalls: 'not_modelled',
    },
    meshes,
    triangleCount,
    bounds: {min: [-widthMetres / 2, 0, -depthMetres / 2],
      max: [widthMetres / 2, maxHeightMetres, depthMetres / 2]},
    roofRiseMetres, maxHeightMetres,
  };
}
