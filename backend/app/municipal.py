
"""
PredioAI — Quito Municipal Cadastral Service

Data source:
Quito ArcGIS FeatureServer — predios_a_2024

Capabilities:
- Search by cadastral key (clave_cata)
- Search by property number (n_predio)
- Retrieve all published cadastral attributes
- Retrieve parcel geometry as GeoJSON
- Identify horizontal properties (PH)
- Separate individual property measurements
  from global lot measurements
- Normalize cadastral attributes
- Preserve raw municipal information
- Retrieve ArcGIS field metadata

Important:
The municipal parcel geometry may represent
the GLOBAL LOT rather than an individual house.

Covered and open construction areas are not
explicitly available in this ArcGIS layer.
"""

import os
import re
import json
from copy import deepcopy

import httpx

from .async_cache import AsyncTTLCache
from .municipal_http import municipal_client, get
from .spatial_geometry import transfer_limit


# ============================================================
# 1. CONFIGURATION
# ============================================================

DEFAULT_LAYER_URL = (
    "https://geoquito.quito.gob.ec/server/rest/services/"
    "Hosted/predios_a_2024/FeatureServer/0"
)

LAYER_URL = os.getenv(
    "QUITO_ARCGIS_URL",
    DEFAULT_LAYER_URL
).rstrip("/")

# Compatibility with configurations ending in /query.
if LAYER_URL.endswith("/query"):
    LAYER_URL = LAYER_URL[:-6]

QUERY_URL = f"{LAYER_URL}/query"

REQUEST_TIMEOUT = 30.0
MAX_RESULTS = 10

# Briefly reuse authoritative geometry between a property sheet and its PUGS
# review. AIVA is deliberately excluded from this core cache.
CORE_CACHE = AsyncTTLCache(
    ttl=60, max_entries=128, max_weight=8 * 1024 * 1024,
    weight=lambda value: len(json.dumps(value, separators=(",", ":")).encode("utf-8")),
)

ALLOWED_IDENTIFIERS = {
    "clave_cata",
    "n_predio",
}


# ============================================================
# 2. EXCEPTIONS
# ============================================================

class MunicipalError(Exception):
    """Raised when the municipal service fails."""
    pass


# ============================================================
# 3. IDENTIFIER VALIDATION
# ============================================================

def validate_identifier(
    identifier: str,
    identifier_type: str
):
    """
    Validate a cadastral search identifier.

    Supported:
        clave_cata
        n_predio
    """

    if identifier_type not in ALLOWED_IDENTIFIERS:
        raise ValueError(
            "Identifier type must be "
            "'clave_cata' or 'n_predio'"
        )

    if not re.fullmatch(r"[0-9]{1,25}", identifier):
        raise ValueError(
            "Identifier must contain 1–25 digits"
        )

    if (
        identifier_type == "clave_cata"
        and len(identifier) > 10
    ):
        raise ValueError(
            "Cadastral key cannot exceed 10 digits"
        )

    return identifier


# ============================================================
# 4. ARCGIS QUERY
# ============================================================

async def _fetch_core_predio(
    identifier: str,
    identifier_type: str = "clave_cata"
):
    """
    Retrieve a cadastral record from Quito's ArcGIS API.

    Returns:
        GeoJSON FeatureCollection

    The returned properties include all attributes
    published by the municipal layer.
    """

    identifier = validate_identifier(
        identifier,
        identifier_type
    )

    params = {
        "where": f"{identifier_type} = '{identifier}'",
        "outFields": "*",
        "returnGeometry": "true",
        "outSR": "4326",
        "f": "geojson",
        "resultRecordCount": MAX_RESULTS,
    }

    try:
        async with municipal_client(REQUEST_TIMEOUT) as client:

            response = await get(
                client, QUERY_URL, params=params, timeout=REQUEST_TIMEOUT,
            )

            response.raise_for_status()
            payload = response.json()

    except (httpx.HTTPError, ValueError) as exc:
        raise MunicipalError(
            "Municipal service unavailable "
            "or returned invalid JSON"
        ) from exc

    if not isinstance(payload, dict) or "error" in payload:
        raise MunicipalError(
            "Municipal ArcGIS service returned an error"
        )

    if (payload.get("type") != "FeatureCollection"
            or not isinstance(payload.get("features"), list)
            or any(not isinstance(feature, dict)
                   or not isinstance(feature.get("properties") or {}, dict)
                   for feature in payload["features"])):
        raise MunicipalError(
            "Unexpected municipal response format"
        )

    complete = transfer_limit(payload)
    if (complete is True or len(payload["features"]) > MAX_RESULTS
            or (len(payload["features"]) == MAX_RESULTS and complete is not False)):
        raise MunicipalError("Municipal lookup may be truncated; search by a unique predio number")

    # The public lookup and PUGS reuse the same source-matched geometry.
    if payload.get("features"):
        payload = await _apply_2026_geometry(identifier, identifier_type, payload)

    return payload


