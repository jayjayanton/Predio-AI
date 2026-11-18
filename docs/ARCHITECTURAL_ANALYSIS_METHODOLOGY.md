# PredioAI — Property, Plans and Intervention Intelligence

**Product scope, methodology and development roadmap**  
**Scope revised:** 18 November 2026

**Companion document:** [Project README](../README.md)

## Product origin and positioning

PredioAI originated in **improving an existing home**, not in trading land. Painting, replacing floors, repairing walls, remodeling, reorganizing a layout, reconstructing and expanding a house are central use cases. The platform is intended for ordinary homeowners and for architects, remodelers and construction companies serving them.

**One-line definition:** PredioAI connects property records, architectural plans and relevant municipal information so people and professionals can understand a building and prepare evidence-based interventions.

**Homepage message:** “Entiende tu casa. Planea su transformación.”

**Current working sequence:** authorized PDF/CAD → inspected geometry and confirmed scale → metric layout/footprint study → optional predio and matching IRM → preliminary comparisons and source-labelled geometry exports. The broader roadmap adds independently verified architectural quantities and professional reports.

The map is context, not the whole product. “Multi-purpose” means several uses of this same evidence model, not a claim that every proposed use is already built. Do not recast remodeling as a secondary feature of a real-estate platform in later redesigns.

## Audiences and commercial hypothesis

| Audience | Job to be done | Product boundary |
| --- | --- | --- |
| Homeowner | Understand what is needed for painting, flooring, repairs, renovation or expansion | Accessible project language; professional review where needed |
| Architect, remodeling contractor, construction firm | Inspect documents remotely, review quantities and prepare client-facing documentation | Measured geometry and reports must be verified and traceable |
| Real estate firm or developer | Discover/compare parcels and review their municipal context | A complementary existing workflow; no automatic investment recommendation |
| Insurer or loss-assessment professional | Link observed damage to documented building elements and prepare a reviewed evaluation | Potential extension; actual damage evidence and professional validation required |

**Value hypothesis:** adequate plans and verified dimensions could reduce repetitive measurements, preparation time and some early site visits. Do not state savings as achieved before measuring them. Necessary site verification, structural assessment and applicable approvals are not replaced.

PredioAI extracts information and derives measurements/quantities from verified inputs. It does **not** automatically decide materials, labor, unit prices, repair costs, budgets, insurance coverage or compensation. Companies and professionals use the reviewed information for their own evaluations and pricing.

## Existing foundation versus planned capabilities

| Capability | State |
| --- | --- |
| Spanish React/Vite interface; predio lookup and parcel map | Implemented |
| PH unit versus parent-lot distinction | Implemented |
| Cadastral comparison and descriptive CSV export | Implemented; local browser selection |
| Assisted IRM access and browser PDF field extraction | Implemented prototype; CAPTCHA and document review remain manual |
| PDF/DXF/DWG document inspection through `/api/documents/analyze` | Experimental extraction; DWG requires the deployed local converter |
| ZIP drawing-package inventory and selection | Implemented; one selected PDF/DXF/DWG inspected per request, without automatic xref assembly or persistent projects |
| Drawing overview/detail viewer, zoom, layout switching, layer visibility, individual and rectangle selection | Implemented; imported geometry with explicit limitations |
| Selected geometric lengths, closed-boundary perimeters and enclosed areas | Implemented in the browser after explicit unit confirmation or known-length calibration; sampled curves are approximate |
| Metric circles and rectangles for furniture/extension studies | Implemented; editing, drag/nudge, rotation, undo/redo and zoom-independent physical dimensions |
| Ground-footprint extraction | Implemented from one valid selected source contour with an explicit ground-footprint declaration; valid holes preserved |
| Per-view session drafts | Implemented for exact imported views, including scale and layout history; not durable or shared project storage |
| Manual parcel placement and preliminary IRM comparisons | Implemented with explicit association, scope, placement and parameter review; no approval or independently established georeference |
| Local footprint JSON and proposed WGS84 GeoJSON exports | Implemented with source/scale/placement metadata and unverified status; not a technical report or reopenable project |
| Illustrative exterior volume and front/side projections | Implemented from one selected contour and applied scale; height/roof are explicit user assumptions, not extracted building evidence |
| Preliminary on-screen document-inspection summary | Implemented; not a verified measurement report |
| Automatic wall/room/roof classification | Not implemented |
| Verified scale and architectural lengths/surfaces | Not implemented |
| Manual measurement corrections with authoritative recalculation | Planned |
| Exportable technical measurement reports | Planned |
| Secure persistent projects, collaboration and contextual AI assistant | Planned |
| Parcel scoring and unsupervised segmentation | Planned parallel analytics track |
| Damage-evidence workflow for insurance/peritaje | Potential extension; not implemented |

