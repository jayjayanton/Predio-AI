# PredioAI — Homeowner pilot and Quito public-data audit

**Reviewed:** 17 November 2026  
**Scope:** Public municipal data discovery, read-only access checks, product prioritization and owner-led plan acquisition. This is an audit/backlog, not a new live integration or a legal/engineering opinion.  
**Companion:** [Architectural methodology](ARCHITECTURAL_ANALYSIS_METHODOLOGY.md) · [Project README](../README.md)

## 1. Commercial focus for the next pilot

Primary users: homeowners, independent architects/small practices, and remodeling/construction firms. Lead with a real home-improvement task, initially selected floor surfaces or wall painting from adequate plans. Keep GIS discovery and comparison available; developers and insurance/peritaje remain complementary/future audiences, not equal launch priorities. This narrows go-to-market without deleting existing functionality.

The common workflow remains predio → user-supplied authorized PDF/DXF and relevant IRM → inspect and explore drawings → validate inputs → calculate reviewable quantities → reviewed reports. Existing geometry selection, layers and zoom are retained. Verified scale, architectural measurement, correction-driven recalculation and technical exports still need implementation and validation. Do not call these completed merely because the viewer renders polylines.

A working interpretation pipeline, not necessarily a newly trained ML model, is the next technical objective. Prefer explicit CAD/vector evidence and deterministic calculations. Scoring/clustering for parcels is a separate track.

## 2. Owner-led access to plans

The current official procedure is **Emisión de copias simples o certificadas de documentos ... bajo custodia de la Dirección Metropolitana de Gestión Documental y Archivos**. Its page was updated 8 November 2026 and covers records transferred into that office's custody. It lists a request form and identification, permits an authorized third party with additional documentation, and describes in-person service. The general listed procedure has no fee; this does not establish that every specialist plan, format or cartographic product is free.

Official entry: https://pam.quito.gob.ec/MDMQ_Tramites/Operativas/FrmFichaTramite?codtt=240

**Not established:** that every house has a complete archived drawing set; that this office holds every relevant file; that original DWG/DXF files are deliverable; that copies reflect later changes; or that plans can be retrieved anonymously through the predio GIS API. Historical plan-copy instructions are not substituted for the current procedure.

Recommended onboarding states (future workflow; the homepage currently supplies guidance only):

- **I have plans:** upload an authorized PDF/DXF copy and record document date/version.
- **I need a copy:** guide the user to identify the custodian, request available drawings and confirm format. The owner or authorized representative handles the request. Do not collect government credentials or identity documents in PredioAI merely to provide guidance.
- **I received a scan:** identify it explicitly and route to a separately validated raster/manual-calibration path; do not pretend it contains vector entities.
- **No adequate plan available:** explain missing evidence and the need to obtain suitable drawings or verified measurements rather than fabricate geometry.

Ask for available floor plans, sections, elevations, area schedules and revisions. Request a usable digital original when available; a scan can still be evidence but presents a different extraction problem. Government approval, cadastral polygons and the IRM do not by themselves verify interior dimensions or today's as-built condition.

## 3. How evidence is classified

**Metadata verified:** an official directory/layer definition was readable; not proof that every query or feature works.  
**Count query observed:** a browser audit obtained an anonymous returnCountOnly response; not a completeness, geometry, schema or production-reliability test.  
**Catalog only:** listed but fields, record access or interpretation need validation.  
**Reuse cleared:** requires an explicit applicable license/authorization. A public URL, empty copyright field or Query capability is not a commercial license.

No owner names, identity numbers or private plan records were intentionally collected. Do not harvest publicly exposed survey/administrative fields just because the server permits access. Query only needed, reviewed fields; avoid outFields=* in production.

All ArcGIS paths below are relative to:

```
https://geoquito.quito.gob.ec/server/rest/services/
```

Directory discovery:
- https://geoquito.quito.gob.ec/server/rest/services?f=pjson
- https://geoquito.quito.gob.ec/server/rest/services/web_reference_dmc?f=pjson
- https://geoquito.quito.gob.ec/server/rest/services/web_reference_dmot?f=pjson
- https://geoquito.quito.gob.ec/server/rest/services/Hosted?f=pjson

## 4. Prioritized source inventory

### A. Construction-unit geometry — promising but needs semantic verification