async def lookup_core_predio(identifier: str, identifier_type: str = "clave_cata"):
    """Retrieve exact cadastral geometry without optional valuation requests.

    Source URLs form part of the key. Return an isolated copy so enrichment or
    a caller cannot mutate the cached municipal evidence.
    """
    identifier = validate_identifier(identifier, identifier_type)
    key = (QUERY_URL, NEW_2026_LAYER_URL, identifier_type, identifier)
    payload, _ = await CORE_CACHE.load(
        key, lambda: _fetch_core_predio(identifier, identifier_type),
    )
    return deepcopy(payload)


async def lookup_predio(identifier: str, identifier_type: str = "clave_cata"):
    """Preserve the public enriched property response using a reusable core."""
    payload = await lookup_core_predio(identifier, identifier_type)
    if payload.get("features"):
        payload = await _apply_aiva_comparison(payload)
    return payload



# ===================================================================
# OPTIONAL 2026 HYBRID EXTENSION — BEGIN
# 2026 supplies the latest parcel geometry; 2024 continues to supply
# detailed cadastral attributes. No other endpoint changes are needed.
# ===================================================================
NEW_2026_LAYER_URL = (
    "https://geoquito.quito.gob.ec/server/rest/services/"
    "Hosted/predios_2026_feb/FeatureServer/5"
)


async def _lookup_2026_geometry(identifier: str) -> dict | None:
    """Fetch a 2026 parcel by numeric predio ID; None on any failure."""
    try:
        async with municipal_client(REQUEST_TIMEOUT) as client:
            response = await get(
                client, f"{NEW_2026_LAYER_URL}/query",
                params={
                    "where": f"predio = {int(identifier)}",
                    "outFields": "predio,SHAPE__Area",
                    "returnGeometry": "true",
                    "outSR": "4326",
                    "f": "geojson",
                    "resultRecordCount": MAX_RESULTS,
                },
            )
            response.raise_for_status()
            payload = response.json()
        if (not isinstance(payload, dict) or payload.get("type") != "FeatureCollection"
                or transfer_limit(payload) is True):
            return None
        features = payload.get("features", [])
        if len(features) != 1 or not features[0].get("geometry"):
            return None
        return features[0]
    except (httpx.HTTPError, ValueError, TypeError, KeyError, AttributeError):
        return None


async def _apply_2026_geometry(
    identifier: str, identifier_type: str, payload: dict
) -> dict:
    """Preserve 2024 attributes, swapping geometry only for a safe match."""
    if identifier_type != "n_predio":
        return payload
    features = payload.get("features", [])
    if len(features) != 1:
        return payload
    newer = await _lookup_2026_geometry(identifier)
    if newer is None:
        return payload
    newer_id = (newer.get("properties") or {}).get("predio")
    try:
        if int(newer_id) != int(identifier):
            return payload
    except (TypeError, ValueError):
        return payload

    # Avoid modifying the original response in place.
    merged = dict(payload)
    old = dict(features[0])
    old["geometry"] = newer["geometry"]
    props = dict(old.get("properties") or {})
    props["_predioai_geometry_source"] = "predios_2026_feb"
    props["_predioai_attributes_source"] = "predios_a_2024"
    props["_predioai_geometry_area_2026_reported"] = (
        newer.get("properties") or {}
    ).get("SHAPE__Area")
    old["properties"] = props
    merged["features"] = [old]
    return merged

# OPTIONAL 2026 HYBRID EXTENSION — END


# ===================================================================
# OPTIONAL AIVA 2024/2026 COMPARISON — BEGIN
# Only the enriched property lookup requests AIVA. PUGS reuses the core.
# AIVA is a ZONE LAND RATE (USD/m2), not
# the official total appraisal or a market sale price.
# ===================================================================
AIVA_MAPSERVER = (
    "https://geoquito.quito.gob.ec/server/rest/services/"
    "web_reference_dmc/valoracion_del_suelo/MapServer"
)


