"""Source-aware geographic references; never infer a CRS from CAD magnitudes.

Coordinates remain unverified documentary evidence. A reference point does not
register the drawing, establish parcel identity, or certify a survey.
"""
from __future__ import annotations

from functools import lru_cache
import math
import re
import warnings
from xml.etree import ElementTree

from pyproj import CRS, network
from pyproj.exceptions import CRSError, ProjError
from pyproj.transformer import TransformerGroup


# Pinned municipal definition, consulted 2026-11-18. No runtime remote lookup.
# https://geoquito.quito.gob.ec/server/rest/services/web_reference_dmot/
# division_politica_administrativa/MapServer?f=pjson  (spatialReference.wkt)
# Equivalent published authority identifier: ESRI:103985, NOT EPSG:32717.
SIRES_DMQ_WKT = (
    'PROJCS["SIRES-DMQ",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",'
    'SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],'
    'UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],'
    'PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",10000000.0],'
    'PARAMETER["Central_Meridian",-78.5],PARAMETER["Scale_Factor",1.0004584],'
    'PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]'
)
SIRES_SOURCE_URL = (
    "https://geoquito.quito.gob.ec/server/rest/services/web_reference_dmot/"
    "division_politica_administrativa/MapServer?f=pjson"
)
SIRES_BOUNDS = (-79.0, -0.6, -78.15, 0.27)  # ESRI:103985 area of use.
MAX_CANDIDATES = 40
MAX_POINT_PAIRS = 20
MAX_CRS_XML = 65_536
MAX_COORDINATE = 1_000_000_000
REFERENCE_NOTE = (
    "La conversión ubica un punto de referencia. No georreferencia la geometría "
    "del plano ni confirma que corresponda al predio o al IRM."
)

NUMBER = r"[-+]?\d{1,12}(?:[.,]\d{1,10})?(?![\d.,])"
XY_PAIR = re.compile(
    rf"\b(?:X|Este|Easting)\s*[:=]\s*({NUMBER})"
    rf"(?P<gap>[^\d]{{0,100}}?)\b(?:Y|Norte|Northing)\s*[:=]\s*({NUMBER})",
    re.IGNORECASE,
)
LAT_LON_PAIR = re.compile(
    rf"\bLatitud(?:e)?\s*[:=]\s*({NUMBER})"
    rf"(?P<gap>[^\d]{{0,100}}?)\bLongitud(?:e)?\s*[:=]\s*({NUMBER})",
    re.IGNORECASE,
)
LON_LAT_PAIR = re.compile(
    rf"\bLongitud(?:e)?\s*[:=]\s*({NUMBER})"
    rf"(?P<gap>[^\d]{{0,100}}?)\bLatitud(?:e)?\s*[:=]\s*({NUMBER})",
    re.IGNORECASE,
)
EPSG_LABEL = re.compile(r"\bEPSG\s*[:=]?\s*(\d{3,6})\b", re.IGNORECASE)
SIRES_LABEL = re.compile(r"\bSIRES\s*[-–—_]?\s*(?:DMQ|MDQ)\b", re.IGNORECASE)
WGS84_LABEL = re.compile(r"\bWGS\s*[-_]?\s*84\b", re.IGNORECASE)
IDENTIFIERS = (
    ("predio", re.compile(
        r"\b(?:n[uú]mero\s+de\s+predio|n[°ºo.]?\s*(?:de\s+)?predio|"
        r"predio(?:\s+n[°ºo.]*)?)\s*[:#=\-]?\s*(\d{3,25})(?!\d)", re.IGNORECASE)),
    ("cadastral_key", re.compile(
        r"\b(?:clave\s+catastral|c[oó]digo\s+catastral|referencia\s+catastral|"
        r"geoclave)\s*[:#=\-]?\s*([A-Z0-9][A-Z0-9.\-]{4,39})\b", re.IGNORECASE)),
)


def empty_location(source: str, status: str = "not_found") -> dict:
    return {
        "status": status, "source": source, "crs": None, "point": None,
        "geographic": None, "extents": None, "candidates": [],
        "warnings": [], "verified": False,
    }


def _finite(value, limit: float = MAX_COORDINATE) -> float:
    if isinstance(value, bool):
        raise ValueError("Introduce coordenadas numéricas finitas.")
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError("Introduce coordenadas numéricas finitas.") from exc
    if not math.isfinite(number) or abs(number) > limit:
        raise ValueError("Las coordenadas no son finitas o superan el rango admitido.")
    return number


