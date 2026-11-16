# PredioAI

**Cadastral intelligence today. Architectural document intelligence next.**

PredioAI is an Ecuador-focused, full-stack geospatial application that connects municipal property information with a future workflow for understanding architectural drawings. The project starts with Quito's cadastral records and is being developed toward a practical goal: helping homeowners, architects, and construction professionals turn approved architectural PDFs into reliable measurements, construction quantities, and technical reports.

> **Project status — MVP 0.2:** Cadastral search, interactive parcel mapping, and basic PDF inspection are implemented. Automated room/wall/roof measurement, AI chat, persistent projects, and report generation are **planned**, not yet available.

<!-- SCREENSHOT: After capturing the current homepage, save the image as docs/images/predioai-home.png and uncomment the next line. -->
<!-- ![PredioAI homepage — cadastral search and interactive map](docs/images/predioai-home.png) -->

## Why PredioAI?

Municipal cadastral data can describe a property, but it does not tell the whole story of a building. Architectural plans may contain room dimensions, area schedules, wall heights, sections, and roof information, yet turning those documents into usable construction quantities still takes manual work.

PredioAI aims to connect those two sources: **where a property is** and **what its construction documents say about it**. A future user will be able to upload an authorized PDF, review extracted measurements, ask questions in Spanish, and export a traceable technical report.

## Two user workflows

The homepage now distinguishes **Propietarios y remodeladores** from **Nueva construcción y terrenos**. Both reuse the same Quito cadastral search and map.

- **Owners/remodelers:** the existing repair, maintenance, plan upload, selectable geometry and document-inspection workflow remains available.
- **New construction:** choose **Predio individual / vivienda propia** or **Desarrollar terreno / varios lotes**, then search a predio. The app displays municipal API attributes including ownership regime, lot status, registered construction use, land area, frontage and existing construction area. These describe the cadastral record and do not prove that subdivision, a vacant lot, or multifamily construction is permitted. Search a predio, copy its predio number, consult the official IRM with manual CAPTCHA, and select the downloaded PDF. Uploaded text-based IRM PDFs are now parsed by `POST /api/irm/extract` and recognized land area, COS PB, COS Total, and floors are auto-filled as **unverified candidates**. When the IRM lacks a recognizable land-area field, the form uses the cadastral parent-lot area (`area_terre`) as a clearly labeled fallback, never claiming it came from the IRM. The construction form adapts to the selected project type: minimum lot/frontage appear for multiple houses or subdivision; dwelling designation is shown for housing scenarios. The user must review and confirm values before theoretical COS limits are calculated. Extracted metadata is cached per predio in browser session storage (not a permanent project database); the original PDF is not retained server-side. This is not a legal buildability determination; residential compatibility, setbacks, density, and parcel scoring remain future work. The construction-capacity panel is hidden until an IRM PDF has been successfully parsed (or previously parsed metadata restored for the selected predio). IRM candidate extraction now includes minimum lot area, minimum frontage, and VU/VB/VM codes when explicitly labeled. For multiple houses or subdivision, a theoretical area-only lot count and per-minimum-lot COS areas are shown after human verification. This does not establish permitted subdivision or housing-unit count. Scanned PDFs may not yield text; OCR, reliable land-use compatibility and density checks, and automated prohibitions for apartment buildings are not yet implemented. The interface therefore shows **pending verification**, never an invented permission or prohibition.

The developer IRM upload currently selects a local file only; it does not send or parse it. The standalone Playwright desktop assistant is documented in [automation/README.md](automation/README.md) and is not launched by the website.

## Current capabilities

- **Quito cadastral search:** Look up a property by **clave catastral** or **número de predio** using the municipal ArcGIS service.
- **Interactive GIS map:** Display returned parcel polygons, zoom to results, and switch between Esri Light Gray, Topographic, and Satellite basemaps.
- **Property attributes:** View identifiers, parish, zoning, use, registered construction area, and land areas.
- **Propiedad horizontal (PH) awareness:** Distinguish an individual unit's attributed land area and construction area from the shared **lote matriz**. The highlighted polygon is a cadastral parcel, **not** necessarily the building footprint.
- **Experimental PDF inspection:** Upload an authorized PDF to inspect page counts, page dimensions, vector drawing counts, and text-character counts. This endpoint does **not** yet extract architectural measurements or intentionally retain the file.
- **API and build validation:** FastAPI endpoints and repository CI for backend tests and frontend build.

