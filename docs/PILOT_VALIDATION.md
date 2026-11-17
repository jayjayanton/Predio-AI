# PredioAI: preliminary presentation and first real-document test

Review date: **17 November 2026**.

## What the preliminary presentation can establish

Present the current application as an experimental workspace for understanding a home's plans and municipal context. The useful current demonstration is **choose an activity → inspect an authorized PDF/DXF → select lines and layers → review the document summary**, with an optional predio/IRM workflow.

The current software exposes document geometry. It does not yet establish architectural accuracy, verified floor/wall measurements, reliable room recognition, a permit decision or a finished technical report. Automated tests and synthetic documents exercise software behavior; they do not substitute for a real-project validation.

The initial conversation should be with the homeowner and a small architecture/remodeling team, such as the colleague's M2 construction practice. Ask where plan review takes time, which files they actually receive, how they check dimensions, what corrections they would need and which existing deliverable the tool should help prepare. Willingness to pay and time saved remain hypotheses until observed.

## A focused demonstration

1. Explain the practical task: understand an existing plan before replacing a room's floor or preparing a painting scope.
2. Open **Analizar planos** directly. Explain that municipal lookup is optional for inspecting a file. An isolated flooring or painting task can be inspected without an IRM under this pilot's software rules.
3. With an authorized document, show the source file, available pages/layers and selected geometry. Label a synthetic fixture explicitly if used only to demonstrate interaction.
4. Open **Resumen documental**. Point out the available evidence and fields still awaiting verification.
5. Show **Mi predio** only when municipal context is relevant. Broader remodeling, structural and expansion requests retain their document prerequisites; the application does not decide what work is permitted.
6. Ask the reviewer to choose one real case for the next measurement milestone.

## What to request for the first real test

Ask the owner/architect for an authorized vector PDF or DXF of one existing room or small dwelling. If the source is DWG, request an authorized DXF export. Remove unrelated personal information. Retain the original source and revision date.

Gather a small set of independently checked dimensions and a reference area from the responsible architect or a site measurement. Record whether the drawing reflects the current building. If possible, obtain both a PDF and a DXF export of the same drawing to compare how units and geometry survive conversion.

For the first case, prefer a **floor surface** with a clear boundary and at least two known dimensions. A painting case adds verified wall heights, treatment of corners/faces and opening deductions, so it should follow the simpler floor case.

## Validation sequence

| Check | Evidence needed | Result to record |
| --- | --- | --- |
| Document ingestion | Real authorized PDF/DXF; source/revision | Opens, partial extraction or rejection, with reasons |
| Source fidelity | Original drawing beside extracted geometry | Missing/duplicated lines, transformed blocks, curves, hidden layers or page issues |
| Scale and units | CAD units plus dimension annotations or another independent reference | Verified, conflicting or unknown; never infer metres from screen pixels |
| Selected surface | Reviewer-confirmed closed room boundary | Which lines belong to the room; treatment of wall thickness and exclusions |
| Measurement milestone | Implemented deterministic area calculation and independently checked reference | Absolute error and percentage error, plus unresolved inputs |
| Correction milestone | Deliberate correction to a boundary/dimension | Dependent quantities invalidated and recalculated from the corrected version |
| Report milestone | Source, revision, selected elements, formula and review status | Traceable output that another person can reproduce and check |

Only the first two checks can be investigated with today's viewer. The scale/calculation/correction/report pipeline still requires implementation and validation. Agree an acceptable error tolerance with the intended professional user **before** evaluating results; do not invent a universal construction tolerance.

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
