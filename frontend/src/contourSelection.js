import {MAX_AREA_SEGMENTS, getExteriorContour, pointInExteriorContour} from './drawingMeasurements.js';

const MAX_CONTOUR_CANDIDATES = 64;
const samePoint = (a, b) => a?.[0] === b?.[0] && a?.[1] === b?.[1];

// Select an existing source boundary, never a rectangle inferred from a label,
// a group of open lines, or the screen coordinates. Hatch sources take priority
// over annotation boxes; multiple containing hatches require an explicit choice.
export function findClosedContours(items, point, tolerance = 0) {
  const candidates = items.filter(item => !item.hatch_pattern && !item.dimension_handle
    && ['hatch_boundary', 'polyline', 'curve'].includes(item.kind)
    && (item.rings?.length || item.closed || (item.points?.length > 2 && samePoint(item.points[0], item.points.at(-1)))));
  if (candidates.length > MAX_CONTOUR_CANDIDATES) return {choices: [], reason: 'complexity_limit'};
  // Bound total quadratic validation across overlapping source elements, not
  // only the per-element guard in getExteriorContour.
  let work = 0;
  for (const item of candidates) {
    const paths = item.rings?.length ? item.rings : [item.points || []];
    const segments = paths.reduce((sum, path) => sum + Math.max(0, path.length
      - (samePoint(path[0], path.at(-1)) ? 1 : 0)), 0);
    work += segments * segments;
    if (work > MAX_AREA_SEGMENTS * MAX_AREA_SEGMENTS) return {choices: [], reason: 'complexity_limit'};
  }
  const matches = [];
  for (const item of candidates) {
    const exterior = getExteriorContour(item);
    if (exterior.available && pointInExteriorContour(exterior, point, tolerance)) matches.push({item, exterior});
  }
  const hatches = matches.filter(choice => choice.item.kind === 'hatch_boundary');
  const choices = hatches.length ? hatches : matches;
  return {choices, reason: choices.length ? null : 'no_contour'};
}
