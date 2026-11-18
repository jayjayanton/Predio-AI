"""Source-linked drawing primitives for the interactive PredioAI viewer.

Geometry is in native PDF points or DXF drawing units. No real-world
measurements or wall/room classifications are inferred.
"""
from __future__ import annotations

import math
import re
from collections import Counter

MAX_PRIMITIVES = 3000
MAX_SOURCE_LABELS = 250
MAX_DXF_VISITS = 100_000
MAX_BLOCK_DEPTH = 8
MAX_POLYLINE_POINTS = 10_000


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


def extract_dxf_primitives(model):
    """Extract bounded straight geometry, retaining block-instance provenance.

    Top-level geometry is retained first; ordinary block references then supply
    transformed virtual entities without modifying the source document. Omission
    counts describe observed entity instances, never percentage coverage.
    """
    from ezdxf.xclip import XClip

    items = []
    source_labels = []
    source_label_limit_reached = False
    omitted = Counter()
    pending_blocks = []
    visited = 0
    curved_polylines = 0
    limit_reached = False
    traversal_limit_reached = False
    depth_limit_reached = False

    class TraversalStopped(Exception):
        pass

    def take_visit():
        nonlocal visited, traversal_limit_reached
        if visited >= MAX_DXF_VISITS:
            traversal_limit_reached = True
            return False
        visited += 1
        return True

    def original(entity):
        return getattr(entity, "origin_of_copy", None) or entity

    def handle(entity):
        return original(entity).dxf.get("handle", "unassigned")

    def effective_layer(entity, inherited="0"):
        layer = entity.dxf.get("layer", "0")
        return inherited if layer == "0" else layer

    def capture_source_label(entity, path, block_path, inherited_layer):
        """Keep author-supplied text at CAD coordinates; never infer room areas."""
        nonlocal source_label_limit_reached
        kind = entity.dxftype()
        if kind not in {"TEXT", "MTEXT", "ATTRIB", "DIMENSION"}:
            return False
        try:
            value = entity.plain_text() if kind == "MTEXT" else entity.dxf.get("text", "")
            if kind == "DIMENSION" and (not value or "<>" in str(value)):
                # Automatic CAD dimensions need unit/style evaluation; do not invent a value.
                return False
            text = re.sub(r"\s+", " ", str(value or "")).strip()
            if not text or any(ord(character) < 32 for character in text):
                return False
            point = (entity.dxf.get("text_midpoint") or entity.dxf.get("defpoint")
                     if kind == "DIMENSION" else entity.dxf.get("insert"))
            if point is None or not math.isfinite(float(point[2])) or abs(float(point[2])) > 1e-7:
                return False
            position = _finite_pair(point)
            if position is None:
                return False
            if len(source_labels) >= MAX_SOURCE_LABELS:
                source_label_limit_reached = True
                return False
            height = float(entity.dxf.get("height", entity.dxf.get("char_height", 0)) or 0)
            if not math.isfinite(height) or height < 0:
                height = 0
            source_labels.append({
                "id": "label-" + path,
                "text": text[:120],
                "position": position,
                "layer": effective_layer(entity, inherited_layer),
                "kind": ("source_area" if re.search(r"\d+(?:[.,]\d+)?\s*m(?:²|2|\\^2)", text, re.I)
                         else "source_dimension" if kind == "DIMENSION" else "source_text"),
                "source_type": kind,
                "source_handle": handle(entity),
                "block_path": block_path,
                "text_height": min(height, 1e5),
                "verified": False,
            })
            return True
        except (AttributeError, ValueError, TypeError, IndexError, OverflowError):
            return False

    def emit(entity, path, block_path, inherited_layer):
        nonlocal curved_polylines, limit_reached
        kind = entity.dxftype()
        if kind in {"TEXT", "MTEXT", "ATTRIB", "DIMENSION"}:
            if not capture_source_label(entity, path, block_path, inherited_layer):
                omitted[kind] += 1
            return
        points = None
        if kind == "LINE":
            vertices = [entity.dxf.start, entity.dxf.end]
        elif kind == "LWPOLYLINE":
            if entity.has_arc:
                curved_polylines += 1
                omitted[kind] += 1
                return
            if len(entity) > MAX_POLYLINE_POINTS:
                omitted[kind] += 1
                return
            # Respect OCS/extrusion instead of treating raw XY as world XY.
            vertices = list(entity.vertices_in_wcs())
        else:
            omitted[kind] += 1
            return
        # This viewer supports planar XY drawings; do not silently project 3D.
        if any(not math.isfinite(v.z) or abs(v.z) > 1e-7 for v in vertices):
            omitted[kind] += 1
            return
        points = [_finite_pair(v) for v in vertices]
        if kind == "LWPOLYLINE":
            if entity.closed and points:
                points.append(points[0])
        if not points or len(points) < 2 or not all(points):
            omitted[kind] += 1
            return
        if len(items) >= MAX_PRIMITIVES:
            limit_reached = True
            omitted[kind] += 1
            return
        items.append({
            "id": path,
            "kind": "line" if kind == "LINE" else "polyline",
            "points": points, "page": 1,
            "layer": effective_layer(entity, inherited_layer),
            "source": "dxf_modelspace", "source_handle": handle(entity),
            "block_path": block_path,
            "classification": "unclassified",
        })

    def expand(insert, path, block_path=(), names=(), inherited_layer="0"):
        nonlocal depth_limit_reached
        name = insert.dxf.name
        if len(names) >= MAX_BLOCK_DEPTH:
            depth_limit_reached = True
            omitted["INSERT"] += 1
            return
        if name in names:
            omitted["INSERT"] += 1
            return
        block = insert.block()
        scales = [abs(insert.dxf.get(key, 1)) for key in ("xscale", "yscale", "zscale")]
        # virtual_entities does not apply XCLIP or expand MINSERT. Restrict
        # this pilot to uniform scale so curved source polylines cannot be
        # silently disassembled into straight fragments during transformation.
        if (block is None or block.block_record.is_xref or insert.mcount > 1
                or XClip(insert).has_clipping_path
                or not all(math.isfinite(value) and value > 0 for value in scales)
                or not math.isclose(scales[0], scales[1], rel_tol=1e-9)
                or not math.isclose(scales[0], scales[2], rel_tol=1e-9)):
            omitted["INSERT"] += 1
            return
        layer = effective_layer(insert, inherited_layer)
        instance_path = (*block_path, path)

        def skipped(entity, reason):
            if not take_visit():
                raise TraversalStopped
            omitted[entity.dxftype()] += 1

        try:
            for attribute in insert.attribs:
                if not take_visit():
                    return
                if not capture_source_label(attribute, f"{path}/a-{handle(attribute)}", instance_path, layer):
                    omitted[attribute.dxftype()] += 1
            for index, entity in enumerate(insert.virtual_entities(skipped_entity_callback=skipped)):
                if not take_visit():
                    return
                child_path = f"{path}/b{index}-{handle(entity)}"
                if entity.dxftype() == "INSERT":
                    expand(entity, child_path, instance_path, (*names, name), layer)
                else:
                    emit(entity, child_path, instance_path, layer)
                if traversal_limit_reached:
                    return
        except TraversalStopped:
            return
        except Exception:
            # Retain already extracted evidence, but never label this block as
            # fully rendered when transformation or source structure fails.
            omitted["INSERT"] += 1

    for index, entity in enumerate(model):
        if not take_visit():
            break
        path = f"dxf-e{index}-{handle(entity)}"
        if entity.dxftype() == "INSERT":
            pending_blocks.append((entity, path))
        else:
            emit(entity, path, (), "0")
    if not traversal_limit_reached:
        for insert, path in pending_blocks:
            expand(insert, path)
            if traversal_limit_reached:
                break

    return items, {
        "status": "partial" if omitted or traversal_limit_reached or depth_limit_reached or source_label_limit_reached else "supported_geometry",
        "scope": "modelspace",
        "rendered_primitives": len(items),
        "source_labels": source_labels,
        "rendered_source_labels": len(source_labels),
        "source_label_limit_reached": source_label_limit_reached,
        "source_label_limit": MAX_SOURCE_LABELS,
        "omitted_entity_counts": dict(omitted),
        "omitted_curved_polylines": curved_polylines,
        "limit_reached": limit_reached,
        "primitive_limit": MAX_PRIMITIVES,
        "traversal_limit_reached": traversal_limit_reached,
        "depth_limit_reached": depth_limit_reached,
        "omitted_nonempty_layouts": 0,
    }


def dxf_primitives(model):
    """Return supported native-coordinate geometry without unit inference."""
    return extract_dxf_primitives(model)[0]


def drawing_view(items, bounds=None, invert_y=False, source_labels=None):
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
    visible_labels = []
    for label in source_labels or []:
        px, py = label["position"]
        visible_labels.append({
            **label,
            "position": [px, ymin + ymax - py if invert_y else py],
        })
    return {
        "elements": normalized,
        "source_labels": visible_labels,
        "bounds": [xmin, ymin, xmax, ymax],
        "units_verified": False,
        "measurements_available": False,
    }
