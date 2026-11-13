# PredioAI — Architectural Document Intelligence

**Project methodology and development roadmap**  
**Stage:** Product design and validation · November 2026  
**Companion document:** [Project README](../README.md)

## Project overview

PredioAI is being developed as a practical bridge between **property GIS** and **construction-document analysis**. Its current prototype retrieves Quito cadastral data and inspects PDF structure. The next stage will allow users to upload authorized architectural drawings, extract reliable construction quantities, explore the findings through an AI assistant, and generate technical reports.

The intended users include homeowners, architects, estimators, remodeling contractors, and construction companies in Ecuador. The initial use case is **quantity takeoff from existing plans**—not insurance claim handling or automatically retrieving government documents.

### Product hypothesis

If architectural plans already contain room dimensions, area schedules, sections, and construction annotations, PredioAI can reduce repetitive manual measurement work by turning those documents into structured, reviewable quantities. The hypothesis must be tested against real approved drawings and manually verified results.

### Guiding principles

1. **Upload-first:** The user provides the architectural PDF. Linking it to a Quito cadastral record is optional.
2. **Extract before infer:** Prefer explicit annotations and vector geometry; calculate from verified inputs.
3. **Evidence for every number:** Preserve document, page, location, units, formula, and verification status.
4. **Reviewable, not magical:** Users can correct ambiguous room associations, scales, and dimensions.
5. **One source of truth:** Dashboard, AI chat, and reports use the same structured construction profile.
6. **No custom model training by default:** Introduce advanced computer vision only if a measured need arises.

## Existing foundation

| System | Current state |
| --- | --- |
| React/Vite Spanish-language interface | Implemented |
| Quito cadastral lookup (`clave_cata`, `n_predio`) | Implemented |
| Esri basemap switching and parcel visualization | Implemented |
| PH unit-versus-parent-lot distinction | Implemented |
| `POST /api/blueprints/inspect` | Implemented; page/vector/text metadata only |
| Automatic room/wall/roof extraction | Not implemented |
| Persistent document workspace | Not implemented |
| AI assistant and report generation | Not implemented |

### Cadastral interpretation

For PH example predio `627739`, the municipal layer previously returned:
- Registered construction area (`area_const`): **211.36 m²**.
- Attributed land share (`area_ter_1`): **223.43 m²**.
- Parent/global lot (`area_terre`): **33,348.48 m²**.

The mapped cadastral polygon represents the global lot, **not the individual dwelling footprint**. These are separate from plan-derived room and roof measurements.

## User journey

1. **Start:** Search a property by cadastral identifier, or open **Análisis de planos** directly.
2. **Upload:** Supply authorized PDF plans, ideally including floor plans, sections, elevations, roof plans, and area schedules.
3. **Inspect:** Determine document type, pages, text, vector content, and whether OCR is needed.
4. **Extract:** Read explicit dimensions, room labels, schedules, levels, and documented construction characteristics.
5. **Validate:** Associate annotations with the correct elements; verify scale and highlight discrepancies.
6. **Calculate:** Derive quantities from verified measurements, leaving unsupported values pending.
7. **Explore:** Display the PDF and measurements side by side; ask the contextual assistant questions.
8. **Report:** Export a technical summary and quantity schedule with citations and caveats.

The upload should open an **in-app analysis tab/workspace**, not a separate browser tab. Long-term project persistence requires authentication and secure storage.

## Architectural information model

| Quantity | Preferred evidence | Rule |
| --- | --- | --- |
| Total construction area | `Cuadro de áreas` | Do not silently overwrite cadastral figures |
| Room area | Room schedule or verified plan geometry | Specify net vs gross area |
| Room dimensions | Dimension annotations (`cotas`) | Associate with correct room and floor |
| Wall length | Dimensioned wall geometry | Declare measurement convention |
| Wall height | Sections (`cortes`), elevations, schedules | Never assume from floor plan alone |
| Gross/net wall surface | Verified length, height, openings | Specify wall faces and opening deductions |
| Roof surface | Roof plan and verified slopes | Distinguish projected area from actual slope area |
| Doors/windows | Opening schedules and annotated geometry | Verify counts and dimensions |
| Materials | Notes and specifications | Unknown if undocumented |

Government approval may support document provenance, but it does **not** guarantee that every quantity is shown or that the building matches the drawings today.

