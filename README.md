# PredioAI

**Property and architectural-plan intelligence for improving homes.**

PredioAI began with a practical question: **how can someone understand their home and prepare work on it using the property record, existing drawings and municipal information?** Painting a room, replacing a floor, repairing or reorganizing a space, remodeling, reconstructing and expanding a house are central use cases, not an add-on to a land-search product.

The intended platform connects **predio + architectural PDF/CAD + relevant IRM information → structured evidence → interactive drawings → reviewed measurements and reports**. It is for ordinary homeowners as well as architects, remodeling contractors and construction teams. Real estate discovery is a complementary application of the same property context. A potential insurance/peritaje extension would connect plans with evidence of actual damage to support professional reporting; it is not implemented.

**Public-facing message:** “Entiende tus planos. Prepara tu reforma.”

**Working pilot with geometric measurements, scaled layout studies, footprint placement, ZIP drawing packages and illustrative 3D.** Confirm drawing units or calibrate a known length, measure supported source geometry, and draw or reshape metric furniture and extension proposals directly on the plan. A user-declared ground footprint can be extracted from a valid selected source contour, positioned on a linked parcel and compared with reviewed IRM parameters. These are preliminary geometric studies; architectural recognition, independent physical validation and certified technical reports remain further milestones. A ZIP organizes separate drawings for individual inspection, and illustrative 3D retains explicit height/roof assumptions. Explainable parcel scoring and unsupervised segmentation remain planned on a parallel analytics track.

