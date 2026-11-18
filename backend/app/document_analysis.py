"""PredioAI document extraction prototype.

Extract evidence from IRM PDFs and architectural PDF/DXF/DWG drawings.
DWG conversion runs locally through a bounded, server-installed converter.
NO zoning compliance verdict, legal authorization, or scale inference.
Optional dependency for DXF: pip install ezdxf.
"""
from __future__ import annotations

from collections import Counter
from io import StringIO
import re
from threading import BoundedSemaphore

from .dwg_conversion import convert_dwg_to_dxf
from .drawing_geometry import CadImportBudget, CadImportLimitError
from .location_analysis import cad_location, native_geometry_extents, text_location

MAX_BYTES = 15 * 1024 * 1024
MAX_PAGES = 100
MAX_ENTITIES = 100_000
MAX_TEXT = 25_000
MAX_CAD_LAYOUTS = 100

# One complete CAD conversion/parse/geometry import per worker process keeps
# the native converter from overlapping an already expanded ezdxf document.
_CAD_IMPORT_SLOT = BoundedSemaphore(1)


class CadImportBusyError(ValueError):
    """The CAD importer is already handling another request."""

    def __init__(self):
        super().__init__(
            "Hay otro plano CAD en proceso. Espera un momento y vuelve a intentar."
        )

IRM_PATTERNS = {
    "predio": r"(?i)(?:n[uú]mero\s+de\s+predio|predio\s*(?:n[°ºo.]*)?)\s*[:#-]?\s*(\d{3,15})",
    "area_terreno": r"(?i)(?:[aá]rea\s+(?:del\s+)?terreno|superficie\s+(?:del\s+)?terreno)\s*[:=]?\s*(\d{1,7}(?:[.,]\d{1,2})?)\s*m(?:²|2|\b)",
    "lote_minimo": r"(?i)\b(?:lote|[aá]rea\s+de\s+lote)\s*m[ií]nimo\s*[:=]?\s*(\d{1,7}(?:[.,]\d{1,2})?)\s*m(?:²|2)?",
    "frente_minimo": r"(?i)\bfrente\s*m[ií]nimo\s*[:=]?\s*(\d{1,5}(?:[.,]\d{1,2})?)\s*m(?:etros)?\b",
    "vivienda_tipo": r"(?i)\b(?:tipo\s+de\s+vivienda|n[uú]mero\s+de\s+viviendas)\s*[:=]?\s*(VU|VB|VM)\b",
    "cos_pb": r"(?i)\bCOS\s*(?:PB|planta\s+baja)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*%",
    "cos_total": r"(?i)\bCOS\s*total\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*%",
    "altura": r"(?i)\baltura\s*(?:m[aá]xima|edificaci[oó]n)?\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(?:m|metros)\b",
    "pisos": r"(?i)(?:n[uú]mero\s+de\s+pisos|pisos\s+permitidos)\s*[:=]?\s*(\d+)",
    "retiro_frontal": r"(?i)retiro\s+frontal\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*m\b",
    "retiro_lateral": r"(?i)retiro\s+lateral\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*m\b",
    "retiro_posterior": r"(?i)retiro\s+posterior\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*m\b",
}


def _irm_evidence(fragments: list[str]) -> tuple[dict, dict]:
    """Keep page provenance and withhold competing parameter sets.

    Extracted values remain candidates. Neither a first PDF match nor the
    largest buildability value establishes which assignment applies to a lot.
    """
    candidates = {}
    flags = []
    regime = "unknown"
    for field, pattern in IRM_PATTERNS.items():
        matches = []
        for page, fragment in enumerate(fragments, 1):
            for match in re.finditer(pattern, fragment):
                raw = match.group(1)
                matches.append({"raw": raw, "page": page,
                    "evidence": match.group(0)[:180], "status": "unverified_extraction"})
        distinct = {}
        for match in matches:
            raw = match["raw"].replace(",", ".")
            try:
                key = float(raw) if field != "predio" else raw.lstrip("0") or "0"
            except ValueError:
                key = raw.upper()
            distinct.setdefault(key, match)
        if len(distinct) == 1:
            candidates[field] = next(iter(distinct.values()))
        elif len(distinct) > 1 and field not in {"predio", "vivienda_tipo"}:
            first = matches[0]
            flags.append({"kind": "multiple_parameter_sets", "field": field,
                "page": first["page"], "evidence": first["evidence"],
                "values": [match["raw"] for match in list(distinct.values())[:8]]})
    for page, fragment in enumerate(fragments, 1):
        ph = re.search(r"\bPROPIEDAD\s+HORIZONTAL\b", fragment, re.IGNORECASE)
        individual = re.search(r"\b(?:UNIPROPIEDAD|PROPIEDAD\s+INDIVIDUAL)\b", fragment, re.IGNORECASE)
        if ph:
            regime = "horizontal"
            flags.append({"kind": "horizontal_property", "page": page, "evidence": ph.group(0)})
        elif individual and regime == "unknown":
            regime = "individual"
        # Explicit positive statements only: generic notes saying that risks
        # must be reviewed do not establish an actual property restriction.
        special = re.search(
            r"\b(?:AFECTACI[OÓ]N(?:ES)?\s*(?:POR\s+V[IÍ]AS)?\s*[:=]\s*S[IÍ]\b|"
            r"QUEBRADA\s+ABIERTA|PROTECCI[OÓ]N\s+ECOL[OÓ]GICA\s*\(\s*PE\s*\)|"
            r"AFECTADO\s+POR\s+(?:FALLA|QUEBRADA|V[IÍ]A)|"
            r"PROHIBID[AO]\s+(?:EDIFICAR|CONSTRUIR))", fragment, re.IGNORECASE,
        )
        if special:
            flags.append({"kind": "special_restrictions", "page": page, "evidence": special.group(0)[:180]})
    return candidates, {"property_regime": regime, "flags": flags[:32], "review_required": True}


