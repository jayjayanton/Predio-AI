
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
from fastapi.middleware.gzip import GZipMiddleware
from starlette.concurrency import run_in_threadpool

from .dwg_conversion import DwgConversionError, converter_available

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
app.add_middleware(GZipMiddleware, minimum_size=1000, compresslevel=5)


# ============================================================
# 2. HEALTH CHECK
# ============================================================

@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "application": "PredioAI",
        "version": "0.2.0",
        "dwg_conversion_available": converter_available(),
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
from .document_analysis import analyze_document, CadImportBusyError
from .project_package import analyze_project_package, MAX_PACKAGE_BYTES
from .work_activities import requires_irm, validate_activities
from .location_analysis import transform_coordinates
from .footprint_analysis import PlanningRequest, PlanningBusyError, assess_planning, MAX_REQUEST_BYTES
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from fastapi import Request
from pyproj.exceptions import ProjError
from shapely.errors import GEOSException
import math
import json


class CoordinateTransformRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    x: float = Field(ge=-1_000_000_000, le=1_000_000_000, allow_inf_nan=False, strict=True)
    y: float = Field(ge=-1_000_000_000, le=1_000_000_000, allow_inf_nan=False, strict=True)
    source_crs: str = Field(min_length=4, max_length=24)

    @field_validator("x", "y", mode="before")
    @classmethod
    def reject_nonfinite_json(cls, value):
        # Some JSON parsers accept NaN/Infinity. Normalize them to a rejected
        # JSON-safe value so FastAPI can serialize the 422 validation error.
        if isinstance(value, float) and not math.isfinite(value):
            return None
        return value


@app.post("/api/coordinates/transform")
async def convert_reference_coordinates(request: CoordinateTransformRequest):
    """Convert an explicitly referenced point; never register a drawing or parcel."""
    try:
        return await run_in_threadpool(transform_coordinates, request.x, request.y, request.source_crs)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/planning/assess")
async def assess_ground_footprint(request: Request):
    """Compare a bounded user-positioned footprint; never authorize construction."""
    content = bytearray()
    async for chunk in request.stream():
        content.extend(chunk)
        if len(content) > MAX_REQUEST_BYTES:
            raise HTTPException(status_code=413, detail="El estudio supera 1 MB; reduce los contornos o las figuras.")
    try:
        def reject_nonfinite(value):
            raise ValueError("El estudio contiene un número no finito.")
        payload = json.loads(content, parse_constant=reject_nonfinite)
        study = PlanningRequest.model_validate(payload)
        return await run_in_threadpool(assess_planning, study)
    except PlanningBusyError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValidationError as exc:
        # Never echo source geometry or non-JSON-safe error inputs.
        raise HTTPException(status_code=422, detail={"message": "Revisa los datos del estudio.",
            "errors": exc.errors(include_input=False, include_context=False)}) from exc
    except (ValueError, TypeError, RecursionError) as exc:
        raise HTTPException(status_code=422, detail=str(exc) or "El estudio no contiene geometría válida.") from exc
    except (ProjError, GEOSException) as exc:
        raise HTTPException(status_code=422, detail="No se pudo comparar esta geometría; revisa los contornos, sus unidades y la implantación.") from exc