## Product direction

The next phase is **user-uploaded architectural document analysis**. Government-document retrieval is not required for the first version.

| Capability | Status |
| --- | --- |
| Municipal property lookup and mapping | Implemented |
| Basic architectural PDF inspection | Implemented — experimental |
| Drawing classification, annotations, and area schedules | Planned |
| Validated room areas, wall lengths/heights, roof quantities | Planned |
| Reviewable construction profile and PDF viewer | Planned |
| Property-aware conversational AI assistant | Planned |
| Technical PDF and Excel reports | Planned |

### Intended user experience

1. **Find a property or start with a PDF.** A cadastral identifier is useful but will not be mandatory for architectural analysis.
2. **Upload authorized plans.** PredioAI inspects the drawing set and extracts explicit dimensions, schedules, and relevant geometry.
3. **Review measurements.** The user confirms ambiguous scales, room boundaries, heights, and other assumptions.
4. **Explore the building.** A dedicated in-app **Análisis de planos** workspace will present a PDF viewer, structured measurements, and a contextual AI assistant.
5. **Export findings.** Generate a technical report with room-by-room areas, wall quantities, roof measurements where supported, sources, and limitations.

Potential applications include painting and flooring estimates, renovation planning, preliminary construction quantity takeoffs (*cómputos métricos*), and property documentation. PredioAI is **not** an insurance claims-management product.

## Technology

| Layer | Stack |
| --- | --- |
| Frontend | React, Vite, React Leaflet, Leaflet |
| Backend | Python, FastAPI |
| Municipal GIS | Quito ArcGIS REST / GeoJSON |
| Basemaps | Esri |
| Current PDF inspection | PyMuPDF |
| Planned geometry calculations | Python / NumPy / Shapely |
| Planned assistant | Hosted LLM API with structured measurement retrieval |
| Planned exports | PDF and Excel |

A custom-trained computer vision model is **not** part of the current plan. The first goal is to extract and calculate from documented measurements, using OCR or more advanced techniques only when evidence shows they are needed.

## Consulta IRM asistida — Playwright y Chromium

La integración de escritorio está implementada de forma **experimental**: el botón **«Consultar IRM con Playwright (escritorio)»** del sitio web envía el número de predio a un puente Python local (`127.0.0.1:8765`). Playwright abre Chromium, rellena el número de predio, espera a que el usuario resuelva el CAPTCHA y detecta el informe oficial. Si lo valida, genera un PDF en la carpeta **Descargas** del usuario. La carga posterior del PDF en PredioAI sigue siendo manual.

**Dependencias por componente (no existe un único requirements.txt):**

| Componente | Archivo | Contenido relevante |
| --- | --- | --- |
| Backend FastAPI (Render) | [`backend/requirements.txt`](backend/requirements.txt) | FastAPI, HTTPX, PyMuPDF, Shapely, etc. **No requiere Playwright** |
| Automatización local de escritorio | [`automation/requirements.txt`](automation/requirements.txt) | **`playwright>=1.50,<2`** |
| Navegador Chromium | Instalado por Playwright | `py -m playwright install chromium` (descarga separada, no es paquete pip) |
| Instalador Windows | [`automation/setup_windows.bat`](automation/setup_windows.bat) | Instala Playwright y Chromium, luego inicia el puente local |

En Windows, después de `git pull origin main`, ejecute **`automation/setup_windows.bat`** para instalar lo necesario e iniciar el puente. Se necesita Python con el lanzador `py`. También puede instalar manualmente:

```powershell
py -m pip install -r automation/requirements.txt
py -m playwright install chromium
py automation/irm_bridge.py
```

El puente solo se ejecuta en el computador del usuario; no se instala en GitHub Pages ni Render. El CAPTCHA se completa manualmente. Si el puente no está disponible, siguen funcionando **«Copiar número»** y **«Abrir consulta IRM oficial»**.

