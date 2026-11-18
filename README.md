# PredioAI

**Property and architectural-plan intelligence for improving homes.**

PredioAI began with a practical question: **how can someone understand their home and prepare work on it using the property record, existing drawings and municipal information?** Painting a room, replacing a floor, repairing or reorganizing a space, remodeling, reconstructing and expanding a house are central use cases, not an add-on to a land-search product.

The intended platform connects **predio + architectural PDF/CAD + relevant IRM information → structured evidence → interactive drawings → reviewed measurements and reports**. It is for ordinary homeowners as well as architects, remodeling contractors and construction teams. Real estate discovery is a complementary application of the same property context. A potential insurance/peritaje extension would connect plans with evidence of actual damage to support professional reporting; it is not implemented.

**Public-facing message:** “Entiende tus planos. Prepara tu reforma.”

**Working pilot with geometric measurements.** Cadastral lookup, document inspection, selectable vector geometry and a measurement panel exist. Users can confirm drawing units or calibrate against a known length, then calculate selected lengths, closed-boundary perimeters and enclosed areas. Architectural interpretation, independently validated measurements, corrections with authoritative recalculation and exportable technical reports remain further milestones. Explainable parcel scoring and unsupervised segmentation remain planned on a parallel analytics track.

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
| **Analizar planos** | Choose an activity, inspect an authorized PDF/DXF/DWG and explore geometry; link cadastral context optionally |
| **Mi predio** | Look up a predio, inspect its cadastral information and continue to IRM review or the document workflow |
| **Explorar mapa** | Find cadastral records, browse the map and open a property sheet |
| **Selección** | Manage up to 100 predios, import labelled IDs from PDF/CSV/DOCX/XLSX or pasted list, open each for IRM, compare four at a time, export CSV |
| **Analítica (secondary)** | Roadmap for future parcel scoring and unsupervised segmentation, linked under complementary capabilities; no active scores |

The architectural journey is **select the work → supply plans and relevant IRM → inspect/explore geometry → review the document summary**, with optional property linking. Opening or reloading `#planos` enters the same document workspace. After a successful inspection, the drawing stays visible; the user opens **Resumen documental** explicitly. File errors appear beside the upload controls, unsupported/empty/oversized files are rejected before sending, and changed inputs invalidate an in-flight analysis. Verified measurements and technical report export are planned, not completed steps.

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

The project workflow accepts PDF, DXF and DWG drawings, a building type and repair/maintenance/remodeling/structural/expansion activities. DWG files are converted locally on the API server to DXF before extraction; deployment must install the pinned converter described in [DEPLOYMENT.md](DEPLOYMENT.md). The drawing workspace pairs an overview with a detailed inspection canvas, layer controls, individual/rectangle selection and a searchable source-element list. **Ver plano de ejemplo** opens a clearly fictional drawing without uploading a file. CAD imports retain all supported geometry within explicit whole-import resource limits, rather than stopping the display at 3,000 elements. Curves are approximated for display with their source identity retained; unsupported content and conversion warnings remain visible. A selected polyline is not automatically a recognized wall, a measured room or an editable construction design.

Project documents are submitted to the FastAPI `/api/documents/analyze` endpoint. PDF/DXF parsing uses memory; DWG conversion uses a private temporary directory cleaned up after processing. Files are not saved as permanent projects. This is separate from the browser-only developer IRM parser described below. Repair, maintenance and a remodeling request containing **only `replace_floor`** can be inspected without an IRM. Other remodeling activities, mixed flooring/remodeling requests, structural modification and expansion retain the pilot's IRM prerequisite. This software rule applies to preliminary document inspection; it does not establish permit requirements or verify that a proposed intervention is nonstructural.

The on-screen **document summary** describes inspection evidence and unresolved architectural quantities. It identifies when no predio is linked. The separate **Medidas** panel calculates geometric lengths and areas after explicit unit confirmation or known-length calibration, independently of the API's extraction-only result. User-confirmed scale is not independent physical verification. Wall heights, opening deductions, architectural classification, reviewed corrections and traceable measurement exports remain future work. The system does not automatically estimate material requirements, construction costs, market prices or regulatory compliance. Validation against independently checked real-project dimensions remains pending.

### Selection measurements

Open **Medidas** in the drawing inspector. For a CAD model, review the declared units and explicitly apply the appropriate unit. Alternatively, select one eligible line or path, enter its independently known length in metres and apply calibration. PDF pages and paper layouts require known-length calibration. Scale is scoped to the current imported view and is reset when the drawing/view changes.

The panel reports selected geometric length and, for a supported simple closed boundary, perimeter and enclosed area. Curved geometry uses the imported sampled paths and is labelled approximate. Text, dimension decorations and hatch-pattern strokes are excluded; explicit hatch boundaries can be measured. Disconnected, branching, crossing, ambiguous or overly complex selections do not produce an area. Selecting the whole drawing does not define a floor surface.