def _representative_point(geometry: dict):
    """Use a vertex-average probe; not a parcel-wide overlay."""
    try:
        ring = geometry["coordinates"][0]
        if not ring:
            return None
        # Mean of first ring vertices is only a probe and may be outside
        # concave polygons. AIVA zone-code lookup is preferred when known.
        return [sum(p[0] for p in ring[:-1]) / (len(ring)-1),
                sum(p[1] for p in ring[:-1]) / (len(ring)-1)]
    except (KeyError, IndexError, TypeError, ZeroDivisionError):
        return None


async def _aiva_layer(layer_id: int, point: list, zone_code: str | None):
    """Query a municipal AIVA zone; failures return None, never break lookup."""
    params = {
        "geometry": f"{point[0]},{point[1]}",
        "geometryType": "esriGeometryPoint",
        "inSR": 4326,
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "cod_aiva,valor_m2" if layer_id == 0 else "CODIGO,VALOR",
        "returnGeometry": "false",
        "f": "json",
    }
    try:
        async with municipal_client(REQUEST_TIMEOUT) as client:
            response = await get(
                client, f"{AIVA_MAPSERVER}/{layer_id}/query", params=params,
            )
            response.raise_for_status()
            payload = response.json()
        if not isinstance(payload, dict) or payload.get("error"):
            return None
        features = payload.get("features", [])
        if len(features) != 1:
            return None
        attributes = features[0].get("attributes", {})
        code = attributes.get("cod_aiva") if layer_id == 0 else attributes.get("CODIGO")
        if zone_code and str(code) != str(zone_code):
            return None
        rate = attributes.get("valor_m2") if layer_id == 0 else attributes.get("VALOR")
        if not isinstance(rate, (int, float)) or rate < 0:
            return None
        return {"rate_usd_m2": rate, "zone_code": str(code)}
    except (httpx.HTTPError, ValueError, TypeError, KeyError, AttributeError):
        return None


async def _apply_aiva_comparison(payload: dict) -> dict:
    """Attach optional rates to GeoJSON properties; keep originals intact."""
    import asyncio

    merged = dict(payload)
    results = []
    for feature in payload.get("features", []):
        item = dict(feature)
        props = dict(item.get("properties") or {})
        point = _representative_point(item.get("geometry") or {})
        if point:
            code = props.get("codigo_aiv")
            recent, previous = await asyncio.gather(
                _aiva_layer(0, point, code),
                _aiva_layer(1, point, code),
            )
            if recent or previous:
                old_rate = previous["rate_usd_m2"] if previous else None
                new_rate = recent["rate_usd_m2"] if recent else None
                props["_predioai_aiva_2024_usd_m2"] = old_rate
                props["_predioai_aiva_2026_usd_m2"] = new_rate
                props["_predioai_aiva_zone_code"] = (
                    recent or previous
                )["zone_code"]
                props["_predioai_aiva_change_pct"] = (
                    round((new_rate / old_rate - 1) * 100, 2)
                    if old_rate and new_rate is not None else None
                )
                props["_predioai_aiva_method"] = "single-point zone probe; verify multi-zone parcels"
        item["properties"] = props
        results.append(item)
    merged["features"] = results
    return merged

# OPTIONAL AIVA 2024/2026 COMPARISON — END

# ============================================================
# 5. PROPERTY CLASSIFICATION
# ============================================================

def is_horizontal_property(properties: dict) -> bool:
    """
    Identify Propiedad Horizontal (PH).

    PH properties may include individual houses,
    apartments or commercial units sharing
    a global cadastral lot.
    """

    property_type = str(
        properties.get("tipo_propi") or ""
    ).strip().upper()

    return property_type == "PROPIEDAD HORIZONTAL"


# ============================================================
# 6. PROPERTY NORMALIZATION
# ============================================================