**Path:** `web_reference_dmc/catastro_dmc_view/MapServer/0`  
**Published layer:** Unidad constructiva (polygon). The same service lists Bloque (1), Predio municipal (2), Predio regularizado (14), Lote (15), Manzana (16).  
**Evidence:** layer metadata verified; no construction-unit feature retrieval/completeness check in this audit. Selected fields include `CAT_UC_ID` and `CAT_BLOQUE`; public metadata does not establish a complete room/floor model or a direct validated predio join.  
**Use hypothesis:** contextualize mapped construction within the lot and reconcile it with supplied plans.  
**Limits:** do not label it a certified building footprint, unique dwelling boundary or interior blueprint without checking the geometry's meaning, stacking and relationships. Metadata extents need sanity checks; use bounded area queries. No construction dates or update currency are inferred. SIRES-DMQ custom projection must be handled correctly.  
**Priority:** inspect sample geometries and mapping rules next; add only as contextual geometry.  
**Reuse:** not stated in inspected metadata.

Source: https://geoquito.quito.gob.ec/server/rest/services/web_reference_dmc/catastro_dmc_view/MapServer/0?f=pjson

### B. Heritage and archaeological context — high relevance for remodeling

**Path:** `web_reference_dmot/patrimonio/MapServer`  
**Layers:** Inventario inmueble (0); archaeological group (1), point sites (2), area sites (3), sensitivity zone (4), archaeological delimitation (5); Área histórica y patrimonial (6).  
**Evidence:** metadata reviewed; an anonymous count query for inventory layer 0 succeeded during the browser audit. Layer 0 uses `inventari` for its renderer. Not all layers received live feature-query tests.  
**Use hypothesis:** show an inventory/area intersection as a prompt to review applicable intervention conditions before changing a facade, layout or structure.  
**Limits:** mapped inventory presence is not an automatically parsed legal restriction; no-hit is not certification of unrestricted work. Verify current records and professional requirements separately.  
**Priority:** first context package, subject to reuse/schema checks.  
**Reuse:** not stated.

Source: https://geoquito.quito.gob.ec/server/rest/services/web_reference_dmot/patrimonio/MapServer/0?f=pjson

### C. Geographic features and ravines — location context, not a legal setback

**Path:** `web_reference_dmc/accidente_geografico/MapServer/0`  
**Published layer:** Tipo de accidente.  
**Evidence:** service catalog reviewed; browser audit reported a successful anonymous count query. Individual field/geometry interpretation needs independent sample verification; do not assume labels merely from the service title.  
**Related PUGS layers:** Red hídrica (11), Cuerpo de agua (12), Quebrada viva (14), under the PUGS service below.  
**Use hypothesis:** identify mapped nearby/intersecting features to guide extension/site review.  
**Limits:** no automatic ravine upper-edge delineation or legal protection-width buffer. Features from different dates/methods need reconciliation.  
**Priority:** first context package.  
**Reuse:** not stated.

Source: https://geoquito.quito.gob.ec/server/rest/services/web_reference_dmc/accidente_geografico/MapServer?f=pjson

### D. PUGS hazard context — add detail beyond the existing use/buildability layer

**Service:** `web_reference_dmot/plan_de_uso_y_gestion_del_suelo_2024/MapServer`  
**Candidate layers:** 18 mass-movement susceptibility; 19 flood susceptibility; 20 subsidence susceptibility; 22 volcanic-flow threat; 23 ashfall threat.  
**Evidence:** service metadata verified; individual metadata reviewed for 18, 19 and 20. Layer 18 field `nvl_dazmm`, layer 19 `nvl_dazin`, layer 20 `susc_rel`. Do not assume each layer covers every class or every location. The count-query attempts for these layers did not yield usable responses in this audit channel; live feature-query acceptance remains open.  
**Use hypothesis:** a source-dated, preliminary site-context panel for an architect.  
**Limits:** not structural damage, site-specific soil bearing capacity, seismic building vulnerability or permission to build. No intersection is not a safety clearance; unqueried/failed data is not absence. The service is explicitly a 2024 publication, not proof that every rule/layer is the latest applicable one.  
**Priority:** first context package, with cautious wording and clear coverage/errors.  
**Reuse:** not stated.

Sources:
- https://geoquito.quito.gob.ec/server/rest/services/web_reference_dmot/plan_de_uso_y_gestion_del_suelo_2024/MapServer?f=pjson
- https://geoquito.quito.gob.ec/server/rest/services/web_reference_dmot/plan_de_uso_y_gestion_del_suelo_2024/MapServer/18?f=pjson
- https://geoquito.quito.gob.ec/server/rest/services/web_reference_dmot/plan_de_uso_y_gestion_del_suelo_2024/MapServer/19?f=pjson
- https://geoquito.quito.gob.ec/server/rest/services/web_reference_dmot/plan_de_uso_y_gestion_del_suelo_2024/MapServer/20?f=pjson

