# PredioAI — document inspection

The document workspace is connected to **`POST /api/documents/analyze`**.
It extracts document evidence and selectable geometry. It does not establish
architectural measurements, regulatory compliance or construction approval.

The frontend's **Medidas** panel separately calculates selected geometric
lengths, perimeters and closed-boundary areas after explicit unit confirmation
or known-length calibration. CAD display coordinates preserve native distance
and area; the Y reflection used for rendering does not change either. PDF
coordinates are page points and require calibration. The extraction endpoint's
`measurements_available: false` remains accurate: it does not receive the user's
calibration, compute these browser-local results or verify physical dimensions.
Calibration is scoped to the current view and is not saved as a project.

## Current inputs and extraction

| Input | Parser | Current output |
| --- | --- | --- |
| Architectural PDF | PyMuPDF | Page sizes, text/vector/image counts, OCR-needed flags and supported straight vector paths for the viewer |
| Architectural DXF | ezdxf | Modelspace and supported layout views, entity/layer counts, unit code, positioned source text, dimension drawing components, straight and approximated curved geometry, transformed CAD blocks and hatch geometry |
| IRM PDF | PyMuPDF | Page metadata, text evidence and recognizable fields such as predio, COS, floors and setbacks, labelled as unverified extraction |
| Scanned PDF | PDF inspection only | Image/text metadata and possible OCR-needed flags; no OCR or automatic conversion into selectable walls |
| Architectural DWG | Local LibreDWG CLI followed by ezdxf | Direct upload; source filename/format retained, conversion status plus DXF evidence and partial-view metadata |

PyMuPDF and ezdxf are both included in `backend/requirements.txt`.
The viewer presents the imported drawing in an overview and an inspection
canvas. The overview uses the same imported data; it is not an independent
rendering of the original file. CAD imports no longer stop at 3,000 display
elements. All supported geometry is retained when the complete import fits the
resource limits. Unsupported content remains explicitly reported. PDF
curves/images and unsupported CAD entities are not converted into architectural
elements. A CAD unit code or dimension annotation is evidence to review, not a
verified physical measurement.

**Ver plano de ejemplo** opens a fictional drawing entirely in the frontend.
It demonstrates layers, curved paths, source labels, zoom, selection and the
measurement panel without uploading or analyzing a user's file. The explicit
fictional **Área de ejemplo** boundary is 442 × 244 drawing units; applying
centimetres produces 10.7848 m² and a 13.72 m perimeter. Its illustrative
dimensions are not verified physical measurements and it does not bypass the
real-upload prerequisites.

## Combined endpoint

Submit multipart fields:

- `blueprint`: required PDF, DXF or DWG.
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

PDF/DXF parsing uses memory. DWG input and converted output use a private
temporary directory removed on success or failure. This endpoint does not save
permanent projects. Inputs and converted output remain limited to **15 MB**;
PDFs remain limited to **100 pages**, with the existing bounded PDF extraction.
CAD imports use whole-document limits on entity visits, emitted elements,
vertices, text, nesting and elapsed traversal time, shared across layouts.
Crossing a CAD resource limit rejects the import with a clear error rather than
returning a successful drawing with the remaining elements cut off. CAD import
work is serialized per API process; a busy service returns a retryable error.
These cooperative limits do not impose an OS memory sandbox on the DXF parser.

Current aggregate CAD ceilings are 100 layouts, 100,000 visited entity
instances, 50,000 emitted elements, 500,000 generated vertices, 500,000 source
components, 500,000 text characters, 32 MiB of serialized element data and
32 nested block levels. Traversal checks a 30-second cooperative deadline.
Hatch work also has intersection/dash preflight budgets before the library
allocates intermediate geometry. Text-summary fields remain capped for backward
compatibility, but full selectable text elements are not cut at that summary
limit. Large responses use negotiated gzip compression; compression does not
remove geometry.

DWG conversion uses a server-managed executable, never a command or URL from
an uploaded file. It runs in a separate process with a 30-second wall limit,
CPU/memory/file limits, bounded diagnostic capture and one conversion slot per
API process. This is resource containment, not a complete security sandbox.
See [deployment](../DEPLOYMENT.md) for installation and operational checks.

The API retains `blueprint.format="dwg"` and adds `converted_format="dxf"`
and `conversion.status` (`converted` or `converted_with_warnings`). Conversion
does not establish fidelity. Missing or busy conversion returns HTTP 503;
timeout returns 504; unsupported, malformed or excessive output returns 422.
Safe user-facing messages omit internal paths and converter diagnostics.

DXF-derived views report `extraction.status`, observed omitted entity types and
reasons, approximation information and imported counts. Omission counts refer
to observed source instances, including block children; they are not coverage
percentages. Source identifiers and block-instance paths remain available for
selection. Supported blocks retain their placement, including nested transforms;
unsupported references, clipping and non-planar content are identified explicitly.

Arcs, circles, ellipses, splines and curved polylines use a display approximation.
The flattening tolerance is in drawing units and is not a certified total
geometric error or a measurement tolerance. Hatch boundaries/pattern strokes
and stored dimension drawing components can contribute selectable elements.
Each source hatch keeps its rendered boundary rings in one compound element,
after applying its island style. Pattern strokes remain separate; patterned
boundaries use `filled: false`. Separate block instances retain distinct IDs,
even when they share a source handle. Grouping preserves all boundary vertices
and segment counts while allowing the browser to account for nested holes.
Fonts, fills and rich text may differ from the original CAD application's plot.
Text remains *source annotation*, never an independently verified quantity.
An area label is not automatically paired with a closed room polygon.

The DWG/DXF response lists `cad_layouts` with entity counts and marks which
layouts have an imported view. Modelspace and supported paper-layout content
are available separately; unsupported viewport content must remain flagged.
A view or paper-layout name does not establish the building floor count or
whether a particular view is ground/first/upper floor. PDF text-based annotations
are not changed by this CAD-specific improvement.

## Other document paths

- `/api/blueprints/inspect` remains a basic PDF metadata endpoint; it is not the combined project workflow.
- `/api/irm/extract` provides backend IRM-only extraction.
- The property/urban-planning UI's browser parser uses PDF.js separately; it does not submit its IRM to either project endpoint.
- `analyze_pair` remains a Python helper for inspecting two documents; the UI calls the multipart endpoint instead.

## Pending validation and development

One supplied real DWG has been exercised through local conversion and the
document pipeline. It exposed import and block-display limitations; it is not
evidence of verified measurement accuracy. Further independent drawings and
manually checked references are needed. Verified units/scale,
wall/room recognition, physical lengths and surfaces, geometry correction with
recalculation, and exportable technical reports are not implemented. Test
fixtures verify software behavior; they do not validate architectural accuracy.

See [the renovation workflow](RENOVATION_WORKFLOW.md) and
[architectural methodology](../docs/ARCHITECTURAL_ANALYSIS_METHODOLOGY.md).