def _inside(longitude: float, latitude: float, bounds) -> bool:
    west, south, east, north = bounds
    tolerance = 1e-8
    longitude_inside = (west - tolerance <= longitude <= east + tolerance
                        if west <= east else longitude >= west - tolerance or longitude <= east + tolerance)
    return longitude_inside and south - tolerance <= latitude <= north + tolerance


@lru_cache(maxsize=32)
def _source_crs(identifier: str):
    if not isinstance(identifier, str) or len(identifier) > 24:
        raise ValueError("Indica un código EPSG válido o SIRES-DMQ.")
    normalized = identifier.strip().upper()
    if normalized in {"SIRES-DMQ", "ESRI:103985"}:
        return CRS.from_wkt(SIRES_DMQ_WKT), "ESRI:103985", "SIRES-DMQ (Quito)", SIRES_BOUNDS
    if not re.fullmatch(r"EPSG:\d{3,6}", normalized):
        raise ValueError("Indica un código EPSG válido o SIRES-DMQ; no se aceptan definiciones arbitrarias.")
    try:
        crs = CRS.from_user_input(normalized)
    except (CRSError, ProjError) as exc:
        raise ValueError("No se reconoce ese código EPSG.") from exc
    if (not (crs.is_projected or crs.is_geographic) or crs.is_compound or
            len(crs.axis_info) != 2):
        raise ValueError("Se requiere un CRS horizontal de dos dimensiones.")
    if crs.is_geographic and any(axis.unit_name.lower() != "degree" for axis in crs.axis_info):
        raise ValueError("Las coordenadas geográficas deben usar un CRS expresado en grados.")
    return crs, normalized, crs.name, crs.area_of_use.bounds if crs.area_of_use else None


def _transformer_group(identifier: str):
    # Offline only. Never download grid files or enable network from uploaded data.
    # TransformerGroup's transformers are not thread-safe. Keep them local to
    # this conversion instead of sharing a cached group across API worker threads.
    network.set_network_enabled(False)
    crs, _, _, _ = _source_crs(identifier)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        group = TransformerGroup(crs, "EPSG:4326", always_xy=True, allow_ballpark=False)
    if not group.best_available or not group.transformers:
        raise ValueError("No está disponible localmente la transformación requerida para ese CRS; revisa el datum y las rejillas necesarias.")
    return group


def transform_coordinates(x, y, source_crs: str, *,
                          provenance: str = "user_supplied_crs",
                          point_role: str = "reference_point") -> dict:
    """Convert one explicit CRS point to WGS84 without guessing or ballpark fallbacks."""
    x, y = _finite(x), _finite(y)
    crs, identifier, name, area = _source_crs(source_crs)
    if crs.is_geographic and not (-180 <= x <= 180 and -90 <= y <= 90):
        raise ValueError("Para un CRS geográfico, X es longitud (−180 a 180) e Y es latitud (−90 a 90).")
    try:
        group = _transformer_group(identifier)
        result = None
        for transformer in group.transformers[:16]:
            longitude, latitude = transformer.transform(x, y, errcheck=True)
            if not (math.isfinite(longitude) and math.isfinite(latitude) and
                    -180 <= longitude <= 180 and -90 <= latitude <= 90):
                continue
            if area and not _inside(longitude, latitude, area):
                continue
            operation_area = transformer.area_of_use
            if operation_area and not _inside(longitude, latitude, operation_area.bounds):
                continue
            result = longitude, latitude
            break
        if result is None:
            raise ValueError("El punto queda fuera del área de uso del CRS o no admite una conversión válida. Revisa el sistema, las unidades y el orden X/Y.")
    except (CRSError, ProjError, OverflowError) as exc:
        raise ValueError("No se pudo convertir el punto con ese CRS. Revisa coordenadas, unidades y datum.") from exc
    longitude, latitude = result
    source = "user_supplied" if provenance == "user_supplied_crs" else provenance
    return {
        "crs": {"id": identifier, "name": name, "source": source},
        "point": {"x": x, "y": y},
        "geographic": {
            "latitude": latitude, "longitude": longitude, "crs": "EPSG:4326",
            "point_role": point_role, "provenance": provenance,
        },
        "verified": False, "warnings": [REFERENCE_NOTE],
        **({"crs_definition_source": SIRES_SOURCE_URL} if identifier == "ESRI:103985" else {}),
    }