Consulte la [guía de instalación y solución de problemas](automation/README.md).

## Run locally

**Requirements:** Python 3.11+ and Node.js 20+.

### Backend — PowerShell

```powershell
cd backend
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

API documentation: **http://localhost:8000/docs**

A virtual environment is optional. If you use one, activate it before installing dependencies.

### Frontend — separate PowerShell terminal

```powershell
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**.

For an example lookup, select **Número de predio** and enter `627739`. The returned PH cadastral attributes and geometry depend on the municipal service's availability and published data.

### Configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `QUITO_ARCGIS_URL` | Municipal ArcGIS query endpoint | Configured in backend |
| `CORS_ORIGINS` | Allowed frontend origins | `http://localhost:5173` |
| `VITE_API_URL` | Frontend backend URL | `http://localhost:8000` |

## API overview

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Backend health |
| GET | `/api/municipal/fields` | Published municipal fields |
| GET | `/api/predios/{identifier_type}/{identifier}` | GeoJSON property lookup (`clave_cata` or `n_predio`) |
| GET | `/api/property-details/{identifier_type}/{identifier}` | Structured property details |
| GET | `/api/predios/by-cadastral-key/{cadastral_key}` | Legacy cadastral-key route |
| POST | `/api/blueprints/inspect` | Basic authorized PDF inspection |

The PDF inspection endpoint currently accepts PDFs up to **15 MB** and up to **100 pages**. It returns metadata, not measured construction quantities.

## Quality checks

From `backend`:

```powershell
python -m pytest tests -q
```

From `frontend`:

```powershell
npm run build
```

GitHub Actions is configured to run backend tests and frontend build checks.

## Development methodology

The detailed project plan, extraction pseudocode, measurement conventions, source provenance, review process, and pilot milestones are documented in:

**[Architectural Analysis Methodology](docs/ARCHITECTURAL_ANALYSIS_METHODOLOGY.md)**

The first planned validation uses a small set of authorized architectural PDFs and manually verified quantities, potentially from M2 Construction Services, to establish what can be extracted reliably before adding an AI chat interface.

## Screenshot

A homepage screenshot will be added here when available. Save it at **`docs/images/predioai-home.png`** and uncomment the Markdown image line near the top of this README. This keeps the image path stable without adding a placeholder or broken link.

## Data provenance and limitations

- Municipal data currently comes from a **2024 Quito cadastral layer** and may not reflect present conditions.
- A cadastral polygon is **not** a surveyed building footprint.
- In PH developments, a shared parent lot must not be confused with an individual dwelling's attributed area.
- Approved plans may not contain every needed measurement and may differ from the building as constructed or remodeled.
- Architectural measurements must retain document/page references and indicate whether they are documented, calculated, confirmed, or pending.
- Users must have permission to upload plans. Authentication, secure storage, and document retention controls are prerequisites for persistent multi-user use.
- Confirm municipal-data and basemap licensing/reuse terms before commercial deployment.
- PredioAI's future outputs will be analytical aids, not automatically certified architectural or engineering assessments.

---

**PredioAI** · Quito, Ecuador · Research and development prototype


### PUGS 2024 regulatory source (new construction)

The new-construction workflow links to Quito's official PUGS 2024 geovisor, ArcGIS MapServer, and Ordinance 003-2024. These are authoritative **reference sources**, not an automated parcel-level zoning lookup yet. The cadastral `zonificaci` attribute is **not** a substitute for the PUGS planning designation. A future spatial overlay must verify service layer IDs, layer currency, intersection of the full parcel geometry (not just a centroid), multiple-zone overlaps, and basic versus maximum buildability before using PUGS values for eligibility decisions. IRM discrepancies must be flagged, never silently overwritten.


### PUGS spatial query prototype

`GET /api/pugs/{identifier_type}/{identifier}` retrieves a unique cadastral polygon and queries the official 2024 PUGS `MapServer/60/query` using ArcGIS `esriSpatialRelIntersects`, EPSG:4326, and the complete parcel polygon. The new-construction interface displays returned attributes and flags multiple-zone intersections. It does not compute intersection fractions, verify the server's current live behavior, resolve zoning-law exceptions, or grant legal permission. A failed municipal request is explicitly reported. The integration requires testing against known real predios and their IRMs before it can be relied on for eligibility screening.


