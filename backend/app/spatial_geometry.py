"""Shared, hole-aware polygon validation and metre-based PUGS overlays."""
import math

from pyproj import Transformer
from shapely.errors import GEOSException
from shapely.geometry import shape
from shapely.ops import transform

PROJECTION = Transformer.from_crs("EPSG:4326", "EPSG:32717", always_xy=True)


def valid_polygon(geometry):
    if not isinstance(geometry, dict) or geometry.get("type") not in ("Polygon", "MultiPolygon"):
        raise ValueError("Only Polygon/MultiPolygon geometries are accepted")
    try:
        polygon = shape(geometry)
        if polygon.is_empty or not polygon.is_valid or polygon.area <= 0:
            raise ValueError("Invalid or empty polygon; geometry was not repaired")
        west, south, east, north = polygon.bounds
        if not all(math.isfinite(v) for v in polygon.bounds):
            raise ValueError("Nonfinite polygon coordinates")
        if west < -80 or east > -77 or south < -2 or north > 1:
            raise ValueError("Polygon outside expected Quito WGS84 bounds")
        return polygon
    except (GEOSException, TypeError, KeyError, IndexError) as exc:
        raise ValueError("Invalid polygon geometry") from exc


def project_polygon(polygon):
    try:
        projected = transform(PROJECTION.transform, polygon)
        if (projected.is_empty or not projected.is_valid
                or not math.isfinite(projected.area) or projected.area <= 0):
            raise ValueError("Projected polygon geometry invalid")
        return projected
    except GEOSException as exc:
        raise ValueError("Projected polygon geometry invalid") from exc


def overlap_attributes(parcel, zone, attributes):
    """Return evidence for a positive-area intersection, preserving holes."""
    try:
        overlap = parcel.intersection(zone).area
    except GEOSException as exc:
        raise ValueError("Polygon intersection could not be evaluated") from exc
    if not math.isfinite(overlap):
        raise ValueError("Polygon intersection area invalid")
    if overlap <= 0:
        return None
    result = dict(attributes)
    result["_overlap_m2"] = round(overlap, 2)
    result["_overlap_percent"] = round(100 * overlap / parcel.area, 2)
    return result


def transfer_limit(payload):
    """Read ArcGIS' optional completion flag without treating absence as false."""
    flag = payload.get("exceededTransferLimit")
    if isinstance(flag, bool):
        return flag
    metadata = payload.get("properties")
    if isinstance(metadata, dict):
        flag = metadata.get("exceededTransferLimit")
        if isinstance(flag, bool):
            return flag
    return None
