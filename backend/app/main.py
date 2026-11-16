
"""
PredioAI — FastAPI Backend

Endpoints:
    GET  /api/health
    GET  /api/municipal/fields

    GET  /api/predios/by-cadastral-key/{cadastral_key}
    GET  /api/predios/{identifier_type}/{identifier}

    GET  /api/property-details/{identifier_type}/{identifier}

    POST /api/blueprints/inspect

Supported identifiers:
    clave_cata
    n_predio
"""

import os
from pathlib import Path

from fastapi import (
    FastAPI,
    HTTPException,
    UploadFile,
    File
)

from fastapi.middleware.cors import CORSMiddleware

from .municipal import (
    lookup_predio,
    get_property_details,
    get_municipal_fields,
    MunicipalError,
)


# ============================================================
# 1. APPLICATION CONFIGURATION
# ============================================================

app = FastAPI(
    title="PredioAI API",
    description=(
        "Quito cadastral property intelligence "
        "and architectural document inspection."
    ),
    version="0.2.0"
)

origins = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"]
)


# ============================================================
# 2. HEALTH CHECK
# ============================================================

@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "application": "PredioAI",
        "version": "0.2.0"
    }


# ============================================================
# 3. MUNICIPAL FIELD METADATA
# ============================================================

@app.get("/api/municipal/fields")
async def municipal_fields():
    """
    Retrieve all published fields from Quito's
    municipal cadastral ArcGIS layer.
    """

    try:
        fields = await get_municipal_fields()

    except MunicipalError as exc:
        raise HTTPException(
            status_code=502,
            detail=str(exc)
        ) from exc

    return {
        "count": len(fields),
        "fields": fields
    }


# ============================================================
# 4. LEGACY CADASTRAL KEY LOOKUP
# ============================================================

@app.get(
    "/api/predios/by-cadastral-key/{cadastral_key}"
)
async def predio_by_cadastral_key(
    cadastral_key: str
):
    """
    Backward-compatible cadastral key search.
    """

    try:
        data = await lookup_predio(
            cadastral_key,
            "clave_cata"
        )

    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc)
        ) from exc

    except MunicipalError as exc:
        raise HTTPException(
            status_code=502,
            detail=str(exc)
        ) from exc

    if not data.get("features"):
        raise HTTPException(
            status_code=404,
            detail="Predio not found"
        )

    return data


# ============================================================
# 5. DUAL IDENTIFIER LOOKUP
# ============================================================

@app.get(
    "/api/predios/{identifier_type}/{identifier}"
)
async def predio_lookup(
    identifier_type: str,
    identifier: str
):
    """
    Search by:
        clave_cata
        n_predio

    Returns the original municipal GeoJSON.
    """

    try:
        data = await lookup_predio(
            identifier,
            identifier_type
        )

    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc)
        ) from exc

    except MunicipalError as exc:
        raise HTTPException(
            status_code=502,
            detail=str(exc)
        ) from exc

    if not data.get("features"):
        raise HTTPException(
            status_code=404,
            detail="Property not found"
        )

    return data


# ============================================================
# 6. NORMALIZED PROPERTY DETAILS
# ============================================================

@app.get(
    "/api/property-details/{identifier_type}/{identifier}"
)
async def property_details(
    identifier_type: str,
    identifier: str
):
    """
    Retrieve structured cadastral information.

    Includes:
        - Individual property identifiers
        - Construction measurements
        - Global lot measurements
        - PH ownership allocation
        - Property valuation
        - Original GeoJSON
    """

    try:
        result = await get_property_details(
            identifier,
            identifier_type
        )

    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc)
        ) from exc

    except MunicipalError as exc:
        raise HTTPException(
            status_code=502,
            detail=str(exc)
        ) from exc

    if result["count"] == 0:
        raise HTTPException(
            status_code=404,
            detail="Property not found"
        )

    return result


# ============================================================
# 7. BLUEPRINT INSPECTION
# ============================================================

MAX_UPLOAD = 15 * 1024 * 1024


