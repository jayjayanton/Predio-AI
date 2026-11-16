"""PredioAI document extraction prototype.

Extract evidence from IRM PDFs and architectural PDF/DXF drawings.
NO zoning compliance verdict, legal authorization, scale inference, or DWG conversion.
Optional dependency for DXF: pip install ezdxf.
"""
from __future__ import annotations

from collections import Counter
from io import StringIO
import re

MAX_BYTES = 15 * 1024 * 1024
MAX_PAGES = 100
MAX_ENTITIES = 100_000
MAX_TEXT = 25_000

IRM_PATTERNS = {
    "predio": r"(?i)(?:n[uú]mero\s+de\s+predio|predio\s*(?:n[°ºo.]*)?)\s*[:#-]?\s*(\d{3,15})",
    "area_terreno": r"(?i)(?:[aá]rea\s+(?:del\s+)?terreno|superficie\s+(?:del\s+)?terreno)\s*[:=]?\s*(\d{1,7}(?:[.,]\d{1,2})?)\s*m(?:²|2|\b)",
    "lote_minimo": r"(?i)\b(?:lote|área\s+de\s+lote)\s*m[ií]nimo\s*[:=]?\s*(\d{1,7}(?:[.,]\d{1,2})?)\s*m(?:²|2|\\b)",
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


def _validate(data: bytes, filename: str, allowed: set[str]) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in allowed:
        raise ValueError(f"Unsupported format: .{ext or '?'}")
    if not data or len(data) > MAX_BYTES:
        raise ValueError("File is empty or exceeds 15 MB")
    if ext == "pdf" and not data.startswith(b"%PDF-"):
        raise ValueError("Invalid PDF signature")
    if ext == "dwg":
        raise ValueError("DWG requires authorized conversion to DXF; no automatic conversion")
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
                view = drawing_view(pdf_primitives(page),
                    [0, 0, float(page.rect.width), float(page.rect.height)])
                view["page"] = page.number + 1
                views.append(view)
            pages.append({
                "page": page.number + 1,
                "width_pt": round(page.rect.width, 2),
                "height_pt": round(page.rect.height, 2),
                "text_characters": len(text),
                "vector_paths": len(page.get_drawings()),
                "embedded_images": len(page.get_images(full=True)),
                "needs_ocr": len(text.strip()) < 30,
            })
    finally:
        doc.close()
    combined = "\n".join(fragments)
    candidates = {}
    if role == "irm":
        for field, pattern in IRM_PATTERNS.items():
            match = re.search(pattern, combined)
            if match:
                candidates[field] = {
                    "raw": match.group(1),
                    "status": "unverified_extraction",
                }
    return {
        "format": "pdf", "role": role, "pages": pages,
        "candidate_irm_fields": candidates,
        "drawing_views": views if role == "blueprint" else [],
        "text_excerpt": combined[:3000] if role == "irm" else "",
        "warnings": (["Scanned pages may require OCR"]
                     if any(p["needs_ocr"] for p in pages) else []),
    }


def _dxf(data: bytes) -> dict:
    try:
        import ezdxf
        from .drawing_geometry import dxf_primitives, drawing_view
    except ImportError as exc:
        raise ValueError("DXF support requires optional package ezdxf") from exc
    try:
        doc = ezdxf.read(StringIO(data.decode('utf-8-sig')))
        model = doc.modelspace()
        view = drawing_view(dxf_primitives(model), invert_y=True)
        counts = Counter()
        layer_counts = Counter()
        annotations = []
        dimension_labels = []
        for index, entity in enumerate(model):
            if index >= MAX_ENTITIES:
                raise ValueError("DXF entity limit exceeded")
            kind = entity.dxftype()
            counts[kind] += 1
            layer_counts[entity.dxf.layer] += 1
            if kind in {"TEXT", "MTEXT"} and len(annotations) < 150:
                value = (entity.dxf.text if kind == "TEXT"
                         else entity.text).strip()
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
        "entity_counts": dict(counts),
        "layer_counts": dict(layer_counts),
        "annotations": annotations,
        "drawing_views": [{**view, "page": 1}],
        "dimensions": dimension_labels,
        "warnings": [
            "CAD units, drawing scale, layer meaning and dimensions require validation",
            "No floor area, setback or regulatory compliance is inferred",
        ],
    }


def analyze_document(data: bytes, filename: str, role: str) -> dict:
    """Return bounded, evidence-first metadata for an IRM or blueprint."""
    if role not in {"irm", "blueprint"}:
        raise ValueError("role must be irm or blueprint")
    ext = _validate(data, filename, {"pdf"} if role == "irm"
                    else {"pdf", "dxf", "dwg"})
    result = _pdf(data, role) if ext == "pdf" else _dxf(data)
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