def _validate(data: bytes, filename: str, allowed: set[str]) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in allowed:
        raise ValueError(f"Unsupported format: .{ext or '?'}")
    if not data or len(data) > MAX_BYTES:
        raise ValueError("File is empty or exceeds 15 MB")
    if ext == "pdf" and not data.startswith(b"%PDF-"):
        raise ValueError("Invalid PDF signature")
    return ext


def _pdf(data: bytes, role: str) -> dict:
    import fitz
    from .drawing_geometry import pdf_primitives, drawing_view

    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as exc:
        raise ValueError("Cannot parse PDF") from exc
    try:
        if not 1 <= len(doc) <= MAX_PAGES:
            raise ValueError("PDF page count outside supported range")
        pages = []
        fragments = []
        views = []
        for page in doc:
            text = page.get_text("text")
            fragments.append(text[:MAX_TEXT])
            if role == "blueprint":
                drawings = page.get_drawings()
                vector_path_count = len(drawings)
                view = drawing_view(pdf_primitives(page, drawings=drawings),
                    [0, 0, float(page.rect.width), float(page.rect.height)])
                del drawings
                view["page"] = page.number + 1
                views.append(view)
            pages.append({
                "page": page.number + 1,
                "width_pt": round(page.rect.width, 2),
                "height_pt": round(page.rect.height, 2),
                "text_characters": len(text),
                "vector_paths": vector_path_count if role == "blueprint" else len(page.get_drawings()),
                "embedded_images": len(page.get_images(full=True)),
                "needs_ocr": len(text.strip()) < 30,
            })
    finally:
        doc.close()
    combined = "\n".join(fragments)
    candidates = {}
    planning_evidence = None
    if role == "irm":
        candidates, planning_evidence = _irm_evidence(fragments)
    location = text_location(enumerate(fragments, 1), "irm" if role == "irm" else "pdf")
    location_predios = {item["value"] for item in location["candidates"] if item["kind"] == "predio"}
    if role == "irm" and "predio" not in candidates and len(location_predios) == 1:
        evidence = next(item for item in location["candidates"] if item["kind"] == "predio")
        candidates["predio"] = {"raw": next(iter(location_predios)), "status": "unverified_extraction",
                               "page": evidence.get("page"), "evidence": evidence.get("evidence", "")}
    return {
        "format": "pdf", "role": role, "pages": pages,
        "candidate_irm_fields": candidates,
        **({"planning_evidence": planning_evidence} if role == "irm" else {}),
        "location": location,
        "drawing_views": views if role == "blueprint" else [],
        "text_excerpt": combined[:3000] if role == "irm" else "",
        "warnings": (["Scanned pages may require OCR"]
                     if any(p["needs_ocr"] for p in pages) else []),
    }