The current **Analizar planos** entry opens the document workspace directly. A cadastral lookup is optional context, with a visible unlinked state until a predio is selected. Inspection results remain in the viewer, and the documentary summary is opened separately. The hosted visual studio requests `review_scope=drawing_study`, so any validated activity can be visualized without an IRM. The API default `document_review` still allows repair, maintenance and isolated floor-finish replacement without an IRM and requires it for other remodeling, mixed requests, structural modification and expansion. These are software review scopes, not a determination of municipal permits.

The developer IRM parser runs locally in the browser. The remodeling/project document workflow sends files to the backend: PDF/DXF parsing uses memory and DWG conversion uses temporary files removed after processing. ZIP selection resends the archive and inspects only its chosen drawing; no archive is extracted to disk and no package is saved as a project. Illustrative geometry and assumptions are computed in the browser and are temporary. Do not promise that all uploaded files stay on-device. Existing local IRM automation is optional desktop tooling, not automatic municipal retrieval by the hosted app.

## Core user journey

1. **Define the intervention.** Start with plain-language tasks: paint, change flooring, repair, remodel/reorganize, reconstruct or expand. Escalate technical review for structural changes and extensions.
2. **Link property context when available.** A document can be inspected without a municipal lookup. When linked, obtain the predio/cadastral context and confirm the drawing corresponds to it. Separate the lot, building, PH unit and individual room; they are not interchangeable geometries.
3. **Provide documents.** Upload authorized PDF, DXF or DWG drawings, individually or in a ZIP, and relevant IRM. The server inventories the ZIP but inspects only the chosen supported drawing. It converts DWG to DXF and reports conversion and extraction limitations while retaining the selected source identity. Compare the result with the original. Plans are already digital when vector PDF/CAD is provided; the job is parsing/structuring, not assuming they need a newly trained vision model.
4. **Inspect before inferring.** Determine available text, vector geometry, pages/layers and explicit dimensions. A raster scan needs a distinct validated extraction path. An IRM provides urban-planning context, not room dimensions.
5. **Explore interactively.** Use the overview to keep context while zooming into the detail canvas. Show/hide layers, search source identifiers or text, and select individual elements or a rectangular area. The built-in fictional drawing demonstrates the controls without an upload. Imported CAD curves use an explicit display approximation; units, source annotations and layer names remain evidence to review. Future semantic associations connect these elements to walls, rooms, floors or openings; selection alone is not recognition.
6. **Validate measurement inputs.** Confirm scale/units per drawing, dimensions, heights, face conventions, openings and evidence that the drawing corresponds to the current building. Mark unknowns and conflicts explicitly.
7. **Measure and study the layout.** The browser computes supported lengths and closed-boundary areas with the user's confirmed scale. Metric furniture and extension figures are independent overlays. Exact views retain their own scale/draft in the session; a replacement source starts without the previous view's calibration. A scale edit preserves the figures' metre dimensions but invalidates the footprint and requires their placement to be reviewed.
8. **Extract and place a declared footprint.** Select a valid closed contour, confirm that it represents the ground footprint and retain its holes. Review the exported local geometry. When the actual predio is known, link it, place and orient the footprint without rescaling, and confirm the proposed placement. A first parcel link or later matching IRM attachment preserves the CAD study; the association remains a separate explicit declaration.
9. **Compare reviewed evidence.** Review IRM candidates, documentary identity, scope, countable areas and parcel-edge classifications. Missing inputs and special conditions remain pending. The current outputs are preliminary numeric checks, a documentary summary and source-labelled JSON/GeoJSON. Independently verified architectural quantities, revisioned corrections and professional technical reports remain further work.