## Technical architecture

```text
React application
├── Catastro (existing)
├── Análisis de planos (planned)
│   ├── Upload + PDF viewer
│   ├── Measurement review panel
│   └── Property-aware AI chat
└── Informes (planned)
          │
          ▼
FastAPI backend
├── Municipal cadastral service (existing)
├── PDF inspection (existing)
├── Document extraction (planned)
├── Scale / geometry validation (planned)
├── Deterministic quantity engine (planned)
├── Versioned construction profile (planned)
├── AI retrieval + calculation tools (planned)
└── PDF / Excel report generation (planned)
```

**Suggested tools:** PyMuPDF for PDF inspection and vector/text extraction; OCR only where needed; NumPy/Shapely for geometry; an LLM API for language understanding and source-grounded explanations. The AI should never invent a quantity the geometry engine cannot support.

## Processing pseudocode

The following functions are **design pseudocode**, not existing backend APIs.

```python
def process_upload(files, project_id=None, cadastral_id=None):
    require_upload_authorization()
    project = get_or_create_project(project_id, cadastral_id)
    documents = validate_and_store_securely(files, project, versioned=True)

    for document in documents:
        inspection = inspect_pdf(document)
        sheets = classify_sheets(inspection)  # plan / section / elevation / roof / schedule
        raw = extract_text_tables_dimensions_vectors(document, sheets)

        if raw.has_scanned_pages:
            raw += ocr_relevant_pages(document)

        observations = locate_explicit_annotations(raw)
        evidence = link_to_source_pages_and_regions(observations, document)
        scale = validate_scale_from_known_dimensions(raw, evidence)

        candidates = associate_rooms_walls_roofs(
            raw, observations, scale, evidence
        )
        save_candidates(project, candidates, status="pending_review")

    return get_measurement_review_queue(project)


def confirm_measurements_and_calculate(project_id, corrections):
    verified = apply_user_review(project_id, corrections)
    geometry = build_geometry_from_verified_inputs(verified)

    quantities = {
        "room_areas": calculate_room_areas(geometry),
        "wall_lengths": calculate_wall_lengths(geometry),
        "wall_face_areas": calculate_wall_areas_if_height_known(
            geometry, verified.heights, verified.openings
        ),
        "roof_areas": calculate_roof_areas_if_pitch_known(
            geometry, verified.roof_geometry, verified.roof_slopes
        ),
    }

    quantities = mark_missing_inputs_as_pending(quantities)
    return save_versioned_profile(project_id, quantities)


def answer_question(project_id, question):
    profile = load_construction_profile(project_id)
    sources = retrieve_relevant_pdf_evidence(project_id, question)
    calculations = execute_validated_quantity_tools(question, profile)

    return llm_explain_with_citations(
        question, profile, sources, calculations,
        never_invent_measurements=True
    )


def create_report(project_id, sections, output_format="pdf"):
    profile = load_construction_profile(project_id)
    report = assemble_technical_report(
        profile, sections,
        include_source_pages=True,
        include_formulas=True,
        include_review_status=True,
        include_limitations=True
    )
    return export(report, output_format)
```

## Measurement rules and traceability

Each measurement should record:
- **Identity:** Project, building, floor, room, element ID, and measurement convention.
- **Quantity:** Numeric value, unit, and whether gross/net.
- **Source:** Document ID/version, sheet/page, and page region where possible.
- **Derivation:** `documented`, `calculated`, `user_confirmed`, or `estimated`.
- **Review status:** `pending`, `verified`, `conflicting`, or `unavailable`.
- **Calculation:** Formula, verified inputs, and assumptions.

Sample formulas—only when the required dimensions are known:

```text
Rectangular floor area        = length × width
Gross wall-face area          = measured wall-face length × verified height
Net paintable wall area       = gross wall-face area − verified openings
Simple sloped roof-plane area = projected area / cos(verified roof pitch)
Preliminary work cost         = measured quantity × user-supplied unit rate
```

For complex floor plans and roofs, calculate by verified polygons or individual planes rather than relying on a single simplified formula. Missing scale, height, pitch, or geometry must produce **pending**, not an invented estimate.

## Conversational assistant

The proposed assistant is an all-purpose interface **within the uploaded project's context**. It retrieves structured measurements, consults relevant document evidence, invokes deterministic calculation tools, and explains results in Spanish.