### E. Roads and infrastructure — keep proposed, approved and existing separate

**PUGS layers:** main roads existing (68), projected (69), approved alignment (70), local roads (71); aqueduct (73), oil/pipeline layers (74–75), transmission/subtransmission lines (76), collector (77).  
**Evidence:** catalog definitions reviewed; layer 69 metadata independently verified with `tipg_via`/`catg_via` and polyline geometry. Other infrastructure field/sample tests remain open.  
**Use hypothesis:** surface a possible interaction with a planned extension and guide the questions for official review.  
**Limits:** a road centerline is not an official affected-area polygon; approved alignment does not mean built road. A pipe/line on a map does not prove a household service connection, capacity, easement width or live network condition.  
**Priority:** roads first for expansion projects; infrastructure later as verified context.  
**Reuse:** not stated.

Source: https://geoquito.quito.gob.ec/server/rest/services/web_reference_dmot/plan_de_uso_y_gestion_del_suelo_2024/MapServer/69?f=pjson

### F. Environmental protection — distinguish designation from proposals

**PUGS layers:** SNAP (2), national forest heritage (3), provincial areas (4), ACUS (6), AIER (7), wetland protection (8), ecological corridor (9), proposed SMANP areas (10).  
**Evidence:** service catalog reviewed; no individual feature-query acceptance yet.  
**Use hypothesis:** help users/professionals identify environmental-context review items when expanding or rebuilding.  
**Limits:** layer 10 explicitly contains proposals; do not treat it as enacted protection. Do not translate geometry into a categorical project prohibition without the applicable verified rule.  
**Priority:** part of the context review for relevant projects.  
**Reuse:** not stated.

Source: PUGS service metadata cited above.

### G. Lot occupation/buildability indicators — useful candidate, semantics unresolved

**Path:** `web_reference_dmot/indicadores_territoriales/MapServer`  
**Layers:** Compacidad (0); Nivel de ocupación del lote (1); Nivel de edificabilidad del lote (2).  
**Evidence:** service metadata verified; layer fields, methodology, observation date and sample results still need confirmation.  
**Use hypothesis:** offer a secondary comparison with plan/cadastral information once their definition is known.  
**Limits:** never treat the name alone as unused building rights, allowed expansion, remaining COS, floor area or a structural diagnosis.  
**Priority:** second wave.  
**Reuse:** not stated.

Source: https://geoquito.quito.gob.ec/server/rest/services/web_reference_dmot/indicadores_territoriales/MapServer?f=pjson

### H. Habitat Observatory — strongest explicit open-license finding

**Portal:** https://geoquito.quito.gob.ec/observatorio_habitat/Descargas.html  
**License:** the Observatory expressly publishes its material under **CC BY 4.0**, including commercial adaptation/reuse with attribution. Confirm that the precise file being used is covered; this is not a blanket license for every GeoQuito service or original photograph.  
**Published indicators:** qualitative housing deficit (DH_02), quantitative deficit (DH_01), crowding (DH_03), basic services (SB_01), sanitation (SB_02), waste collection (SB_03), tenure (AT_01), housing/building and urban-growth series, park vegetation. CSV packages include source/uncertainty notes.  
**Use hypothesis:** support market/pilot research and explain the need for housing improvement; show area-level environmental context separately.  
**Limits:** ENEMDU-derived Quito/national and selected urban/rural aggregates cannot classify an individual home's defects or an owner's finances. Sampling uncertainty and edition matter.  
**Priority:** research/pitch evidence now, not part of a homeowner's interior measurement calculation.

Catalog candidates associated with this broader environment include `Hosted/mancha_urbana_a_2024`, `Hosted/cobertura_suelo_a_2025`, `Hosted/cobertura_verde_parque_a_2025`, plus Sentinel-2 valid-coverage/no-coverage polygons. Verify each service's actual layer ID (not always 0), time period and license before integration. Directory presence or a year in a name is not validation. Some Observatory pages/editions describe different end-years for consolidated urban growth; use the downloaded version and changelog, not an assumed complete 2025 time series.

Methodology: https://geoquito.quito.gob.ec/observatorio_habitat/Metodologia.html