[Open the application](https://jayjayanton.github.io/Predio-AI/) · [Architectural methodology and product scope](docs/ARCHITECTURAL_ANALYSIS_METHODOLOGY.md) · [Pilot presentation and real-document validation](docs/PILOT_VALIDATION.md) · [Deployment guide](DEPLOYMENT.md)

## UX focus and straightforward navigation

The public entry now answers a single question: **what does PredioAI help you do?** It is an experimental architectural-plan and municipal-context review tool for planning a household intervention—not a project-management platform, supplier finder, construction contractor, budget generator, or software that performs the renovation. The product does not currently generate verified architectural measurements or export finished takeoffs.

The first screen offers **two explicit paths**: **Analizar planos** opens document inspection directly for a home improvement task, while **Mi predio** provides cadastral/municipal information. Linking a predio is optional for document inspection and remains available from the plan workspace. **Explorar mapa** is a separate GIS discovery tool. **Selección** preserves the existing parcel portfolio. **Analítica** is accessible from the expanded complementary/future section of the homepage and through its existing hash route, without competing with primary tasks in the header.

Consumer-facing tasks are painting, flooring, repair, remodeling, reorganization and expansion. The measurement panel calculates supported geometry using the scale explicitly supplied by the user. It does not identify walls or rooms automatically, verify the building's current condition, prepare quotes, select contractors, procure materials or manage building works. Architectural interpretation and reviewed reports remain separate milestones. The guidance for obtaining municipal copies remains owner-led; PredioAI does not submit the request.

## Firm portfolios and sequential IRM review

**Selección** is now a local portfolio of up to **100 predios** rather than a four-column-only shortlist. The existing four-property side-by-side comparison is preserved as an optional subset. Users can import a **text-based PDF containing clearly labelled predio identifiers**, **CSV**, **Word DOCX tables**, or **Excel XLSX worksheets**. For tabular files, users select the sheet/table, header row and predio column, then preview and deselect suggested IDs before adding. A pasted list of one predio number per line is also supported. The example workbook *Impuesto Predial Actualizado 2021.xlsx* has its predio identifiers under the **Cédula Catastral** heading on the second content row; monetary columns must never be interpreted as predio IDs. Import is handled in the browser (PDF.js) and only approved identifiers and non-sensitive workflow markers are persisted. The original PDF, raw text and IRM documents are **not stored**. Scanned PDFs require OCR or manual identifier entry. Legacy binary Word .doc and Excel .xls require conversion to .docx/.xlsx or CSV. No OCR is claimed.

After importing, the user can click **Completar datos municipales · hasta 10** to perform sequential, user-triggered property lookups for up to ten sparse imported IDs per batch. Only a matching municipal predio number is accepted, and failed lookups stay pending; this does not request IRMs. Each property also has its own **Abrir ficha / IRM** action. Municipal details are queried **one property at a time**, and the official IRM retrieval/CAPTCHA and user upload/review remain individual. Portfolio status is an optional **manual** reviewed/pending marker and must not be confused with automatic verification or storage of an IRM. Imported identifiers are not assumed to be confirmed municipal properties and any unknown cadastral fields remain blank until a consultation. The list can be filtered and exported to CSV; the portfolio is browser-local, not synchronized across devices or firms.

**Privacy and reliability:** A PDF may contain owner names or ID numbers. The importer extracts only clearly labelled numeric predio IDs and, if unambiguously on the same row, a cadastral key. It does not upload the PDF to the backend or persist document text. Review of candidate IDs is required before saving. There is no bulk municipal scraping or automatic bypass of the official IRM portal.

## Product status and navigation

The interface is in Spanish and the initial municipal-data scope is Quito's Distrito Metropolitano. Municipal connectivity, document type and drawing quality affect what can be inspected.

| Section | Purpose |
| --- | --- |
| **Inicio** | One clear proposition, two choices (plans or property), what's implemented, what's not, and everyday use cases |
| **Analizar planos** | Inspect an authorized drawing, confirm scale, arrange metric figures, extract a declared ground footprint and optionally review its placement with a predio and IRM |
| **Mi predio** | Look up a predio, inspect its cadastral information and continue to IRM review or the document workflow |
| **Explorar mapa** | Find cadastral records, browse the map and open a property sheet |
| **Selección** | Manage up to 100 predios, import labelled IDs from PDF/CSV/DOCX/XLSX or pasted list, open each for IRM, compare four at a time, export CSV |
| **Analítica (secondary)** | Roadmap for future parcel scoring and unsupervised segmentation, linked under complementary capabilities; no active scores |

The architectural journey is **select the work → supply a plan → confirm scale and study the layout → optionally link a predio and matching IRM → review the evidence**. Opening or reloading `#planos` enters the same document workspace. After inspection, the drawing stays visible in the full-width studio; document intake can be collapsed and **Resumen documental** opens explicitly. File errors appear beside the upload controls, unsupported/empty/oversized files are rejected before sending, and changed inputs invalidate an in-flight analysis. Local footprint JSON and proposed WGS84 GeoJSON exports are available; verified architectural reports remain planned.

## One product foundation, multiple applications

| Audience | Intended job | Scope |
| --- | --- | --- |
| Homeowners | Understand a project and prepare painting, flooring, repair, renovation, reorganization, reconstruction or expansion | The originating use case; inspected geometry is available, verified quantities are pending |
| Architects and construction/remodeling firms | Review drawings remotely and prepare traceable intervention measurements and client reports | Document inspection and user-calibrated geometric measurements exist; reviewed architectural takeoffs and technical exports are planned |
| Real estate firms and developers | Discover and compare parcels and review their municipal context | Existing discovery and comparison tools; scoring and segmentation are planned |
| Insurers and loss-assessment professionals | Associate damage evidence with building elements and prepare reviewed reports for clients | Potential future extension; no damage-assessment or claims engine exists |

The common asset is the property's linked evidence, not a different product for every audience. Start with an understandable homeowner task; expose professional detail progressively. Do not advertise automatic prices, materials, professional certification or elimination of every site visit.

### Future insurance example

For a wall affected by an earthquake, a possible workflow would link the documented wall to dated photographs, observations and verified dimensions; record the observed extent and missing evidence; then let an authorized professional review an evidence-linked report before sharing it with the client. Plans alone do not reveal the damage that occurred. Hidden damage, structural safety, causation, policy coverage and compensation are not conclusions to generate automatically. This extension requires separate validation, consent/access controls and professional review before release.

## What works today

### Architectural document workspace

The project workflow accepts PDF, DXF and DWG drawings or a ZIP containing those formats, a building type and repair/maintenance/remodeling/structural/expansion activities. DWG files are converted locally on the API server to DXF before extraction; deployment must install the pinned converter described in [DEPLOYMENT.md](DEPLOYMENT.md). The drawing workspace pairs an overview with a detailed inspection canvas, layer controls, individual/rectangle selection and a searchable source-element list. **Ver plano de ejemplo** opens a clearly fictional drawing without uploading a file. CAD imports retain all supported geometry within explicit whole-import resource limits, rather than stopping the display at 3,000 elements. Curves are approximated for display with their source identity retained; unsupported content and conversion warnings remain visible. A selected polyline is not automatically a recognized wall, a measured room or an editable construction design.

Project documents are submitted to the FastAPI `/api/documents/analyze` endpoint. PDF/DXF parsing uses memory; DWG conversion uses a private temporary directory cleaned up after processing. Files are not saved as permanent projects. This is separate from the browser-only developer IRM parser described below. The visual studio sends **`review_scope=drawing_study`**, allowing any valid activity, including an extension study, to be visualized without an IRM. The API default **`document_review`** preserves its existing prerequisites: repair, maintenance and remodeling containing only `replace_floor` may omit an IRM; other remodeling, mixed requests, structural modification and expansion require one. Neither scope establishes permit requirements or certifies the intervention as nonstructural.

The on-screen **document summary** describes inspection evidence, layout-study quantities and unresolved architectural information. It identifies when no predio is linked. **Medidas** calculates geometric lengths and areas after explicit unit confirmation or known-length calibration, independently of the API's extraction-only result. User-confirmed scale is not independent physical verification. Verified wall heights, opening deductions, architectural classification and reviewed measurement reports remain future work. Heights and roofs entered in **Ilustración 3D** are hypotheses for that illustration. The system does not automatically estimate materials, construction costs, market prices or certify regulatory compliance. Validation against independently checked real-project dimensions remains pending.

### ZIP drawing packages

Upload a standard ZIP to keep related floor plans, sections, elevations and other drawings together. Normal folder paths are preserved in the package selector. The server inventories supported PDF/DXF/DWG entries and inspects **one chosen drawing per request**; the first inspection opens the first supported path in sorted order. Selecting another entry sends the ZIP again with that exact entry path. Other drawings are not decompressed or parsed during that request.

| Package limit | Current value |
| --- | --- |
| Uploaded ZIP | 30 MiB |
| Each supported drawing | 15 MiB |
| Archive entries / supported drawings | 1,000 / 100 |
| Advertised total uncompressed content | 150 MiB |

The importer rejects unsafe or ambiguous paths, links, encrypted entries and excessive expansion. It skips macOS auxiliary files, unsupported formats and nested archives, with counts and notices. A selected drawing that cannot be inspected keeps the inventory available so another entry can be opened. Temporary CAD/converter errors remain retryable. See [document inspection](backend/DOCUMENT_ANALYSIS.md) for the full API contract and resource boundaries.

The package is an ephemeral drawing inventory. It is not saved as a project, and CAD external references are not assembled or linked automatically. A single CAD file can already contain multiple drawings or layouts; a file, layer or layout does not by itself identify a floor. A section marker alone does not supply the section geometry. Additional floors, elevations and roof information are available only when the supplied drawings actually contain them.

### Selection measurements

Open **Medidas** in the drawing inspector. For a CAD model, review the declared units and explicitly apply the appropriate unit. Alternatively, select one eligible line or path, enter its independently known length in metres and apply calibration. PDF pages and paper layouts require known-length calibration. Each exact imported view retains its own confirmed scale and layout draft during the active session; an unseen view starts unconfirmed and returning to a previously visited view restores only its own state. Replacing the drawing or inspecting a different ZIP member does not transfer that calibration or draft. Reloading the page does not restore a saved project.

**Unidad de las coordenadas CAD** describes the units of the imported coordinates, not the desired display units: results are displayed in metres and square metres. A manual unit that differs from the file's declaration shows a persistent warning above the values and an explicit button to apply the declared unit. Metadata remains a suggestion rather than independent verification.

The panel reports selected geometric length and, for a supported simple closed boundary, perimeter and enclosed area. Curved geometry uses the imported sampled paths and is labelled approximate. Text, dimension decorations and hatch-pattern strokes are excluded; explicit hatch boundaries can be measured. Disconnected, branching, crossing, ambiguous or overly complex selections do not produce an area. Selecting the whole drawing does not define a floor surface.

Selected, compatible and excluded counts appear together before the values. **Volver al plano** returns focus to the drawing without changing the selection, zoom or applied scale. Calibration factors retain significant digits and show an approximation sign when their display is rounded; U.S. survey feet are a separate explicit unit choice.

A source hatch's rendered outer and inner boundaries stay in one selectable element, including patterned hatches. Valid nested contours subtract holes from area; perimeter includes their inner edges. Pattern strokes remain separately selectable and excluded from measurement. A smaller item count after reimport can reflect this source grouping without losing drawing segments. Hatch island style is respected before the contours are grouped.

**Área de contorno** selects an existing closed source boundary by clicking inside it. It replaces the selection with one contour and explicitly measures its exterior; when several source hatches contain the point, the user chooses one. This tool does not join open lines, read an area from a label, or identify rooms. A compound selection also offers **Trazado CAD con recortes** (the default) and **Solo contorno exterior**. Exterior mode highlights only the measured outside boundary and does not deduct internal masks, which can represent furniture graphics rather than physical floor openings. Review the boundary and the intended area convention. Changing the selection resets this convention to the source geometry.

**Ver plano de ejemplo** includes a separate **Área de ejemplo** layer. Select its boundary and apply centimetres: the fictional 4.42 × 2.44 m rectangle has perimeter 13.72 m and area 10.7848 m². This is a reproducible arithmetic demonstration, not a real-building measurement.

Unit-code and layout context references: [Autodesk INSUNITS](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-Core/files/GUID-A58A87BB-482B-4042-A00A-EEF55A2B4FD8.htm) and [ezdxf DXF units](https://ezdxf.readthedocs.io/en/stable/concepts/units.html). Unit metadata suggests an interpretation; the panel still requires explicit confirmation or calibration.

### Scaled figures and ground-footprint extraction

The inspector separates **Medidas**, **Figuras**, **Huella** and **Capas**. After confirming scale, use **Figuras → Dibujar sobre el plano** to create a proposal at the intended location. Drag to size a rectangle, square or circle; place three corners for a triangle; or click successive corners and close a custom polygon. Valid concave polygons, such as an L-shaped extension, are supported. Width, depth, area and perimeter follow the applied scale, with no fixed preset size required.

Select a figure to move it, reshape its corners or scale the whole figure. Add or remove polygon corners, edit dimensions, name, rotation and furniture/extension role, duplicate/delete, and undo/redo committed edits. Invalid crossing or degenerate polygons cannot be committed. Existing metric presets remain optional shortcuts: a **1.60 × 0.90 m table**, **1 m diameter circle**, or **3 × 4 m extension rectangle**. The 10 cm adjustment controls and keyboard arrows (5 cm; Shift + arrow = 50 cm) support fine placement. Zoom and pan change only the viewport: figures retain their metric dimensions. The CAD source is not rewritten. Furniture/reference figures are excluded from added building occupation; hiding a figure affects display only.

For **Huella de planta**, select one valid closed CAD contour and explicitly declare that it represents the ground footprint being studied. The extracted local-metre polygon preserves valid interior holes. A polygon drawn in **Figuras** is a user-created proposal and does not become the source footprint or verified existing construction. Open, intersecting, disjoint, ambiguous or nested-island source contours remain unavailable; extraction does not automatically identify a building, assemble wall lines or trace a raster image. Reconfirm the footprint after changing scale: figures retain their metre dimensions, but their positions and the newly scaled source need review.

The opaque draft and scale survive a documentary-summary round trip for the same imported drawing/view. First linking a predio retains that drawing, but still requires an explicit document-to-parcel association. A matching IRM can be attached later through `/api/irm/extract` without reconverting the CAD or discarding its layout. An updated IRM clears document-review confirmations and requires its new values to be checked. These states are temporary application memory, not durable project storage.

### Parcel placement and preliminary IRM comparison

**Usar como huella** opens and focuses **Tu huella sobre el predio**, directly below the drawing viewer. With a linked predio, its Esri satellite map opens automatically and frames the parcel; without one, the local study remains available with a linking action. The source and download actions stay visible, and the receipt explains that this is a session draft: export before reloading, closing or replacing the drawing. Ordinary figure edits do not navigate away from the drawing or reset the selected planner panel.

Position the local origin by dragging the map anchor, adjusting the rotation, or opening the precise coordinate controls. Rotation is clockwise; scale is never changed to make a footprint fit the parcel. Review and explicitly confirm the position/orientation. This is a **manual proposed placement**, not a recovered CAD georeference or verified survey. Editing its position or orientation clears that confirmation.

`POST /api/planning/assess` performs bounded deterministic comparisons in metres. Extension polygons, including valid custom concave shapes, are unioned with the existing footprint, so overlaps are counted once; furniture is excluded. Committing an extension's geometry or role change clears the scenario's countable-area review and requires the final proposal areas to be checked again. With a reviewed placement, the service reports the proposed footprint's area outside the supplied parcel. IRM values remain extracted candidates until reviewed. The following checks have separate pending, conflict or within-reviewed-limits states:

- The selected predio, IRM identifier and any explicit drawing identifier must agree, with the document association confirmed by the user.
- The reviewer must establish a complete ground footprint for the individual lot, the applicable single parameter set and the absence of unresolved special conditions. PH, multiple assignments and restriction evidence keep the general numeric review pending.
- **Geometric footprint area is not automatically municipal countable area.** For COS PB, enter the reviewed final ground-floor countable area or explicitly confirm that it equals the combined footprint. Existing construction and the proposed addition must both be included. Total countable floor area, maximum height and number of floors are separate inputs; none is inferred from the ground plan.
- Front, side and rear parcel edges must be classified by the user before checking their reviewed setbacks. The front is not inferred from north. Incomplete edge classification, parcel holes and special boundaries prevent a complete setback result.
- A difference greater than 5% between the projected parcel area and reviewed documentary land area keeps normative comparisons pending. A successful numeric comparison never constitutes permission to build, structural feasibility or municipal certification.

**Live setback feedback:** after the predio, IRM, scope, placement and applicable edge requirements have been reviewed, creating, moving or resizing an extension checks that figure immediately in the drawing. Crossing a reviewed setback turns it red and shows the required clearance, proposed clearance and shortfall. Exact equality with a minimum setback is amber **En el límite**, not a violation. A valid hypothetical conflict remains editable; the application does not silently clip it. Existing construction and each extension are checked independently, while furniture is excluded. Missing or stale evidence remains **Retiros por revisar**, and incomplete edge classification cannot produce an all-clear result. COS and other checks remain separate.

The map and local footprint preview also show each submitted figure's status. Direct polygon drawing still takes place in the CAD viewer; the map positions the whole drawing study. **Prueba cómo avisa un retiro** provides a detached, explicitly fictional 5 m example using the same metric evaluator. Its values never become rules or geometry for the current project, including Campolivar.

**Visible setback envelope:** after the complete review above, the map and CAD drawing show the area inside the reviewed setbacks and the excluded strip. The API's `buildable_envelope` clips the actual parcel against each classified edge's metric setback; it is not an axis-aligned bounding box. Frontage width (`frente_minimo`) is distinct from the inward front setback (`retiro_frontal`). Straight offsets are exact; round caps are conservatively approximated outward by at most 5 mm for display, while existing exact-distance checks remain authoritative. An empty envelope is explicit; unknown, stale or incomplete evidence never produces a green area. Envelope processing has separate bounds (512 edges, 65,536 buffer vertices, 20,000 output vertices), so an unavailable visual does not disable eligible distance checks.

The IRM review prominently exposes front/side/rear classification and a specific next-step status. **Consultar esquema del IRM** loads the reference diagram only on request from the exact inspected PDF, caches it by file identity, and provides the original PDF when a diagram cannot be identified. Its 15 MB / 100-page limit matches the existing browser IRM reader. The diagram is a document reference; its pixels never define the parcel, setback distances or a geographic placement.

**Exports:** local footprint JSON records metre coordinates, the source origin, scale, figures and `geographic_crs: null`. Once a proposed placement is available, GeoJSON contains WGS84 coordinates, placement provenance and `verified: false`; it is not a verified geospatial registration. Neither export is a finished architectural report or a project file that the app can reopen.

Current bounds: the viewer allows 60 figures, up to 128 corners per custom polygon, dimensions from 0.01 to 200 m, up to 40 undo steps and footprint spans up to 5 km, with the existing 2,000-segment source-topology limit. The assessment API caps JSON at 1,000,000 bytes, 100 shapes and 10,000 total positions across submitted polygons, and rejects invalid geometry instead of repairing it silently. Parcel calculations use a 25 km projected-coordinate bound around the placement anchor. These limits describe computational scope, not surveying accuracy.

**Example separation:** the supplied Campolivar DWG has no associated IRM or confirmed predio. The built-in fictional drawing also has neither. Both remain useful standalone layout studies; an IRM from another example must never supply their location or regulatory parameters.

Automatic building recognition, converting a manually drawn proposal into an established source footprint, raster footprint extraction, persistent project saving and final technical certification are not implemented. Direct polygon drawing is available for layout proposals; existing source geometry and user-created figures retain separate meanings throughout this workflow.

### Illustrative reconstruction

Select one eligible closed contour, explicitly apply a unit or calibration in **Medidas**, and open **Ilustración 3D**. The base follows the selected drawing's exterior footprint, including supported concavities, with the user's applied scale. It is not replaced by a rectangular approximation. Curves retain their imported approximation. Interior rings and graphic masks are explicitly ignored for this exterior illustration and do not become inferred openings.

| Editable assumption | Supported values |
| --- | --- |
| Height | 0.3–12 m; initial example 2.6 m |
| Roof | None initially, flat, or gable |
| Gable pitch | 1–60°; initial example 20° |
| Gable ridge direction | Parallel to the drawing's X or Y axis |

For a gable roof, the entered height is the assumed eaves height; the displayed illustrative maximum also includes the assumed ridge rise. Edit the inputs and choose **Actualizar ilustración** to apply them. Unapplied or invalid edits retain the last applied illustration. **Vista 3D**, **Frente ilustrativo**, **Lado ilustrativo** and **Planta** show the same hypothetical volume. Front and side views are projections of that volume, not actual architectural sections or elevations extracted from the file.

This does not infer interior walls, doors/windows, openings, additional storeys, actual height or the existing roof. Source geometry and geometric measurements remain unchanged. The illustration and its assumptions are temporary and reset when the selected contour, drawing/view or scale changes.

**Fictional demonstration:** open **Ver plano de ejemplo**, select the closed boundary on **Área de ejemplo**, open **Medidas**, choose **cm** and click **Aplicar unidad**. Open **Ilustración 3D**, edit the height and roof assumptions, then click **Actualizar ilustración**. Compare the 3D/front/side views and return with **Volver al plano fuente**. The example demonstrates geometry and editable assumptions without using a private drawing or claiming that an actual building has those heights or roof.

### Drawing location and IRM coordinates

Document inspection includes **Ubicación y vínculo con el IRM** in the drawing workspace and documentary summary. Each source keeps its own coordinate system, original point, geographic reference and extraction status. The visual drawing study can proceed without an IRM for any activity; the default API document-review prerequisites remain separate. Attach the corresponding IRM when available.

- CAD analysis exposes original modelspace coordinate extents and their provenance. Recorded header extents are cached drawing metadata, not surveyed parcel limits. Viewer coordinates, user-confirmed measurement scale and illustrative 3D coordinates are not geographic coordinates.
- Supported CAD geolocation metadata can produce a WGS84 reference point. Standalone CAD latitude/longitude header settings are excluded as location evidence, including the documented AutoCAD default pair. An absent or unsupported reference remains pending.
- Clearly labeled IRM coordinates retain page and source evidence. Explicit **SIRES-DMQ** (including the IRM spelling **SIRES MDQ**) uses Quito's published WGS84 modified Transverse Mercator definition: central meridian −78.5°, latitude of origin 0°, scale 1.0004584, false easting 500,000 m and false northing 10,000,000 m. This is not standard UTM zone 17S. Extraction and conversion do not independently verify the property.
- Users can add a temporary, attributed reference using WGS84 latitude/longitude or projected X/Y with a supported, explicitly supplied CRS. `POST /api/coordinates/transform` performs a bounded local conversion; it does not accept arbitrary projection pipelines or download transformation grids. A reference point does not translate, rotate, scale or georeference the CAD geometry.
- The panel compares explicit predio candidates and geographic reference points when available. Matching identifiers or nearby points do not certify that the drawing and IRM describe the same building. Filename digits never become a cadastral identifier. References reset with a new inspection or ZIP member and are not saved as a permanent project.

Projection source: [GeoQuito's municipal SIRES-DMQ definition](https://geoquito.quito.gob.ec/server/rest/services/web_reference_dmot/division_politica_administrativa/MapServer?f=pjson). CAD defaults: [Autodesk LATITUDE](https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-LT/files/GUID-BBA986D3-9BA8-4160-9471-55DAC9EDCA70.htm) and [LONGITUDE](https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-LT/files/GUID-C745C49D-3646-4C3E-B32E-7AC0F89E854E.htm).

### Geographic discovery

- Search by land-area range, cadastral urban/rural classification and multiple parishes, including a shortcut for the valleys.
- Add optional filters for minimum frontage, zonal administration, ownership regime and a single **maximum construction-to-land percentage from 0 to 100**. A blank percentage leaves that filter inactive. This ratio uses `area_const / area_terre`; it is not COS or building-footprint coverage.
- Apply filters to the municipal query before counting and pagination. Administration and ownership choices come from published distinct values.
- Browse compact results, sort by identifier or land area, and choose **50/100 records per page in Lista** or **100/200 in Iconos**.
- Select a card or polygon, inspect its information and open **Ficha predial**. Map selection remains synchronized with the result list.
- Switch streets, OSM, topographic and satellite basemaps. Nearby parcel outlines and source context remain available.

The map defaults to **1,000 matching cadastral features**, with an optional **2,000-feature** overview. The current card page is also included, so a selected result beyond the overview remains visible. The first results page becomes usable before the overview finishes; an overview error preserves that page and exposes a retry. A message identifies partial coverage. The count is a municipal query count, not properties offered for sale.

Discovery reuses short-lived, source-specific query snapshots across page sizes and layouts. Nearby 2026 parcel outlines use bounded fixed-tile caching and an enforced **2,400-feature display cap**; partial coverage is labeled. These display caches do not replace the exact cadastral geometry used for property analysis. See [REST efficiency and larger-map validation](docs/REST_PERFORMANCE.md) for cache limits, evidence and the conditions for reconsidering GeoParquet.

### Property information and comparison

The property sheet shows cadastral identification, parish, land and construction areas, ownership regime and returned valuation information. It distinguishes an individual **propiedad horizontal (PH)** unit from its shared **lote matriz**. Cadastral valuations and zonal AIVA references are not market appraisals or contractor costs.

**Selección** stores up to 100 sparse descriptive records in the current browser's `localStorage`. Users can import lists, review each predio, compare any four selected records, reopen a property for a fresh lookup and download a UTF-8 CSV. PH attributed area stays separate from parent-lot area.

This is browser-local storage, not an account, shared team workspace or permanent project database. Uploaded documents and owner details are not included. When storage is unavailable, the selection remains in application memory for the active page session.

### Assisted IRM review

1. Open the selected property's IRM workflow.
2. Copy its predio number and open the official municipal portal.
3. Complete the municipal CAPTCHA manually and obtain the official PDF.
4. Select that PDF in PredioAI and review extracted fields and evidence.
5. Confirm relevant values before using available theoretical capacity calculations.

**The developer IRM workflow parses the PDF locally using PDF.js.** It does not upload this file to Render or call `/api/irm/extract`. File, fields and images are ephemeral: cleared on reload or property change. Previous session-stored extractions are not restored.

The browser parser accepts PDFs up to **15 MB / 100 pages**. Recognizable text and evidence are **unverified candidates**; a detected predio number conflicting with the selected property is rejected. Scanned documents may need OCR, which is not implemented in this workflow.

Review includes available IRM/PUGS context, documented conditions and preliminary COS calculations after confirmation. The rectangular residential simulator is conceptual. These outputs do not authorize construction, establish permitted density or certify subdivision. In PH, the parent-lot area is never substituted for the unit's attributed area.

### Optional spatial zoning review

After discovery, users can request preliminary PUGS review of the **current results page**. Retrieved geometries are sent in batches of at most **100 per request**, including a 200-result page.

`POST /api/pugs/spatial-screen` retrieves PUGS geometry by fixed tiles, reuses a **15-minute process-local memory cache of projected polygons and spatial indexes**, and intersects polygons using a Shapely `STRtree` in **EPSG:32717**. Concurrent requests share missing tile loads. Single-property and batch overlays preserve polygon holes. Exact pagination boundaries are checked without treating truncated responses as complete. This is bounded retrieval, not a persistent whole-city zoning database.

The API reuses a lifespan-managed municipal HTTP connection pool with at most four active upstream requests per worker. A bounded **60-second cadastral core cache** lets a property sheet and its following PUGS lookup share source-matched geometry. PUGS does not repeat optional AIVA valuation requests.

The response distinguishes `single_zone`, `multiple_zones`, `no_intersection`, `unavailable` and `ambiguous`. Incomplete responses are not negative eligibility decisions. VU/VB/VM labels require explicit codes in examined fields; missing codes do not imply prohibition. The evidence filter applies to the current page, not all of Quito.

## Development priorities

| Direction | Intended outcome | Status |
| --- | --- | --- |
| Architectural measurement engine | Associate reviewed building elements and quantities with confirmed physical evidence, corrections and recalculation | Geometric selection panel implemented; architectural verification remains pending |
| Reviewed project reports | Export evidence, measurements, formulas, missing inputs and review status | Planned; not the existing inspection summary |
| Homeowner/professional pilot | Test a painting, flooring or renovation task against manually verified references | Proposed |
| Explainable parcel scoring | Compare parcels under explicit criteria, weights, constraints and data-quality indicators | Parallel planned analytics track |
| Unsupervised segmentation | Explore and validate groups of parcels with similar characteristics | Parallel planned analytics track |
| Insurance damage-documentation support | Link actual-condition evidence and plans for a professional's report | Potential extension; not implemented |

Any claim of reduced time, cost or site visits is a **hypothesis to validate**, not a measured outcome. Record document adequacy, measurement error, corrections and the visits still required. Similarity between parcels does not establish profitability, construction feasibility or damage severity.

## Design and UX

Retain the ivory/forest visual system and existing GIS/document workflows. The homepage now leads with household interventions and interactive plans rather than lot acquisition. It distinguishes working geometry inspection, future verified measurements and potential insurance use. A document-workflow card replaces the territorial illustration as the main homepage visual; it contains no invented parcel or measurement results.

Existing interaction improvements remain: map-to-property navigation, a 100-predio local portfolio with four-property comparison, progressively disclosed filters, compact results, loading/error/empty states, responsive layouts, accessible control labels, keyboard focus and reduced-motion support. Parcel popups remain available without the unwanted black rectangular map focus outline. Document inspection now opens directly and keeps the vector viewer visible; dragging the background works alongside element selection.

Validate before release. Passing CI does not verify municipal service availability, a drawing's scale or its correspondence with current conditions.

## Architecture

| Layer | Implementation |
| --- | --- |
| Application | React 18, Vite, hash-based navigation |
| Maps | React Leaflet / Leaflet, municipal ArcGIS data, Esri and OpenStreetMap basemaps |
| Developer IRM parser | PDF.js in the browser; ephemeral file and extracted state |
| Comparison selection | Browser-local snapshots and client-side CSV export |
| API | Python / FastAPI / HTTPX |
| Spatial zoning | Shapely, pyproj, bounded PUGS tile retrieval and memory cache |
| Experimental PDF/DXF/DWG analysis | PyMuPDF, ezdxf and a bounded local LibreDWG conversion process |
| ZIP project packages | Bounded archive inventory and one selected drawing per request; no xref assembly or permanent storage |
| Illustrative reconstruction | Browser-local Three.js scene from a selected exterior contour and explicit user assumptions |
| Scaled layout and footprint | Browser-local metric shapes, per-view draft/history, validated selected contour and local JSON export |
| Placement and numeric IRM study | Shapely polygon operations and pyproj local metric projection, reviewed inputs and proposed WGS84 GeoJSON export |
| Hosting | GitHub Pages frontend + Render FastAPI backend |
| Optional desktop IRM assistant | Local Docker container with Playwright, Chromium and browser-accessible desktop |

```text
frontend/       React application, browser IRM parsing, comparison and tests
backend/        FastAPI services, spatial/document analysis and tests
automation/     Optional Dockerized IRM desktop assistant
docs/           Architectural methodology, product scope and screenshots
.github/        Validation and GitHub Pages workflows
render.yaml     Existing Render backend configuration
```

## Run locally

**Requirements:** Node.js 20+ and Python 3.11+. Use the existing `main` branch.

In one terminal:

```powershell
cd backend
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

API documentation: [http://localhost:8000/docs](http://localhost:8000/docs).

In another terminal:

```powershell
cd frontend
npm ci
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The frontend defaults to the local API; copy `frontend/.env.example` to `frontend/.env.local` for an override. Sample lookup: **Número de predio**, `627739`; results depend on the live municipal service.

| Variable | Purpose | Default / production setting |
| --- | --- | --- |
| `VITE_API_URL` | Frontend API origin, read at build time | Local: `http://localhost:8000`; deployed: `https://predioai-api.onrender.com` |
| `VITE_BASE_PATH` | Frontend asset base, read at build time | Production default: `/Predio-AI/`; use `/` for root hosting |
| `CORS_ORIGINS` | Permitted frontend origins | Local: `http://localhost:5173`; Render: `https://jayjayanton.github.io` |
| `QUITO_ARCGIS_URL` | Backend cadastral layer; trailing `/query` accepted | Municipal `predios_a_2024/FeatureServer/0` |

The explorer queries its municipal ArcGIS source directly. Changing backend `QUITO_ARCGIS_URL` does not reconfigure that frontend source.

## API overview

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Backend health |
| GET | `/api/municipal/fields` | Published cadastral field metadata |
| GET | `/api/predios/{identifier_type}/{identifier}` | GeoJSON lookup by `clave_cata` or `n_predio` |
| GET | `/api/property-details/{identifier_type}/{identifier}` | Structured property details |
| GET | `/api/predios/by-cadastral-key/{cadastral_key}` | Legacy cadastral-key lookup |
| GET | `/api/pugs/{identifier_type}/{identifier}` | Full-polygon PUGS query for one property |
| POST | `/api/pugs/spatial-screen` | Screen up to 100 supplied parcel polygons |
| POST | `/api/pugs/screen` | Compatibility endpoint for up to 20 identifiers; not used by advanced explorer |
| POST | `/api/blueprints/inspect` | Basic PDF metadata and drawing/text counts |
| POST | `/api/documents/analyze` | PDF/DXF/DWG or selected ZIP inspection; `drawing_study` permits visualization without IRM, while default `document_review` retains conditional prerequisites |
| POST | `/api/irm/extract` | Attach/review an IRM after drawing inspection without reprocessing the CAD; separate from the browser developer IRM parser |
| POST | `/api/coordinates/transform` | Convert an explicitly referenced point without registering CAD geometry |
| POST | `/api/planning/assess` | Bounded footprint, placement, parcel and reviewed IRM comparisons; no regulatory approval |

Individual document uploads and supported drawings inside a ZIP have a **15 MiB limit**; a ZIP blueprint upload has a **30 MiB limit**. ZIP requests can include `package_entry` to select an exact supported path from the returned inventory. PDF inspection limits documents to **100 pages**. Extraction is evidence, not verified measurements, certification or completed technical reports. Browser-local illustrative assumptions are not submitted to the extraction endpoint.

## Validation and deployment

Frontend, from `frontend/`:

```powershell
npm ci
npm test
npm run build
```

Backend, from `backend/`:

```powershell
python -m pytest tests -q
```

Frontend tests cover selection normalization, persistence validation, CSV export, direct-plan routing, upload validation, review scopes, ZIP selection/error state, illustrative geometry and product-positioning guards. Scaled-study tests exercise metric dimensions through zoom, pointer drag commits, undo/redo, footprint holes, scale invalidation, exact-view restoration and replacement isolation. Planning tests cover candidate review, association gates, exports and stale-result handling. Backend tests cover document/spatial processing, ZIP boundaries, retained `document_review` prerequisites, `drawing_study`, polygon union/containment, countable-area distinctions, setbacks, projection and input limits. Browser review should check these connected workflows at desktop and narrow widths as well as existing map/list selection and failed-request states. Passing numerical tests does not establish real-building accuracy or municipal approval.

CI runs backend tests and frontend tests/build. The Pages workflow tests/builds the frontend and deploys on pushes to **`main`** or manual dispatch. Its backend test job is separate; publication is not proof that the API or upstream municipal services are healthy.

The existing Pages project demonstration uses Vite's `/Predio-AI/` base path. `VITE_BASE_PATH=/` prepares a build for a root-domain frontend; `VITE_API_URL` is baked into either build. Render uses `render.yaml` for the existing backend; GitHub Pages cannot run FastAPI. A sleeping backend can slow the first lookup. The commercial-hosting path and domain procedure are documented in [DEPLOYMENT.md](DEPLOYMENT.md).

### Optional desktop IRM assistant

The manual portal workflow needs no additional software. The experimental assistant sends the selected predio number to a Docker bridge at `127.0.0.1:8765`, opens containerized Chromium on a local browser screen and waits for manual CAPTCHA/report navigation. Import back into PredioAI remains manual.

On Windows, install and start Docker Desktop, then double-click:

```powershell
automation\start_docker_windows.bat
```

The launcher builds and starts the local image, opens the browser view at `127.0.0.1:6080`, and maps generated PDFs to the user's Downloads folder. Python, Playwright and Chromium do not need to be installed on the host. Docker remains optional desktop software and is not a Render backend requirement. Browser local-network permissions may affect the bridge. See [automation/README.md](automation/README.md).

## Sources and interpretation

| Source | Contribution | Interpretation |
| --- | --- | --- |
| [Quito cadastral attributes, 2024](https://geoquito.quito.gob.ec/server/rest/services/Hosted/predios_a_2024/FeatureServer/0) | Identification, areas, frontage, ownership, recorded use and valuations | Historical attributes; not proof of current condition, availability or ownership due diligence |
| [Parcel geometry, February 2026](https://geoquito.quito.gob.ec/server/rest/services/Hosted/predios_2026_feb/FeatureServer/5) | Reference geometry where matched | Cadastral boundary, not surveyed dwelling/room geometry; original geometry retained when needed |
| [Municipal AIVA](https://geoquito.quito.gob.ec/server/rest/services/web_reference_dmc/valoracion_del_suelo/MapServer) | Zonal land reference values | Not transaction prices or commercial appraisals; point-based lookup has limits |
| [Official IRM portal](https://pam.quito.gob.ec/mdmq_web_irm/irm/buscarPredio.jsf) | User-obtained urban-planning document | Extracted fields require review; not a construction permit |
| [PUGS 2024, layer 60](https://geoquito.quito.gob.ec/server/rest/services/web_reference_dmot/plan_de_uso_y_gestion_del_suelo_2024/MapServer/60) | Zoning/buildability evidence | Intersections and codes are preliminary; current rules, exceptions and IRM require verification |

Additional constraints:

- Administrative parish type, cadastral urban/rural class and PUGS zoning are different concepts.
- PH attributed area (`area_ter_1`) and parent lot (`area_terre`) remain separate.
- Deed/registration dates are not construction dates; recorded area does not establish permits or legality.
- Basic and maximum buildability differ; surface conflicts for review rather than silently reconcile them.
- Missing data, failed requests and ambiguous intersections stay visible. No explicit housing code is not a prohibition.
- Users need authorization to process drawings. Authentication, shared projects, durable document storage and access controls are not implemented.
- Plans describe documented design, not necessarily today's building or observed disaster damage.
- Source dates differ from consultation dates. Check municipal-data and basemap reuse terms before commercial use.

**PredioAI · Vivienda, planos y proyectos · Quito, Ecuador · Product pilot**
