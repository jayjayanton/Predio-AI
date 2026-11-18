# PredioAI — Property, Plans and Intervention Intelligence

**Product scope, methodology and development roadmap**  
**Scope revised:** 17 November 2026  
**Companion document:** [Project README](../README.md)

## Product origin and positioning

PredioAI originated in **improving an existing home**, not in trading land. Painting, replacing floors, repairing walls, remodeling, reorganizing a layout, reconstructing and expanding a house are central use cases. The platform is intended for ordinary homeowners and for architects, remodelers and construction companies serving them.

**One-line definition:** PredioAI connects property records, architectural plans and relevant municipal information so people and professionals can understand a building and prepare evidence-based interventions.

**Homepage message:** “Entiende tu casa. Planea su transformación.”

**Conceptual workflow:** predio → authorized PDF/CAD plans and relevant IRM → structured document evidence → interactive drawings → reviewed measurements → reports for the owner, contractor or professional client.

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
| Drawing overview/detail viewer, zoom, layout switching, layer visibility, individual and rectangle selection | Implemented; imported geometry with explicit limitations |
| Selected geometric lengths, closed-boundary perimeters and enclosed areas | Implemented in the browser after explicit unit confirmation or known-length calibration; sampled curves are approximate |
| Preliminary on-screen document-inspection summary | Implemented; not a verified measurement report |
| Automatic wall/room/roof classification | Not implemented |
| Verified scale and architectural lengths/surfaces | Not implemented |
| Manual measurement corrections with authoritative recalculation | Planned |
| Exportable technical measurement reports | Planned |
| Secure persistent projects, collaboration and contextual AI assistant | Planned |
| Parcel scoring and unsupervised segmentation | Planned parallel analytics track |
| Damage-evidence workflow for insurance/peritaje | Potential extension; not implemented |

The current **Analizar planos** entry opens the document workspace directly. A cadastral lookup is optional context, with a visible unlinked state until a predio is selected. Inspection results remain in the viewer, and the documentary summary is opened separately. Repair, maintenance and an isolated floor-finish replacement can proceed without an IRM; other remodeling activities, mixed requests, structural modification and expansion retain the pilot's IRM prerequisite. These are software inspection requirements, not a determination of municipal permits.

The developer IRM parser runs locally in the browser. The remodeling/project document workflow sends files to the backend: PDF/DXF parsing uses memory and DWG conversion uses temporary files removed after processing. Do not promise that all uploaded files stay on-device. Existing local IRM automation is optional desktop tooling, not automatic municipal retrieval by the hosted app.

## Core user journey

1. **Define the intervention.** Start with plain-language tasks: paint, change flooring, repair, remodel/reorganize, reconstruct or expand. Escalate technical review for structural changes and extensions.
2. **Link property context when available.** A document can be inspected without a municipal lookup. When linked, obtain the predio/cadastral context and confirm the drawing corresponds to it. Separate the lot, building, PH unit and individual room; they are not interchangeable geometries.
3. **Provide documents.** Upload authorized PDF, DXF or DWG drawings and relevant IRM. The server converts DWG to DXF and reports conversion and extraction limitations while retaining the original source identity. Compare the result with the original. Plans are already digital when vector PDF/CAD is provided; the job is parsing/structuring, not assuming they need a newly trained vision model.
4. **Inspect before inferring.** Determine available text, vector geometry, pages/layers and explicit dimensions. A raster scan needs a distinct validated extraction path. An IRM provides urban-planning context, not room dimensions.
5. **Explore interactively.** Use the overview to keep context while zooming into the detail canvas. Show/hide layers, search source identifiers or text, and select individual elements or a rectangular area. The built-in fictional drawing demonstrates the controls without an upload. Imported CAD curves use an explicit display approximation; units, source annotations and layer names remain evidence to review. Future semantic associations connect these elements to walls, rooms, floors or openings; selection alone is not recognition.
6. **Validate measurement inputs.** Confirm scale/units per drawing, dimensions, heights, face conventions, openings and evidence that the drawing corresponds to the current building. Mark unknowns and conflicts explicitly.
7. **Calculate and correct.** The current browser panel computes supported geometric lengths and simple closed-boundary areas with the user's confirmed scale. Changing selection or applying a new scale recalculates the panel; switching drawing/view resets calibration. Architectural quantities, reviewed corrections and authoritative report recalculation remain future work. A future correction must invalidate dependent quantities before a report is treated as current.
8. **Review and communicate.** Assemble traceable quantities and missing information into a report reviewed by the responsible person/professional, then export/share through an authorized workflow when implemented.

Use an in-app workspace. Do not send a user to a separate browser tab to inspect drawing geometry. Secure project persistence requires authentication, access controls, retention and deletion policies first.

## Everyday examples

### Painting a room

The target workflow lets a user select the relevant wall faces, verify their lengths and heights, and deduct openings for those same faces. Report gross/net wall area and the included faces. Never assume a wall height from a floor plan alone. A ceiling is a separate selected surface. Paint choice, coats, coverage per product and price are outside automatic estimation.

### Replacing a floor

Verify a room boundary and scale, then measure the selected floor polygon. Identify net versus gross area and any holes/deductions. Do not silently add waste factors or convert the area into boxes of flooring, a shopping list or a price.

### Reorganizing, remodeling, reconstructing or expanding

Record the existing documented configuration, the user's intended intervention and relevant municipal information. Proposed design changes must stay separate from source/as-built evidence. The current viewer does not move walls, redesign a floor plan or authorize demolition. Structural roles, hidden conditions, geometry/retreat compliance and permission require appropriate professional review; insufficient evidence produces a pending item, not a positive feasibility result.

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

For multiple heights, faces or roof planes, calculate each supported part separately. Unknown scale, dimensions, height, pitch or element identity must return **pending/unavailable**, not zero or a fabricated estimate. Evidence of approval does not guarantee that drawings match today's building.

## Architecture: preserve and extend

```text
React application
├── Predio / municipal context (existing)
├── Planos y remodelación (existing experimental entry)
│   ├── Activity and document inputs (existing)
│   ├── Vector selection / layers / zoom (existing)
│   ├── Scale and measurement review (planned)
│   └── Corrections and report preparation (planned)
├── Discovery / comparison (existing complementary workflow)
├── Scoring / unsupervised segmentation (planned parallel track)
└── Damage-evidence review for professionals (potential extension)
         │
         ▼
FastAPI and browser services
├── Municipal lookup and PUGS (existing)
├── Browser developer IRM parsing (existing)
├── Backend PDF/DXF extraction and local DWG conversion (experimental)
├── Validated geometry / deterministic quantities (planned)
├── Versioned evidence profile / secure storage (planned)
└── Reviewed technical exports / optional grounded assistant (planned)
```

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
- Keep existing geometry interaction visible; distinguish it from semantic recognition, editing and real-world measurement.
- Insurance/peritaje is a possible future extension, never a currently operating automated claims service.
- Parcel scoring and unsupervised ML are distinct from architectural extraction and damage detection.
- Never invent dimensions, quantities, regulatory values, materials, costs, customers, partnerships or achieved savings.
- User document authorization and secure handling precede persistent storage, collaboration and client sharing.
- Human review and necessary field verification remain part of the intended workflow.
- Confirm municipal-data/basemap reuse terms before commercialization; pricing remains open.

**Next practical step:** validate one real drawing and a manually checked painting or flooring measurement case, while preserving the existing predio → plans/IRM → interactive review foundation.
