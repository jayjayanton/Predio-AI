# PredioAI — document inspection

The document workspace is connected to **`POST /api/documents/analyze`**.
It extracts document evidence and selectable geometry. It does not establish
architectural measurements, regulatory compliance or construction approval.

## Current inputs and extraction

| Input | Parser | Current output |
| --- | --- | --- |
| Architectural PDF | PyMuPDF | Page sizes, text/vector/image counts, OCR-needed flags and supported straight vector paths for the viewer |
| Architectural DXF | ezdxf | Modelspace entity/layer counts, unit code, unverified source text labels with CAD positions, explicit dimension overrides, and bounded straight geometry including supported transformed INSERT blocks |
| IRM PDF | PyMuPDF | Page metadata, text evidence and recognizable fields such as predio, COS, floors and setbacks, labelled as unverified extraction |
| Scanned PDF | PDF inspection only | Image/text metadata and possible OCR-needed flags; no OCR or automatic conversion into selectable walls |
| Architectural DWG | Local LibreDWG CLI followed by ezdxf | Direct upload; source filename/format retained, conversion status plus DXF evidence and partial-view metadata |

PyMuPDF and ezdxf are both included in `backend/requirements.txt`.
The viewer renders extracted primitives rather than a complete reproduction
of the source drawing. PDF curves/images and unsupported CAD entities are not
converted into architectural elements. A CAD unit code or dimension annotation
is evidence to review, not a verified physical measurement.

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
permanent projects. Limits are **15 MB per input and converted output**,
**100 PDF pages**, **100,000 DXF modelspace entities**, **3,000 selectable
primitives per view**, and **250 positioned source annotations per view**. Block traversal also has visit/depth/cycle guards.

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

DXF-derived views report `extraction.status`, observed omitted entity types,
primitive/traversal/depth limits, and excluded nonempty layouts. Omission
counts refer to observed source instances, including block children; they are
not coverage percentages. Supported top-level geometry is retained before block
detail. Curved polylines are omitted instead of being replaced by straight
chords. Unsupported curves, hatches and complex block cases remain outside the
selectable geometry rendering. Supported TEXT/MTEXT/ATTRIB text and explicit
DIMENSION text overrides are now displayed as *source annotations*, with CAD
coordinates and layer provenance, not calculated values. Automatic dimension
measurements without an explicit text override are not inferred. An area label
is not automatically paired with a closed room polygon. Annotation positions
may not reproduce CAD text rotation, formatting or plotting exactly.

The DWG/DXF response lists `cad_layouts` with entity counts and marks which
layout is displayed. **Only modelspace is rendered.** A single view or the name
of a paper layout does not establish the building floor count or whether a
particular view is ground/first/upper floor. PDF text-based annotations are not
changed by this CAD-specific improvement.

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
