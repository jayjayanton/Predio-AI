# PredioAI — Repair, maintenance, remodeling and expansion workflow

## User journey
1. Select predio and inspect cadastral information.
2. Choose **Casa** or **Departamento** and intervention type:
   repair, maintenance, interior remodel, structural modification, expansion.
3. Upload blueprint (currently PDF through UI; future PDF/DXF) and
   IRM when applicable. For expansion, IRM is required for the preliminary
   urban-planning workflow. For other work it is optional or recommended;
   applicability must be reviewed for each project, not inferred solely
   from whether it is a house or apartment.
4. Backend extracts document evidence and validated dimensions.
5. Future interactive blueprint viewer displays original drawing with
   individually selectable walls, floors, roofs, openings and rooms;
   support multiple selection, overlays, and source references.
6. Users correct extracted geometry; corrections create a revision and
   trigger recalculation of affected quantities and dependencies.
7. Generate preliminary quantity/feasibility report from the latest
   revision, including source evidence, missing fields and limitations.

## Critical non-negotiable validation
- NEVER invent dimensions, areas, wall heights, materials, roof pitch,
  IRM values, prices or construction approval.
- A PDF scale label alone is not reliable unless verified against
  dimension annotations or another reliable reference.
- Without verified scale or CAD units, show the drawing but block
  physical measurements and dependent calculations.
- Floor plans may provide wall length but not wall height. Do not
  calculate vertical wall area without verified height.
- Partial repair areas require measured affected extent; selecting
  an entire wall does not establish damaged surface area.
- Distinguish gross and net wall areas and subtract openings only
  when opening dimensions are verified.
- Distinguish projected roof area from sloped roof surface area.
- Apartment renovations can affect structure, services, facade,
  common property or condominium rules. IRM is not categorically
  irrelevant to apartments.
- Municipal approval and professional structural review are separate
  from preliminary automated checks.

## Future extraction and computation modules
- PyMuPDF: vector PDF drawings, text and IRM tables.
- ezdxf: DXF entities/layers, units, dimensions and annotations.
- NumPy: vector math and derived quantities after validation.
- Shapely: wall/room polygons, areas, distances and overlays.
- pdfplumber: IRM tables when PyMuPDF extraction is insufficient.
- OpenCV/Pillow and optional OCR for scanned documents.
- SQLite/JSON: persistent element inventory, revisions and audit trail.
- PDF.js with SVG overlays: source-aligned interactive selection.
- ReportLab or equivalent: reproducible preliminary PDF reports.

## Current implementation status
- Predio selection, cadastral/AIVA information and map: implemented.
- UI selection of building and intervention type: implemented.
- Conditional IRM requirement: implemented as a **workflow prompt**,
  not a definitive legal determination.
- PDF upload: implemented through existing inspection endpoint.
- PDF/DXF evidence-first module: backend/app/document_analysis.py,
  not yet wired to the UI.
- Interactive geometry selection, correction/recalculation, report
  generation, and IRM compliance engine: **not implemented**.

## Rollback
The new frontend controls are isolated under
`OPTIONAL WORKFLOW SELECTORS` and `OPTIONAL WORK TYPE CONTROLS`.
Git commit d64ff9783c11242cf20ee267bb0f399daf2b1d64 contains
the workflow UI change. Revert that commit to restore the previous
two-required-PDF UI, leaving existing cadastral data untouched.