Use an in-app workspace. Do not send a user to a separate browser tab to inspect drawing geometry. Secure project persistence requires authentication, access controls, retention and deletion policies first.

## Drawing packages and source completeness

A single CAD document may contain multiple plan drawings, sections or elevations in modelspace and paper layouts. A project can also distribute these across separate files. The ZIP workflow accommodates the latter without assuming a geodatabase, one file per floor, or any automatic relationship between the documents. Folder paths identify files; file names, layer names and layout names do not establish storey count or architectural meaning.

The current package limit is **30 MiB** uploaded, with at most **1,000 archive entries**, **100 supported drawings**, **15 MiB per supported drawing** and **150 MiB** advertised uncompressed content. The server validates the inventory and opens only the requested entry, or the first supported path in sorted order. Unsupported files, macOS auxiliary files and nested archives are skipped with notices. Unsafe paths, links, encryption and excessive expansion are rejected. A member inspection error preserves the package browser, including retryable converter errors. There is no recursive extraction or automatic assembly of external CAD references.

Request actual sections, elevations and roof drawings when height or roof evidence is needed. A plan-view cutting marker locates a referenced section; it does not provide that profile. Another floor is visible only if its geometry is present in the supplied documents and successfully imported. Missing source geometry remains missing after packaging files together.

## Delivered layout and footprint study

### Coordinate and source model

Figure centres are stored in the imported view's display coordinates, while their declared widths, depths and diameters are stored in metres. Canvas zoom is a view transform, never part of the physical scale. Tables begin at 1.60 × 0.90 m, circles at 1 m diameter and extension rectangles at 3 × 4 m; users can edit these dimensions and distinguish furniture/reference objects from extensions. Dragging commits one position edit, keyboard controls support fine placement, and bounded undo/redo handles committed layout edits. These overlays do not alter the original CAD entities.

The **Huella** tool requires one eligible closed source contour and an explicit user statement that it represents the ground footprint. It preserves a valid exterior and its holes, rejecting crossing, open, disjoint or nested-island geometries. A hatch opening may be a graphical mask rather than a real building opening; the reviewer must establish the meaning of the selected contour. This is neither automatic ground-floor recognition nor freehand/raster tracing.

The planning snapshot translates the selected footprint's bounding-box centre to local `(0,0)` and converts drawing units to metres. It reflects the viewer's downward Y axis so local X points right and local Y points up. Figures and the footprint share that same origin. Up is not proven geographic north until the proposed orientation is reviewed. The local JSON export explicitly has no geographic CRS and retains source, origin, unit/calibration and figure-role metadata.

### Session scope and progressive evidence

Confirmed scale, figures, accepted footprint and undo history are tied to each exact imported view. Switching to a new view does not borrow another view's scale; returning to the same view restores its own draft. A documentary-summary round trip restores this state for the same drawing. Replacement imports and newly inspected ZIP members do not inherit a previous drawing's state. There is no durable project save, cross-device synchronization or import of an exported study as a project.

The first predio link can add context without reimporting the drawing. A matching IRM can be attached later through `/api/irm/extract`; its extraction does not reprocess the CAD. Updating the IRM invalidates its review/association confirmations and countable-area review while retaining the drawing study. Changing the proposed extensions requires final countable areas to be checked again. No earlier IRM may be substituted solely because a drawing has no municipal information.

The supplied **Campolivar DWG has no associated IRM or confirmed predio**. The built-in fictional example also has neither. Their coordinates, identity and regulatory constraints remain unresolved. The previously discussed PH example is separate evidence and must not be attached to either drawing by implication.

### Proposed placement and preliminary checks

The map places the local origin at an editable WGS84 reference point and applies a user-selected clockwise rotation. It never stretches the footprint to fit the lot. Position/orientation changes clear placement confirmation. The FastAPI `/api/planning/assess` service uses a local WGS84 azimuthal-equidistant projection for metric calculations and emits proposed WGS84 GeoJSON with provenance and `verified: false`. This coordinate conversion records a user-positioned hypothesis; it does not recover a missing CAD-to-survey transformation.

Shapely unions extension polygons with the selected existing footprint, deducts holes and counts overlaps once. Furniture does not contribute to added occupation. A confirmed placement enables comparison with the parcel boundary, including outside area. That geometric result is separate from municipal buildability:

| Review | Inputs and current boundary |
| --- | --- |
| Documentary association | Matching selected predio and IRM identifiers, any explicit drawing identifier, and user-confirmed correspondence; a filename is not identity evidence |
| Scope | Complete ground footprint of an individual lot, one applicable parameter set, reviewed restrictions and no unresolved special conditions; PH/multiple-zone/restriction flags keep numeric regulation review pending |
| COS PB | Reviewed final municipal countable ground area and documentary lot area; geometric footprint may be used only after the user explicitly confirms their equivalence |
| Setbacks | User-classified front, side and rear exterior edges and reviewed requirements; no inferred road frontage, automatic special boundaries or complete result for parcel holes |
| Height, floors and COS total | Explicit final building height, floor count and countable area across all floors; never inferred from a ground-floor drawing |
| Area consistency | Projected parcel area versus reviewed documentary area; a discrepancy above 5% keeps normative checks pending |

**Geometric area and municipal countable area remain separate fields.** The selected footprint may contain gross walls, roof projections or other surfaces whose regulatory treatment is not established by the CAD polygon. The reviewer can enter a final countable ground area directly or confirm that it equals the combined geometric footprint. Missing countable area keeps COS PB pending. A final multi-floor countable area smaller than the ground-floor countable area also prevents a COS-total conclusion.

Each check reports pending, conflict or within the reviewed numeric limits. `regulatory_approval` remains false. The system does not determine structural feasibility, legal building rights, final municipal permission, site conditions or the completeness of a survey. Quito's [PUGS manual](https://habitat.quito.gob.ec/wp-content/uploads/2025/07/MANUAL-PUGS.pdf) and the actual property-specific IRM provide the municipal context; the geometry engine does not replace them.

### Computational bounds and unavailable features

The viewer currently supports 60 figures, 0.01–200 m dimensions, 40 undo steps and an extracted footprint span of at most 5 km. Source topology work retains the 2,000-segment limit. The planning request is bounded to 1,000,000 bytes, 100 shapes and 10,000 total polygon positions; local coordinates are limited to ±10 km and parcel coordinates to a 25 km projected-coordinate bound around the anchor. Invalid geometry is rejected rather than silently repaired, and backend calculation concurrency is bounded.

Automatic building recognition, joining arbitrary wall segments into a building, freehand boundary tracing, raster footprint inference, persistent project saving and final technical certification are not implemented. JSON/GeoJSON exports describe the current study; they are not professional measurement reports, permits or an app project-recovery format.

## Illustrative reconstruction and evidence status

**Ilustración 3D** creates a bounded exterior volume from one selected eligible closed contour and the user's explicitly applied unit/calibration. Its base follows that source exterior footprint, including supported concavities. Imported curve approximation carries through. Interior rings and graphic masks are ignored with a notice; they do not become physical openings.

Height is an editable **0.3–12 m** assumption, initially **2.6 m**. Roof choices are none initially, flat or gable. A gable has an assumed **1–60°** pitch and an X- or Y-aligned ridge; its height input means eaves height. The UI separately labels the illustrative maximum height that includes the ridge. Changes take effect through **Actualizar ilustración**. Invalid or unapplied inputs keep the last applied illustration.

The 3D, front, side and plan views are projections of the same hypothetical volume. Front/side do not constitute actual architectural sections or elevations. The model does not infer interior walls, doors/windows, openings, storeys, actual building height or the existing roof. Assumptions remain distinct from document evidence and are not promoted into verified quantities. Source measurements are unchanged. Changing the selected contour, view, drawing or scale resets the illustration; there is no saved model or model export.

For an authorized presentation without private drawings, use **Ver plano de ejemplo → select Área de ejemplo → Medidas → choose cm → Aplicar unidad → Ilustración 3D**. Edit the assumptions and click **Actualizar ilustración**. Compare the hypothetical projections, then return through **Volver al plano fuente**. This demonstrates an inspectable footprint and adjustable hypotheses while real-building validation remains pending.

## Everyday examples

### Painting a room

