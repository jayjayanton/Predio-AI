/** Reviewable, session-local measurements from independent architectural views. */
const TYPES = new Set(['floor_area', 'room_height']);
const safePositive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
export const PROJECT_SELECTION_LIMIT = 60;
export function addProjectSelection(current = [], proposal) {
  if (!Array.isArray(current) || current.length >= PROJECT_SELECTION_LIMIT) return current;
  const room = String(proposal?.room || '').trim().slice(0, 80);
  const source = String(proposal?.source || '').trim().slice(0, 260);
  const kind = proposal?.kind;
  const metric = proposal?.metric;
  if (!room || !source || !TYPES.has(kind) || !safePositive(metric?.value)
    || !safePositive(proposal?.metresPerUnit) || !Array.isArray(proposal?.elementIds)
    || !proposal.elementIds.length || proposal.elementIds.length > 1000) return current;
  if (kind === 'floor_area' && !safePositive(metric?.perimeter)) return current;
  const record = {
    id: String(proposal.id || `sel-${Date.now()}-${current.length}`),
    room, source, kind, view: String(proposal.view || '').slice(0, 120),
    viewIndex: Number.isInteger(proposal.viewIndex) ? proposal.viewIndex : 0,
    elementIds: proposal.elementIds.map(id => String(id).slice(0, 100)),
    metresPerUnit: proposal.metresPerUnit, value: metric.value,
    perimeter: kind === 'floor_area' ? metric.perimeter : null,
    approximate: Boolean(proposal.approximate),
    evidence: 'selected_scaled_geometry',
  };
  return [...current, record];
}
export function removeProjectSelection(records, id) {
  return (records || []).filter(item => item.id !== id);
}
/** Never silently add multiple room outlines or infer slope/height from unrelated drawings. */
export function summarizeProjectSelections(records = []) {
  const grouped = new Map();
  for (const item of records) {
    if (!grouped.has(item.room)) grouped.set(item.room, []);
    grouped.get(item.room).push(item);
  }
  return [...grouped].map(([room, items]) => {
    const areas = items.filter(item => item.kind === 'floor_area');
    const heights = items.filter(item => item.kind === 'room_height');
    const oneArea = areas.length === 1 ? areas[0] : null;
    const oneHeight = heights.length === 1 ? heights[0] : null;
    const volume = oneArea && oneHeight && safePositive(oneArea.value * oneHeight.value)
      ? oneArea.value * oneHeight.value : null;
    return {room, items, floorArea: oneArea?.value ?? null,
      perimeter: oneArea?.perimeter ?? null, height: oneHeight?.value ?? null,
      volume, volumeStatus: volume === null ? 'pending_evidence' : 'constant_height_assumed',
      ambiguous: areas.length > 1 || heights.length > 1,
      approximate: Boolean(oneArea?.approximate || oneHeight?.approximate)};
  });
}
