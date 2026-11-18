// Cadastral discovery snapshots are bounded, short-lived and source-specific.
// They never mix the 2024 search geometry with the 2026 nearby-map layer.
export const CADASTRE_SEARCH = 'https://geoquito.quito.gob.ec/server/rest/services/Hosted/predios_a_2024/FeatureServer/0/query';
const SEARCH_FIELDS = 'fid,n_predio,clave_cata,parroquia,area_terre,area_ter_1,area_const,frente,administra,tipo_propi,zonificaci';
const abortError = () => new DOMException('La consulta fue cancelada.', 'AbortError');

export function explorerOrdering(sort) {
  return sort === 'largest' ? 'area_terre DESC, n_predio ASC, fid ASC'
    : sort === 'smallest' ? 'area_terre ASC, n_predio ASC, fid ASC' : 'n_predio ASC, fid ASC';
}

export async function fetchExplorerJson(url, {signal, timeoutMs = 30000, ...options} = {}, fetcher = (...args) => fetch(...args)) {
  if (signal?.aborted) throw abortError();
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, {once: true});
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetcher(url, {...options, signal: controller.signal});
    const payload = await response.json();
    if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : `HTTP ${response.status}`);
    if (signal?.aborted) throw abortError();
    if (payload.error) throw new Error(payload.error.message || 'Error municipal');
    return payload;
  } catch (error) {
    if (timedOut) throw new Error('La consulta municipal superó el tiempo de espera. Inténtalo de nuevo.');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

export function createExplorerQueryClient({fetcher, now = () => Date.now(), ttlMs = 120000, maxFilters = 4, maxRows = 6000} = {}) {
  const snapshots = new Map();
  let generation = 0;
  function open({where, orderByFields, source = CADASTRE_SEARCH}) {
    const key = JSON.stringify([source, where]);
    let snapshot = snapshots.get(key);
    if (!snapshot || snapshot.expires <= now()) {
      snapshot = {id: ++generation, expires: now() + ttlMs, count: null, orders: new Map()};
    }
    snapshots.delete(key);
    snapshots.set(key, snapshot);
    while (snapshots.size > maxFilters) snapshots.delete(snapshots.keys().next().value);
    if (!snapshot.orders.has(orderByFields)) snapshot.orders.set(orderByFields, new Map());
    const rows = snapshot.orders.get(orderByFields);
    const request = (params, signal) => fetchExplorerJson(`${source}?${new URLSearchParams({where, ...params})}`, {signal}, fetcher);
    const remember = (index, feature) => {
      // Access-order eviction bounds all orderings in this filter snapshot.
      rows.delete(index); rows.set(index, feature);
      let retained = [...snapshot.orders.values()].reduce((total, map) => total + map.size, 0);
      for (const map of snapshot.orders.values()) {
        while (retained > maxRows && map.size) { map.delete(map.keys().next().value); retained--; }
      }
    };
    return {
      id: `${key}|${snapshot.id}|${orderByFields}`,
      async count(signal) {
        if (signal?.aborted) throw abortError();
        if (snapshot.count !== null) return snapshot.count;
        const payload = await request({f: 'json', returnCountOnly: 'true', returnGeometry: 'false'}, signal);
        if (!Number.isInteger(payload.count) || payload.count < 0) throw new Error('Conteo municipal inválido.');
        snapshot.count = payload.count;
        return snapshot.count;
      },
      async range(offset, size, signal) {
        const features = [];
        let index = offset;
        const end = offset + size;
        while (index < end) {
          if (signal?.aborted) throw abortError();
          if (rows.has(index)) {
            const feature = rows.get(index); remember(index, feature); features.push(feature); index++; continue;
          }
          let missingEnd = index + 1;
          while (missingEnd < end && missingEnd - index < 1000 && !rows.has(missingEnd)) missingEnd++;
          const requested = missingEnd - index;
          const payload = await request({f: 'geojson', outFields: SEARCH_FIELDS, returnGeometry: 'true', outSR: '4326',
            orderByFields, resultOffset: String(index), resultRecordCount: String(requested)}, signal);
          if (payload.type !== 'FeatureCollection' || !Array.isArray(payload.features)) throw new Error('Geometría municipal inválida.');
          // Keep the service's native Polygon/MultiPolygon and interior rings.
          // Counts/pages retain records with missing geometry for honest coverage.
          const received = payload.features.slice(0, requested);
          for (let i = 0; i < received.length; i++) remember(index + i, received[i]);
          features.push(...received);
          index += received.length;
          const overflow = payload.exceededTransferLimit || payload.properties?.exceededTransferLimit;
          if (!received.length && overflow) throw new Error('La respuesta municipal quedó incompleta.');
          if (!received.length || (received.length < requested && !overflow)) break;
        }
        return features;
      },
    };
  }
  return {open, clear: () => snapshots.clear()};
}

export function mergeExplorerFeatures(overview, page) {
  if (!overview?.features?.length) return page;
  if (!page?.features?.length) return overview;
  const key = feature => String(feature.id ?? feature.properties?.fid ?? feature.properties?.n_predio ?? '');
  const seen = new Set(overview.features.map(key));
  const extra = page.features.filter(feature => !seen.has(key(feature)) && seen.add(key(feature)));
  return extra.length ? {type: 'FeatureCollection', features: [...overview.features, ...extra]} : overview;
}
