# PredioAI — Architectural PDF Analysis Methodology

**Status:** Proposed / design only — not implemented  
**Scope:** Ecuador-first construction document intelligence, useful to homeowners, architects, contractors, and remodeling businesses.  
**Last discussed:** November 2026

## 1. Product objective

Convert **user-uploaded architectural documentation** into a traceable construction profile, practical quantities, an interactive property-aware AI assistant, and downloadable technical reports.

Core user journey:

1. User searches a cadastral property **or** starts without a cadastral identifier.
2. User uploads authorized architectural PDF(s), preferably a complete approved drawing set.
3. PredioAI inspects documents, extracts explicit information, and identifies drawing types.
4. PredioAI verifies dimensions/scales and derives quantities when supported.
5. User reviews and corrects uncertain extracted measurements.
6. PredioAI stores a structured, versioned building profile.
7. User asks natural-language questions and requests reports.
8. User exports PDF/Excel reports with source references.

**Plan A:** User supplies architectural PDFs. Do not make automated government-document retrieval a prerequisite.  
**Optional future integration:** Authorized retrieval of municipal documents.  
**Not in initial scope:** Insurance claim administration, automated policy decisions, specialized CNN training, or a replacement for professional site verification.

## 2. Existing application context

- Frontend: React/Vite; Spanish-language Ecuadorian UI.
- Backend: FastAPI.
- Existing cadastral lookup: Quito municipal ArcGIS GeoJSON, by `n_predio` or `clave_cata`.
- Existing PDF endpoint: `POST /api/blueprints/inspect` for basic PDF inspection.
- Map: Esri basemaps.
- Distinguish an individual *propiedad horizontal* unit from its shared global lot.

**Cadastral data is a separate source, not a substitute for building drawings.**

Example PH semantics from existing test property 627739:
- `area_const` = 211.36 m² registered construction area.
- `area_ter_1` = 223.43 m² attributed land share.
- `area_terre` = 33,348.48 m² global development lot.
- The cadastral polygon represents the global parcel, not the individual house footprint.
- Do not treat the attributed land share as a measured private lot or building footprint.

## 3. Proposed navigation

- **Catastro:** Search, map, cadastral attributes.
- **Análisis de planos:** Upload PDF; open an **in-app workspace tab**, not a separate browser tab. Show PDF viewer, extraction results, measurement review, and property-aware chat.
- **Informes:** Generate/download selected report sections.

Allow upload without cadastral lookup; associate a document with a cadastral property when known. Preserve user projects and uploaded document versions when persistence and authentication are implemented.

## 4. Extraction priorities

| Data | Preferred source | Important caveat |
| --- | --- | --- |
| Construction area | Area schedule / `cuadro de áreas` | Compare, do not silently overwrite, municipal area |
| Room floor area | Room schedule or verified plan geometry | May differ from net/gross building area |
| Room dimensions | `cotas` / dimension annotations | Associate each dimension with correct room |
| Wall lengths | Dimensioned wall geometry | Specify centerline, inside-face, or outside-face convention |
| Wall heights | `cortes`, elevations, schedules | **Do not infer from plan view alone** |
| Wall face area | Length × documented height | Define faces and subtract verified openings as appropriate |
| Roof surface area | Roof plan, pitch, elevations | Plan projection ≠ sloped roof surface |
| Doors/windows | Opening schedules and dimensions | Confirm quantities and locations |
| Materials | Specifications/notes, if supplied | Mark missing values as unknown |
| Floors/levels | Plan titles, levels, sections | Match plan sheets to the correct level |

Approved plans often include useful dimensions but **approval does not guarantee every needed quantity is present** or that as-built conditions still match the plans.

## 5. Processing methodology (pseudocode)

