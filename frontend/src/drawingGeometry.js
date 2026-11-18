// Display-space geometry only. These operations do not calibrate CAD units or
// compute construction quantities. CAD/PDF coordinates already have Y down.
const finitePoint = point => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]);
const validBounds = bounds => Array.isArray(bounds) && bounds.length === 4
  && bounds.every(Number.isFinite) && bounds[0] <= bounds[2] && bounds[1] <= bounds[3];
export const layerName = item => item.layer || 'Sin capa';
export const isText = item => item.kind === 'text';

export function unionBounds(bounds) {
  let result = null;
  for (const box of bounds) {
    if (!validBounds(box)) continue;
    result = result
      ? [Math.min(result[0], box[0]), Math.min(result[1], box[1]), Math.max(result[2], box[2]), Math.max(result[3], box[3])]
      : [...box];
  }
  return result;
}

const pointBounds = points => {
  let result = null;
  for (const [x, y] of points) result = result
    ? [Math.min(result[0], x), Math.min(result[1], y), Math.max(result[2], x), Math.max(result[3], y)]
    : [x, y, x, y];
  return result;
};

export function textCorners(item) {
  const lines = item.text.split('\n');
  // Font metrics vary between CAD and the browser; this box is for selection,
  // never a verified text extent or a measured area.
  const fontHeight = item.text_transform ? 1 : item.height;
  const width = lines.reduce((longest, line) => Math.max(longest, line.length), 1) * fontHeight * 0.62;
  const height = fontHeight * (1 + (lines.length - 1) * 1.2);
  const left = item.alignment === 'center' ? -width / 2 : item.alignment === 'right' ? -width : 0;
  const angle = item.rotation * Math.PI / 180;
  const cos = Math.cos(angle); const sin = Math.sin(angle);
  const top = item.baselineOffset - fontHeight;
  return [[left, top], [left + width, top], [left + width, top + height], [left, top + height]]
    .map(([x, y]) => item.text_transform
      ? [item.position[0] + x * item.text_transform[0] + y * item.text_transform[2], item.position[1] + x * item.text_transform[1] + y * item.text_transform[3]]
      : [item.position[0] + x * cos - y * sin, item.position[1] + x * sin + y * cos]);
}