def normalize_property(feature: dict) -> dict:
    """
    Convert municipal attributes into a structured
    property record.

    Distinguishes:
        - Individual PH unit
        - Global cadastral lot
        - Construction measurements
        - Property valuation
        - Geometry

    Does not invent covered/open construction areas.
    """

    p = feature.get("properties") or {}

    is_ph = is_horizontal_property(p)

    # --------------------------------------------------------
    # PROPERTY IDENTIFIERS
    # --------------------------------------------------------

    identifiers = {
        "predio_number": p.get("n_predio"),
        "predio": p.get("predio"),
        "cadastral_key": p.get("clave_cata"),
        "fid": p.get("fid"),
        "global_lot_id": p.get("cat_lote_i"),
        "property_id": p.get("cat_predio"),
    }

    # --------------------------------------------------------
    # PROPERTY CLASSIFICATION
    # --------------------------------------------------------

    classification = {
        "property_type": p.get("tipo_propi"),
        "is_horizontal_property": is_ph,
        "building_use": p.get("uso_constr"),
        "economic_use": p.get("destino_ec"),
        "property_status": p.get("estado_pre"),
        "lot_status": p.get("estado_lot"),
        "zoning": p.get("zonificaci"),
    }

    # --------------------------------------------------------
    # CONSTRUCTION MEASUREMENTS
    # --------------------------------------------------------

    construction = {
        "total_area_m2": p.get("area_const"),

        # Not explicitly exposed by this layer.
        "covered_area_m2": None,
        "open_area_m2": None,

        "area_source": "municipal_arcgis",
        "breakdown_available": False,
    }

    # --------------------------------------------------------
    # LAND MEASUREMENTS
    # --------------------------------------------------------

    land = {
        "global_lot_area_m2": p.get("area_terre"),

        "attributed_land_area_m2": (
            p.get("area_ter_1") if is_ph else None
        ),

        "ownership_share_percent": (
            p.get("alicuota_p") if is_ph else None
        ),

        "gis_polygon_area_m2": p.get("SHAPE__Area"),

        "frontage_m": p.get("frente"),
    }

    # --------------------------------------------------------
    # PROPERTY VALUATION
    # --------------------------------------------------------

    valuation = {
        "total_assessed_value": p.get("avaluo_tot"),
        "land_assessed_value": p.get("avaluo_ter"),
        "construction_assessed_value": p.get(
            "avaluo_con"
        ),
        "currency": "USD",
    }

    # --------------------------------------------------------
    # LOCATION
    # --------------------------------------------------------

    location = {
        "parish": p.get("parroquia"),
        "administrative_zone": p.get("administra"),
        "property_code": p.get("nomenclatu"),
        "land_value_zone": p.get("codigo_aiv"),
    }

    # --------------------------------------------------------
    # GEOMETRY
    # --------------------------------------------------------

    geometry = {
        "type": (
            "associated_cadastral_lot"
            if is_ph
            else "cadastral_parcel"
        ),

        "polygon": feature.get("geometry"),

        "individual_building_footprint": None,

        "individual_footprint_available": False,
    }

    # --------------------------------------------------------
    # FINAL NORMALIZED RECORD
    # --------------------------------------------------------

    return {
        "identifiers": identifiers,
        "classification": classification,
        "construction": construction,
        "land": land,
        "valuation": valuation,
        "location": location,
        "geometry": geometry,

        # Preserve all municipal attributes.
        "raw_properties": p,
    }


# ============================================================
# 7. NORMALIZE MULTIPLE FEATURES
# ============================================================

def normalize_feature_collection(
    feature_collection: dict
) -> dict:
    """
    Normalize every returned property while preserving
    the original GeoJSON for mapping.
    """

    features = feature_collection.get(
        "features", []
    )

    normalized = [
        normalize_property(feature)
        for feature in features
    ]

    return {
        "type": "PredioAIPropertyCollection",
        "count": len(normalized),
        "properties": normalized,
        "geojson": feature_collection,
    }


# ============================================================
# 8. MUNICIPAL FIELD METADATA
# ============================================================

async def get_municipal_fields() -> list:
    """
    Retrieve all available field definitions from
    the Quito municipal ArcGIS layer.

    Useful for identifying additional attributes.
    """

    try:
        async with municipal_client(REQUEST_TIMEOUT) as client:

            response = await get(
                client, LAYER_URL, params={"f": "json"},
            )

            response.raise_for_status()
            metadata = response.json()

    except (httpx.HTTPError, ValueError) as exc:
        raise MunicipalError(
            "Unable to retrieve municipal metadata"
        ) from exc

    if not isinstance(metadata, dict) or "error" in metadata:
        raise MunicipalError(
            "Municipal metadata returned an error"
        )

    return [
        {
            "name": field.get("name"),
            "alias": field.get("alias"),
            "type": field.get("type"),
        }
        for field in metadata.get("fields", [])
    ]


# ============================================================
# 9. HIGH-LEVEL PROPERTY LOOKUP
# ============================================================

async def get_property_details(
    identifier: str,
    identifier_type: str = "clave_cata"
):
    """
    Retrieve and normalize a property record.

    Returns structured property information
    plus original GeoJSON geometry.
    """

    geojson = await lookup_predio(
        identifier,
        identifier_type
    )

    return normalize_feature_collection(geojson)
