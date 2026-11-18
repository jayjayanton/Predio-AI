# PredioAI — home-intervention review workflow

## Working user journey

1. Open **Analizar planos**. A predio lookup is optional for document inspection; users can link municipal context when they have the identifier.
2. Choose **Casa** or **Departamento**, an intervention category and the relevant activities.
3. Upload an authorized architectural **PDF, DXF or DWG**, or a **ZIP** containing separate drawings, plus an IRM when required by this inspection workflow. The server converts DWG before extraction and reports conversion limitations.
4. Submit to **`POST /api/documents/analyze`**. A ZIP produces an inventory and one selected drawing; choose another entry to inspect it separately. The backend returns extraction evidence and supported geometry, with units and measurements unverified.
5. Inspect the extracted drawing in the existing viewer: switch pages, select individual or multiple primitives, show/hide available layers, zoom and pan.
6. Open **Medidas** and explicitly apply a CAD unit or calibrate against a known length. Eligible selections can produce geometric lengths, perimeters and areas. This does not independently verify physical dimensions.
7. Optionally select one closed exterior contour and open **Ilustración 3D** after applying scale. Edit the assumed height/roof and choose **Actualizar ilustración**. Its front/side views are hypothetical projections, not actual project sections; interiors, openings and storeys are not inferred.
8. Open the **documentary summary** to review the files, selected activities and unresolved measurement status. This is an on-screen inspection summary, not an exported technical report.

After inspection, the user remains with the drawing so the interactive result
can be reviewed before opening the summary. A selected line or polyline is not
automatically a recognized wall, floor, room, roof or opening. The viewer shows
supported extracted geometry, with explicit notices for unsupported content.
An import exceeding whole-document resource limits is rejected rather than
silently truncated. Packages and illustrations are temporary; files are not
saved as permanent projects and CAD external references are not assembled.

## IRM prerequisite in the application

| Selected work | IRM needed to submit this inspection |
| --- | --- |
| Repair or maintenance | No |
| Remodeling with only `replace_floor` — **Cambiar acabado de piso** | No |
| Any other remodeling activity, including a mixed selection with `replace_floor` | Yes |
| Structural modification or expansion | Yes |

The backend validates the activities before applying `requires_irm` from
`app/work_activities.py`. The floor-finish exception concerns preliminary
document inspection. It does not certify the proposed work as nonstructural,
authorize construction or replace a review of applicable municipal requirements.
Apartment work may also involve common property or condominium rules.

## Available and planned capabilities

| Capability | Status |
| --- | --- |
| Predio lookup, cadastral context and map | Available; depends on municipal services |
| Building/work/activity selection and PDF/DXF/DWG or ZIP upload | Available in the document workspace; DWG requires the server converter installed at deployment |
| PDF/DXF/DWG metadata, tentative IRM fields and bounded vector extraction | PyMuPDF/ezdxf, with bounded local DWG conversion and partial-view notices |
| ZIP inventory and selected drawing | Available; lazy individual inspection, recoverable selected-member errors, no xref assembly |
| Interactive primitive selection, pages, available layers, zoom and pan | Available; user applies units/calibration separately |
| Selected geometric lengths, closed-boundary perimeters and areas | Available after explicit scale confirmation; independent physical verification remains pending |
| Illustrative exterior volume | Available from a selected source contour and applied scale; height/roof are editable assumptions |
| On-screen inspection summary | Available; does not contain verified quantities or a compliance verdict |
| Verified scale/units and physical lengths/surfaces | Planned |
| Architectural element recognition and geometry corrections | Planned |
| Revision tracking, dependent recalculation and traceable technical exports | Planned |
| Automated material quantities, costs or construction approval | Not provided |

## Next validation milestone

Use an authorized real PDF, DXF or DWG and a manually verified reference. Begin with
one floor-finish task: confirm that the required geometry is available, establish
units/scale against reliable dimensions, then compare the calculated
surface with the reference. Record omissions and corrections before expanding
to painting or more complex work.

For a demonstration without private files, open **Ver plano de ejemplo**,
select **Área de ejemplo**, choose **cm** in **Medidas** and click
**Aplicar unidad**, then open **Ilustración 3D**. Height accepts **0.3–12 m**,
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