def _number(text: str) -> float:
    return _finite(text.replace(",", "."))


def _nearby_crs(text: str, start: int, end: int, geographic: bool):
    # Metadata has to share the same page and a short coordinate section.
    before = re.split(r"\r?\n[ \t]*\r?\n", text[max(0, start - 180):start])[-1]
    after = re.split(r"\r?\n[ \t]*\r?\n", text[end:min(len(text), end + 100)])[0]
    # After the pair, accept only an immediately labeled CRS, not metadata
    # belonging to a subsequent property/survey section.
    if not re.match(r"^[\s,;/|]*(?:EPSG\b|SIRES\b|WGS\b)", after, re.IGNORECASE):
        after = ""
    nearby = before + text[start:end] + after
    if re.search(r"\b(?:sin\s+(?:referencia|georreferenciaci[oó]n)|CRS\s+desconocido)\b", nearby, re.IGNORECASE):
        return None
    identifiers = {f"EPSG:{m.group(1)}" for m in EPSG_LABEL.finditer(nearby)}
    if SIRES_LABEL.search(nearby):
        identifiers.add("ESRI:103985")
    if geographic and WGS84_LABEL.search(nearby):
        identifiers.add("EPSG:4326")
    return next(iter(identifiers)) if len(identifiers) == 1 else None


def text_location(fragments, source: str = "irm") -> dict:
    """Extract labeled evidence from (page, text) fragments, never filenames.

    Multiple distinct coordinate pairs remain unresolved. A page boundary is
    never crossed and individual CAD text entities are supplied separately.
    """
    result = empty_location(source)
    pairs = []
    unsupported_pair = False
    seen_candidates = set()

    def candidate(kind, value, page, evidence):
        key = (kind, value, page)
        if len(result["candidates"]) < MAX_CANDIDATES and key not in seen_candidates:
            seen_candidates.add(key)
            result["candidates"].append({
                "kind": kind, "value": str(value), "page": page,
                "source": "cad_text" if source == "cad" else "pdf_text",
                "evidence": evidence[:180], "status": "unverified_extraction",
            })

    for page, fragment in fragments:
        text = str(fragment)[:25_000]
        for kind, pattern in IDENTIFIERS:
            for match in pattern.finditer(text):
                candidate(kind, match.group(1), page, match.group(0))
        # This municipal layout places owner fields before the property number.
        # Keep the search bounded and require the adjacent property-status label;
        # return only the number evidence, never the intervening personal fields.
        for match in re.finditer(
            r"\bDATOS\s+DEL\s+PREDIO[\s\S]{0,600}?\b"
            r"(N[uú]mero\s*:\s*(\d{3,25})(?!\d))"
            r"(?=\s*Estado\s+(?:del\s+)?predio\s*:)", text, re.IGNORECASE,
        ):
            candidate("predio", match.group(2), page, match.group(1))
        for match in EPSG_LABEL.finditer(text):
            candidate("crs_label", f"EPSG:{match.group(1)}", page, match.group(0))
        for match in SIRES_LABEL.finditer(text):
            candidate("crs_label", "SIRES-DMQ", page, match.group(0))
        if re.search(r"\bSIRES\b", text, re.IGNORECASE) and not SIRES_LABEL.search(text):
            candidate("crs_label", "SIRES (definición por confirmar)", page, "SIRES")
        for pattern, kind in ((XY_PAIR, "xy"), (LAT_LON_PAIR, "lat_lon"), (LON_LAT_PAIR, "lon_lat")):
            for match in pattern.finditer(text):
                if len(pairs) >= MAX_POINT_PAIRS:
                    break
                tail = text[match.end():match.end() + 40]
                trailing_word = re.match(r"[^\S\r\n]*(?:[°º][^\S\r\n]*)?([A-Za-zÁÉÍÓÚáéíóú]+)", tail)
                if (not re.fullmatch(r"[\s/,;|°º]*", match.group("gap")) or
                    re.match(r"[^\S\r\n]*(?:[°º][^\S\r\n]*\d|['\"′″])", tail) or
                    (trailing_word and trailing_word.group(1).upper() not in {"EPSG", "WGS"})):
                    # Hemisphere suffixes, sexagesimal notation and unit suffixes
                    # need a dedicated parser. Never silently drop S/W or minutes.
                    unsupported_pair = True
                    continue
                try:
                    first, second = _number(match.group(1)), _number(match.group(3))
                except ValueError:
                    continue
                x, y = (second, first) if kind == "lat_lon" else (first, second)
                if kind != "xy" and not (-180 <= x <= 180 and -90 <= y <= 90):
                    continue
                crs = _nearby_crs(text, match.start(), match.end(), kind != "xy")
                pairs.append({"x": x, "y": y, "crs": crs, "page": page, "kind": kind})
                candidate("coordinate_pair", f"X: {x}; Y: {y}", page, match.group(0))
    unique = {(p["x"], p["y"], p["crs"], p["kind"]): p for p in pairs}
    if len(unique) > 1 or len(pairs) >= MAX_POINT_PAIRS:
        result["status"] = "needs_crs"
        result["warnings"].append("Hay varias referencias de coordenadas. Elige y confirma el punto que corresponde al documento antes de convertirlo.")
        return result
    if not unique:
        if unsupported_pair:
            result["status"] = "unsupported"
            result["warnings"].append("El formato de coordenadas contiene hemisferios, unidades o notación no compatibles. Confirma los valores en grados decimales con signo o X/Y y su CRS.")
            return result
        result["warnings"].append("No se identificó un par de coordenadas geográficas con contexto suficiente en el texto disponible.")
        return result
    pair = next(iter(unique.values()))
    result["point"] = {"x": pair["x"], "y": pair["y"]}
    result["point_page"] = pair["page"]
    result["status"] = "needs_crs"
    if not pair["crs"]:
        result["warnings"].append("Se extrajeron coordenadas, pero falta confirmar su sistema de referencia y datum. No se deducen por su magnitud.")
        return result
    try:
        converted = transform_coordinates(pair["x"], pair["y"], pair["crs"],
            provenance="cad_text" if source == "cad" else "pdf_text_sires_dmq" if pair["crs"] == "ESRI:103985" else "pdf_text",
            point_role="document_reference_point")
    except ValueError as exc:
        result["warnings"].append(str(exc))
        return result
    result.update(converted, status="geographic_available")
    result["geographic"]["page"] = pair["page"]
    result["warnings"].insert(0, "Coordenadas extraídas del texto, sin verificar. Contrasta los valores y el predio con el documento original.")
    return result


