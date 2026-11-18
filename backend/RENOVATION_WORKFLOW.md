# PredioAI — home-intervention review workflow

## Working user journey

1. Open **Analizar planos**. A predio lookup is optional for document inspection; users can link municipal context when they have the identifier.
2. Choose **Casa** or **Departamento**, an intervention category and the relevant activities.
3. Upload an authorized architectural **PDF, DXF or DWG**, or a **ZIP** containing separate drawings. The visual studio can start without a predio or IRM for any valid activity. The server converts DWG before extraction and reports conversion limitations.
4. Submit to **`POST /api/documents/analyze`** with **`review_scope=drawing_study`**. A ZIP produces an inventory and one selected drawing; choose another entry to inspect it separately. The backend returns extraction evidence and supported geometry, with units and measurements unverified. The separate API default `document_review` retains the prerequisites below.
5. Inspect the extracted drawing in the existing viewer: switch pages, select individual or multiple primitives, show/hide available layers, zoom and pan.
6. Open **Medidas** and explicitly apply a CAD unit or calibrate against a known length. Eligible selections can produce geometric lengths, perimeters and areas. This does not independently verify physical dimensions.
7. Open **Figuras** to add a metric table/rectangle, circle or proposed extension. Edit dimensions, role and rotation; drag or nudge, duplicate/delete, and undo/redo. Zoom and pan never alter the declared physical dimensions. Furniture/reference figures do not count as extensions.
8. In **Huella**, select one valid closed source contour and explicitly declare that it represents the ground footprint. Preserve valid holes. The resulting local polygon can be inspected and exported before a predio exists.
9. Link the actual predio when known. The first link preserves the drawing study; place and rotate its footprint on the parcel map without changing its scale, then confirm that proposed placement. Attach the matching IRM later through **`POST /api/irm/extract`** without reconverting or losing the CAD draft. Review new document candidates and their association.
10. Use **`POST /api/planning/assess`** to compare the footprint/extension union, parcel boundary and reviewed IRM conditions. Record countable municipal areas separately from geometric footprint area. Missing association, parameters, complete ground footprint or special-condition review leaves the relevant checks pending.
11. Optionally select one closed exterior contour and open **Ilustración 3D** after applying scale. Edit the assumed height/roof and choose **Actualizar ilustración**. Its front/side views are hypothetical projections, not actual project sections; interiors, openings and storeys are not inferred.
12. Open the **documentary summary** to review the files, selected activities, current study quantities and unresolved evidence. Local JSON and proposed WGS84 GeoJSON exports are available; the summary is not a certified technical report.

After inspection, the user remains with the drawing so the interactive result
can be reviewed before opening the summary. A selected line or polyline is not
automatically a recognized wall, floor, room, roof or opening. The viewer shows
supported extracted geometry, with explicit notices for unsupported content.
An import exceeding whole-document resource limits is rejected rather than
silently truncated. Packages and illustrations are temporary; files are not
saved as permanent projects and CAD external references are not assembled.

## Review scopes and the preserved IRM prerequisite

The hosted visual studio explicitly selects **`drawing_study`**, allowing a
geometry/layout study for any validated activity without an IRM. It does not
grant an activity a municipal clearance. In contrast, callers that omit
`review_scope` receive **`document_review`**, which preserves these requirements:

| Selected work | IRM required in `document_review` |
| --- | --- |
| Repair or maintenance | No |
| Remodeling with only `replace_floor` — **Cambiar acabado de piso** | No |
| Any other remodeling activity, including a mixed selection with `replace_floor` | Yes |
| Structural modification or expansion | Yes |

The backend validates the activities in both scopes. It applies `requires_irm`
from `app/work_activities.py` only to `document_review`. Invalid scopes or
activities are rejected. Neither the floor-finish exception nor a visual study
certifies work as nonstructural, authorizes construction or replaces review of
applicable municipal requirements.
Apartment work may also involve common property or condominium rules.

## Drawing state, footprint and placement contract

The browser stores figure dimensions in metres and centres in the exact imported
view's coordinates. Each view retains its own confirmed scale, figures,
footprint and bounded undo history for the active session. Returning from the
documentary summary restores that draft. A new view or replacement drawing does
not borrow another view's calibration; a different ZIP inspection is a new
source. This is not durable storage, a project export/import system or a
cross-device workspace.

Scale changes preserve figure dimensions in metres, clear incompatible undo
history and invalidate the accepted footprint; source-relative positions need
review. Figure visibility affects only the canvas. Proposed extensions remain
in the scenario until deleted or reclassified as furniture/reference.

Ground-footprint extraction is explicit source selection, not automatic building
recognition. One valid exterior and its holes become a local-metre `Polygon`.
Open, crossing, disjoint, ambiguous or nested-island contours are rejected.
The source display Y axis is reflected to local Y-up, and the footprint bounds
centre becomes `(0,0)` for both the footprint and figures. The local export has
no geographic CRS and records source/origin/scale metadata.

The planning endpoint takes the local footprint and role-labelled figure
polygons, optionally a WGS84 parcel, a latitude/longitude anchor and clockwise
rotation, reviewed IRM data, final proposal parameters and exterior-edge
classifications. It uses Shapely and a local WGS84 azimuthal-equidistant
projection for metric calculations. Placement is a user hypothesis: moving the
anchor does not establish a CAD georeference or modify the source file. Changing
anchor or angle clears placement confirmation. WGS84 GeoJSON export retains
placement provenance and `verified: false`.

## Preliminary geometry and IRM comparisons

