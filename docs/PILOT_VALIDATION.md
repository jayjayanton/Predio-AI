# PredioAI: preliminary presentation and first real-document test

Review date: **17 November 2026**.
Document-workflow update: **17 November 2026**.

## What the preliminary presentation can establish

Present the application as an experimental workspace for understanding a home's plans and municipal context. The useful demonstration is **choose an activity → inspect an authorized PDF/DXF/DWG or one drawing from a ZIP → review conversion and partial-view notices → select geometry and apply its scale → explore an explicitly illustrative volume → review the document summary**, with an optional predio/IRM workflow. DWG and ZIP support must be verified on the deployed API before demonstrating uploads.

The current software exposes document geometry. It does not yet establish architectural accuracy, verified floor/wall measurements, reliable room recognition, a permit decision or a finished technical report. Automated tests and synthetic documents exercise software behavior; they do not substitute for a real-project validation.

The initial conversation should be with the homeowner and a small architecture/remodeling team, such as the colleague's M2 construction practice. Ask where plan review takes time, which files they actually receive, how they check dimensions, what corrections they would need and which existing deliverable the tool should help prepare. Willingness to pay and time saved remain hypotheses until observed.

## A focused demonstration

1. Explain the practical task: understand an existing plan before replacing a room's floor or preparing a painting scope.
2. Open **Analizar planos** directly. Explain that municipal lookup is optional for inspecting a file. An isolated flooring or painting task can be inspected without an IRM under this pilot's software rules.
3. Use **Ver plano de ejemplo** to introduce the drawing overview, zoom, layer controls and selection without an upload. The sample is a fictional dwelling. Then inspect an authorized document and show its source file, available views/layers, imported element count and source identifiers. A rectangular selection crosses drawing elements; it does not automatically define a room boundary or a construction quantity.
4. Open **Medidas**. For the fictional **Área de ejemplo** boundary, apply centimetres and check the expected 13.72 m perimeter and 10.7848 m² area. For a real model, review and explicitly confirm its units or calibrate one eligible line against an independently known length. Show that a different selection recalculates the result, while an open or ambiguous boundary has no area. Then open **Resumen documental** to distinguish document evidence from these browser-local calculations.
5. Keep the fictional **Área de ejemplo** boundary selected. In **Medidas**, choose **cm** and click **Aplicar unidad**, then open **Ilustración 3D**. The initial 2.6 m height and absent roof are example assumptions. Choose another height or a flat/gable roof, then click **Actualizar ilustración**. Compare **Vista 3D**, **Frente ilustrativo**, **Lado ilustrativo** and **Planta**. Explain that the base comes from the selected exterior geometry and applied scale; front/side are hypothetical projections, not sections found in a source file. Use **Volver al plano fuente** to return to the selected drawing.
6. With an authorized ZIP, show its folder paths and select another supported drawing. Explain that only the selected file is inspected, each view needs its own scale, and no floor count or relationship between files is inferred. If a selected drawing fails, show that the inventory remains available for another selection.
7. Show **Mi predio** only when municipal context is relevant. Broader remodeling, structural and expansion requests retain their document prerequisites; the application does not decide what work is permitted.
8. Ask the reviewer to choose one real case for the next measurement milestone.

During the measurement demonstration, show the selected/compatible/excluded counts and use **Volver al plano** to resume selection without losing the applied scale. For a hatch with nested contours, select its source boundary and compare the area after hole deductions and the perimeter including inner edges. Reimport the file to obtain the grouped source boundaries; previously loaded results retain their earlier representation.

For a floor hatch interrupted by furniture graphics, use **Área de contorno** and click inside its closed source boundary. Check the highlighted exterior against the original drawing, then compare **Solo contorno exterior** with **Trazado CAD con recortes**. A graphic mask is not automatically a physical floor opening. Confirm the CAD coordinate unit, including any mismatch warning; displayed measurements remain in m and m². A printed area label can be compared with the geometric result but never supplies that result.

The illustrative controls accept height **0.3–12 m**, with **2.6 m** as the initial example. Roof choices are none, flat or gable; a gable uses an assumed **1–60°** pitch and an X- or Y-aligned ridge. For a gable, entered height means eaves height. The illustration follows the selected outside contour and explicitly ignores internal cutouts; it does not reconstruct interior walls, openings, additional storeys or an actual roof. Assumptions apply only after **Actualizar ilustración** and reset when the contour, view, drawing or scale changes.

For ZIP demonstrations, use a package no larger than **30 MiB**, with each supported drawing at most **15 MiB**, at most **100 supported drawings / 1,000 entries**, and at most **150 MiB** advertised uncompressed content. Nested archives and unsupported files are skipped; unsafe, encrypted or excessive-expansion packages are rejected. Files are inspected separately without automatic xref assembly. Package contents and illustrations are not saved as permanent projects. Reloading requires choosing the ZIP again.