Selected, compatible and excluded counts appear together before the values. **Volver al plano** returns focus to the drawing without changing the selection, zoom or applied scale. Calibration factors retain significant digits and show an approximation sign when their display is rounded; U.S. survey feet are a separate explicit unit choice.

A source hatch's rendered outer and inner boundaries stay in one selectable element, including patterned hatches. Valid nested contours subtract holes from area; perimeter includes their inner edges. Pattern strokes remain separately selectable and excluded from measurement. A smaller item count after reimport can reflect this source grouping without losing drawing segments. Hatch island style is respected before the contours are grouped.

**Ver plano de ejemplo** includes a separate **Área de ejemplo** layer. Select its boundary and apply centimetres: the fictional 4.42 × 2.44 m rectangle has perimeter 13.72 m and area 10.7848 m². This is a reproducible arithmetic demonstration, not a real-building measurement.

Unit-code and layout context references: [Autodesk INSUNITS](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-Core/files/GUID-A58A87BB-482B-4042-A00A-EEF55A2B4FD8.htm) and [ezdxf DXF units](https://ezdxf.readthedocs.io/en/stable/concepts/units.html). Unit metadata suggests an interpretation; the panel still requires explicit confirmation or calibration.

### Geographic discovery

- Search by land-area range, cadastral urban/rural classification and multiple parishes, including a shortcut for the valleys.
- Add optional filters for minimum frontage, zonal administration, ownership regime and a single **maximum construction-to-land percentage from 0 to 100**. A blank percentage leaves that filter inactive. This ratio uses `area_const / area_terre`; it is not COS or building-footprint coverage.
- Apply filters to the municipal query before counting and pagination. Administration and ownership choices come from published distinct values.
- Browse compact results, sort by identifier or land area, and choose **50/100 records per page in Lista** or **100/200 in Iconos**.
- Select a card or polygon, inspect its information and open **Ficha predial**. Map selection remains synchronized with the result list.
- Switch streets, OSM, topographic and satellite basemaps. Nearby parcel outlines and source context remain available.

The map loads a bounded overlay of **up to 1,000 matching cadastral features**, independently of the current card page. A message identifies partial coverage. The count is a municipal query count, not properties offered for sale.

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

`POST /api/pugs/spatial-screen` retrieves PUGS geometry by fixed tiles, reuses a **15-minute process-local memory cache**, and intersects polygons using a Shapely `STRtree` in **EPSG:32717**. This is bounded retrieval, not a persistent whole-city zoning database.

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
| Hosting | GitHub Pages frontend + Render FastAPI backend |
| Optional desktop IRM assistant | Local Python bridge + Playwright / Chromium |

```text
frontend/       React application, browser IRM parsing, comparison and tests
backend/        FastAPI services, spatial/document analysis and tests
automation/     Optional local IRM desktop assistant
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
| POST | `/api/documents/analyze` | Experimental PDF/DXF/DWG and conditional IRM extraction |
| POST | `/api/irm/extract` | Backend IRM extraction; not used by browser developer IRM workflow |

Document endpoints enforce a **15 MB per-file limit**. Basic PDF inspection also limits documents to **100 pages**. Extraction is evidence, not verified measurements, certification or completed technical reports.

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

Frontend tests cover selection normalization, persistence validation, CSV export, direct-plan routing, upload validation, conditional IRM requirements and product-positioning guards. The positioning checks are content regression checks, not end-to-end drawing tests. Backend tests cover API, document and spatial processing, including the isolated-flooring exception and mixed-activity prerequisites. Browser review should check homepage actions, direct `#planos` reload, navigation, upload errors, drawing interaction, map/list selection, opening a property, comparison, responsive layouts and failed municipal requests.

CI runs backend tests and frontend tests/build. The Pages workflow tests/builds the frontend and deploys on pushes to **`main`** or manual dispatch. Its backend test job is separate; publication is not proof that the API or upstream municipal services are healthy.

The existing Pages project demonstration uses Vite's `/Predio-AI/` base path. `VITE_BASE_PATH=/` prepares a build for a root-domain frontend; `VITE_API_URL` is baked into either build. Render uses `render.yaml` for the existing backend; GitHub Pages cannot run FastAPI. A sleeping backend can slow the first lookup. The commercial-hosting path and domain procedure are documented in [DEPLOYMENT.md](DEPLOYMENT.md).

### Optional desktop IRM assistant

The manual portal workflow needs no additional software. The experimental assistant sends the selected predio number to a local bridge at `127.0.0.1:8765`, opens Chromium and waits for manual CAPTCHA/report navigation. Import back into PredioAI remains manual.

On Windows, `automation/setup_windows.bat` installs dependencies and configures the bridge. Manual installation from the repository root:

```powershell
py -m pip install -r automation/requirements.txt
py -m playwright install chromium
py automation/irm_bridge.py
```

Playwright is optional desktop software, not a Render backend requirement. Browser local-network permissions may affect the bridge. See [automation/README.md](automation/README.md).

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
