# PredioAI — document inspection

The document workspace is connected to **`POST /api/documents/analyze`**.
It extracts document evidence and selectable geometry. It does not establish
architectural measurements, regulatory compliance or construction approval.

## Current inputs and extraction

| Input | Parser | Current output |
| --- | --- | --- |
| Architectural PDF | PyMuPDF | Page sizes, text/vector/image counts, OCR-needed flags and supported straight vector paths for the viewer |
| Architectural DXF | ezdxf | Modelspace entity/layer counts, unit code, text annotations, unverified dimension metadata and supported LINE/LWPOLYLINE geometry |
| IRM PDF | PyMuPDF | Page metadata, text evidence and recognizable fields such as predio, COS, floors and setbacks, labelled as unverified extraction |
| Scanned PDF | PDF inspection only | Image/text metadata and possible OCR-needed flags; no OCR or automatic conversion into selectable walls |
| DWG | Unsupported directly | Convert an authorized copy to DXF before uploading; PredioAI does not perform the conversion |

PyMuPDF and ezdxf are both included in `backend/requirements.txt`.
The viewer renders extracted primitives rather than a complete reproduction
of the source drawing. PDF curves/images and unsupported CAD entities are not
converted into architectural elements. A CAD unit code or dimension annotation
is evidence to review, not a verified physical measurement.

## Combined endpoint

Submit multipart fields:

- `blueprint`: required PDF or DXF.
- `building_type`: `house` or `apartment`.
- `work_type`: `repair`, `maintenance`, `remodel`, `structural` or `expansion`.
- `activities`: one or more distinct activity identifiers belonging to the selected category.
- `predio_number`: optional numeric identifier; document inspection can start without a municipal lookup.
- `irm`: PDF required for the selected activities according to `requires_irm` in `app/work_activities.py`.

The current application prerequisite requires an IRM for structural work,
expansion and remodeling, **except when the sole remodeling activity is
`replace_floor` (Cambiar acabado de piso)**. Repair and maintenance do not
require it for this inspection step. This rule does not determine which permits
or professional reviews the proposed work requires.

Successful responses include document metadata, `drawing_views`, selected
activities and these explicit limits:

```json
{
  "status": "extraction_only",
  "measurements_available": false,
  "compliance_checked": false,
  "report_available": false
}
```

Project uploads are processed in memory; this endpoint does not deliberately
persist the files. Limits are **15 MB per file**, **100 PDF pages**,
**100,000 DXF modelspace entities**, and **3,000 selectable primitives per
view**. Large or unsupported drawings may therefore be incomplete in the viewer.

## Other document paths

- `/api/blueprints/inspect` remains a basic PDF metadata endpoint; it is not the combined project workflow.
- `/api/irm/extract` provides backend IRM-only extraction.
- The property/urban-planning UI's browser parser uses PDF.js separately; it does not submit its IRM to either project endpoint.
- `analyze_pair` remains a Python helper for inspecting two documents; the UI calls the multipart endpoint instead.

## Pending validation and development

Real architectural PDF/DXF examples and manually checked references are still
needed to evaluate document adequacy and accuracy. Verified units/scale,
wall/room recognition, physical lengths and surfaces, geometry correction with
recalculation, and exportable technical reports are not implemented. Test
fixtures verify software behavior; they do not validate architectural accuracy.

See [the renovation workflow](RENOVATION_WORKFLOW.md) and
[architectural methodology](../docs/ARCHITECTURAL_ANALYSIS_METHODOLOGY.md).
