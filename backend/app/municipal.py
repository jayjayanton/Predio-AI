
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

import httpx


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

async def lookup_predio(
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
        async with httpx.AsyncClient(
            timeout=REQUEST_TIMEOUT,
            follow_redirects=False
        ) as client:

            response = await client.get(
                QUERY_URL,
                params=params
            )

            response.raise_for_status()
            payload = response.json()

    except (httpx.HTTPError, ValueError) as exc:
        raise MunicipalError(
            "Municipal service unavailable "
            "or returned invalid JSON"
        ) from exc

    if "error" in payload:
        raise MunicipalError(
            "Municipal ArcGIS service returned an error"
        )

    if payload.get("type") != "FeatureCollection":
        raise MunicipalError(
            "Unexpected municipal response format"
        )

    return payload


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
        async with httpx.AsyncClient(
            timeout=REQUEST_TIMEOUT,
            follow_redirects=False
        ) as client:

            response = await client.get(
                LAYER_URL,
                params={"f": "json"}
            )

            response.raise_for_status()
            metadata = response.json()

    except (httpx.HTTPError, ValueError) as exc:
        raise MunicipalError(
            "Unable to retrieve municipal metadata"
        ) from exc

    if "error" in metadata:
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
