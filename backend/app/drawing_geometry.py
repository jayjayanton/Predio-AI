"""Source-linked drawing primitives for the interactive PredioAI viewer.

Geometry is in native PDF points or DXF drawing units. No real-world
measurements or wall/room classifications are inferred.
"""
from __future__ import annotations

import math

MAX_PRIMITIVES = 3000


def _finite_pair(value):
    try:
        x, y = float(value[0]), float(value[1])
        if math.isfinite(x) and math.isfinite(y) and max(abs(x), abs(y)) < 1e9:
            return [round(x, 5), round(y, 5)]
    except (TypeError, ValueError, IndexError, OverflowError):
        pass
    return None


def pdf_primitives(page):
    """Extract straight source paths; curves and images are not approximated."""
    items = []
    for drawing_index, drawing in enumerate(page.get_drawings()):
        for segment_index, segment in enumerate(drawing.get("items", [])):
            if len(items) >= MAX_PRIMITIVES:
                break
            if segment[0] == "l":
                start = _finite_pair(segment[1])
                end = _finite_pair(segment[2])
                if start and end and start != end:
                    items.append({
                        "id": f"pdf-p{page.number + 1}-d{drawing_index}-s{segment_index}",
                        "kind": "line", "points": [start, end],
                        "page": page.number + 1, "source": "pdf_vector",
                        "classification": "unclassified",
                    })
            elif segment[0] == "re":
                rect = segment[1]
                corners = [[rect.x0, rect.y0], [rect.x1, rect.y0],
                           [rect.x1, rect.y1], [rect.x0, rect.y1],
                           [rect.x0, rect.y0]]
                points = [_finite_pair(p) for p in corners]
                if all(points):
                    items.append({
                        "id": f"pdf-p{page.number + 1}-d{drawing_index}-s{segment_index}",
                        "kind": "polyline", "points": points,
                        "page": page.number + 1, "source": "pdf_vector",
                        "classification": "unclassified",
                    })
        if len(items) >= MAX_PRIMITIVES:
            break
    return items


def dxf_primitives(model):
    """Extract modelspace LINE and LWPOLYLINE geometry without unit inference."""
    items = []
    for index, entity in enumerate(model):
        if len(items) >= MAX_PRIMITIVES:
            break
        kind = entity.dxftype()
        points = None
        if kind == "LINE":
            points = [_finite_pair(entity.dxf.start), _finite_pair(entity.dxf.end)]
        elif kind == "LWPOLYLINE":
            points = [_finite_pair((x, y)) for x, y in entity.get_points("xy")]
            if entity.closed and points:
                points.append(points[0])
        if points and len(points) >= 2 and all(points):
            items.append({
                "id": f"dxf-e{index}-{entity.dxf.handle}",
                "kind": "line" if kind == "LINE" else "polyline",
                "points": points, "page": 1,
                "layer": entity.dxf.layer, "source": "dxf_modelspace",
                "classification": "unclassified",
            })
    return items


def drawing_view(items, bounds=None, invert_y=False):
    """Return a native-coordinate viewBox and bounded selectable primitives."""
    if bounds is None:
        coordinates = [p for item in items for p in item["points"]]
        if not coordinates:
            return {"elements": [], "bounds": None, "units_verified": False}
        xs = [p[0] for p in coordinates]
        ys = [p[1] for p in coordinates]
        bounds = [min(xs), min(ys), max(xs), max(ys)]
    xmin, ymin, xmax, ymax = bounds
    # Zero-height/width bounds occur with horizontal/vertical CAD lines.
    # Expand the viewport only, without changing source coordinates.
    if xmax < xmin or ymax < ymin:
        return {"elements": [], "bounds": None, "units_verified": False}
    span = max(xmax - xmin, ymax - ymin)
    pad = max(span * 0.05, 1.0)
    if xmax == xmin:
        xmin -= pad
        xmax += pad
    if ymax == ymin:
        ymin -= pad
        ymax += pad
    normalized = []
    for item in items:
        transformed = dict(item)
        transformed["points"] = [
            [p[0], ymin + ymax - p[1] if invert_y else p[1]]
            for p in item["points"]
        ]
        normalized.append(transformed)
    return {
        "elements": normalized,
        "bounds": [xmin, ymin, xmax, ymax],
        "units_verified": False,
        "measurements_available": False,
    }