```python
def ingest_architectural_documents(files, project_id=None, cadastral_id=None):
    # 1. Validate user authorization, file type/size and safe PDF parsing.
    project = get_or_create_project(project_id, cadastral_id)
    documents = store_documents_securely(files, project, versioned=True)

    for doc in documents:
        inspection = inspect_pdf(doc)  # pages, metadata, text, drawings, scans
        pages = classify_pages(inspection)  # floor plan, section, elevation, roof, schedule
        raw = extract_text_tables_annotations_vectors(doc, pages)

        if raw.needs_ocr:
            raw += ocr_selected_pages(doc)  # fallback, not default

        observations = identify_explicit_dimensions_areas_levels(raw)
        evidence = link_observations_to_page_regions(observations, doc)

        # Never calculate metric geometry from an unverified drawing scale.
        calibration = validate_scale_using_dimensions_and_geometry(raw, evidence)
        candidates = associate_annotations_with_rooms_walls_roofs(raw, calibration)

        save_extraction_candidates(
            project, doc, candidates, evidence, calibration,
            status="requires_review"
        )

    return get_review_queue(project)


def confirm_and_calculate(project_id, reviewer_edits):
    verified = apply_reviewed_measurements(project_id, reviewer_edits)
    geometry = construct_validated_geometry(verified)

    quantities = {}
    quantities["room_areas"] = compute_room_areas(geometry)
    quantities["wall_lengths"] = compute_wall_lengths(geometry)
    quantities["wall_areas"] = compute_wall_face_areas(
        geometry, verified_heights=verified.heights,
        verified_openings=verified.openings
    )
    quantities["roof_areas"] = compute_roof_surface_areas(
        geometry, verified_roof_slopes=verified.roof_slopes
    )

    # Unsupported quantities stay null / pending, never guessed.
    quantities = mark_unsupported_as_pending(quantities)
    return save_versioned_construction_profile(project_id, quantities)


def answer_property_question(project_id, question):
    profile = load_structured_profile(project_id)
    evidence = retrieve_relevant_document_excerpts(project_id, question)
    tool_results = run_allowed_deterministic_calculations(question, profile)
    return llm_explain_with_citations(
        question, profile, evidence, tool_results,
        refuse_to_invent_missing_measurements=True
    )


def generate_technical_report(project_id, sections, format):
    profile = load_structured_profile(project_id)
    # Same authoritative data powers dashboard, chat, and report.
    report = build_report(
        profile,
        sections=sections,
        include_provenance=True,
        include_verification_status=True,
        include_assumptions_and_limitations=True
    )
    return export_report(report, format)  # PDF first; XLSX next
```

Pseudocode describes the **target architecture**, not existing callable functions.

## 6. Measurement provenance and reliability

For every quantity store:
- Value and units; element ID, room, level, and measurement convention.
- Source document ID/version, sheet/page, and optional page region/bounding box.
- Method: `explicitly_documented`, `calculated_from_verified_geometry`, `user_confirmed`, or `estimated`.
- Verification status: `pending`, `verified`, `conflicting`, or `unavailable`.
- Formula and inputs for derived quantities.
- Confidence/uncertainty where meaningful; never treat a model confidence score as a measurement guarantee.

If scale, height, roof pitch, or drawing context is missing, return **pending / not available** rather than a fabricated number. Highlight conflicting figures, e.g. a room schedule area versus geometry-derived area.

Illustrative formulas (only with verified inputs):
- Rectangular floor area: `length * width`.
- Gross interior wall-face area: `interior_perimeter * wall_height`.
- Net paintable wall area: `gross_wall_area - verified_opening_areas` (account for multiple wall faces).
- Sloped roof surface: `horizontal_projection / cos(roof_pitch)` for a simple uniform plane; complex roofs require individual roof-plane geometry.
- Preliminary cost: `quantity * user_supplied_unit_rate` with explicit exclusions and waste assumptions.

## 7. AI assistant

The assistant is a **general-purpose conversational interface specialized to the user's uploaded documents and property profile**, not a standalone PDF chatbot that guesses numbers.

Example questions:
- `¿Cuántos m² tiene cada dormitorio?`
- `¿Cuántos metros lineales de pared tiene la planta baja?`
- `¿Cuántos m² de pared necesito pintar, descontando las ventanas?`
- `¿Cuál es el área real de la cubierta según los planos?`
- `¿Coincide el área de construcción con el catastro?`
- `Genera un informe técnico con las superficies por ambiente.`

LLM may interpret requests, select retrieval/calculation tools, explain results, and draft narratives. **Deterministic Python routines** calculate measurable quantities. Every numeric answer should cite its source and indicate whether it was documented, calculated, or unverified. Where possible, clicking a citation highlights the PDF region.

