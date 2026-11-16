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
- **New construction:** search a predio, copy its predio number, consult the official IRM with manual CAPTCHA, and select the downloaded PDF. Uploaded text-based IRM PDFs are now parsed by `POST /api/irm/extract` and recognized land area, COS PB, COS Total, and floors are auto-filled as **unverified candidates**. The user must review and confirm values before theoretical COS limits are calculated. Extracted metadata is cached per predio in browser session storage (not a permanent project database); the original PDF is not retained server-side. This is not a legal buildability determination; residential compatibility, setbacks, density, and parcel scoring remain future work. The construction-capacity panel is hidden until an IRM PDF has been successfully parsed (or previously parsed metadata restored for the selected predio). IRM candidate extraction now includes minimum lot area, minimum frontage, and VU/VB/VM codes when explicitly labeled. For multiple houses or subdivision, a theoretical area-only lot count and per-minimum-lot COS areas are shown after human verification. This does not establish permitted subdivision or housing-unit count. Scanned PDFs may not yield text; OCR, reliable land-use compatibility and density checks, and automated prohibitions for apartment buildings are not yet implemented. The interface therefore shows **pending verification**, never an invented permission or prohibition.

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

## Consulta IRM asistida (prototipo local)

Se añadió un módulo independiente de **Python + Playwright** en [`automation/irm_playwright.py`](automation/irm_playwright.py). Desde PowerShell se ejecuta con el **número real de predio**: `py automation/irm_playwright.py NUMERO_PREDIO`. El navegador se abre en el equipo del usuario, rellena el campo de predio, espera el CAPTCHA manual y detecta la página `irm.jsf`. Tras verificación humana, puede imprimir el informe como PDF local.

**No está integrado automáticamente al botón del sitio web**, no corre en Render y la impresión del informe real aún debe validarse. Consulte las [instrucciones completas de instalación y uso](automation/README.md).

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
