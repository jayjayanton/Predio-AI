# REST efficiency and larger-map validation

Reviewed and implemented on 18 November 2026.

## Decision

Keep the municipal REST architecture for interactive discovery, parcel details and bounded PUGS review. The observed inefficiencies were repeated retrieval, unnecessary enrichment and geometry/index preparation. GeoParquet is a storage and exchange format; it does not replace request scheduling, pagination or map rendering.

No GeoParquet dependency, municipal snapshot pipeline or new database was added. Reconsider a versioned GeoParquet analytics dataset when a defined job repeatedly scans a substantial portion of Quito, joins many thousands of parcels, needs reproducible historical snapshots or must run independently of municipal service availability. Such a job needs explicit refresh, provenance, retention and publication rules. An interactive display of many more polygons should first evaluate generalized vector tiles and viewport/zoom-dependent detail. Those can coexist with REST and a separate analytical dataset.

Primary references: [ArcGIS feature queries](https://developers.arcgis.com/rest/services-reference/enterprise/query-feature-service-layer/), [Esri map performance guidance](https://architecture.arcgis.com/en/framework/architecture-pillars/performance-and-scalability/optimize-web-maps-layers-and-apps.html), [GeoParquet distribution guidance](https://github.com/opengeospatial/geoparquet/blob/main/format-specs/distributing-geoparquet.md) and [HTTPX connection pooling](https://www.python-httpx.org/advanced/clients/).

## Priorities implemented

### 1. Correctness and failure isolation

- Search-map data includes the current results page as well as the bounded overview, including pages beyond the first 1,000 records.
- The first page is usable while its optional overview loads. An overview failure preserves the list, count and current-page polygons and allows retry.
- New searches, clear actions and leaving discovery cancel obsolete requests. Run identities also reject late responses from transports that ignore cancellation.
- Camera placement is tied to the search and selected geometry. Appending an overview does not reset a user's pan or repeatedly focus an unchanged selection.
- Single-property and batch PUGS calculations both preserve holes and MultiPolygon topology. Invalid or incomplete zoning evidence produces unavailable/ambiguous results rather than false no-intersection.
- PUGS pagination distinguishes explicit completion from missing completion flags, accepts an exact final 2,000-row result, detects repeated pages and uses a bounded completion probe when necessary.

### 2. Reuse and bounded work

| Component | Retention and limits | Reused work |
| --- | --- | --- |
| Discovery query snapshots | 2 minutes; 4 filters; 6,000 rows per filter across sort orders | Count and native GeoJSON rows; missing ranges only |
| Nearby 2026 map tiles | 15 minutes; 256 entries; 5,000 cached feature occurrences | Fixed-grid geometry, shared in-flight loads; incomplete tiles remain subdivision markers |
| Nearby drawing | At most 2,400 visible features; 64 new tile queries per viewport; depth 5; 4 concurrent requests | Only intersecting cached features; selected visible parcel retained; limits displayed |
| Cadastral core | 60 seconds; 128 entries; 8 MiB serialized weight | 2024 attributes and source-matched 2026 geometry between property and PUGS requests |
| PUGS tiles | 15 minutes; 150 entries; 32 MiB estimated geometry/attribute/index weight | Projected polygons, attributes and per-tile STRtrees; concurrent missing loads shared |
| Municipal HTTP | One connection pool per application worker; 4 active upstream requests | Connections across cadastral, AIVA and PUGS calls |

The limits bound retained data and work; the estimated PUGS weight is not an exact resident-memory measurement. Caches are process/browser-local and are not a distributed cache. An entry can be refreshed when its TTL expires or it is evicted. Snapshot sorting has a stable municipal `fid` tie-breaker. Bounded caching does not create an atomic snapshot of a changing upstream service.

The 2024 discovery source and 2026 nearby source remain distinct. Display caches do not replace the exact property geometry used by analysis. Property-horizontal (PH) unit/parent-lot scope and source provenance are retained. PUGS continues to return preliminary evidence with `regulatory_approval: false`.

### 3. Larger map loads

The overview defaults to **1,000** and allows **2,000** through the map-size selector. Current-page geometry is added if it lies beyond the overview, so the search overlay can contain up to the chosen overview plus one card page. The separate nearby layer has its own 2,400-feature cap. These are separate budgets, not a single total path-count guarantee.

Regression tests exercise 1,000/2,000 overview changes, selecting a later page, warm-page reuse, cancellation, overflow subdivision, concurrent callers, expiry and the nearby drawing cap. A reproducible data-preparation benchmark is available:

```sh
cd frontend
npm run benchmark:explorer -- /path/to/municipal.geojson
```

Supply a native municipal GeoJSON FeatureCollection containing at least 2,000 polygons. The checked run used a bounded 2,000-feature query of the published 2024 layer, area 300–1,000 m² in Cumbayá or Tumbaco, ordered by `n_predio ASC, fid ASC`. It requested only discovery fields. The raw municipal fixture is not committed. Summary: [recorded benchmark](performance/explorer-2026-11-18.json).

| Native features | Vertices | JSON size | Local gzip size | Parse median | Initial bounds median | Cached bounds median |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 23,620 | 1,309,975 bytes | 336,896 bytes | 4.522 ms | 3.457 ms | 0.116 ms |
| 2,000 | 47,231 | 2,624,498 bytes | 506,211 bytes | 9.049 ms | 7.693 ms | 0.335 ms |

These are Node v24 measurements in the review environment, with 30 recorded trials after 5 warmups. They measure parsing and bounds preparation, **not browser rendering or mobile responsiveness**. Local gzip size is not observed wire traffic. The local Chromium runner could not start under the environment's socket restriction, and the remote browser could not reach the local Vite server. Consequently no local desktop/mobile frame-rate or interaction-latency claim is made from this run. The production build, mounted component tests and data-path benchmarks are separate checks.

Before raising the default, validate the deployed 1,000/2,000 controls on a representative phone and desktop: time first usable cards and completed overlay separately; pan and select repeatedly; change page/layout; select a result beyond 1,000; revisit a nearby viewport; record network calls, long tasks and interaction latency. Count total vertices and visible paths as well as features. A small parcel and a very detailed parcel are not equal rendering work.

### 4. GeoParquet remains a conditional analytics change

The new caches and request separation improve the current REST path without adding a second authoritative data lifecycle. GeoParquet becomes a candidate when there is a concrete bulk job and measurements showing repeated broad scans dominate that job. Compare REST, a versioned GeoParquet snapshot with an analytical engine, and a spatial database using the same filters, precision, freshness and output requirements before choosing one.

## Request-count evidence

| Workflow | Before | Implemented behavior |
| --- | ---: | ---: |
| Count + 50 cards + first 1,000 overview | 7 municipal requests | 3: count, first 50, remaining 950 |
| Page/layout change within cached overview | Repeated count/geometry work | 0 new requests while snapshot remains valid |
| Increase overview from 1,000 to 2,000 | No larger overview option | 1 additional 1,000-row request |
| Property details followed by PUGS for the same source key | 9 source requests | 5: the initial 4 plus zoning; cached core reused and AIVA omitted from PUGS |
| Reuse complete nearby viewport | Geometry downloaded again | 0 new tile requests while complete cached coverage remains valid |
| Reuse warm PUGS tiles | Geometry/index preparation repeated | Cached projection and STRtree reused |

The after counts are deterministic regression/fixture checks, not a production latency guarantee. Cold property/PUGS calls, expired entries, different source keys, cache eviction and optional service failures change the counts. Municipal count latency and application-host startup latency remain outside these cache changes.

The preceding live audit observed 1,000-row geometry responses in approximately 1.0 s and 2,000-row responses in approximately 1.2 s for this filter, while the count took about 3.3 s. It also observed a full old 50-plus-overview workflow around 7.4 s. Those were isolated remote measurements, not a load test, client-location measurement or p95 service objective. No post-change end-to-end speedup percentage is inferred from request-count reduction alone.