The target workflow lets a user select the relevant wall faces, verify their lengths and heights, and deduct openings for those same faces. Report gross/net wall area and the included faces. Never assume a wall height from a floor plan alone. A ceiling is a separate selected surface. Paint choice, coats, coverage per product and price are outside automatic estimation.

### Replacing a floor

Verify a room boundary and scale, then measure the selected floor polygon. Identify net versus gross area and any holes/deductions. Do not silently add waste factors or convert the area into boxes of flooring, a shopping list or a price.

### Reorganizing, remodeling, reconstructing or expanding

Record the existing documented configuration, the user's intended intervention and relevant municipal information. Metric furniture and extension figures can now visualize a proposal, while the selected ground footprint supports a separate parcel-placement study. These overlays do not move source walls or establish that a proposed demolition or structural change is possible. Numeric IRM comparisons require the reviewed inputs described above. Structural roles, hidden conditions and permission require appropriate professional review; insufficient evidence remains pending.

## Potential insurance and damage-documentation extension

This is now an explicit **future product hypothesis**, not a prohibited adjacent market and not a current claims capability.

Example: an insurer or appointed professional wants to document a wall affected by an earthquake and prepare an evaluation to communicate to the client.

A proposed workflow would:

1. Obtain authorization for the property/project documents and damage evidence.
2. Link the correct drawing version and documented wall to dated photographs, observations and, where available, pre-event/as-built references.
3. Let a reviewer annotate the affected element, visible damage region and confidence/uncertainty. Keep the designed wall area distinct from the observed damaged area.
4. Quantify an extent only when a verified scale/dimension and reliable evidence-to-element association exist. A whole wall is not automatically wholly damaged, and a photograph alone is not assumed to provide reliable scale.
5. Record what cannot be determined remotely and refer those items for inspection.
6. Generate a draft evidence-linked report for professional review. An authorized professional or insurer makes the evaluation and controls client delivery.

Plans alone cannot establish that damage occurred, its extent, hidden damage, structural safety or its cause. The platform must not automatically declare a building safe/unsafe, decide coverage, calculate indemnity or send unreviewed client decisions. This extension would need separate ground-truth validation, consent, access controls, provenance, retention rules and audit history. No insurance upload, damage detector or report-delivery service is added by this positioning update.

## Cadastral and municipal interpretation

For historical PH example predio `627739`, previously retrieved values were construction **211.36 m²**, attributed land **223.43 m²** and parent lot **33,348.48 m²**. These are historical example observations, not guaranteed current values.

The cadastral polygon is the **lote matriz**, not the unit footprint or room boundaries. Never derive room/wall measurements from it. Do not overwrite cadastral area with plan-derived area: store both sources, definitions and dates. Cadastral/AIVA values are not construction prices or market appraisals.

An IRM is evidence for reviewing urban-planning conditions, not proof of current building condition or an automatic construction permit. Current project upload requirements are application workflow rules, not universal legal statements. Multiple zoning assignments, PH rights and missing fields remain visible for review.

## Evidence model and measurement rules

The current selection panel is a geometric prototype within this broader
methodology. It measures imported paths with a user-confirmed scale; it does
not recognize rooms, wall faces, net/gross area conventions or existing site
conditions. A unit code is only a suggestion until explicitly applied. PDF
pages and CAD paper layouts need their own known-length calibration. Text and
dimension decorations are evidence, not measurable boundaries. Curves use the
sampled imported geometry, with the approximation disclosed. Open, branching,
intersecting, disconnected or ambiguous selections keep area unavailable.
The API's extraction-only flags and professional review status are unchanged.

Each future measurement must include:

- Identity: project, building/unit, level, room, selected element IDs and measurement convention.
- Value: numeric quantity, units, gross/net status and selected wall faces.
- Source: document ID/version, page or CAD layer, original coordinates/region and any user-provided evidence.
- Derivation: documented, calculated or user-confirmed; not an unsupported inferred number.
- Review: pending, verified, conflicting or unavailable, plus reviewer and revision information.
- Calculation: formula, verified inputs, deductions and dependencies.

