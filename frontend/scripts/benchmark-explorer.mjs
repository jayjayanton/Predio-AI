// Run with: npm run benchmark:explorer -- /path/to/municipal.geojson
// The input must contain at least 2,000 native municipal polygon features.
// This measures data preparation and request reuse, not browser frame rates.
import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {performance} from 'node:perf_hooks';
import {createExplorerQueryClient, explorerOrdering} from '../src/explorerQuery.js';
import {collectionBounds} from '../src/parcelMapData.js';

const input = process.argv[2];
if (!input) {
  console.error('Usage: npm run benchmark:explorer -- /path/to/municipal.geojson');
  process.exit(1);
}
const fixture = JSON.parse(await readFile(input, 'utf8'));
if (fixture.type !== 'FeatureCollection' || fixture.features?.length < 2000) {
  throw new Error('Provide a native GeoJSON FeatureCollection with at least 2,000 features.');
}

const countVertices = coordinates => !Array.isArray(coordinates) ? 0
  : typeof coordinates[0] === 'number' ? 1
    : coordinates.reduce((total, child) => total + countVertices(child), 0);
const summarize = samples => {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    median: Number(sorted[Math.floor(sorted.length / 2)].toFixed(3)),
    p95: Number(sorted[Math.ceil(sorted.length * .95) - 1].toFixed(3)),
  };
};
const preparation = [1000, 2000].map(size => {
  const collection = {type: 'FeatureCollection', features: fixture.features.slice(0, size)};
  const encoded = JSON.stringify(collection);
  const parsing = [], initialBounds = [], cachedBounds = [];
  for (let trial = 0; trial < 35; trial++) {
    const started = performance.now();
    const fresh = JSON.parse(encoded);
    const parsed = performance.now();
    collectionBounds(fresh);
    const bounded = performance.now();
    collectionBounds(fresh);
    const cached = performance.now();
    if (trial >= 5) {
      parsing.push(parsed - started);
      initialBounds.push(bounded - parsed);
      cachedBounds.push(cached - bounded);
    }
  }
  return {
    features: size,
    vertices: collection.features.reduce((total, feature) => total + countVertices(feature.geometry?.coordinates), 0),
    json_bytes: Buffer.byteLength(encoded),
    local_gzip_bytes: gzipSync(encoded).length,
    parse_ms: summarize(parsing),
    initial_bounds_ms: summarize(initialBounds),
    cached_bounds_ms: summarize(cachedBounds),
  };
});

const requests = [];
const client = createExplorerQueryClient({fetcher: async url => {
  const params = new URL(url).searchParams;
  if (params.get('returnCountOnly') === 'true') {
    requests.push({kind: 'count'});
    return {ok: true, json: async () => ({count: fixture.features.length})};
  }
  const offset = Number(params.get('resultOffset'));
  const size = Number(params.get('resultRecordCount'));
  requests.push({kind: 'geometry', offset, size});
  return {ok: true, json: async () => ({
    type: 'FeatureCollection', features: fixture.features.slice(offset, offset + size),
    properties: {exceededTransferLimit: offset + size < fixture.features.length},
  })};
}});
const query = client.open({where: 'benchmark_fixture', orderByFields: explorerOrdering('id')});
await Promise.all([query.count(), query.range(0, 50)]);
await query.range(0, 1000);
const initialRequests = requests.length;
await query.range(200, 200);
await query.count();
const cachedPageRequests = requests.length - initialRequests;
await query.range(0, 2000);
const largerMapRequests = requests.length - initialRequests;
const afterLargerMap = requests.length;
await query.range(1000, 200);
await query.range(0, 1000);

console.log(JSON.stringify({
  recorded_at: new Date().toISOString(),
  runtime: process.version,
  trials: 30,
  warmup_trials: 5,
  method: 'Local Node data preparation on native municipal geometry; deterministic mocked transport for request counts.',
  limitations: 'No browser rendering, interaction latency, mobile CPU, live network latency, or service-load measurement. Gzip is local compression, not observed wire traffic.',
  preparation,
  request_reuse: {
    initial_50_plus_1000_map: initialRequests,
    cached_page_and_count_additional: cachedPageRequests,
    upgrade_1000_to_2000_additional: largerMapRequests,
    cached_later_page_and_reduced_map_additional: requests.length - afterLargerMap,
    calls: requests,
  },
}, null, 2));
