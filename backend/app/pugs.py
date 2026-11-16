"""Evidence-only spatial intersection with official Quito PUGS 2024 layer 60."""
import json
import httpx
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
        "returnGeometry": "false", "resultRecordCount": 20, "f": "json",
    }
    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=False) as client:
            response = await client.get(LAYER + "/query", params=params)
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise MunicipalError("PUGS service unavailable or invalid response") from exc
    if payload.get("error"):
        raise MunicipalError("PUGS service returned an error")
    rows = payload.get("features") or []
    if payload.get("exceededTransferLimit") or len(rows) >= 20:
        return {"status": "ambiguous", "reason": "Zone result limit reached", "zones": [], "source": LAYER}
    zones = [row.get("attributes") or {} for row in rows]
    return {
        "status": "single_zone" if len(zones) == 1 else "multiple_zones" if zones else "no_intersection",
        "zones": zones, "source": LAYER,
        "spatial_method": "full parcel polygon intersects; overlap fractions not calculated",
        "regulatory_approval": False,
    }