| Quantity | Preferred evidence | Guardrail |
| --- | --- | --- |
| Total construction area | Area schedule | Preserve separately from cadastral figures |
| Room/floor area | Verified boundary and scale or explicit area schedule | Declare net/gross convention |
| Wall length | Associated dimensions or calibrated geometry | Declare centerline/face convention |
| Wall height | Sections, elevations, schedules or verified user evidence | Never infer from plan view alone |
| Wall surface | Verified length, height, faces and openings | Deductions must correspond to selected faces |
| Roof surface | Roof geometry and verified slope | Distinguish projected and sloping area |
| Doors/windows | Annotated geometry and schedules | Verify dimensions and counts |
| Material description | Documented notes/specifications | Unknown when absent; not automatic material quantities |
| Observed damage extent | Verified actual-condition evidence linked to elements | Future module; never equate it with design geometry |

Illustrative formulas, not implemented claims:

```text
Rectangular floor area = verified length × verified width
General floor area = area of verified selected polygon minus verified holes
Gross wall-face area = sum of verified face lengths × their verified heights
Net paintable wall area = gross selected face area − corresponding opening areas
Simple roof-plane surface = verified projected area / cos(verified roof pitch)
```

For multiple heights, faces or roof planes, calculate each supported part separately. Unknown scale, dimensions, height, pitch or element identity must remain **pending/unavailable** in measurement evidence. User-entered illustrative assumptions do not fill these verified-evidence fields. Evidence of approval does not guarantee that drawings match today's building.

## Architecture: preserve and extend

| Layer | Existing capabilities | Further work |
| --- | --- | --- |
| React project workspace | Activity inputs, temporary ZIP inventory, selected drawing, layers, zoom and source selection | Independently verified architectural interpretation and reviewed corrections |
| Browser geometry | User-applied scale, measurements, metric figures/history, selected ground footprint and temporary illustrative volume | Authoritative architectural quantities and reviewed report preparation |
| Property context | Predio/municipal review, discovery and comparison | Explainable scoring and unsupervised segmentation |
| FastAPI document services | PDF/DXF extraction, local DWG conversion and bounded ZIP inventory with lazy member inspection | Versioned evidence profiles and secure project storage |
| FastAPI planning service | Bounded local-metric polygon union, manual placement and reviewed IRM comparisons; proposed WGS84 export | Independent survey/architectural validation and broader municipal condition modelling |
| Other services | Municipal/PUGS lookup and browser developer IRM parsing | Reviewed technical exports and an optional grounded assistant |
| Potential extension | No current damage-evidence workflow | Professional damage review with separately validated evidence |

Prefer PyMuPDF/vector PDF extraction and ezdxf/CAD entities before inference. Use geometry libraries for deterministic calculations. Introduce OCR or computer vision only for specific document types that need them and only after validation. Custom model training is not a default prerequisite. A future language assistant retrieves evidence and calls calculation tools; it never invents measurements or substitutes its own arithmetic for the authoritative engine.

### Design pseudocode — not existing APIs

```python
def process_project_documents(files, property_context=None):
    require_authorized_use(files)
    documents = validate_inputs(files)
    candidates = []
    for document in documents:
        inspection = inspect_document(document)
        raw = extract_available_text_vectors_layers(document)
        if inspection.requires_raster_processing:
            raw = validated_raster_path_or_pending(document, raw)
        candidates += preserve_source_links(raw, document)
    return evidence_profile(property_context, candidates, status="pending_review")


def confirm_and_recalculate(profile, corrections):
    reviewed = apply_corrections_with_revision_history(profile, corrections)
    invalidate_dependent_results(reviewed)
    scale = validate_scale_and_units_per_view(reviewed)
    if not scale.verified:
        return pending_measurements(reason="Scale or units unverified")
    geometry = build_geometry_from_reviewed_elements(reviewed)
    quantities = calculate_only_supported_lengths_and_surfaces(geometry, reviewed)
    return save_versioned_profile_with_sources(reviewed, quantities)


def prepare_report(profile):
    require_results_match_latest_review_revision(profile)
    return draft_report(profile, include_sources=True,
                        include_formulas=True, include_pending_items=True,
                        include_limitations=True, automatic_costs=False)


def annotate_damage_future(profile, evidence, reviewer):
    require_authorized_evidence(evidence)
    observations = reviewer.link_observations_to_elements(evidence, profile)
    extent = quantify_only_if_supported(observations)
    return draft_for_professional_review(observations, extent,
                                        determine_safety=False,
                                        decide_coverage=False,
                                        calculate_indemnity=False)
```