def native_geometry_extents(primitives) -> dict | None:
    """Bounded existing primitives only, before viewer Y inversion; no expansion."""
    minimum = [math.inf, math.inf]
    maximum = [-math.inf, -math.inf]
    for item in primitives:
        groups = [item.get("points", [])]
        groups.extend(item.get("rings", []))
        if item.get("position"):
            groups.append([item["position"]])
        for points in groups:
            for point in points:
                for axis in (0, 1):
                    value = float(point[axis])
                    if math.isfinite(value):
                        minimum[axis] = min(minimum[axis], value)
                        maximum[axis] = max(maximum[axis], value)
    if not all(math.isfinite(value) for value in minimum + maximum):
        return None
    return {"min": minimum, "max": maximum, "source": "extracted_modelspace_geometry"}


def _cad_extents(doc, fallback):
    try:
        low = [_finite(v, 1e12) for v in doc.header.get("$EXTMIN")]
        high = [_finite(v, 1e12) for v in doc.header.get("$EXTMAX")]
        valid = len(low) == 3 and len(high) == 3 and all(a <= b for a, b in zip(low, high))
        if valid and (low != high or fallback is None):
            return {"min": low, "max": high, "units_code": int(doc.units), "source": "header_cached"}
    except (TypeError, ValueError, OverflowError):
        pass
    return {**fallback, "units_code": int(doc.units)} if fallback else None


def _check_geodata_axes(definition: str):
    """The supported local-grid subset is explicitly East/North in metres."""
    root = ElementTree.fromstring(definition)
    local_name = lambda tag: tag.rsplit("}", 1)[-1]
    axis_nodes = [node for node in root.iter() if local_name(node.tag) == "Axis"]
    if len(axis_nodes) != 1 or axis_nodes[0].get("uom", "").lower() not in {"meter", "metre"}:
        raise ValueError("unsupported geodata axes")
    axes = []
    for node in axis_nodes[0]:
        if local_name(node.tag) == "CoordinateSystemAxis":
            axes.append({local_name(child.tag): (child.text or "").strip() for child in node})
    if len(axes) != 2:
        raise ValueError("unsupported geodata axes")
    by_order = {axis.get("AxisOrder"): axis for axis in axes}
    for order, abbreviation, direction in (("1", "E", "east"), ("2", "N", "north")):
        axis = by_order.get(order, {})
        if axis.get("AxisAbbreviation") != abbreviation or axis.get("AxisDirection", "").lower() != direction:
            raise ValueError("unsupported geodata axis orientation")