### I. Local obsolescence / upgrading candidates — research only

**Catalogs:**
- `Hosted/Obsolescencia_Física__La_Mariscal/MapServer/1` (also FeatureServer variant)
- `Hosted/mb_repotenciacion_edificaciones_092025_WFL1/FeatureServer/1` — published name: Lotes categorizados por AIVAS

**Evidence:** obsolescence service metadata lists one layer at ID 1 and a La Mariscal extent; methodology/currentness not established. The second service's layer 1 metadata and anonymous count response were observed by the browser audit; field names include cadastral/zoning references. The service title is not evidence of program eligibility or assessed damage. Do not expand the AIVAS acronym or infer status from a guessed meaning. Layer 0 was not a valid substitute for layer 1.  
**Use hypothesis:** investigate local rehabilitation research with the publisher.  
**Limits:** no whole-Quito coverage claim; a title/initial map extent does not establish actual coverage, approved interventions or current structural condition. The count response is not a validated building total.  
**Priority:** later; request metadata first.  
**Reuse:** not stated.

Sources:
- https://geoquito.quito.gob.ec/server/rest/services/Hosted/Obsolescencia_F%C3%ADsica__La_Mariscal/MapServer
- https://geoquito.quito.gob.ec/server/rest/services/Hosted/mb_repotenciacion_edificaciones_092025_WFL1/FeatureServer/1?f=pjson

## 5. Free access is not the same as free commercial integration

The read-only audit observed public metadata, and successful anonymous count requests for heritage inventory, geographic-feature and the identified upgrading-candidate layer. No token/paywall was required in those tested paths. Other sources were catalog/metadata checks only; some requests failed or were blocked. This does not establish an uptime guarantee, complete features or a reuse license.

Several inspected municipal layers have empty copyright/description metadata. Treat commercial use/caching/redistribution rights as **unconfirmed**, not public domain. Ask the publisher to confirm coverage, update frequency, source scale and reuse terms before deploying them commercially.

Quito separately advertises a paid base-cartography service. Do not promise free high-resolution survey-ready imagery, CAD or elevation simply because a web map displays it:
https://pam.quito.gob.ec/MDMQ_Tramites/Operativas/FrmFichaTramite?codtt=201

## 6. Proposed implementation sequence

1. **Measurement core:** validate one authorized vector PDF/DXF and a manually checked floor-surface task; then painting with documented heights/openings. Keep current viewer/IRM tools. Fail clearly on unknown scale or missing dimensions. No price/material estimates.
2. **Minimal context pilot:** heritage, mapped ravines/geographic features, susceptibility and relevant roads. Inspect construction-unit geometry as an additional candidate, not a substitute for uploaded plans. Obtain reuse/definition clarification first.
3. **Testable adapter layer:** register exact endpoint/layer, publisher, source date/version, CRS WKT, fields, license state and access-test state. Query a bounded selected-property area on demand, request only necessary fields, paginate according to source limits, deduplicate by IDs and preserve provenance.
4. **Three-state UI:** match found; no match in successfully queried coverage; unavailable/unverified. Preserve mixed zones, partial results and municipal-source failures. Never convert a timeout or missing class to a green safety badge.
5. **Deferred enrichment:** keep initial GIS search fast and GIS-only. Load context after selecting a property or choosing an intervention; do not execute every service for every result. For interior painting/flooring, avoid forcing all outdoor context into the main task.
6. **Validation:** test known interior, edge, outside-coverage, PH and source-outage cases. Compare results to official map/document evidence. Bounded feature-query and geometry tests are still required beyond this audit's metadata/count checks.

CRS matters: inspected services use custom **SIRES-DMQ** Transverse Mercator definitions, not automatically WGS84 longitude/latitude or standard UTM 17S. Request an explicit output CRS when supported or transform using the supplied definition. Preserve original evidence coordinates. Do not mix cadastral map coordinates with local CAD units or measure m² in degrees.

The future context card should say which source intersects, its publication/reference date, the intersection's scope and what must be verified. A PH result normally describes the parent lot unless a unit association has been verified. Do not silently assign a parent-lot restriction or area to a specific room.

## 7. Release boundary

This update changes homepage audience emphasis and adds plan-request guidance and this audit. It does **not** connect these candidate layers to the live app, implement a new model, retrieve anyone's plans, verify dimensions, issue permits or assess damage. The main technical deliverable remains a dependable, source-linked measurement workflow for homeowners and the small practices serving them.