export function prepareDrawing(view = {}) {
  const source = Array.isArray(view.elements) ? view.elements : [];
  const labels = Array.isArray(view.source_labels) ? view.source_labels : [];
  const representedLabels = new Set(source.map(item => item.source_label_id).filter(Boolean));
  const textSignature = item => JSON.stringify([item.source_handle || '', item.text || '', item.position || []]);
  const representedText = new Set(source.filter(item => item.kind === 'text').map(textSignature));
  const legacyLabels = labels.filter(label => !representedLabels.has(label.id) && !representedText.has(textSignature(label)))
    .map(label => ({...label, annotation_kind: label.kind, kind: 'text', height: label.text_height, legacy_label: true}));
  const raw = [...source, ...legacyLabels];
  const extent = validBounds(view.bounds) ? Math.max(view.bounds[2] - view.bounds[0], view.bounds[3] - view.bounds[1], 1) : 100;
  const ids = new Set();
  const items = [];
  let invalidCount = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const original = raw[index];
    let id = String(original.id ?? `element-${index + 1}`);
    if (ids.has(id)) id = `${id}#${index + 1}`;
    ids.add(id);
    const item = {...original, id, source_id: original.id || id, layer: layerName(original)};
    if (item.kind === 'text') {
      if (!finitePoint(item.position) || typeof item.text !== 'string' || !item.text.trim()) { invalidCount += 1; continue; }
      item.position = item.position.slice(0, 2);
      item.height = Number.isFinite(item.height) && item.height > 0 ? item.height : extent / 200;
      item.rotation = Number.isFinite(item.rotation) ? item.rotation : 0;
      item.text_transform = Array.isArray(item.text_transform) && item.text_transform.length === 4 && item.text_transform.every(Number.isFinite)
        ? item.text_transform : null;
      item.alignment = ['center', 'right'].includes(item.alignment) ? item.alignment : 'left';
      const fontHeight = item.text_transform ? 1 : item.height;
      const textHeight = fontHeight * (1 + (item.text.split('\n').length - 1) * 1.2);
      item.baselineOffset = item.vertical_alignment === 'top' ? fontHeight
        : item.vertical_alignment === 'middle' ? fontHeight - textHeight / 2
        : item.vertical_alignment === 'bottom' ? fontHeight - textHeight : 0;
      item.points = [];
      item.rings = [];
      item.corners = textCorners(item);
      item.bounds = pointBounds(item.corners);
      item.segmentCount = 0;
    } else {
      const rawRings = Array.isArray(item.rings) ? item.rings : [];
      const rawPoints = Array.isArray(item.points) ? item.points : [];
      // Reject malformed paths instead of connecting across an invalid vertex.
      if (rawPoints.some(point => !finitePoint(point)) || rawRings.some(ring => !Array.isArray(ring) || ring.some(point => !finitePoint(point)))) {
        invalidCount += 1; continue;
      }
      item.points = rawPoints.map(point => point.slice(0, 2));
      item.rings = rawRings.filter(ring => ring.length > 1).map(ring => ring.map(point => point.slice(0, 2)));
      const paths = item.rings.length ? item.rings : [item.points];
      if (!paths.some(path => path.length)) { invalidCount += 1; continue; }
      item.bounds = unionBounds(paths.map(pointBounds));
      item.segmentCount = paths.reduce((total, path) => total + Math.max(0, path.length - 1)
        + ((item.closed || item.rings.length) && path.length > 2 && (path[0][0] !== path.at(-1)[0] || path[0][1] !== path.at(-1)[1]) ? 1 : 0), 0);
    }
    item.searchText = [item.source_id, item.layer, item.text, item.source_handle, item.source_type, item.kind,
      ...(Array.isArray(item.block_path) ? item.block_path : [])].filter(Boolean).join(' ').toLocaleLowerCase('es');
    items.push(item);
  }
  return {
    items,
    byId: new Map(items.map(item => [item.id, item])),
    bounds: unionBounds([view.bounds, ...items.map(item => item.bounds)]),
    invalidCount,
    textCount: items.filter(isText).length,
    segmentCount: items.reduce((total, item) => total + item.segmentCount, 0),
  };
}

export function intersects(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

export function buildSpatialIndex(items, bounds = unionBounds(items.map(item => item.bounds))) {
  if (!bounds || !items.length) return {query: () => []};
  const cells = Math.max(4, Math.min(128, Math.ceil(Math.sqrt(items.length / 6))));
  const cellWidth = Math.max(bounds[2] - bounds[0], 1e-9) / cells;
  const cellHeight = Math.max(bounds[3] - bounds[1], 1e-9) / cells;
  const grid = new Map(); const broad = [];
  const cellRange = box => [
    Math.max(0, Math.min(cells - 1, Math.floor((box[0] - bounds[0]) / cellWidth))),
    Math.max(0, Math.min(cells - 1, Math.floor((box[1] - bounds[1]) / cellHeight))),
    Math.max(0, Math.min(cells - 1, Math.floor((box[2] - bounds[0]) / cellWidth))),
    Math.max(0, Math.min(cells - 1, Math.floor((box[3] - bounds[1]) / cellHeight))),
  ];
  for (const item of items) {
    const [x0, y0, x1, y1] = cellRange(item.bounds);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 64) { broad.push(item); continue; }
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
      const key = y * cells + x;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(item);
    }
  }
  return {query(box) {
    if (!validBounds(box) || !intersects(bounds, box)) return [];
    const [x0, y0, x1, y1] = cellRange(box);
    const found = new Set(broad.filter(item => intersects(item.bounds, box)));
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
      for (const item of grid.get(y * cells + x) || []) if (intersects(item.bounds, box)) found.add(item);
    }
    return [...found];
  }};
}

export function fitTransform(bounds, width, height, padding = 28) {
  if (!validBounds(bounds)) return {scale: 1, x: width / 2, y: height / 2};
  const spanX = Math.max(bounds[2] - bounds[0], 1e-6);
  const spanY = Math.max(bounds[3] - bounds[1], 1e-6);
  const scale = Math.max(1e-9, Math.min(Math.max(1, width - 2 * padding) / spanX, Math.max(1, height - 2 * padding) / spanY));
  return {scale, x: width / 2 - (bounds[0] + bounds[2]) * scale / 2, y: height / 2 - (bounds[1] + bounds[3]) * scale / 2};
}