def _dxf(data: bytes) -> dict:
    try:
        import ezdxf
        from .drawing_geometry import extract_dxf_primitives, drawing_view
    except ImportError as exc:
        raise ValueError("DXF support requires optional package ezdxf") from exc
    budget = CadImportBudget()
    try:
        # Match universal-newline file reading: a retained CR corrupts DXF
        # string values, including hexadecimal group-310 binary records.
        doc = ezdxf.read(StringIO(data.decode("utf-8-sig"), newline=None))
        budget.check_time()
        model = doc.modelspace()
        # A CAD presentation/layout is not necessarily a separate building floor.
        layouts = [model, *(layout for layout in doc.layouts if not layout.is_modelspace)]
        if len(layouts) > MAX_CAD_LAYOUTS:
            raise CadImportLimitError(
                f"El CAD supera {MAX_CAD_LAYOUTS} presentaciones. "
                "Divide el archivo; no se devolvió un conjunto de vistas recortado."
            )
        cad_layouts = []
        views = []
        model_extents = None
        model_text_fragments = []
        for layout in layouts:
            budget.check_time()
            displayed = layout.is_modelspace or bool(len(layout))
            scope = "modelspace" if layout.is_modelspace else "paperspace"
            page = len(views) + 1 if displayed else None
            cad_layouts.append({
                "name": layout.name, "entity_count": len(layout),
                "displayed": displayed, "page": page, "scope": scope,
                "viewport_contents_displayed": False,
            })
            if not displayed:
                continue
            primitives, extraction = extract_dxf_primitives(
                layout, budget=budget, scope=scope, page=page,
            )
            source_labels = extraction.pop("source_labels", [])
            if layout.is_modelspace:
                model_extents = native_geometry_extents(primitives)
                model_text_fragments = [(1, label.get("text", "")) for label in source_labels]
            extraction["import_limits"]["layouts"] = MAX_CAD_LAYOUTS
            views.append({
                **drawing_view(primitives, invert_y=True, source_labels=source_labels),
                "extraction": extraction, "page": page,
                "name": layout.name, "layout_name": layout.name,
                "label": "Modelo CAD" if layout.is_modelspace else f"Presentación: {layout.name}",
            })
        counts = Counter()
        layer_counts = Counter()
        annotations = []
        dimension_labels = []
        for index, entity in enumerate(model):
            budget.check_time()
            if index >= MAX_ENTITIES:
                raise CadImportLimitError("El CAD supera el límite de entidades de origen.")
            kind = entity.dxftype()
            counts[kind] += 1
            layer_counts[entity.dxf.get("layer", "0")] += 1
            if kind in {"TEXT", "MTEXT"} and len(annotations) < 150:
                value = entity.plain_text().strip()
                if value:
                    annotations.append(value[:300])
            if kind == "DIMENSION" and len(dimension_labels) < 100:
                dimension_labels.append({
                    "layer": entity.dxf.layer,
                    "text_override": entity.dxf.get("text", ""),
                    "measurement_unverified": True,
                })
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError("Cannot parse DXF") from exc
    return {
        "format": "dxf", "role": "blueprint",
        "units_code": doc.header.get("$INSUNITS", 0),
        "location": cad_location(doc, model_extents=model_extents, text_fragments=model_text_fragments),
        "cad_layouts": cad_layouts,
        "display_scope": "modelspace_and_paperspace" if len(views) > 1 else "modelspace_only",
        "floor_identification": "unverified",
        "entity_counts": dict(counts),
        "layer_counts": dict(layer_counts),
        "annotations": annotations,
        "drawing_views": views,
        "dimensions": dimension_labels,
        "import_summary": {
            "views": len(views), "rendered_primitives": budget.elements,
            "generated_vertices": budget.points, "visited_entity_instances": budget.visits,
            "text_characters": budget.text_characters,
            "serialized_element_bytes": budget.element_bytes,
            "budget_truncated": False,
        },
        "warnings": [
            "CAD units, drawing scale, layer meaning and dimensions require validation",
            "Source text and source dimension labels are unverified; no room is assigned from proximity alone",
            "Curves and text are display approximations; source fonts, lineweights, linetypes and colors are not reproduced",
            "Nonempty paper layouts are separate views; their modelspace viewports are not rendered",
            "Unsupported, clipped, external-reference or nonplanar contents are reported per view",
            "No floor area, setback or regulatory compliance is inferred",
        ],
    }


def analyze_document(data: bytes, filename: str, role: str) -> dict:
    """Return bounded, evidence-first metadata for an IRM or blueprint."""
    if role not in {"irm", "blueprint"}:
        raise ValueError("role must be irm or blueprint")
    ext = _validate(data, filename, {"pdf"} if role == "irm"
                    else {"pdf", "dxf", "dwg"})
    if ext in {"dwg", "dxf"}:
        if not _CAD_IMPORT_SLOT.acquire(blocking=False):
            raise CadImportBusyError()
        try:
            if ext == "dwg":
                converted = convert_dwg_to_dxf(data)
                try:
                    result = _dxf(converted.dxf_bytes)
                except CadImportLimitError:
                    raise
                except ValueError as exc:
                    raise ValueError(
                        "No se pudo interpretar la conversión del DWG. "
                        "Revisa el archivo original o prueba una exportación PDF/DXF."
                    ) from exc
                result.update(format="dwg", converted_format="dxf", conversion=converted.metadata)
                result["warnings"] = [*converted.metadata.get("warnings", []), *result["warnings"]]
            else:
                result = _dxf(data)
        finally:
            _CAD_IMPORT_SLOT.release()
    else:
        result = _pdf(data, role)
    result["filename"] = filename.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    result["compliance_checked"] = False
    result["official_approval"] = False
    return result


def analyze_pair(irm_data: bytes, blueprint_data: bytes,
                 blueprint_filename: str = "blueprint.pdf") -> dict:
    """Inspect both sources; do not claim to determine legal compliance."""
    return {
        "irm": analyze_document(irm_data, "irm.pdf", "irm"),
        "blueprint": analyze_document(blueprint_data, blueprint_filename, "blueprint"),
        "comparison_status": "extraction_only",
        "next_steps": [
            "Validate IRM fields and source document date",
            "Establish drawing units and actual scale",
            "Identify existing versus proposed construction",
            "Review Quito regulations with a qualified professional",
        ],
    }