## Reports and optional assistant

The UI, future assistant and exports must use the same versioned evidence profile. Proposed report sections: property identification, document/version inventory, intervention scope, selected element overlays, reviewed lengths/areas, formula and input provenance, corrections, missing/conflicting data, reviewer status and limitations. PDF is the proposed first technical export, with structured table export later. These are not existing report-download features; the current cadastral CSV is a different export.

Example grounded assistant requests: “¿Qué superficie de pared seleccioné?”, “¿Qué falta verificar antes de medir este piso?”, “¿De dónde sale esta dimensión?” and “Prepara un resumen por ambiente.” Where no verified measurement exists, explain the missing input and link to the source rather than supply a number.

The insurance extension would add observed damage evidence and a professional review/delivery state. A draft is never described as a certified evaluation. Do not include automatic material/price schedules or cost projections in the architectural measurement scope.

## Delivery roadmap and validation

| Milestone | Deliverable | Acceptance evidence |
| --- | --- | --- |
| M0 — Preserve the foundation | Keep cadastral, IRM, activity and viewer flows working | Tests/build plus browser review; do not rebuild them for marketing changes |
| M1 — Source-linked document evidence | Improve sheet/element associations using authorized PDF/DXF/DWG | Original document/page/layer references and conversion limits remain inspectable |
| M2 — Verified measurements | Scale calibration, selected room/wall/surface calculations, corrections and recalculation | Agreement with manually checked reference measurements |
| M3 — Usable project workspace | Homeowner-friendly guidance and professional review; secure saved projects when ready | Users understand pending data and can trace/reopen supported results |
| M4 — Reviewed exports | Technical reports consistent with latest geometry/evidence revision | UI and report agree; stale results cannot be exported as current |
| Parallel — Territorial analytics | Explainable scoring and validated unsupervised groups | Transparent criteria, data quality and cluster usefulness checks |
| Optional — Insurance/peritaje pilot | Actual-condition evidence and damage annotations | Separate reviewed ground truth, privacy controls and reporting validation |

### Proposed validation with M2 Construction Services

Subject to their willingness and authorization, obtain **2–3 completed drawing sets** and manually verified takeoffs. Include at least a painting or flooring task before expanding to complex renovations. This is a proposed collaboration, not a claimed customer or signed partnership.

Ask which source formats and approved/as-built sheets are available, which quantities are laborious, how they measure wall faces/areas, which conventions and tolerances they use, how results are delivered and what confidentiality restrictions apply.

Measure source coverage, element matching, length/area discrepancies, unsupported cases, reviewer corrections and preparation time versus a manual baseline. Separately record whether any preliminary site visits were actually avoided and which visits remained necessary. Establish accuracy targets after inspecting the pilot documents; do not invent promised accuracy or savings.

### First measurement-prototype acceptance criteria

Given an authorized dimensioned vector plan: identify usable views and elements; trace candidate dimensions to sources; verify scale; compute selected supported lengths/areas; leave unknown heights/slopes pending; apply corrections and recalculate; show source-linked overlays and unique IDs; generate a reviewed report consistent with the same profile; compare with a manually verified reference. A successful file parse alone is not acceptance.

## Scope guardrails for future changes

- Lead with homeowners and improvement projects; keep professionals prominent and real estate complementary.
- Keep geometry interaction and proposal editing visible; distinguish editable overlays from source editing, semantic recognition and independently verified measurements.
- Insurance/peritaje is a possible future extension, never a currently operating automated claims service.
- Parcel scoring and unsupervised ML are distinct from architectural extraction and damage detection.
- Never invent dimensions, quantities, regulatory values, materials, costs, customers, partnerships or achieved savings.
- User document authorization and secure handling precede persistent storage, collaboration and client sharing.
- Human review and necessary field verification remain part of the intended workflow.
- Confirm municipal-data/basemap reuse terms before commercialization; pricing remains open.

**Next practical step:** validate one real drawing and a manually checked painting or flooring measurement case, while preserving the existing predio → plans/IRM → interactive review foundation.