export const toWorld = (point, transform) => [(point[0] - transform.x) / transform.scale, (point[1] - transform.y) / transform.scale];
export const toScreen = (point, transform) => [point[0] * transform.scale + transform.x, point[1] * transform.scale + transform.y];

export function zoomAt(transform, factor, anchor, minimum = 1e-9, maximum = Infinity) {
  const scale = Math.max(minimum, Math.min(maximum, transform.scale * factor));
  const world = toWorld(anchor, transform);
  return {scale, x: anchor[0] - world[0] * scale, y: anchor[1] - world[1] * scale};
}

export const rectangle = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
const inside = (point, bounds) => point[0] >= bounds[0] && point[0] <= bounds[2] && point[1] >= bounds[1] && point[1] <= bounds[3];

function pointInRing(point, ring) {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if (((yi > point[1]) !== (yj > point[1])) && point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi) result = !result;
  }
  return result;
}

function pathsFor(item) { return item.rings.length ? item.rings : [item.points]; }
function filledContains(item, point) {
  if (!item.filled) return false;
  return pathsFor(item).reduce((result, ring) => pointInRing(point, ring) ? !result : result, false);
}

function segmentDistance(point, a, b) {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  const t = length2 ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2)) : 0;
  return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy);
}

function eachSegment(item, callback) {
  for (const path of pathsFor(item)) {
    if (path.length === 1 && callback(path[0], path[0])) return true;
    for (let i = 1; i < path.length; i += 1) if (callback(path[i - 1], path[i])) return true;
    if ((item.closed || item.rings.length) && path.length > 2 && callback(path.at(-1), path[0])) return true;
  }
  return false;
}

export function hitTest(items, point, tolerance) {
  let best = null; let bestDistance = tolerance;
  for (const item of items) {
    if (isText(item)) {
      if (pointInRing(point, item.corners)) { best = item; bestDistance = 0; }
      continue;
    }
    if (filledContains(item, point) && !best) best = item;
    eachSegment(item, (a, b) => {
      const distance = segmentDistance(point, a, b);
      if (distance <= bestDistance) { best = item; bestDistance = distance; }
      return false;
    });
  }
  return best;
}

function segmentMeetsRectangle(a, b, box) {
  // Liang–Barsky clipping also handles horizontal/vertical/zero-length segments.
  let lo = 0; let hi = 1;
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const p = [-dx, dx, -dy, dy]; const q = [a[0] - box[0], box[2] - a[0], a[1] - box[1], box[3] - a[1]];
  for (let i = 0; i < 4; i += 1) {
    if (p[i] === 0) { if (q[i] < 0) return false; }
    else if (p[i] < 0) lo = Math.max(lo, q[i] / p[i]);
    else hi = Math.min(hi, q[i] / p[i]);
    if (lo > hi) return false;
  }
  return true;
}

export function selectInRectangle(items, box) {
  return items.filter(item => {
    if (!intersects(item.bounds, box)) return false;
    if (isText(item)) return item.corners.some(point => inside(point, box))
      || pointInRing([box[0], box[1]], item.corners)
      || item.corners.some((point, i) => segmentMeetsRectangle(point, item.corners[(i + 1) % 4], box));
    return filledContains(item, [box[0], box[1]]) || eachSegment(item, (a, b) => segmentMeetsRectangle(a, b, box));
  });
}

export function filterDrawingItems(items, {hiddenLayers = new Set(), showText = true, query = '', selected = null} = {}) {
  const needle = query.trim().toLocaleLowerCase('es');
  return items.filter(item => !hiddenLayers.has(item.layer) && (showText || !isText(item))
    && (!needle || item.searchText.includes(needle)) && (!selected || selected.has(item.id)));
}

export function updateSelection(current, ids, {additive = false, toggle = false} = {}) {
  const result = additive ? new Set(current) : new Set();
  for (const id of ids) {
    if (toggle && result.has(id)) result.delete(id);
    else result.add(id);
  }
  return result;
}