@app.post("/api/documents/analyze")
async def analyze_project_documents(
    blueprint: UploadFile = File(...),
    irm: UploadFile | None = File(default=None),
    building_type: Literal["house", "apartment"] = Form(...),
    work_type: Literal["repair", "maintenance", "remodel", "structural", "expansion"] = Form(...),
    predio_number: str | None = Form(default=None),
    activities: list[str] = Form(...),
    package_entry: str | None = Form(default=None),
    review_scope: Literal["document_review", "drawing_study"] = Form(default="document_review"),
):
    """Inspect one drawing or selected ZIP member and a conditionally required IRM PDF.

    This does not calculate dimensions, check regulatory compliance,
    or certify that an intervention is permitted.
    """
    try:
        selected_activities = validate_activities(work_type, activities)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if review_scope == "document_review" and requires_irm(work_type, activities) and irm is None:
        raise HTTPException(status_code=422, detail="IRM required for the selected remodeling, structural, or expansion activities")
    if predio_number and (not predio_number.isdigit() or len(predio_number) > 25):
        raise HTTPException(status_code=422, detail="Invalid predio number")

    async def parse_upload(upload: UploadFile, role: str):
        filename = upload.filename or ""
        is_package = role == "blueprint" and filename.lower().endswith(".zip")
        limit = MAX_PACKAGE_BYTES if is_package else MAX_UPLOAD
        content = await upload.read(limit + 1)
        if len(content) > limit:
            raise HTTPException(status_code=413, detail="El ZIP supera el límite de 30 MB." if is_package else f"{role} exceeds 15 MB")
        try:
            if is_package:
                return await run_in_threadpool(analyze_project_package, content, filename, package_entry)
            if role == "blueprint" and package_entry is not None:
                raise ValueError("La selección de un archivo del paquete requiere un ZIP.")
            return await run_in_threadpool(analyze_document, content, filename, role)
        except DwgConversionError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
        except CadImportBusyError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    blueprint_result = await parse_upload(blueprint, "blueprint")
    irm_result = await parse_upload(irm, "irm") if irm is not None else None

    return {
        "predio_number": predio_number,
        "building_type": building_type,
        "work_type": work_type,
        "activities": selected_activities,
        "review_scope": review_scope,
        "irm_required_for_regulatory_review": requires_irm(work_type, activities),
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
        "planning_evidence": result.get("planning_evidence", {}),
        "location": result.get("location"),
        "warnings": result.get("warnings", []),
        "pages": len(result.get("pages", [])),
        "stored": False,
        "verified": False,
        "regulatory_eligibility": "pending_review",
    }


# PUGS 2024: evidence-only spatial intersection (not a permit decision).
from .pugs import lookup_pugs

@app.get("/api/pugs/{identifier_type}/{identifier}")
async def pugs_for_predio(identifier_type: str, identifier: str):
    try:
        return await lookup_pugs(identifier, identifier_type)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except MunicipalError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


# Exploratory PUGS screening: bounded batch, not a citywide zoning count.
import asyncio

# Geographic batch PUGS analysis. GeoJSON cadastral polygons come from the
# first-stage ArcGIS query; this endpoint does not refetch each predio.
from .pugs_batch import spatial_screen

class PugsSpatialRequest(BaseModel):
    features: list[dict] = Field(min_length=1, max_length=100)

@app.post("/api/pugs/spatial-screen")
async def screen_pugs_spatial(request: PugsSpatialRequest):
    """Spatially join supplied cadastral polygons with reusable PUGS tiles.

    No VU/VB/VM legal certification. Partial upstream failures are reported
    as unavailable rather than as false no-intersection classifications.
    """
    try:
        return await spatial_screen(request.features)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

class PugsScreenRequest(BaseModel):
    predios: list[str] = Field(min_length=1, max_length=20)

@app.post("/api/pugs/screen")
async def screen_pugs(request: PugsScreenRequest):
    """Screen up to 20 explicitly supplied cadastral predios against PUGS.
    Results are per-parcel evidence; callers must not infer a DMQ-wide count.
    """
    sem = asyncio.Semaphore(4)
    async def inspect(predio):
        if not predio.isdigit() or len(predio) > 25:
            return {"predio": predio, "status": "invalid", "zones": []}
        async with sem:
            try:
                data = await lookup_pugs(predio, "n_predio")
                return {"predio": predio, "status": data.get("status"), "zones": data.get("zones", []),
                        "source": data.get("source"), "scope_warning": data.get("scope_warning")}
            except (MunicipalError, ValueError) as exc:
                return {"predio": predio, "status": "unavailable", "zones": [], "error": str(exc)}
    unique = list(dict.fromkeys(request.predios))
    return {"results": await asyncio.gather(*(inspect(p) for p in unique)),
            "screened": len(unique), "scope": "supplied_predios_only",
            "regulatory_approval": False}
