"""Source-linked drawing primitives for the interactive PredioAI viewer.

Geometry is in native PDF points or DXF drawing units. No real-world
measurements or wall/room classifications are inferred.
"""
from __future__ import annotations

import math
import re
import json
import time
from collections import Counter

# The PDF pilot retains its existing display budget. CAD uses a separate,
# whole-document budget and never returns a silently truncated successful view.
MAX_PRIMITIVES = 3000
MAX_SOURCE_LABELS = 250
MAX_DXF_VISITS = 100_000
MAX_BLOCK_DEPTH = 32
MAX_CAD_PRIMITIVES = 50_000
MAX_CAD_POINTS = 500_000
MAX_CAD_SOURCE_COMPONENTS = 500_000
MAX_CAD_TEXT_CHARACTERS = 500_000
MAX_CAD_ELEMENT_BYTES = 32 * 1024 * 1024
MAX_CAD_SECONDS = 30.0
MAX_CAD_HATCH_WORK = 2_000_000
MAX_CAD_HATCH_BASELINE_WORK = 250_000
MAX_CAD_CURVE_WORK = 500_000
MAX_CAD_PATH_COMPONENTS = 50_000
MAX_SPLINE_CONTROL_POINTS = 10_000
MAX_SPLINE_FIT_POINTS = 512
MAX_SPLINE_DEGREE = 10
CURVE_RELATIVE_TOLERANCE = 1e-4
CURVE_MIN_TOLERANCE = 1e-6


class CadImportLimitError(ValueError):
    """A complete supported import would exceed an explicit resource budget."""

    def __init__(self, message, *, resource=None, limit=None):
        super().__init__(message)
        self.resource = resource
        self.limit = limit


class CadImportBudget:
    """Shared by every layout; checks are cooperative, not an OS time limit.

    Source component counts bound path construction before allocation. Point,
    element, text and serialized-element budgets bound the returned geometry.
    Any limit rejects the import, so a successful response has no budget cut.
    """

    def __init__(self):
        self.started = time.monotonic()
        self.visits = self.points = self.elements = self.components = 0
        self.text_characters = self.element_bytes = 0
        self.hatch_work = self.curve_work = 0

    def check_time(self):
        if time.monotonic() - self.started > MAX_CAD_SECONDS:
            raise CadImportLimitError(
                "La importación CAD supera el tiempo disponible. Divide el dibujo "
                "o exporta las vistas que necesitas; no se devolvió un plano recortado."
            )

    def consume(self, name, count, limit):
        self.check_time()
        value = getattr(self, name) + count
        if value > limit:
            raise CadImportLimitError(
                "El dibujo es demasiado complejo para importarlo en una sola operación. "
                "Divide el archivo o exporta una vista; no se devolvió geometría truncada.",
                resource=name, limit=limit,
            )
        setattr(self, name, value)

    def visit(self):
        self.consume("visits", 1, MAX_DXF_VISITS)

    def component(self, count):
        self.consume("components", count, MAX_CAD_SOURCE_COMPONENTS)

    def point(self):
        self.consume("points", 1, MAX_CAD_POINTS)

    def add_element(self, item):
        self.consume("elements", 1, MAX_CAD_PRIMITIVES)
        encoded = json.dumps(item, ensure_ascii=True, separators=(",", ":"), allow_nan=False)
        self.consume("element_bytes", len(encoded), MAX_CAD_ELEMENT_BYTES)

    @staticmethod
    def limits():
        return {
            "entity_instances": MAX_DXF_VISITS,
            "primitives": MAX_CAD_PRIMITIVES,
            "vertices": MAX_CAD_POINTS,
            "source_components": MAX_CAD_SOURCE_COMPONENTS,
            "text_characters": MAX_CAD_TEXT_CHARACTERS,
            "serialized_element_bytes": MAX_CAD_ELEMENT_BYTES,
            "block_depth": MAX_BLOCK_DEPTH,
            "cooperative_seconds": MAX_CAD_SECONDS,
            "estimated_hatch_intersections": MAX_CAD_HATCH_WORK,
            "hatch_baseline_candidates": MAX_CAD_HATCH_BASELINE_WORK,
            "curve_construction_work": MAX_CAD_CURVE_WORK,
            "path_source_components": MAX_CAD_PATH_COMPONENTS,
            "spline_control_points": MAX_SPLINE_CONTROL_POINTS,
            "spline_fit_points": MAX_SPLINE_FIT_POINTS,
            "spline_degree": MAX_SPLINE_DEGREE,
            "on_exceeded": "reject_import",
        }


