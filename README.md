# PredioAI — Quito Parcel Intelligence

Full-stack prototype for querying Quito cadastral parcels and inspecting authorized architectural PDFs.

## Features
- Search by cadastral key (`clave_cata`) through municipal ArcGIS REST; retain predio number as a secondary attribute.
- Leaflet/OpenStreetMap interactive map with automatic zoom to parcel polygons.
- Display cadastral identifiers, land and construction areas, parish, zoning and building use.
- IRM and architectural plan placeholders.
- Inspect uploaded authorized PDFs (page dimensions, vector drawings and text counts), without storing files.
- GitHub Actions CI for backend tests and frontend build.

## Start backend (Python 3.11+)
```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```
API docs: http://localhost:8000/docs

## Start frontend (Node.js 20+)
```powershell
cd frontend
npm install
npm run dev
```
Open http://localhost:5173 and search for cadastral key `1280416019`.

Example endpoint: `GET /api/predios/by-cadastral-key/1280416019`\n\n## Configuration
- `QUITO_ARCGIS_URL`: municipal ArcGIS FeatureServer query endpoint.
- `CORS_ORIGINS`: default `http://localhost:5173`.
- `VITE_API_URL`: default `http://localhost:8000`.

## Tests
```powershell
cd backend
$env:PYTHONPATH="."
pytest tests -q
```
Run `npm run build` in `frontend` to verify the UI build.

## Important limitations
This uses a 2024 cadastral layer, not necessarily current records. Parcel boundaries are not building footprints. The layer has no attached architectural plans. Approved drawings must be acquired with authorization or supplied by the user. PDF inspection is not yet AI measurement extraction. Confirm municipal data reuse terms before commercial deployment or bulk download.

## Next
1. Validate live deployment and frontend build.
2. Integrate available IRM navigation.
3. Build a calibrated blueprint viewer.
4. Add wall/room dimension extraction with validation.
5. Add authentication before handling sensitive architectural documents.