@app.post("/api/blueprints/inspect")
async def inspect_blueprint(
    file: UploadFile = File(...)
):
    """
    Inspect an authorized architectural PDF.

    Extract:
        - Page count
        - Page dimensions
        - Vector drawing count
        - Text character count

    The PDF is processed in memory and is not
    deliberately stored by this endpoint.

    No architectural measurements are inferred yet.
    """

    # --------------------------------------------------------
    # Validate file extension
    # --------------------------------------------------------

    if (
        not file.filename
        or not file.filename.lower().endswith(".pdf")
    ):
        raise HTTPException(
            status_code=400,
            detail="Only PDF documents are supported"
        )

    # --------------------------------------------------------
    # Read and validate file size
    # --------------------------------------------------------

    data = await file.read(MAX_UPLOAD + 1)

    if len(data) > MAX_UPLOAD:
        raise HTTPException(
            status_code=413,
            detail="PDF exceeds 15 MB limit"
        )

    # --------------------------------------------------------
    # Validate PDF signature
    # --------------------------------------------------------

    if not data.startswith(b"%PDF-"):
        raise HTTPException(
            status_code=400,
            detail="Invalid PDF signature"
        )

    # --------------------------------------------------------
    # Inspect PDF
    # --------------------------------------------------------

    try:
        import fitz

        document = fitz.open(
            stream=data,
            filetype="pdf"
        )

        try:
            pages = len(document)

            if pages == 0 or pages > 100:
                raise ValueError(
                    "Invalid page count"
                )

            page_info = []

            for page in document:

                page_info.append({
                    "page": page.number + 1,
                    "width_pt": round(
                        page.rect.width, 2
                    ),
                    "height_pt": round(
                        page.rect.height, 2
                    ),
                    "vector_drawings": len(
                        page.get_drawings()
                    ),
                    "text_characters": len(
                        page.get_text()
                    )
                })

        finally:
            document.close()

    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail="Unable to parse PDF"
        ) from exc

    # --------------------------------------------------------
    # Return inspection results
    # --------------------------------------------------------

    return {
        "filename": Path(file.filename).name,
        "pages": pages,
        "page_info": page_info,
        "stored": False,
        "measurements_available": False
    }


# ============================================================
# OPTIONAL DOCUMENT ANALYSIS V2 — BEGIN
# Independent of legacy /api/blueprints/inspect.
# Remove this block to revert the new workflow without changing
# municipal or existing PDF endpoints.
# ============================================================
from typing import Literal
from fastapi import Form
from .document_analysis import analyze_document
from .work_activities import validate_activities


@app.post("/api/documents/analyze")
async def analyze_project_documents(
    blueprint: UploadFile = File(...),
    irm: UploadFile | None = File(default=None),
    building_type: Literal["house", "apartment"] = Form(...),
    work_type: Literal["repair", "maintenance", "remodel", "structural", "expansion"] = Form(...),
    predio_number: str | None = Form(default=None),
    activities: list[str] = Form(...),
):
    """Extract evidence from PDF/DXF blueprint and conditionally required IRM PDF.

    This does not calculate dimensions, check regulatory compliance,
    or certify that an intervention is permitted.
    """
    try:
        selected_activities = validate_activities(work_type, activities)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if work_type in {"remodel", "structural", "expansion"} and irm is None:
        raise HTTPException(status_code=422, detail="IRM required for remodel, structural, or expansion review")
    if predio_number and (not predio_number.isdigit() or len(predio_number) > 25):
        raise HTTPException(status_code=422, detail="Invalid predio number")

    async def parse_upload(upload: UploadFile, role: str):
        content = await upload.read(MAX_UPLOAD + 1)
        if len(content) > MAX_UPLOAD:
            raise HTTPException(status_code=413, detail=f"{role} exceeds 15 MB")
        try:
            return analyze_document(content, upload.filename or "", role)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    blueprint_result = await parse_upload(blueprint, "blueprint")
    irm_result = await parse_upload(irm, "irm") if irm is not None else None

    return {
        "predio_number": predio_number,
        "building_type": building_type,
        "work_type": work_type,
        "activities": selected_activities,
        "blueprint": blueprint_result,
        "irm": irm_result,
        "status": "extraction_only",
        "measurements_available": False,
        "compliance_checked": False,
        "report_available": False,
        "warnings": [
            "Scale and dimensions have not been verified",
            "Professional review may be required regardless of IRM upload",
        ],
    }
# OPTIONAL DOCUMENT ANALYSIS V2 — END


# IRM-only extraction for the new-construction workflow.
# Uploaded PDF is processed in memory, never stored on the server.
@app.post("/api/irm/extract")
async def extract_irm(file: UploadFile = File(...)):
    content = await file.read(MAX_UPLOAD + 1)
    if len(content) > MAX_UPLOAD:
        raise HTTPException(status_code=413, detail="IRM exceeds 15 MB")
    try:
        result = analyze_document(content, file.filename or "", "irm")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "filename": result["filename"],
        "candidate_irm_fields": result.get("candidate_irm_fields", {}),
        "warnings": result.get("warnings", []),
        "pages": len(result.get("pages", [])),
        "stored": False,
        "verified": False,
        "regulatory_eligibility": "pending_review",
    }