def _finite_pair(value):
    try:
        x, y = float(value[0]), float(value[1])
        if math.isfinite(x) and math.isfinite(y) and max(abs(x), abs(y)) < 1e9:
            return [round(x, 5), round(y, 5)]
    except (TypeError, ValueError, IndexError, OverflowError):
        pass
    return None


def pdf_primitives(page, *, drawings=None):
    """Extract straight source paths; curves and images are not approximated."""
    items = []
    if drawings is None:
        drawings = page.get_drawings()
    for drawing_index, drawing in enumerate(drawings):
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


def extract_dxf_primitives(model, *, budget=None, scope=None, page=1):
    """Import supported 2D source instances, without a CAD display truncation.

    Block matrices are accumulated before flattening curves, which preserves
    nested nonuniform transforms and MINSERT placement. Paths use ezdxf's Bézier
    conversion followed by adaptive flattening in final drawing coordinates.
    The tolerance is a display setting, not a certified bound on the original
    CAD curve or a verified physical measurement.

    Omission counts refer to encountered source instances. A skipped external,
    clipped, recursive or unsupported container does not reveal its children.
    """
    from ezdxf import path as cad_path
    from ezdxf.math import Matrix44, Vec2, Vec3
    from ezdxf.render import hatching
    from ezdxf.xclip import XClip

    budget = budget or CadImportBudget()
    scope = scope or ("modelspace" if model.is_modelspace else "paperspace")
    items = []
    source_labels = []
    source_label_count = 0
    source_counts = Counter()
    represented = Counter()
    omitted = Counter()
    partial = Counter()
    reasons = Counter()
    approximated = Counter()
    omitted_examples = []
    unexpanded_containers = 0

    def original(entity):
        return getattr(entity, "origin_of_copy", None) or entity

    def handle(entity):
        return original(entity).dxf.get("handle", "unassigned")

    def effective_layer(entity, inherited="0"):
        layer = entity.dxf.get("layer", "0")
        return inherited if layer == "0" else layer

    def omission(entity, identifier, reason, *, part=False):
        nonlocal unexpanded_containers
        kind = entity.dxftype()
        (partial if part else omitted)[kind] += 1
        reasons[reason] += 1
        if not part and kind in {"INSERT", "DIMENSION"}:
            unexpanded_containers += 1
        if len(omitted_examples) < 250:
            omitted_examples.append({
                "id": identifier, "source_type": kind,
                "source_handle": handle(entity), "reason": reason,
                "partially_rendered": part,
            })

    def metadata(entity, identifier, block_path, layer, owner=None):
        result = {
            "id": identifier, "page": page, "source_type": entity.dxftype(),
            "layer": layer, "source": f"dxf_{scope}",
            "source_handle": handle(entity), "block_path": block_path,
            "classification": "unclassified",
        }
        if owner:
            result["dimension_handle"] = owner
        return result

    def add(item):
        budget.add_element(item)
        items.append(item)

    def planar(vertices):
        return all(
            math.isfinite(float(v.z)) and abs(float(v.z)) <= 1e-7
            and _finite_pair(v) is not None
            for v in vertices
        )

    def coordinates(vertices):
        # Validate each CAD vertex once rather than calling planar() and then
        # revalidating and rounding its XY coordinates through _finite_pair().
        result = []
        for vertex in vertices:
            budget.point()
            z = float(vertex.z)
            if not math.isfinite(z) or abs(z) > 1e-7:
                raise ValueError("nonplanar_or_invalid_coordinates")
            try:
                x, y = float(vertex[0]), float(vertex[1])
                valid = math.isfinite(x) and math.isfinite(y) and max(abs(x), abs(y)) < 1e9
            except (TypeError, ValueError, IndexError, OverflowError):
                valid = False
            if not valid:
                raise ValueError("nonplanar_or_invalid_coordinates")
            value = [round(x, 5), round(y, 5)]
            if not result or result[-1] != value:
                result.append(value)
        return result

    def prepared_path(source_path, matrix):
        transformed = source_path.transform(matrix)
        # Curve control points must also be planar; endpoint-only checks would
        # silently project a 3D spline whose endpoints happen to lie on XY.
        vertices = list(transformed.control_vertices())
        if not vertices or not planar(vertices):
            raise ValueError("nonplanar_or_invalid_coordinates")
        span = max(
            max(v.x for v in vertices) - min(v.x for v in vertices),
            max(v.y for v in vertices) - min(v.y for v in vertices),
        )
        tolerance = max(span * CURVE_RELATIVE_TOLERANCE, CURVE_MIN_TOLERANCE)
        points = coordinates(transformed.flattening(tolerance, segments=4))
        if len(points) < 2:
            raise ValueError("empty_or_degenerate_geometry")
        return points, tolerance, transformed.has_curves

    def spline_preflight(control_points, fit_points, degree, *, hatch_edge=False):
        if (control_points > MAX_SPLINE_CONTROL_POINTS
                or fit_points > MAX_SPLINE_FIT_POINTS or degree > MAX_SPLINE_DEGREE):
            raise CadImportLimitError(
                "Una curva SPLINE es demasiado compleja para importarla. "
                "Simplifica esa curva o exporta una vista; no se devolvió geometría truncada."
            )
        # HATCH's public path converter approximates non-cubic/rational
        # splines internally before yielding points. Bound that allocation too.
        budget.consume("curve_work", max(control_points, fit_points) * (64 if hatch_edge else 1), MAX_CAD_CURVE_WORK)

    def prepared_spline(entity, matrix):
        # Direct adaptive B-spline evaluation avoids an eager level-N Bézier
        # approximation with exponentially many temporary sample points.
        spline = entity.construction_tool().transform(matrix)
        vertices = spline.control_points
        if not vertices or not planar(vertices):
            raise ValueError("nonplanar_or_invalid_coordinates")
        span = max(max(v.x for v in vertices) - min(v.x for v in vertices),
                   max(v.y for v in vertices) - min(v.y for v in vertices))
        tolerance = max(span * CURVE_RELATIVE_TOLERANCE, CURVE_MIN_TOLERANCE)
        points = coordinates(spline.flattening(tolerance, segments=4))
        if len(points) < 2:
            raise ValueError("empty_or_degenerate_geometry")
        return points, tolerance

    def check_source_components(entity):
        kind = entity.dxftype()
        if kind == "LWPOLYLINE":
            if len(entity) > MAX_CAD_PATH_COMPONENTS:
                raise CadImportLimitError("Una polilínea tiene demasiados puntos para importarla. Simplifica esa polilínea.")
            budget.component(len(entity))
            curved = sum(1 for vertex in entity if vertex[4])
            budget.consume("curve_work", len(entity) + curved * 24, MAX_CAD_CURVE_WORK)
        elif kind == "POLYLINE":
            if len(entity.vertices) > MAX_CAD_PATH_COMPONENTS:
                raise CadImportLimitError("Una polilínea tiene demasiados puntos para importarla. Simplifica esa polilínea.")
            budget.component(len(entity.vertices))
            curved = sum(1 for vertex in entity.vertices if vertex.dxf.get("bulge", 0))
            budget.consume("curve_work", len(entity.vertices) + curved * 24, MAX_CAD_CURVE_WORK)
        elif kind == "SPLINE":
            spline_preflight(len(entity.control_points), len(entity.fit_points), entity.dxf.degree)
            budget.component(len(entity.control_points) + len(entity.fit_points) + len(entity.knots))
        elif kind in {"HATCH", "MPOLYGON"}:
            components_before = budget.components
            for boundary in entity.paths:
                if hasattr(boundary, "vertices"):
                    budget.component(len(boundary.vertices))
                    curved = sum(1 for vertex in boundary.vertices if len(vertex) > 2 and vertex[2])
                    budget.consume("curve_work", len(boundary.vertices) + curved * 24, MAX_CAD_CURVE_WORK)
                else:
                    budget.component(len(boundary.edges))
                    budget.consume("curve_work", len(boundary.edges) * 24, MAX_CAD_CURVE_WORK)
                    for edge in boundary.edges:
                        if hasattr(edge, "control_points"):
                            spline_preflight(len(edge.control_points), len(edge.fit_points), edge.degree, hatch_edge=True)
                            budget.component(len(edge.control_points) + len(edge.fit_points) + len(edge.knot_values))
                if budget.components - components_before > MAX_CAD_PATH_COMPONENTS:
                    raise CadImportLimitError("Una trama tiene demasiados contornos para importarla. Simplifica esa trama.")
            if entity.pattern:
                budget.component(len(entity.pattern.lines))
                for line in entity.pattern.lines:
                    budget.component(len(line.dash_length_items))

    def text_element(entity, identifier, block_path, matrix, layer, owner=None):
        nonlocal source_label_count
        kind = entity.dxftype()
        # MTEXT formatting and source fonts are not embedded in the browser.
        # Preserve the full plain text; source_labels is only a capped summary.
        text = entity.plain_text() if hasattr(entity, "plain_text") else entity.dxf.get("text", "")
        text = str(text or "").replace("\r\n", "\n").replace("\r", "\n")
        if not text.strip():
            raise ValueError("empty_text")
        if any(ord(c) < 32 and c not in "\n\t" for c in text):
            raise ValueError("invalid_text_control_characters")
        budget.consume("text_characters", len(text), MAX_CAD_TEXT_CHARACTERS)
        height = float(entity.dxf.get("char_height" if kind == "MTEXT" else "height", 1.0))
        if not math.isfinite(height) or height <= 0:
            raise ValueError("invalid_text_height")

        if kind == "MTEXT":
            insert = Vec3(entity.dxf.insert)
            x_axis = entity.get_text_direction().normalize()
            normal = Vec3(entity.dxf.get("extrusion", (0, 0, 1))).normalize()
            y_axis = normal.cross(x_axis).normalize()
            attachment = max(1, min(9, int(entity.dxf.get("attachment_point", 1)))) - 1
            alignment = ("left", "center", "right")[attachment % 3]
            vertical = ("top", "middle", "bottom")[attachment // 3]
            width_factor = 1.0
        else:
            placement, anchor, _ = entity.get_placement()
            ocs = entity.ocs()
            insert = ocs.to_wcs(anchor)
            angle = math.radians(float(entity.dxf.get("rotation", 0)))
            x_axis = ocs.to_wcs((math.cos(angle), math.sin(angle), 0))
            y_axis = ocs.to_wcs((-math.sin(angle), math.cos(angle), 0))
            name = placement.name
            alignment = "center" if "CENTER" in name or name == "MIDDLE" else "right" if "RIGHT" in name else "left"
            vertical = "top" if "TOP" in name else "middle" if "MIDDLE" in name else "bottom" if "BOTTOM" in name else "baseline"
            width_factor = float(entity.dxf.get("width", 1.0))
            # Obliquing and backward/upside-down text are affine operations.
            oblique = math.tan(math.radians(float(entity.dxf.get("oblique", 0))))
            y_axis = y_axis + x_axis * oblique
            flags = int(entity.dxf.get("text_generation_flag", 0))
            if flags & 2:
                x_axis = -x_axis
            if flags & 4:
                y_axis = -y_axis

        position = matrix.transform(insert)
        x_vector = matrix.transform_direction(x_axis * height * width_factor)
        # Text-local Y is downward, like the Canvas text coordinate system.
        y_vector = matrix.transform_direction(y_axis * -height)
        if not planar((position, x_vector, y_vector)) or x_vector.magnitude <= 1e-12 or y_vector.magnitude <= 1e-12:
            raise ValueError("nonplanar_or_invalid_text_transform")
        rotation = math.degrees(math.atan2(x_vector.y, x_vector.x))
        label_id = "label-" + identifier
        item = {
            **metadata(entity, identifier, block_path, layer, owner),
            "kind": "text", "points": [], "text": text,
            "position": _finite_pair(position),
            "height": y_vector.magnitude, "rotation": rotation,
            "alignment": alignment, "vertical_alignment": vertical,
            "text_transform": [x_vector.x, x_vector.y, y_vector.x, y_vector.y],
            "source_label_id": label_id,
            "text_rendering": "plain_text_with_substitute_font",
            "source_style": entity.dxf.get("style", "Standard"),
        }
        add(item)
        approximated[kind] += 1
        source_label_count += 1
        if len(source_labels) < MAX_SOURCE_LABELS:
            summary = re.sub(r"\s+", " ", text).strip()
            source_labels.append({
                "id": label_id, "text": summary[:120], "position": item["position"],
                "layer": layer,
                "kind": ("source_area" if re.search(r"\d+(?:[.,]\d+)?\s*m(?:²|2|\^2)", summary, re.I)
                         else "source_dimension" if owner else "source_text"),
                "source_type": kind, "source_handle": handle(entity),
                "block_path": block_path, "text_height": item["height"],
                "verified": False,
            })

    def hatch_elements(entity, identifier, block_path, matrix, layer, owner=None):
        rings = []
        tolerances = []
        has_curves = False
        # rendering_paths respects normal/outer/ignore hatch island style.
        for boundary in entity.paths.rendering_paths(entity.dxf.hatch_style):
            source = cad_path.from_hatch_boundary_path(
                boundary, entity.ocs(), elevation=entity.dxf.elevation.z
            )
            for path_index, sub_path in enumerate(source.sub_paths()):
                points, tolerance, curves = prepared_path(sub_path, matrix)
                if points[-1] != points[0]:
                    budget.point()
                    points.append(points[0])
                rings.append(points)
                tolerances.append(tolerance)
                has_curves |= curves
        if not rings:
            raise ValueError("empty_hatch_boundaries")
        base = metadata(entity, identifier, block_path, layer, owner)
        approximation = {
            "method": "adaptive_bezier_flattening",
            "tolerance": max(tolerances),
        }
        # Keep one source hatch's outer boundary and islands together. Splitting
        # patterned rings made selecting only its outer edge lose the holes in
        # downstream area calculations. Pattern strokes remain separate below;
        # only solid hatches receive a solid fill in the viewer.
        item = {**base, "kind": "hatch_boundary", "points": [], "rings": rings,
                "filled": bool(entity.dxf.solid_fill and not entity.gradient),
                "closed": True, "fill_rule": "evenodd"}
        if has_curves:
            item["approximation"] = approximation
        add(item)

        if has_curves:
            approximated[entity.dxftype()] += 1
        if entity.gradient:
            omission(entity, identifier, "gradient_fill_not_rendered", part=True)
            return
        if entity.dxf.solid_fill:
            return
        if not entity.pattern or not entity.pattern.lines:
            omission(entity, identifier, "missing_hatch_pattern", part=True)
            return

        # Use the lower-level public functions so a dense pattern cannot run
        # without checking the import deadline. Generate in hatch OCS, then
        # apply OCS -> WCS -> accumulated block matrix exactly once.
        paths = hatching.hatch_boundary_paths(entity, filter_text_boxes=True)
        path_vertices = [Vec2(v) for source in paths for v in source.control_vertices()]
        command_count = sum(len(source) for source in paths)
        ocs = entity.ocs()
        elevation = entity.dxf.elevation.z
        index = 0

        def deadline():
            budget.check_time()
            return False

        for baseline in hatching.pattern_baselines(entity, jiggle_origin=False):
            # hatch_paths collects intersections before its first yield. Its
            # callback alone cannot bound a single dense boundary allocation.
            distances = [baseline.signed_distance(v) for v in path_vertices]
            estimated_lines = math.ceil((max(distances) - min(distances)) / abs(baseline.normal_distance)) + 2
            baseline_work = estimated_lines * command_count
            if baseline_work > MAX_CAD_HATCH_BASELINE_WORK:
                raise CadImportLimitError(
                    "Una trama concentra demasiadas intersecciones para importarla. "
                    "Simplifica la trama; no se devolvió un plano recortado."
                )
            budget.consume("hatch_work", baseline_work, MAX_CAD_HATCH_WORK)
            # An all-gap pattern has no visible strokes and may otherwise loop
            # through arbitrary repeats without yielding a deadline check.
            if baseline.line_pattern and all(value < 0 for value in baseline.line_pattern):
                continue
            for line in hatching.hatch_paths(baseline, paths, terminate=deadline):
                renderer = baseline.pattern_renderer(line.distance)
                pattern_length = renderer.pattern_length
                if pattern_length >= 1e-9:
                    repeats = math.ceil((line.end - line.start).magnitude / pattern_length) + 2
                    budget.consume("hatch_work", repeats * max(1, len(baseline.line_pattern)), MAX_CAD_HATCH_WORK)
                for start, end in renderer.render(line.start, line.end):
                    vertices = (
                        matrix.transform(ocs.to_wcs((start.x, start.y, elevation))),
                        matrix.transform(ocs.to_wcs((end.x, end.y, elevation))),
                    )
                    # Dot patterns are retained as zero-length selectable strokes.
                    points = coordinates(vertices)
                    if len(points) == 1:
                        points.append(points[0])
                    add({**base, "id": f"{identifier}/pattern{index}", "kind": "line",
                         "points": points, "hatch_pattern": True})
                    index += 1

    def emit(entity, identifier, block_path, matrix, inherited_layer, owner=None):
        kind = entity.dxftype()
        layer = effective_layer(entity, inherited_layer)
        before = len(items)
        try:
            check_source_components(entity)
            if kind in {"TEXT", "MTEXT", "ATTRIB", "ATTDEF"}:
                text_element(entity, identifier, block_path, matrix, layer, owner)
            elif kind in {"HATCH", "MPOLYGON"}:
                hatch_elements(entity, identifier, block_path, matrix, layer, owner)
            elif kind == "SPLINE":
                points, tolerance = prepared_spline(entity, matrix)
                add({
                    **metadata(entity, identifier, block_path, layer, owner),
                    "kind": "curve", "points": points,
                    "closed": bool(entity.closed),
                    "approximation": {"method": "adaptive_bspline_flattening", "tolerance": tolerance},
                })
                approximated[kind] += 1
            elif kind in {"LINE", "LWPOLYLINE", "POLYLINE", "ARC", "CIRCLE", "ELLIPSE", "SOLID", "TRACE", "3DFACE"}:
                if kind == "POLYLINE" and (entity.is_polygon_mesh or entity.is_poly_face_mesh):
                    raise ValueError("unsupported_3d_mesh")
                # More Bézier pieces reduce the initial analytic-curve
                # conversion error before final-coordinate flattening.
                source = cad_path.make_path(entity, segments=8)
                points, tolerance, curves = prepared_path(source, matrix)
                item = {
                    **metadata(entity, identifier, block_path, layer, owner),
                    "kind": "curve" if curves else "line" if kind == "LINE" else "polyline",
                    "points": points, "closed": source.is_closed,
                }
                if kind in {"SOLID", "TRACE"}:
                    item["filled"] = True
                if curves or kind == "SPLINE":
                    item["approximation"] = {"method": "adaptive_bezier_flattening", "tolerance": tolerance}
                    approximated[kind] += 1
                add(item)
                if kind in {"LWPOLYLINE", "POLYLINE"} and entity.has_width:
                    omission(entity, identifier, "polyline_width_not_rendered", part=True)
            elif kind == "POINT":
                point = matrix.transform(entity.dxf.location)
                points = coordinates((point, point))
                add({**metadata(entity, identifier, block_path, layer, owner),
                     "kind": "line", "points": [points[0], points[0]], "point_marker": True})
            else:
                omission(entity, identifier,
                         "paper_viewport_contents_not_rendered" if kind == "VIEWPORT"
                         else "unsupported_entity_type")
                return
        except CadImportLimitError:
            raise
        except Exception as exc:
            if isinstance(exc, hatching.DenseHatchingLinesError):
                raise CadImportLimitError(
                    "La trama CAD es demasiado densa para importarla en una sola operación. "
                    "Exporta una vista con una trama menos densa; no se devolvió un plano recortado."
                ) from exc
            reason = (str(exc) if isinstance(exc, ValueError) and str(exc) in {
                "nonplanar_or_invalid_coordinates", "empty_or_degenerate_geometry",
                "empty_text", "invalid_text_control_characters", "invalid_text_height",
                "nonplanar_or_invalid_text_transform", "empty_hatch_boundaries",
                "unsupported_3d_mesh",
            } else "geometry_conversion_failed")
            omission(entity, identifier, reason, part=len(items) > before)
        if len(items) > before:
            represented[kind] += 1

    def visit(entity, identifier, block_path=(), names=(), matrix=None, inherited_layer="0", owner=None):
        nonlocal unexpanded_containers
        budget.visit()
        kind = entity.dxftype()
        source_counts[kind] += 1
        matrix = matrix if matrix is not None else Matrix44()
        if kind == "INSERT":
            if len(names) >= MAX_BLOCK_DEPTH:
                raise CadImportLimitError(
                    f"El CAD supera {MAX_BLOCK_DEPTH} niveles de bloques anidados; "
                    "no se devolvió geometría truncada."
                )
            name = entity.dxf.name
            block = entity.block()
            reason = None
            if name in names:
                reason = "recursive_block_reference"
            elif block is None:
                reason = "missing_block_definition"
            elif block.block_record.is_xref:
                reason = "external_reference_not_loaded"
            elif XClip(entity).has_clipping_path:
                reason = "clipped_block_not_rendered"
            if reason:
                omission(entity, identifier, reason)
                return
            scales = [float(entity.dxf.get(key, 1)) for key in ("xscale", "yscale", "zscale")]
            if not all(math.isfinite(v) and abs(v) > 1e-12 for v in scales):
                omission(entity, identifier, "invalid_block_transform")
                return
            # Preflight raw grid size: multi_insert() otherwise loops through
            # duplicate zero-spacing rows without yielding an interrupt point.
            rows = int(entity.dxf.get("row_count", 1))
            columns = int(entity.dxf.get("column_count", 1))
            budget.component(max(rows, 1) * max(columns, 1))
            layer = effective_layer(entity, inherited_layer)
            instances = entity.multi_insert() if entity.mcount > 1 else (entity,)
            try:
                for index, instance in enumerate(instances):
                    budget.check_time()
                    instance_id = f"{identifier}/i{index}" if entity.mcount > 1 else identifier
                    token = f"INSERT#{handle(entity)}:{name}:i{index}"
                    instance_path = (*block_path, token)
                    transform = instance.matrix44() @ matrix
                    # ATTRIBs already live in the containing coordinate system.
                    for attr_index, attribute in enumerate(instance.attribs):
                        visit(attribute, f"{instance_id}/a{attr_index}-{handle(attribute)}",
                              instance_path, (*names, name), matrix, layer, owner)
                    for child_index, child in enumerate(block):
                        if child.dxftype() == "ATTDEF" and (
                                not child.is_const or instance.has_attrib(child.dxf.tag)):
                            # Definitions are templates. Real instance ATTRIBs
                            # above carry their values and containing-space placement.
                            continue
                        visit(child, f"{instance_id}/b{child_index}-{handle(child)}",
                              instance_path, (*names, name), transform, layer, owner)
                represented["INSERT"] += 1
            except CadImportLimitError:
                raise
            except Exception:
                omission(entity, identifier, "block_expansion_failed", part=True)
        elif kind == "DIMENSION":
            try:
                geometry = entity.get_geometry_block()
                expected = len(geometry) if geometry is not None else 0
                seen = 0
                for index, child in enumerate(entity.virtual_entities()):
                    visit(child, f"{identifier}/d{index}-{handle(child)}",
                          (*block_path, f"DIMENSION#{handle(entity)}"), names, matrix,
                          effective_layer(entity, inherited_layer), handle(entity))
                    seen += 1
                if not seen:
                    omission(entity, identifier, "dimension_geometry_missing")
                else:
                    represented[kind] += 1
                    if seen < expected:
                        omission(entity, identifier, "dimension_components_unavailable", part=True)
            except CadImportLimitError:
                raise
            except Exception:
                omission(entity, identifier, "dimension_expansion_failed", part=True)
        else:
            emit(entity, identifier, block_path, matrix, inherited_layer, owner)

    for index, entity in enumerate(model):
        visit(entity, f"dxf-l{page}-e{index}-{handle(entity)}")

    segments = sum(
        sum(max(0, len(ring) - 1) for ring in item.get("rings", []))
        if item.get("rings") else max(0, len(item.get("points", [])) - 1)
        for item in items
    )
    omitted_labels = max(0, source_label_count - len(source_labels))
    return items, {
        "status": "partial" if omitted or partial else "supported_geometry",
        "scope": scope,
        "rendered_primitives": len(items),
        "rendered_segments": segments,
        "rendered_text_elements": source_label_count,
        "source_entity_counts": dict(source_counts),
        "represented_entity_counts": dict(represented),
        "omitted_entity_counts": dict(omitted),
        "partially_rendered_entity_counts": dict(partial),
        "omission_reasons": dict(reasons),
        "omission_examples": omitted_examples,
        "unexpanded_container_instances": unexpanded_containers,
        "counts_scope": "encountered_entity_instances",
        "approximated_entity_counts": dict(approximated),
        "curve_approximation": {
            "method": "adaptive_bspline_or_bezier_flattening",
            "relative_tolerance": CURVE_RELATIVE_TOLERANCE,
            "minimum_tolerance": CURVE_MIN_TOLERANCE,
            "units": "unverified_drawing_units",
            "certified_geometric_error": False,
        },
        "rendering_limitations": [
            "CAD fonts are substituted; plain text layout and rich formatting are approximate",
            "Source lineweights, linetypes and colors are not reproduced",
            "Only planar XY geometry is displayed; no 3D projection or paper viewport rendering",
        ],
        "source_labels": source_labels,
        "rendered_source_labels": len(source_labels),
        "source_label_limit_reached": bool(omitted_labels),
        "source_label_limit": MAX_SOURCE_LABELS,
        "source_label_summary_omitted": omitted_labels,
        "source_label_summary_only": True,
        "omitted_curved_polylines": 0,
        "limit_reached": False,
        "primitive_limit": MAX_CAD_PRIMITIVES,
        "traversal_limit_reached": False,
        "depth_limit_reached": False,
        "omitted_nonempty_layouts": 0,
        "import_limits": budget.limits(),
    }


def dxf_primitives(model):
    """Return supported native-coordinate geometry without unit inference."""
    return extract_dxf_primitives(model)[0]


def drawing_view(items, bounds=None, invert_y=False, source_labels=None):
    """Produce display coordinates, including text and compound hatch rings."""
    def item_coordinates(item):
        yield from item.get("points", [])
        for ring in item.get("rings", []):
            yield from ring
        if item.get("position"):
            px, py = item["position"]
            yield [px, py]
            # Text metrics vary with substitute fonts; this is a display extent,
            # never a derived architectural boundary or room measurement.
            height = item.get("height", 1)
            text_lines = item.get("text", "").splitlines() or [""]
            width = max((len(line) for line in text_lines), default=0) * 0.65
            alignment = item.get("alignment", "left")
            left = -width / 2 if alignment == "center" else -width if alignment == "right" else 0
            vertical = item.get("vertical_alignment", "baseline")
            top = 0 if vertical == "top" else -len(text_lines) * 0.6 if vertical == "middle" else -len(text_lines) * 1.2
            transform = item.get("text_transform", [height, 0, 0, -height])
            a, b, c, d = transform
            for x, y in ((left, top), (left + width, top), (left + width, top + len(text_lines) * 1.2), (left, top + len(text_lines) * 1.2)):
                yield [px + a * x + c * y, py + b * x + d * y]

    if bounds is None:
        xmin = ymin = math.inf
        xmax = ymax = -math.inf
        for item in items:
            for x, y in item_coordinates(item):
                xmin, ymin = min(xmin, x), min(ymin, y)
                xmax, ymax = max(xmax, x), max(ymax, y)
        if xmin == math.inf:
            return {"elements": [], "source_labels": [], "bounds": None,
                    "units_verified": False, "measurements_available": False}
    else:
        xmin, ymin, xmax, ymax = bounds
    if xmax < xmin or ymax < ymin:
        return {"elements": [], "source_labels": [], "bounds": None,
                "units_verified": False, "measurements_available": False}
    span = max(xmax - xmin, ymax - ymin)
    pad = max(span * 0.05, 1.0)
    if xmax == xmin:
        xmin -= pad
        xmax += pad
    if ymax == ymin:
        ymin -= pad
        ymax += pad

    def display(point):
        return [point[0], ymin + ymax - point[1] if invert_y else point[1]]

    normalized = []
    for item in items:
        transformed = dict(item)
        transformed["points"] = [display(p) for p in item.get("points", [])]
        if "rings" in item:
            transformed["rings"] = [[display(p) for p in ring] for ring in item["rings"]]
        if "position" in item:
            transformed["position"] = display(item["position"])
        if invert_y and "rotation" in item:
            transformed["rotation"] = -item["rotation"]
        if invert_y and "text_transform" in item:
            a, b, c, d = item["text_transform"]
            transformed["text_transform"] = [a, -b, c, -d]
        normalized.append(transformed)
    return {
        "elements": normalized,
        "source_labels": [{**label, "position": display(label["position"])} for label in source_labels or []],
        "bounds": [xmin, ymin, xmax, ymax],
        "units_verified": False,
        "measurements_available": False,
    }