- Union the existing footprint and extension polygons; count overlaps once and
  exclude furniture. Report existing, added and combined geometric area.
- With confirmed placement, compare that union to the supplied parcel and
  report outside area, including incursions into parcel holes.
- Require matching predio identifiers and explicit drawing/IRM association for
  municipal comparisons. The IRM's extracted values are candidates, with their
  available page/evidence retained for review.
- Require a declared complete ground footprint of the individual lot, the
  applicable single parameter set and reviewed special conditions. PH,
  multiple-parameter and restriction evidence keep the general regulation
  review pending; a checkbox does not erase the source flags.
- Keep **geometric footprint** and **municipal countable area** separate. COS PB
  uses reviewed final countable ground area or an explicit declaration that it
  equals the combined footprint. COS total uses separately entered final
  countable area across every floor. Do not infer floors or height from a plan.
- Classify each exterior parcel edge as front, side or rear before comparing
  minimum distances to reviewed setbacks. Do not infer the front from north.
  Incomplete classification, parcel holes and special boundaries prevent a
  complete setback finding.
- Keep normative comparisons pending when projected and documentary parcel
  areas differ by more than 5%, or when the final total countable area is below
  its ground-floor component.

Results are per-check **pending**, **conflict** or **within reviewed limits**.
The response always remains `status: preliminary`, `verified: false` and
`regulatory_approval: false`. It does not assess structural viability, legal
rights, current site conditions or final municipal approval.

The viewer caps figures at 60, dimensions at 0.01–200 m, history at 40 undo
steps, footprint spans at 5 km and source topology at 2,000 segments. The API
caps requests at 1,000,000 bytes, 100 shapes and 10,000 total polygon positions;
local coordinates are bounded to ±10 km and parcel coordinates to a 25 km
projected-coordinate bound around the anchor. It rejects malformed, nonfinite
or invalid geometry rather than silently repairing it. These are computation
limits, not accuracy promises.

**Example boundary:** the supplied Campolivar DWG has no matching IRM or known
predio; the built-in fictional plan also has neither. Both can be used for
standalone metric studies. Do not assign another example's IRM, predio or
coordinates to them.

## Available and planned capabilities

| Capability | Status |
| --- | --- |
| Predio lookup, cadastral context and map | Available; depends on municipal services |
| Building/work/activity selection and PDF/DXF/DWG or ZIP upload | Available in the document workspace; DWG requires the server converter installed at deployment |
| PDF/DXF/DWG metadata, tentative IRM fields and bounded vector extraction | PyMuPDF/ezdxf, with bounded local DWG conversion and partial-view notices |
| ZIP inventory and selected drawing | Available; lazy individual inspection, recoverable selected-member errors, no xref assembly |
| Interactive primitive selection, pages, available layers, zoom and pan | Available; user applies units/calibration separately |
| Selected geometric lengths, closed-boundary perimeters and areas | Available after explicit scale confirmation; independent physical verification remains pending |
| Metric furniture/extension figures and session drafts | Available; exact-view isolation, edit/drag/nudge/rotate, undo/redo and zoom-invariant dimensions |
| Declared ground-footprint extraction | Available for one valid closed source contour with holes; not automatic semantic recognition |
| Parcel placement and preliminary IRM numeric checks | Available with reviewed association, scope, placement and parameters; pending/conflict states retained |
| Local JSON and proposed WGS84 GeoJSON | Available; source-labelled unverified study geometry, not technical reports or reopenable projects |
| Illustrative exterior volume | Available from a selected source contour and applied scale; height/roof are editable assumptions |
| On-screen inspection summary | Available; does not contain verified quantities or a compliance verdict |
| Verified scale/units and physical lengths/surfaces | Planned |
| Architectural element recognition and geometry corrections | Planned |
| Freehand tracing and automatic building/raster-footprint recognition | Not implemented |
| Durable project saving, collaboration and final technical certification | Not implemented |
| Revision tracking, dependent recalculation and traceable technical exports | Planned |
| Automated material quantities, costs or construction approval | Not provided |

## Next validation milestone

Use an authorized real PDF, DXF or DWG and a manually verified reference. Begin with
one floor-finish task: confirm that the required geometry is available, establish
units/scale against reliable dimensions, then compare the calculated
surface with the reference. Record omissions and corrections before expanding
to painting or more complex work.

For a demonstration without private files, open **Ver plano de ejemplo**,
choose **cm** in **Medidas** and click **Aplicar unidad**. Add a table, circle
or extension and confirm that dimensions remain unchanged through zoom. Select
**Huella de ejemplo**, declare it in **Huella** and inspect/export its local
polygon. The predio/IRM portions remain pending. For the separate 3D
demonstration, select **Área de ejemplo** and open **Ilustración 3D**. Height accepts **0.3–12 m**,
initially **2.6 m**. Roof choices are none, flat or gable; gable pitch accepts
**1–60°** and height means eaves height. Click **Actualizar ilustración** after
editing assumptions. Returning to the source shows that its geometry and
measurements have not changed. The illustration resets with contour, view,
file or scale changes.

Painting requires verified wall heights and opening dimensions as well as
lengths. A plan's scale label alone does not establish scale accuracy; selecting
an entire wall does not establish damaged area. Existing drawings also need to
be compared with the building's current condition. These checks describe the
measurement-development milestone, not functionality already completed.

See [document inspection](DOCUMENT_ANALYSIS.md) for API limits and
[architectural methodology](../docs/ARCHITECTURAL_ANALYSIS_METHODOLOGY.md) for
the planned evidence, measurement and review process.
