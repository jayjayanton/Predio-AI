/** Display a reviewed metric polygon in the CAD's original Y-down coordinates.
 * This only draws the guide; exact distances stay in liveSetbacks/the server.
 */
export function localGeometryScreenPath(geometry, {origin, metresPerUnit} = {}, transform = {}) {
  const point = value => Array.isArray(value) && value.length >= 2 && value.slice(0, 2).every(Number.isFinite);
  if (!point(origin) || !Number.isFinite(metresPerUnit) || metresPerUnit <= 0
      || ![transform.scale, transform.x, transform.y].every(Number.isFinite) || transform.scale <= 0) return '';
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : null;
  if (!Array.isArray(polygons) || !polygons.length) return '';
  let vertices = 0;
  const paths = [];
  for (const rings of polygons) {
    if (!Array.isArray(rings) || !rings.length) return '';
    for (const ring of rings) {
      if (!Array.isArray(ring) || ring.length < 4 || (vertices += ring.length) > 20000 || !ring.every(point)
          || ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) return '';
      const points = ring.map(([x, y]) => [
        (origin[0] + x / metresPerUnit) * transform.scale + transform.x,
        (origin[1] - y / metresPerUnit) * transform.scale + transform.y,
      ]);
      if (!points.every(point)) return '';
      paths.push(points.map(([x, y], index) => `${index ? 'L' : 'M'}${x},${y}`).join(' ') + ' Z');
    }
  }
  return paths.join(' ');
}
