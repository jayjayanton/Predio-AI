# PredioAI — document analysis prototype

This module is an **extraction-only** starting point, not a building-code
checker, engineering opinion, permit, or official IRM generator.

## Supported inputs

| Input | Parser | Extracted data |
| --- | --- | --- |
| IRM PDF | PyMuPDF (already installed) | Page geometry, text, image/vector counts, tentative regex matches for predio, COS, height, floors, setbacks |
| Blueprint PDF | PyMuPDF (already installed) | Page sizes, text counts, vector path counts, image counts, OCR-needed flags |
| Blueprint DXF | ezdxf (optional) | CAD units code, entity types, layers, TEXT/MTEXT annotations, DIMENSION metadata |
| Blueprint DWG | Not directly supported | Convert through a licensed/approved converter to DXF, then validate |
| Scanned PDF | Future OCR | Current script flags pages that may need OCR |

## Optional libraries to evaluate

- `ezdxf`: structured DXF reader. Install `pip install ezdxf` when CAD
  input is needed. Not added to mandatory requirements so current CI stays stable.
- `pdfplumber`: tables and coordinate-based PDF text.
- `shapely`: area, topology, setbacks and geometry checks **after** units,
  reference system, and geometry are validated.
- `opencv-python-headless`, `Pillow`: scanned drawings, preprocessing,
  line/symbol extraction.
- `pytesseract` + Tesseract executable: optional OCR; requires an installed
  external binary and language packs.
- `ifcopenshell`: future BIM/IFC input.
- `pyproj` / `geopandas`: later spatial joins with cadastral geometry.
- DWG converter: evaluate ODA licensing and security before enabling uploads.

## Example

```python
from app.document_analysis import analyze_pair

result = analyze_pair(irm_pdf_bytes, blueprint_pdf_bytes, "plano.pdf")
print(result["irm"]["candidate_irm_fields"])
print(result["blueprint"]["pages"])
```

The existing UI currently sends both PDFs independently to
`/api/blueprints/inspect`. This new Python module is not wired into the
frontend yet. Its extraction schema should be reviewed against real Quito IRMs
and actual architects' CAD/PDF files before introducing a combined endpoint.

**Security:** 15 MB per file, 100 pages, 100,000 DXF entities. Do not upload
confidential drawings without the owner's authorization. No OCR, automatic DWG
conversion, unit inference, engineering conclusions, or compliance claims.

**Rollback:** delete `backend/app/document_analysis.py` and
`backend/tests/test_document_analysis.py`; the existing API and UI are
unchanged by this prototype.