### In-app data provenance

The frontend includes a **Fuentes de datos y metodología** section identifying the cadastral 2024 attribute service, conditional 2026 geometry source, municipal AIVA valuation layers, user-uploaded official IRM, PUGS 2024 geovisor and zoning layer 60, and PredioAI's own theoretical calculations. Source links and limitations are shown together; parcel geometry is not a building footprint, AIVA is not a market appraisal, and preliminary IRM/PUGS results are not permits.


### Individual PH predio vs parent lot (corrected)

For `tipo_propi = PROPIEDAD HORIZONTAL`, the new-construction view uses the **attributed individual land area** (`area_ter_1`) as its cadastral reference, **not** the shared parent-lot area (`area_terre`). The parent lot is displayed separately for context and is not used to calculate theoretical subdivision counts. All IRM-derived regulatory values are now read-only; no user-entered figures can overwrite the extraction. Capacity calculations for PH properties are withheld unless an area was explicitly detected in the uploaded IRM, and even then remain preliminary pending confirmation that the regulatory scope is the individual property. Older browser-session extraction values are invalidated.


### Existing buildings and minimum-lot conflicts

The new-construction cadastral summary flags a selected predio whose individual registered area is smaller than an extracted IRM minimum lot, while distinguishing any existing registered construction (`area_const > 0`) from legal approval. A smaller existing PH unit is **not automatically illegal** or unbuildable: the minimum lot may apply to new subdivisions, the building may predate current rules, or the unit may be within a shared parent lot. Construction and approval dates are **not inferred** from the cadastral layer year or geometry; the UI explicitly shows construction year unavailable until a verified source is integrated. A future data-source validation task is to identify a trustworthy construction-year or permit record and preserve its provenance.


### Cadastral date provenance

The original `predios_a_2024` ArcGIS layer publishes `fecha_escr` (deed date) and `fecha_insc` (registration date), alongside `area_const` and `uso_constr`. The new-construction summary displays the two dates separately. Neither is treated as a verified building construction year, which remains unavailable without a distinct source.


### IRM document disclosure and concise development summary

Once an IRM is processed, its extracted raw fields are available under a collapsed, keyboard-accessible **Detalles del IRM cargado** disclosure. A separate **Resumen de parámetros del terreno** remains visible, emphasizing the individual predio area, minimum lot and frontage, COS, floors and theoretical subdivision count where computable. The latter is strictly area-based and is not an approved subdivision or housing-unit count.


### PUGS schema validation and project assessment (2026-11)

The official PUGS 2024 MapServer layer 60 metadata confirms a polygon feature layer with `uso_prin`, `tipo_des`, `unidad_viv`, `lot_min_ba`, `cos_pb_ba`, `pisos_ba`, `lot_min_gm`, and `pisos_gm`. Basic (`_ba`) and general maximum (`_gm`) buildability are distinct. The new-construction UI displays separate **Compatibilidad del proyecto** and **Factibilidad del predio** sections, labeling unknown compatibility instead of assuming multifamily permission. The PUGS service metadata has been inspected, but **no successful live parcel-specific response for predio 627739 has been independently verified**. Spatial matches against PH parent geometry must not be treated as zoning authorization for a specific PH unit. A definitive use-permission matrix and current amendment/exception review are still required before returning permitted/prohibited results.


### Integrated cadastral–PUGS–IRM comparison

The PUGS endpoint now returns its source zoning features **alongside** the matching cadastral predio's ownership regime, individual/parent land areas, and recorded building use. It sends the full polygon to ArcGIS using POST, avoiding long GET query URLs. After IRM upload, the frontend shows a **Comparación IRM y PUGS** table for minimum lot, basic COS PB and basic floors, identifying equal, differing or missing values. Comparisons are withheld for horizontal-property units because the queried PUGS polygon is the shared parent lot, not an independently zoned unit. Differences are flagged for review, never interpreted as legal permission. Live parcel-level intersection and production backend connectivity still require end-to-end verification.
