"""Evidence-only spatial intersection with official Quito PUGS 2024 layer 60."""
import json
import httpx
from shapely.geometry.polygon import orient
from .municipal import lookup_core_predio, validate_identifier, MunicipalError
from .municipal_http import municipal_client, post
from .spatial_geometry import valid_polygon, project_polygon, overlap_attributes, transfer_limit

LAYER = "https://geoquito.quito.gob.ec/server/rest/services/web_reference_dmot/plan_de_uso_y_gestion_del_suelo_2024/MapServer/60"

def polygon_rings(geometry):
    polygon = valid_polygon(geometry)
    parts = list(polygon.geoms) if polygon.geom_type == "MultiPolygon" else [polygon]
    rings = []
    for part in parts:
        # Esri JSON uses clockwise exteriors and counterclockwise holes.
        part = orient(part, sign=-1.0)
        rings.append(list(part.exterior.coords))
        rings.extend(list(hole.coords) for hole in part.interiors)
    if not rings or sum(map(len, rings)) > 20000:
        raise ValueError("Unsupported or oversized cadastral polygon")
    return rings

async def lookup_pugs(identifier, identifier_type):
    validate_identifier(identifier, identifier_type)
    cadastral = await lookup_core_predio(identifier, identifier_type)
    features = cadastral.get("features") or []
    if len(features) != 1:
        return {"status": "unavailable", "reason": "Expected one cadastral parcel", "zones": [], "source": LAYER}
    rings = polygon_rings(features[0].get("geometry") or {})
    params = {
        "where": "1=1",
        "geometry": json.dumps({"rings": rings, "spatialReference": {"wkid": 4326}}),
        "geometryType": "esriGeometryPolygon", "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects", "outFields": "*",
        "returnGeometry": "true", "outSR": "4326", "resultRecordCount": 100, "f": "geojson",
    }
    try:
        async with municipal_client() as client:
            response = await post(client, LAYER + "/query", data=params)
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise MunicipalError("PUGS service unavailable or invalid response") from exc
    if not isinstance(payload, dict) or payload.get("error"):
        raise MunicipalError("PUGS service returned an error")
    if payload.get("type") != "FeatureCollection" or not isinstance(payload.get("features"), list):
        raise MunicipalError("PUGS service returned invalid GeoJSON")
    rows = payload["features"]
    limited = transfer_limit(payload)
    if limited is True or len(rows) > 100 or (len(rows) == 100 and limited is not False):
        return {"status": "ambiguous", "reason": "Zone result limit reached", "zones": [], "source": LAYER}
    # Spatial join: calculate how much of the cadastral polygon falls in each PUGS zone.
    # EPSG:32717 gives metre-based areas near Quito. Never use the PH unit area
    # as though it were the geometry of its parent parcel.
    parcel = project_polygon(valid_polygon(features[0]["geometry"]))
    zones = []
    for row in rows:
        try:
            zoning = project_polygon(valid_polygon(row.get("geometry")))
            attributes = overlap_attributes(parcel, zoning, row.get("properties") or {})
        except (ValueError, TypeError, KeyError, AttributeError):
            return {"status": "unavailable", "reason": "PUGS geometry could not be evaluated completely",
                    "zones": [], "source": LAYER, "regulatory_approval": False}
        if attributes is not None:
            zones.append(attributes)
    zones.sort(key=lambda zone: zone.get("_overlap_m2") or 0, reverse=True)
    cadastral_properties = features[0].get("properties") or {}
    is_ph = str(cadastral_properties.get("tipo_propi") or "").strip().upper() == "PROPIEDAD HORIZONTAL"
    return {
        "predio": cadastral_properties.get("n_predio"),
        "cadastral": {
            "property_regime": cadastral_properties.get("tipo_propi"),
            "individual_area_m2": cadastral_properties.get("area_ter_1") if is_ph else cadastral_properties.get("area_terre"),
            "parent_lot_area_m2": cadastral_properties.get("area_terre") if is_ph else None,
            "is_horizontal_property": is_ph,
            "building_use": cadastral_properties.get("uso_constr"),
        },
        "scope_warning": ("PUGS intersection uses parent-lot geometry; it cannot assign independent building rights to a PH unit" if is_ph else None),
        "status": "single_zone" if len(zones) == 1 else "multiple_zones" if zones else "no_intersection",
        "zones": zones, "source": LAYER,
        "spatial_method": "hole-aware polygon spatial join; provisional overlap in EPSG:32717; parent geometry for PH",
        "dominant_zone": zones[0] if zones and zones[0].get("_overlap_percent") is not None else None,
        "regulatory_approval": False,
    }