OpenAI API is one possible hosted model provider, not a prerequisite for the PDF extraction engine. Keep API credentials server-side, outside Git.

## 8. Reports

Start with a downloadable **Spanish-language technical PDF report**, with Excel export next.

Report sections:
1. Identification and cadastral context, when linked.
2. Uploaded documents, sheet inventory, and version.
3. Construction area and floors.
4. Room-by-room floor area and dimensions.
5. Wall lengths, heights, gross/net wall surfaces.
6. Roof quantities and slope assumptions.
7. Doors, windows, and other documented characteristics.
8. Optional preliminary quantity/cost worksheet using **user-provided** rates.
9. Sources, formulas, discrepancies, review status, and limitations.

Use the same structured data for UI, chat, and reports; never let the LLM invent figures in a report. Label reports as analytical aids, not automatically certified professional assessments.

## 9. Proposed incremental milestones

**M0 — Baseline and Git safety**
- Resolve the current local `App.jsx` rebase conflict before synchronizing the local checkout.
- Keep this methodology separate from application changes; no forced pushes.
- Record current PDF inspection behavior and a minimal regression test.

**M1 — Document inspection and structured extraction**
- Test 2–3 authorized real architectural PDFs from M2 Construction Services.
- Detect vector vs scanned pages; extract annotations, area schedules, dimensions, and page labels.
- Preserve source page/region references.
- Establish what is explicitly available versus missing.

**M2 — Geometry and reviewed quantity calculations**
- Calibrate drawing scale from known dimensions.
- Associate room and wall geometry with annotations; request user review when ambiguous.
- Calculate a **small validated scope first**: room areas and wall lengths.
- Add heights, wall surfaces, openings, and roof quantities only when supported by drawings.
- Compare outputs with manually verified M2 quantity takeoffs.

**M3 — Construction profile and workspace**
- Store project, documents, document versions, measured elements, and source evidence.
- Build in-app `Análisis de planos` tab with PDF viewer, extracted data, and corrections.
- Secure document access and clarify retention/deletion controls.

**M4 — Assistant and technical reports**
- Add backend chat endpoint with retrieval and deterministic calculation tools.
- Add report export (PDF; later XLSX).
- Verify consistency across dashboard, chat, and report.

**M5 — Optional enhancements after validation**
- Pricing / usage limits, user accounts, local Ecuadorian cost catalogs, export into APU workflows.
- OCR enhancements for scans; more advanced CV **only if test evidence shows it is needed**.
- Authorized municipal document retrieval **only as a separate future option**.

## 10. Acceptance criteria for first meaningful prototype

Given an approved, authorized **vector PDF** with a dimensioned floor plan:
- Identify sheets and extract explicit area schedules and room labels.
- Return room measurements with units and document/page references.
- Compute selected room areas and wall lengths only with validated scale/dimensions.
- Flag missing heights/roof pitch as pending instead of assuming them.
- Let a user review or correct extracted values.
- Answer a room-area question using saved measurements and citations.
- Generate a PDF report with the **same values**, provenance, and caveats.
- Compare at least one project's output against M2's manually verified measurements.

Track accuracy: room matching precision/recall, area absolute/relative error, wall-length error, extraction coverage, reviewer correction rate, and processing time. **Do not invent target accuracy thresholds** before seeing the pilot documents.

## 11. Open decisions for M2 pilot

- What is the normal document package: PDF, DWG, scans, or combinations?
- Which sheets are included (floor, roof, sections, elevations, schedules)?
- Which quantities are most valuable to extract first?
- What measurement conventions and rounding rules does M2 use?
- Are completed manual takeoffs available for ground-truth comparison?
- How should users handle outdated drawings or undocumented renovations?
- What confidentiality/authorization restrictions apply to project plans?

## 12. Scope guardrails

- PredioAI **does not certify** as-built conditions or eliminate inspections for safety-critical work.
- No assumptions that all approved drawings contain every measurement.
- No automatic inference of wall heights from a plan view.
- No substitution of shared PH parcel area for individual building footprint.
- No custom model training planned unless simpler methods fail in a measurable way.
- Preserve source provenance and reviewability from the first implementation.