def cad_location(doc, *, model_extents=None, text_fragments=()) -> dict:
    """Read supported GEODATA anchors and explicit labels without guessing a CRS."""
    result = text_location(text_fragments, "cad")
    if result["status"] == "not_found":
        result["status"] = "unreferenced"
        result["warnings"] = []
    result["extents"] = _cad_extents(doc, model_extents)
    if result["extents"] and result["extents"]["source"] == "header_cached":
        result["warnings"].append("Las extensiones son las guardadas en la cabecera CAD; pueden estar desactualizadas y no identifican una ubicación geográfica.")
    legacy_lat = doc.header.get("$LATITUDE")
    legacy_lon = doc.header.get("$LONGITUDE")
    if legacy_lat is not None or legacy_lon is not None:
        result["warnings"].append("Se omitieron los ajustes LATITUDE/LONGITUDE de la cabecera: pueden ser valores predeterminados de CAD y no acreditan la ubicación del proyecto.")
    try:
        geodata = doc.modelspace().get_geodata()
    except Exception:
        geodata = None
        result["warnings"].append("No se pudo leer la referencia GEODATA del modelo CAD.")
    if geodata is None:
        if result["geographic"] is None:
            result["warnings"].append("No se encontró una georreferencia CAD compatible. Sus coordenadas locales no permiten deducir latitud y longitud.")
        return result
    try:
        definition = geodata.coordinate_system_definition
        if len(definition) > MAX_CRS_XML or re.search(r"<!\s*(?:DOCTYPE|ENTITY)", definition, re.IGNORECASE):
            raise ValueError("unsupported geodata definition")
        required = ("design_point", "reference_point", "coordinate_type", "north_direction",
                    "up_direction", "horizontal_unit_scale", "vertical_unit_scale")
        if not all(geodata.dxf.hasattr(attribute) for attribute in required):
            raise ValueError("incomplete geodata anchor")
        _check_geodata_axes(definition)
        matrix, epsg = geodata.get_crs_transformation()  # Never no_checks=True.
        crs, _, _, _ = _source_crs(f"EPSG:{epsg}")
        if (not crs.is_projected or [a.direction for a in crs.axis_info] != ["east", "north"] or
            any(not math.isclose(a.unit_conversion_factor, 1.0) for a in crs.axis_info)):
            raise ValueError("unsupported geodata units")
        horizontal = _finite(geodata.dxf.horizontal_unit_scale)
        vertical = _finite(geodata.dxf.vertical_unit_scale)
        north = geodata.dxf.north_direction
        if horizontal <= 0 or not math.isclose(horizontal, vertical) or math.hypot(north.x, north.y) <= 1e-12:
            raise ValueError("unsupported geodata scale")
        design = geodata.dxf.design_point
        source_point = [_finite(design.x), _finite(design.y), _finite(design.z)]
        point = matrix.transform(design)
        converted = transform_coordinates(point.x, point.y, f"EPSG:{epsg}",
            provenance="cad_geodata", point_role="cad_geodata_reference_point")
    except Exception:
        if result["geographic"] is None:
            result["status"] = "unsupported"
        result["warnings"].append("El CAD contiene GEODATA, pero su CRS o transformación no es compatible con una conversión validada. Revisa la referencia en el programa de origen.")
        return result
    previous_warnings = result["warnings"]
    previous_geographic = result["geographic"]
    if previous_geographic and any(not math.isclose(previous_geographic[axis], converted["geographic"][axis], abs_tol=1e-6)
                                   for axis in ("latitude", "longitude")):
        previous_warnings.append("El texto y GEODATA declaran puntos distintos. Se muestra el punto GEODATA; confirma qué referencia corresponde al proyecto.")
    result.update(converted, status="geographic_available", cad_reference_point=source_point)
    result["warnings"] = previous_warnings + converted["warnings"]
    result["warnings"].insert(0, "Ubicación calculada desde el punto de referencia GEODATA; la correspondencia con el predio y el IRM está pendiente de verificar.")
    return result
