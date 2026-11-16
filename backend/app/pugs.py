"""Evidence-only spatial intersection with official Quito PUGS 2024 layer 60."""
import json
import httpx
from shapely.geometry import shape
from shapely.ops import transform
from pyproj import Transformer
from .municipal import lookup_predio, validate_identifier, MunicipalError

LAYER = "https://geoquito.quito.gob.ec/server/rest/services/web_reference_dmot/plan_de_uso_y_gestion_del_suelo_2024/MapServer/60"
FIELDS = "fcode,leyenda,tipo_des,edifi_ba,ocupa_ba,pisos_ba,lot_min_ba,cos_pb_ba,edifi_gm,ocupa_gm,pisos_gm,lot_min_gm,cos_pb_gm,cod_edi_es,unidad_viv"

def polygon_rings(geometry):
    kind = geometry.get("type")
    coords = geometry.get("coordinates") or []
    polygons = [coords] if kind == "Polygon" else coords if kind == "MultiPolygon" else []
    rings = [ring for polygon in polygons for ring in polygon if len(ring) >= 4]
    if not rings or sum(map(len, rings)) > 20000:
        raise ValueError("Unsupported or oversized cadastral polygon")
    return rings

async def lookup_pugs(identifier, identifier_type):
    validate_identifier(identifier, identifier_type)
    cadastral = await lookup_predio(identifier, identifier_type)
    features = cadastral.get("features") or []
    if len(features) != 1:
        return {"status": "unavailable", "reason": "Expected one cadastral parcel", "zones": [], "source": LAYER}
    rings = polygon_rings(features[0].get("geometry") or {})
    params = {
        "where": "1=1",
        "geometry": json.dumps({"rings": rings, "spatialReference": {"wkid": 4326}}),
        "geometryType": "esriGeometryPolygon", "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects", "outFields": "*",
        "returnGeometry": "true", "outSR": "4326", "resultRecordCount": 100, "f": "json",
    }
    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=False) as client:
            response = await client.post(LAYER + "/query", data=params)
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise MunicipalError("PUGS service unavailable or invalid response") from exc
    if payload.get("error"):
        raise MunicipalError("PUGS service returned an error")
    rows = payload.get("features") or []
    if payload.get("exceededTransferLimit") or len(rows) >= 100:
        return {"status": "ambiguous", "reason": "Zone result limit reached", "zones": [], "source": LAYER}
    # Spatial join: calculate how much of the cadastral polygon falls in each PUGS zone.
    # EPSG:32717 gives metre-based areas near Quito. Never use the PH unit area
    # as though it were the geometry of its parent parcel.
    transformer = Transformer.from_crs("EPSG:4326", "EPSG:32717", always_xy=True)
    parcel = transform(transformer.transform, shape(features[0]["geometry"]))
    parcel_area = parcel.area
    zones = []
    for row in rows:
        attributes = dict(row.get("attributes") or {})
        geom = row.get("geometry") or {}
        try:
            rings = geom.get("rings") or []
            # ArcGIS rings may contain holes; unioning outer shapes is a
            # conservative approximation, so expose overlap as provisional.
            from shapely.geometry import Polygon
            from shapely.ops import unary_union
            parts = [Polygon(ring) for ring in rings if len(ring) >= 4]
            zoning = transform(transformer.transform, unary_union(parts))
            overlap = parcel.intersection(zoning).area
            attributes["_overlap_m2"] = round(overlap, 2)
            attributes["_overlap_percent"] = round(100 * overlap / parcel_area, 2) if parcel_area > 0 else None
        except (ValueError, TypeError, KeyError):
            attributes["_overlap_m2"] = None
            attributes["_overlap_percent"] = None
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
        "spatial_method": "polygon spatial join; provisional overlap in EPSG:32717; parent geometry for PH",
        "dominant_zone": zones[0] if zones and zones[0].get("_overlap_percent") is not None else None,
        "regulatory_approval": False,
    }