## What to request for the first real test

Ask the owner/architect for an authorized vector PDF, DXF or DWG of one existing room or small dwelling. DWG can be submitted directly once the server converter is deployed. Retain the original and any independently exported PDF/DXF for comparison. Remove unrelated personal information and retain the revision date. Confirm whether the drawing describes existing conditions or a proposal.

Ask for related floor plans, actual sections, elevations and roof drawings if available. They may be in one CAD file, several layouts or separate files; a ZIP is an optional way to deliver a set while preserving folders. A section marker does not contain the profile it references. Verify the actual content of each selected document instead of assuming that every file or layer corresponds to a floor. Missing heights and roof details remain unknown even when an illustrative volume can be shown.

Gather a small set of independently checked dimensions and a reference area from the responsible architect or a site measurement. Record whether the drawing reflects the current building. If possible, obtain both a PDF and a DXF export of the same drawing to compare how units and geometry survive conversion.

For the first case, prefer a **floor surface** with a clear boundary and at least two known dimensions. A painting case adds verified wall heights, treatment of corners/faces and opening deductions, so it should follow the simpler floor case.

## Validation sequence

| Check | Evidence needed | Result to record |
| --- | --- | --- |
| Document ingestion | Real authorized PDF/DXF/DWG; source/revision | Opens, conversion notices, partial extraction or rejection, with reasons |
| ZIP package switching | Authorized files with distinct folder paths; one deliberately unusable synthetic member for a software demo | Correct selected source, recoverable member failure, cleared prior geometry/scale, no automatic xref assembly |
| Source fidelity | Original drawing beside extracted geometry | Missing/duplicated lines, transformed blocks, curves, hidden layers or page issues |
| Scale and units | CAD units plus dimension annotations or another independent reference | Verified, conflicting or unknown; never infer metres from screen pixels |
| Selected surface | Reviewer-confirmed closed room boundary | Which lines belong to the room; treatment of wall thickness and exclusions |
| Measurement milestone | Implemented deterministic area calculation and independently checked reference | Absolute error and percentage error, plus unresolved inputs |
| Illustrative volume | Selected exterior contour, applied scale and explicitly entered assumptions | Base follows the selected contour; height/roof remain labelled assumptions; front/side are not source sections |
| Correction milestone | Deliberate correction to a boundary/dimension | Dependent quantities invalidated and recalculated from the corrected version |
| Report milestone | Source, revision, selected elements, formula and review status | Traceable output that another person can reproduce and check |

Today's viewer supports ingestion, inspection, explicit scale confirmation and geometric length/area calculations for eligible selections. The original real-DWG trial exposed the old 3,000-element display cutoff; the expanded importer retains supported blocks, curves, hatches, text and dimension components within whole-import limits. The overview and detail share imported data and are not an independent fidelity check. Compare them with the original CAD application or an independent export, retaining conversion and omission warnings. Unit confirmation and arithmetic checks do not establish physical measurement accuracy. Independent reference dimensions, architectural interpretation, reviewed corrections and reports remain to be validated or implemented. Agree an acceptable error tolerance with the intended professional user **before** evaluating results; do not invent a universal construction tolerance.

Record the baseline manual workflow time, inspection/correction time and any additional visit required. One successful document establishes a case result, not performance across all Quito drawings. Test a second independent drawing before broadening claims.

## Presentation versus release

| Stage | Readiness condition |
| --- | --- |
| Preliminary discussion/demo | Honest scope, working navigation and visible failure states; real-document validation status explained |
| Supervised geometry pilot | Authorized real documents can be inspected and limitations are recorded |
| Measurement pilot | Units, dimensions and outputs checked against independent references; corrections and provenance work |
| Commercial rollout | Validated intended use, suitable hosting, chosen public identity, operational support and appropriate document/access handling |

The existing project URL can support the preliminary discussion. Before buying a domain, resolve the name choice: `predio.ai` is already an active business using PredioAI, and `predioai.com` redirects to it. Registrar checks on the review date showed `predioplan.com` and `planopredio.com` available at standard pricing; availability is temporary and no name change or registration has been made. See the [deployment guide](../DEPLOYMENT.md) for the separate hosting and domain steps.

Sources for the naming/hosting decision: [existing PredioAI business](https://predio.ai/), [Porkbun domain search and pricing](https://porkbun.com/products/domains/com), [GitHub Pages terms](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#pages), [Render static hosting](https://render.com/docs/static-sites).