Example requests:
- “¿Cuál es el área de cada dormitorio?”
- “¿Cuántos metros lineales de paredes tiene la planta baja?”
- “¿Cuántos metros cuadrados de pared necesito pintar?”
- “¿Cuál es el área de la cubierta, considerando su pendiente?”
- “¿Coincide el cuadro de áreas con el catastro?”
- “Genera un informe técnico por ambiente.”

Quantitative answers should link to source pages and ideally highlight the relevant PDF region. The LLM is an interface and explanation layer, **not** the authority for measured geometry.

## Technical reports

Reports should be generated from the **same structured profile** used by the chat and UI.

**First export:** PDF. **Next:** Excel.

Proposed sections:
1. Property and cadastral identification, if linked.
2. Document inventory and drawing versions.
3. Construction area and levels.
4. Room-by-room areas, dimensions, and perimeters.
5. Wall lengths, heights, and net/gross surfaces.
6. Roof areas, slopes, and calculation assumptions.
7. Doors, windows, and material notes where documented.
8. Optional preliminary quantity/cost schedule using user-provided rates.
9. Sources, calculation notes, conflicts, missing information, and review status.

Reports are analytical outputs, not automatically certified architectural or engineering documents.

## Delivery roadmap

| Milestone | Deliverable | Success condition |
| --- | --- | --- |
| **M0 — Stable foundation** | Confirm current app/API behavior and CI | Baseline cadastral lookup and PDF inspection remain functional |
| **M1 — Document extraction** | Parse authorized vector PDFs; identify sheets, text, areas, dimensions | Extracted data linked to original document/page |
| **M2 — Measurement engine** | Validate scale, associate geometry, calculate room areas and wall lengths | Measurements reviewed against manual ground truth |
| **M3 — Analysis workspace** | In-app PDF viewer, corrections, secure project/document records | Users can review and reopen a project's findings |
| **M4 — AI + reports** | Contextual chat, deterministic calculation tools, PDF/Excel export | Chat, dashboard, and report agree on all quantities |
| **M5 — Optional extensions** | OCR improvements, cost integrations, authorized document retrieval | Added only after validated user demand |

No custom CNN or advanced CV phase is currently planned.

## Validation with M2 Construction Services

A proposed pilot is to obtain **2–3 authorized completed drawing sets** and their manually verified quantity takeoffs, if M2 is willing to share them.

Key questions:
- Are project documents vector PDFs, scans, DWG files, or mixed?
- Which approved sheets are routinely available?
- Which quantities take the most manual effort?
- Which conventions govern room area, wall length, wall faces, and rounding?
- How long does a manual takeoff take, and how are its results delivered?
- Are prior verified takeoffs available for objective comparison?
- What confidentiality restrictions apply to the documents?

Measure room-label matching, room-area error, wall-length error, extraction coverage, reviewer corrections, and processing time. Set quantitative accuracy targets **after** inspecting real pilot documents, not before.

## First prototype acceptance criteria

Given an authorized dimensioned vector architectural PDF, the prototype should:
- Identify sheets and extract explicit room labels and area schedules.
- Link each extracted quantity to its source page.
- Validate drawing scale before measuring geometry.
- Calculate selected room areas and wall lengths from verified inputs.
- Leave unknown wall heights and roof pitches pending.
- Allow the user to correct extracted values.
- Answer a grounded room-measurement question.
- Generate a technical report that agrees with the reviewed construction profile.
- Compare its quantities with at least one manually verified takeoff.

## Boundaries and future decisions

- User-uploaded PDFs are **Plan A**. Municipal document retrieval is optional future work.
- Cadastral lookup is helpful but not mandatory for blueprint analysis.
- The product is **not** an insurance-claims platform.
- Plans are evidence of documented design, not proof of current as-built conditions.
- No automatic professional certification or guarantee that a site visit can be eliminated.
- Authentication, access controls, document retention, and deletion rules must precede persistent multi-user storage.
- Confirm municipal-data and basemap reuse terms before commercial launch.
- Pricing and monetization remain open; prioritize extraction accuracy and user value first.

---

**Next practical step:** Review one real approved architectural PDF and a verified manual quantity takeoff, then refine M1 and M2 based on what the document actually contains.
