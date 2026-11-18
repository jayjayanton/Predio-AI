"""Bounded geometric studies of a user-selected ground footprint.

Local coordinates are metres, X east and Y north, with the drawing's chosen
anchor at (0, 0). Placement rotates clockwise, then locates that anchor in a
local WGS84 azimuthal-equidistant projection. Nothing here georeferences the
source CAD, verifies a survey, or authorizes construction.

Municipal context: https://habitat.quito.gob.ec/wp-content/uploads/2025/07/MANUAL-PUGS.pdf
The IRM supplies property-specific parameters and restrictions; satisfying a
subset of numerical comparisons is not a building-permit decision.
"""
from __future__ import annotations

import math
from threading import BoundedSemaphore
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, model_validator
from pyproj import CRS, Transformer
from shapely.errors import GEOSException
from shapely.affinity import rotate
from shapely.geometry import LineString, Polygon, mapping, shape
from shapely.geometry.polygon import orient
from shapely.ops import transform, unary_union
from shapely.validation import explain_validity

MAX_REQUEST_BYTES = 1_000_000
MAX_TOTAL_VERTICES = 10_000
MAX_SHAPES = 100
MAX_LOCAL_COORDINATE = 10_000
MAX_PARCEL_RADIUS = 25_000
SETBACK_TOLERANCE_M = 1e-6
MAX_LIVE_SETBACK_COMPARISONS = 20_000
MAX_ENVELOPE_EDGES = 512
MAX_ENVELOPE_BUFFER_VERTICES = 65_536
MAX_ENVELOPE_OUTPUT_VERTICES = 20_000
ENVELOPE_CURVE_ERROR_M = 0.005
_ASSESSMENT_SLOTS = BoundedSemaphore(2)


class PlanningBusyError(ValueError):
    pass


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


class PolygonInput(StrictModel):
    type: Literal["Polygon", "MultiPolygon"]
    coordinates: list[Any] = Field(min_length=1, max_length=64)


class ShapeInput(StrictModel):
    id: str = Field(min_length=1, max_length=100)
    label: str = Field(default="", max_length=120)
    role: Literal["furniture", "extension"]
    geometry: PolygonInput


class PlacementInput(StrictModel):
    latitude: float = Field(ge=-85, le=85)
    longitude: float = Field(ge=-180, le=180)
    rotation_degrees: float = Field(default=0, ge=-360, le=360)
    confirmed: StrictBool = False


class ConstraintsInput(StrictModel):
    area_terreno: float | None = Field(default=None, gt=0, le=100_000_000)
    cos_pb: float | None = Field(default=None, ge=0, le=100)
    cos_total: float | None = Field(default=None, ge=0, le=10_000)
    retiro_frontal: float | None = Field(default=None, ge=0, le=1000)
    retiro_lateral: float | None = Field(default=None, ge=0, le=1000)
    retiro_posterior: float | None = Field(default=None, ge=0, le=1000)
    altura: float | None = Field(default=None, ge=0, le=1000)
    pisos: int | None = Field(default=None, ge=0, le=200)


class IrmInput(StrictModel):
    provided: StrictBool = False
    reviewed: StrictBool = False
    association_confirmed: StrictBool = False
    selected_predio: str | None = Field(default=None, pattern=r"^\d{1,25}$")
    irm_predio: str | None = Field(default=None, pattern=r"^\d{1,25}$")
    drawing_predio: str | None = Field(default=None, pattern=r"^\d{1,25}$")
    property_regime: Literal["individual", "horizontal", "unknown"] = "unknown"
    single_zone_confirmed: StrictBool = False
    restrictions_reviewed: StrictBool = False
    has_special_restrictions: StrictBool | None = None
    source_label: str = Field(default="", max_length=200)
    evidence_flags: list[Literal["horizontal_property", "multiple_parameter_sets", "special_restrictions"]] = Field(default_factory=list, max_length=3)
    constraints: ConstraintsInput = Field(default_factory=ConstraintsInput)


class ProposalInput(StrictModel):
    ground_floor_confirmed: StrictBool = False
    existing_footprint_complete: StrictBool = False
    footprint_is_counted_area: StrictBool = False
    ground_floor_counted_area_m2: float | None = Field(default=None, ge=0, le=100_000_000)
    height_m: float | None = Field(default=None, gt=0, le=1000)
    floors: int | None = Field(default=None, ge=1, le=200)
    total_floor_area_m2: float | None = Field(default=None, gt=0, le=100_000_000)


class EdgeInput(StrictModel):
    polygon: int = Field(default=0, ge=0, le=63)
    ring: Literal[0] = 0
    edge: int = Field(ge=0, le=MAX_TOTAL_VERTICES)
    kind: Literal["front", "side", "rear"]


class PlanningRequest(StrictModel):
    footprint: PolygonInput
    shapes: list[ShapeInput] = Field(default_factory=list, max_length=MAX_SHAPES)
    parcel: PolygonInput | None = None
    placement: PlacementInput | None = None
    irm: IrmInput | None = None
    proposal: ProposalInput = Field(default_factory=ProposalInput)
    edges: list[EdgeInput] = Field(default_factory=list, max_length=MAX_TOTAL_VERTICES)

    @model_validator(mode="after")
    def unique_items(self):
        ids = [item.id for item in self.shapes]
        if len(ids) != len(set(ids)):
            raise ValueError("Cada figura debe tener un identificador único.")
        edges = [(edge.polygon, edge.ring, edge.edge) for edge in self.edges]
        if len(edges) != len(set(edges)):
            raise ValueError("Cada borde del predio puede tener una sola clasificación.")
        if self.edges and self.parcel is None:
            raise ValueError("Adjunta el polígono del predio para clasificar sus bordes.")
        return self


def _geometry(value: PolygonInput, *, geographic: bool, budget: list[int]):
    """Validate raw positions before constructing GEOS objects; never repair them."""
    polygons = [value.coordinates] if value.type == "Polygon" else value.coordinates
    if len(polygons) > 64:
        raise ValueError("El polígono contiene demasiadas partes.")
    for rings in polygons:
        if not isinstance(rings, list) or not 1 <= len(rings) <= 64:
            raise ValueError("Cada polígono necesita un exterior y hasta 63 huecos.")
        for ring in rings:
            if not isinstance(ring, list) or not 4 <= len(ring) <= MAX_TOTAL_VERTICES:
                raise ValueError("Cada contorno debe ser cerrado y tener al menos tres vértices distintos.")
            budget[0] += len(ring)
            if budget[0] > MAX_TOTAL_VERTICES:
                raise ValueError("El estudio supera 10.000 vértices. Simplifica la geometría en el archivo de origen.")
            for point in ring:
                if not isinstance(point, list) or len(point) != 2:
                    raise ValueError("Se requieren posiciones [X, Y] de dos dimensiones.")
                if any(isinstance(n, bool) or not isinstance(n, (int, float)) or not math.isfinite(n) for n in point):
                    raise ValueError("Las posiciones deben contener números finitos.")
                x, y = point
                if geographic and not (-180 <= x <= 180 and -85 <= y <= 85):
                    raise ValueError("El predio requiere longitud/latitud WGS84 válidas; no coordenadas proyectadas.")
                if not geographic and max(abs(x), abs(y)) > MAX_LOCAL_COORDINATE:
                    raise ValueError("La huella y las figuras deben estar en metros, dentro de 10 km del origen local.")
            if ring[0] != ring[-1]:
                raise ValueError("El contorno no está cerrado; se debe repetir su primer vértice al final.")
            if any(a == b for a, b in zip(ring, ring[1:])):
                raise ValueError("El contorno contiene segmentos de longitud cero.")
    geometry = shape(value.model_dump())
    if geometry.is_empty or not geometry.is_valid or geometry.area <= 0:
        raise ValueError("Polígono no válido; revisa cruces y huecos: " + explain_validity(geometry))
    if not geographic and geometry.area > 100_000_000:
        raise ValueError("La superficie supera el alcance de este estudio local.")
    return geometry


def _rounded(value):
    return None if value is None else round(float(value), 6)


def _check(check_id, status, title, message, actual=None, limit=None, unit=None):
    return {"id": check_id, "status": status, "title": title, "message": message,
            "actual": _rounded(actual), "limit": _rounded(limit), "unit": unit}


def _oriented(geometry):
    if geometry.geom_type == "Polygon":
        return orient(geometry, sign=1)
    from shapely.geometry import MultiPolygon
    return MultiPolygon([orient(part, sign=1) for part in geometry.geoms])


def _projection(placement):
    crs = CRS.from_proj4(
        f"+proj=aeqd +lat_0={placement.latitude} +lon_0={placement.longitude} "
        "+datum=WGS84 +units=m +no_defs"
    )
    forward = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    inverse = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    return forward, inverse


def _feature(geometry, inverse, role, identifier, label, placement):
    geographic = transform(lambda x, y, z=None: inverse.transform(x, y, errcheck=True), geometry)
    # This local study never straddles the antimeridian; reject rather than emit
    # a polygon whose GeoJSON edges would misleadingly span the world.
    if geographic.bounds[2] - geographic.bounds[0] > 180:
        raise ValueError("La implantación cruza el antimeridiano; este estudio local no admite ese caso.")
    return {"type": "Feature", "geometry": mapping(_oriented(geographic)),
            "properties": {"id": identifier, "label": label, "role": role,
                           "placement_method": "user_positioned", "verified": False,
                           "placement_confirmed_by_user": placement.confirmed}}


def assess_planning(request: PlanningRequest | dict) -> dict:
    if isinstance(request, dict):
        request = PlanningRequest.model_validate(request)
    if not _ASSESSMENT_SLOTS.acquire(blocking=False):
        raise PlanningBusyError("Hay otro estudio geométrico en proceso. Vuelve a intentarlo en un momento.")
    try:
        return _assess(request)
    finally:
        _ASSESSMENT_SLOTS.release()


def _assess(request: PlanningRequest) -> dict:
    budget = [0]
    existing = _geometry(request.footprint, geographic=False, budget=budget)
    shapes = [(item, _geometry(item.geometry, geographic=False, budget=budget)) for item in request.shapes]
    parcel = _geometry(request.parcel, geographic=True, budget=budget) if request.parcel else None
    extensions = [geometry for item, geometry in shapes if item.role == "extension"]
    combined = unary_union([existing, *extensions]) if extensions else existing
    added = max(0, combined.area - existing.area)
    metrics = {"existing_footprint_m2": _rounded(existing.area), "extension_added_m2": _rounded(added),
               "combined_footprint_m2": _rounded(combined.area), "parcel_geometry_m2": None,
               "geometric_coverage_percent": None, "counted_ground_area_m2": None,
               "coverage_percent": None, "max_footprint_m2": None, "max_counted_ground_area_m2": None,
               "outside_parcel_m2": None}
    warnings = [
        "Estudio geométrico preliminar con escala, huella e implantación declaradas por el usuario; no es una georreferenciación ni un levantamiento verificado.",
        "Las figuras de mobiliario no incrementan la ocupación. Las ampliaciones se unen a la huella sin contar solapes dos veces.",
        "Una huella geométrica no determina por sí sola el área computable municipal. El IRM y estos cálculos no autorizan obras.",
    ]
    checks = []
    irm = request.irm or IrmInput()
    proposal = request.proposal
    constraints = irm.constraints
    if (proposal.footprint_is_counted_area and proposal.ground_floor_counted_area_m2 is not None and
            not math.isclose(proposal.ground_floor_counted_area_m2, combined.area, rel_tol=1e-9, abs_tol=1e-6)):
        raise ValueError("Elige el área computable revisada o confirma que coincide con la huella; las dos referencias aportadas difieren.")
    counted_ground_area = combined.area if proposal.footprint_is_counted_area else proposal.ground_floor_counted_area_m2
    metrics["counted_ground_area_m2"] = _rounded(counted_ground_area)
    identities = {value.lstrip("0") or "0" for value in [irm.selected_predio, irm.irm_predio, irm.drawing_predio] if value}
    mismatch = len(identities) > 1
    identity_ready = bool(irm.provided and irm.reviewed and irm.association_confirmed and
                          irm.selected_predio and irm.irm_predio and not mismatch)
    checks.append(_check("identity", "conflict" if mismatch else "within_reviewed_limits" if identity_ready else "pending",
        "Correspondencia documental", "Los números de predio aportados no coinciden. Corrige la asociación antes de comparar parámetros."
        if mismatch else "Correspondencia declarada por el usuario y números aportados coincidentes; sigue sin verificación municipal."
        if identity_ready else "Se requiere un IRM revisado, el número de predio en ambos registros y confirmación de que el plano corresponde al mismo predio."))
    scope_reasons = []
    flags = set(irm.evidence_flags)
    if irm.property_regime != "individual" or "horizontal_property" in flags:
        scope_reasons.append("revisar la propiedad horizontal o confirmar que se trata del lote completo")
    if not irm.single_zone_confirmed or "multiple_parameter_sets" in flags:
        scope_reasons.append("resolver la zonificación y los juegos de parámetros aplicables")
    if not irm.restrictions_reviewed or irm.has_special_restrictions is not False or "special_restrictions" in flags:
        scope_reasons.append("revisar afectaciones, protecciones y condiciones especiales")
    if not proposal.ground_floor_confirmed or not proposal.existing_footprint_complete:
        scope_reasons.append("confirmar la planta baja y toda la ocupación existente del terreno")
    scope_ready = identity_ready and not scope_reasons
    checks.append(_check("scope", "within_reviewed_limits" if scope_ready else "pending", "Alcance de la revisión",
        "Alcance declarado como lote individual, una asignación normativa y sin condiciones especiales pendientes."
        if scope_ready else "Antes de interpretar los límites: " + "; ".join(scope_reasons or ["confirmar la correspondencia documental"]) + "."))

    placed = None
    local_parcel = None
    rotated_combined = combined
    placement = request.placement
    inverse = None
    placement_ready = bool(placement and placement.confirmed and parcel is not None)
    if placement:
        forward, inverse = _projection(placement)
        rotated_existing = rotate(existing, -placement.rotation_degrees, origin=(0, 0))
        rotated_combined = rotate(combined, -placement.rotation_degrees, origin=(0, 0))
        placed_features = [_feature(rotated_existing, inverse, "existing", "existing-footprint", "Huella extraída", placement)]
        for item, geometry in shapes:
            placed_features.append(_feature(rotate(geometry, -placement.rotation_degrees, origin=(0, 0)), inverse,
                                            item.role, item.id, item.label, placement))
        placed_features.append(_feature(rotated_combined, inverse, "combined", "combined-footprint", "Huella con ampliaciones", placement))
        placed = {"type": "FeatureCollection", "features": placed_features,
                  "placement": placement.model_dump(), "verified": False,
                  "coordinate_reference": "EPSG:4326", "source_space": "local_metres"}
        if parcel is not None:
            local_parcel = transform(lambda x, y, z=None: forward.transform(x, y, errcheck=True), parcel)
            if (local_parcel.is_empty or not local_parcel.is_valid or
                    not all(math.isfinite(n) for n in local_parcel.bounds) or
                    max(abs(n) for n in local_parcel.bounds) > MAX_PARCEL_RADIUS):
                raise ValueError("La implantación debe quedar a menos de 25 km de todo el predio; revisa el anclaje y las coordenadas.")
            metrics["parcel_geometry_m2"] = _rounded(local_parcel.area)
            metrics["outside_parcel_m2"] = _rounded(rotated_combined.difference(local_parcel).area)
    elif parcel is not None:
        # Geometry-only area is useful before placement. Use a local projection
        # centered on the parcel, not degrees squared or Web Mercator area.
        center = parcel.representative_point()
        area_origin = PlacementInput(latitude=center.y, longitude=center.x)
        forward, _ = _projection(area_origin)
        area_parcel = transform(lambda x, y, z=None: forward.transform(x, y, errcheck=True), parcel)
        if max(abs(n) for n in area_parcel.bounds) > MAX_PARCEL_RADIUS:
            raise ValueError("El predio supera el alcance espacial de este estudio local.")
        metrics["parcel_geometry_m2"] = _rounded(area_parcel.area)
    checks.append(_check("placement", "within_reviewed_limits" if placement_ready else "pending", "Implantación en el predio",
        "Posición y orientación confirmadas por el usuario; no equivalen a una georreferenciación topográfica."
        if placement_ready else "Vincula un polígono de predio y confirma el anclaje y la orientación de la huella."))
    outside = metrics["outside_parcel_m2"]
    containment_status = "pending" if not placement_ready else "conflict" if outside > 0.000001 else "within_reviewed_limits"
    checks.append(_check("containment", containment_status, "Huella dentro del predio",
        "Parte de la huella propuesta queda fuera del polígono aportado o invade uno de sus huecos."
        if containment_status == "conflict" else "La huella propuesta queda dentro del polígono aportado para esta implantación."
        if containment_status == "within_reviewed_limits" else "La comparación requiere la implantación confirmada; la vista de mapa sigue siendo un borrador.",
        outside, 0, "m² fuera"))

    regulation_ready = scope_ready and placement_ready
    area_consistency_ready = True
    if constraints.area_terreno is not None and scope_ready:
        metrics["geometric_coverage_percent"] = _rounded(100 * combined.area / constraints.area_terreno)
        if counted_ground_area is not None:
            metrics["coverage_percent"] = _rounded(100 * counted_ground_area / constraints.area_terreno)
        if constraints.cos_pb is not None:
            metrics["max_footprint_m2"] = _rounded(constraints.area_terreno * constraints.cos_pb / 100)
            metrics["max_counted_ground_area_m2"] = metrics["max_footprint_m2"]
        if metrics["parcel_geometry_m2"] is not None and abs(metrics["parcel_geometry_m2"] - constraints.area_terreno) / constraints.area_terreno > 0.05:
            warnings.append("El área del polígono y el área de terreno revisada difieren más del 5 %. Contrasta el lote, el documento y sus bases de área.")
            regulation_ready = False
            area_consistency_ready = False
            checks.append(_check("area_consistency", "pending", "Base de área del terreno", "Las áreas gráfica y documental difieren más del 5 %; la comparación normativa permanece pendiente.", metrics["parcel_geometry_m2"], constraints.area_terreno, "m²"))
    coverage_ready = regulation_ready and metrics["coverage_percent"] is not None and constraints.cos_pb is not None
    checks.append(_check("coverage", "pending" if not coverage_ready else "conflict" if metrics["coverage_percent"] > constraints.cos_pb + 1e-6 else "within_reviewed_limits",
        "Ocupación en planta baja · COS PB",
        "Comparación del área útil/computable final declarada de planta baja con el área del lote y COS PB revisados."
        if coverage_ready else "Requiere área útil/computable final de planta baja revisada (o confirmación explícita de que equivale a la huella), área del lote, COS PB e IRM asociado, con alcance e implantación confirmados.",
        metrics["coverage_percent"], constraints.cos_pb, "%"))

    setback_edges = _setbacks(request, parcel, local_parcel, rotated_combined,
                             regulation_ready and containment_status == "within_reviewed_limits")
    setbacks_complete = bool(parcel is not None and local_parcel is not None and request.edges)
    if parcel is not None:
        parts = [parcel] if parcel.geom_type == "Polygon" else list(parcel.geoms)
        expected = {(i, 0, edge) for i, part in enumerate(parts) for edge in range(len(part.exterior.coords) - 1)}
        provided = {(edge.polygon, edge.ring, edge.edge) for edge in request.edges}
        setbacks_complete = setbacks_complete and expected == provided and all(not part.interiors for part in parts)
    setback_status = "pending"
    if any(edge["status"] == "conflict" for edge in setback_edges):
        setback_status = "conflict"
    elif setbacks_complete and all(edge["status"] == "within_reviewed_limits" for edge in setback_edges):
        setback_status = "within_reviewed_limits"
    checks.append(_check("setbacks", setback_status, "Retiros por lindero",
        "Se detecta una distancia inferior al retiro revisado en al menos un borde clasificado."
        if setback_status == "conflict" else "Las distancias a todos los bordes clasificados alcanzan los retiros revisados."
        if setback_status == "within_reviewed_limits" else "Clasifica todos los bordes exteriores como frente, lateral o posterior y revisa sus retiros. Huecos, afectaciones y bordes especiales requieren revisión adicional."))
    pending_reasons = [reason for reason, ready in (
        ("identity", identity_ready), ("scope", scope_ready),
        ("placement", placement_ready), ("area_consistency", area_consistency_ready),
    ) if not ready]
    setback_context = _live_setback_context(request, parcel, local_parcel, regulation_ready, pending_reasons)
    buildable_envelope = _buildable_envelope(setback_context, placement, inverse)
    shape_checks = _shape_setback_checks(existing, shapes, setback_context)
    if placed is not None:
        shape_statuses = {(item["role"], item["id"]): item["status"] for item in shape_checks}
        for feature in placed["features"]:
            properties = feature["properties"]
            status = shape_statuses.get((properties["role"], properties["id"]))
            if status is not None:
                properties["setback_status"] = status
    for check_id, title, actual, limit, unit in (
        ("height", "Altura máxima", proposal.height_m, constraints.altura, "m"),
        ("floors", "Número de pisos", proposal.floors, constraints.pisos, "pisos"),
        ("total_coverage", "Ocupación total · COS total", 100 * proposal.total_floor_area_m2 / constraints.area_terreno
         if proposal.total_floor_area_m2 is not None and constraints.area_terreno is not None else None,
         constraints.cos_total, "%"),
    ):
        ready = regulation_ready and actual is not None and limit is not None
        if check_id == "total_coverage" and proposal.total_floor_area_m2 is not None and counted_ground_area is not None and proposal.total_floor_area_m2 + 1e-6 < counted_ground_area:
            ready = False
            warnings.append("El área total computable declarada es menor que el área computable de planta baja; revisa las superficies antes de interpretar COS total.")
        checks.append(_check(check_id, "pending" if not ready else "conflict" if actual > limit + 1e-6 else "within_reviewed_limits", title,
            "Comparación de la condición final de toda la edificación con el límite revisado del IRM."
            if ready else "Faltan datos revisados del IRM o de la condición final de toda la edificación; no se infieren a partir de una planta.", actual, limit, unit))
    return {"status": "preliminary", "verified": False, "metrics": metrics, "checks": checks,
            "placed": placed, "setback_edges": setback_edges, "setback_context": setback_context,
            "shape_checks": shape_checks, "buildable_envelope": buildable_envelope, "warnings": warnings,
            "coordinate_convention": "Local metres: X east, Y north; clockwise rotation around (0,0).",
            "regulatory_approval": False}


def _setbacks(request, parcel, local_parcel, combined, ready):
    if parcel is None:
        return []
    parts = [parcel] if parcel.geom_type == "Polygon" else list(parcel.geoms)
    local_parts = ([local_parcel] if local_parcel.geom_type == "Polygon" else list(local_parcel.geoms)) if local_parcel is not None else None
    constraints = (request.irm or IrmInput()).constraints
    requirements = {"front": constraints.retiro_frontal, "side": constraints.retiro_lateral, "rear": constraints.retiro_posterior}
    output = []
    points_by_polygon = {}
    for edge in request.edges:
        if edge.polygon >= len(parts) or edge.edge >= len(parts[edge.polygon].exterior.coords) - 1:
            raise ValueError("La clasificación de lindero hace referencia a un borde que no existe en el predio.")
        required = requirements[edge.kind]
        actual = None
        if local_parts is not None:
            if edge.polygon not in points_by_polygon:
                points_by_polygon[edge.polygon] = list(local_parts[edge.polygon].exterior.coords)
            points = points_by_polygon[edge.polygon]
            actual = combined.distance(LineString([points[edge.edge], points[edge.edge + 1]]))
        status = "pending" if not ready or actual is None or required is None else "conflict" if actual + 1e-6 < required else "within_reviewed_limits"
        output.append({**edge.model_dump(), "required_m": required, "actual_m": _rounded(actual), "status": status})
    return output


def _live_setback_context(request, parcel, local_parcel, ready, pending_reasons):
    """Expose reviewed metric edges, independent of the changing proposal.

    The inverse rotation brings the projected parcel into the source snapshot's
    coordinate space. Preserve ring ordering so edge identities still refer to
    the same parcel segments. Geometry is deliberately unavailable when its
    documentary, scope or placement prerequisites have not been reviewed.
    """
    reasons = list(pending_reasons)
    parts = [] if parcel is None else [parcel] if parcel.geom_type == "Polygon" else list(parcel.geoms)
    expected = {(i, 0, edge) for i, part in enumerate(parts) for edge in range(len(part.exterior.coords) - 1)}
    provided = {(edge.polygon, edge.ring, edge.edge) for edge in request.edges}
    all_classified = bool(expected) and expected == provided
    no_holes = all(not part.interiors for part in parts)
    constraints = (request.irm or IrmInput()).constraints
    requirements = {"front": constraints.retiro_frontal, "side": constraints.retiro_lateral,
                    "rear": constraints.retiro_posterior}
    known_limits = [requirements[edge.kind] is not None for edge in request.edges]
    if not all_classified:
        reasons.append("unclassified_edges")
    if known_limits and not all(known_limits):
        reasons.append("missing_limits")
    if not no_holes:
        reasons.append("parcel_holes")
    usable = bool(ready and local_parcel is not None and any(known_limits))
    local_geometry = None
    edges = []
    if usable:
        local_geometry = rotate(local_parcel, request.placement.rotation_degrees, origin=(0, 0))
        local_parts = [local_geometry] if local_geometry.geom_type == "Polygon" else list(local_geometry.geoms)
        points_by_polygon = {}
        for edge in request.edges:
            if edge.polygon not in points_by_polygon:
                points_by_polygon[edge.polygon] = list(local_parts[edge.polygon].exterior.coords)
            points = points_by_polygon[edge.polygon]
            edges.append({**edge.model_dump(), "required_m": requirements[edge.kind],
                          "points": [list(points[edge.edge]), list(points[edge.edge + 1])]})
    return {"version": 1, "coordinate_space": "local_metres", "tolerance_m": SETBACK_TOLERANCE_M,
            "ready": usable, "complete": bool(usable and all_classified and no_holes and all(known_limits)),
            "parcel": mapping(local_geometry) if local_geometry is not None else None,
            "edges": edges, "pending_reasons": reasons}


def _round_buffer_segments(radius):
    # A circumscribed arc stays outside the true required-distance buffer.
    # Its maximum radial excess is r * (sec(pi / (4q)) - 1).
    return max(8, math.ceil(math.pi / (4 * math.acos(radius / (radius + ENVELOPE_CURVE_ERROR_M)))))


def _conservative_edge_buffer(points, radius, quadrants):
    """Round-capped metric buffer with exact straight offsets and outward arcs.

    GEOS's usual inscribed circular approximation can leave tiny green wedges
    that are actually inside a setback. Circumscribed cap segments avoid that;
    straight portions remain at the exact required distance, including the
    familiar rectangular-lot case. Only this display polygon is approximate.
    """
    a, b = points
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dy)
    if not length:
        raise ValueError("Un lindero proyectado tiene longitud cero.")
    tx, ty = dx / length, dy / length
    step = math.pi / (2 * quadrants)
    outer_radius = radius / math.cos(step / 2)
    vertices = []
    for center, start in ((b, -math.pi / 2), (a, math.pi / 2)):
        for index in range(2 * quadrants):
            angle = start + (index + 0.5) * step
            along, across = outer_radius * math.cos(angle), outer_radius * math.sin(angle)
            vertices.append((center[0] + tx * along - ty * across,
                             center[1] + ty * along + tx * across))
    return Polygon(vertices), outer_radius - radius


def _buildable_envelope(context, placement, inverse):
    """Display the complete reviewed setback area without changing exact checks.

    The parcel is clipped against each finite, classified boundary segment in
    local metres. No axis-aligned rectangle, map pixels, unreviewed PDF number,
    or COS percentage supplies a boundary. The result is preliminary and does
    not represent other restrictions or permission to build.
    """
    output = {"status": "pending", "local_geometry": None, "geometry": None,
              "area_m2": None, "pending_reasons": list(context["pending_reasons"]),
              "source": "reviewed_irm_setbacks", "method": "parcel_minus_reviewed_edge_buffers",
              "local_coordinate_space": "local_metres", "coordinate_reference": "EPSG:4326",
              "approximate": True, "visual_only": True, "maximum_curve_error_m": None,
              "verified": False, "regulatory_approval": False}
    if not context["complete"] or placement is None or inverse is None:
        if not output["pending_reasons"]:
            output["pending_reasons"] = ["review_required"]
        return output
    edges = context["edges"]
    specifications = [(edge, _round_buffer_segments(edge["required_m"]))
                      for edge in edges if edge["required_m"] > 0]
    if (len(edges) > MAX_ENVELOPE_EDGES or
            sum(4 * count + 1 for _, count in specifications) > MAX_ENVELOPE_BUFFER_VERTICES):
        return {**output, "pending_reasons": ["envelope_complexity"]}
    try:
        parcel = shape(context["parcel"])
        buffers = [_conservative_edge_buffer(edge["points"], edge["required_m"], count)
                   for edge, count in specifications]
        envelope = parcel.difference(unary_union([item[0] for item in buffers])) if buffers else parcel
        curve_error = max((item[1] for item in buffers), default=0)
        if envelope.is_empty or envelope.area <= 1e-6:
            return {**output, "status": "empty", "area_m2": 0.0, "pending_reasons": [],
                    "maximum_curve_error_m": curve_error}
        if envelope.geom_type not in {"Polygon", "MultiPolygon"} or not envelope.is_valid:
            return {**output, "pending_reasons": ["envelope_geometry"]}
        parts = [envelope] if envelope.geom_type == "Polygon" else list(envelope.geoms)
        vertex_count = sum(len(part.exterior.coords) + sum(len(ring.coords) for ring in part.interiors)
                           for part in parts)
        if vertex_count > MAX_ENVELOPE_OUTPUT_VERTICES:
            return {**output, "pending_reasons": ["envelope_complexity"]}
        geographic = _feature(rotate(envelope, -placement.rotation_degrees, origin=(0, 0)),
                              inverse, "setback_envelope", "setback-envelope",
                              "Área dentro de los retiros revisados", placement)["geometry"]
        return {**output, "status": "ready", "local_geometry": mapping(envelope),
                "geometry": geographic, "area_m2": _rounded(envelope.area),
                "pending_reasons": [], "maximum_curve_error_m": curve_error}
    except (GEOSException, ValueError):
        # A display failure must not discard the independent distance checks.
        return {**output, "pending_reasons": ["envelope_geometry"]}


def _shape_setback_checks(existing, shapes, context):
    """Keep an existing conflict separate from every proposed extension."""
    candidates = [("existing-footprint", "existing", "Huella extraída", existing)]
    candidates.extend((item.id, item.role, item.label, geometry) for item, geometry in shapes if item.role == "extension")
    # Bound the multiplicative response size, not just the input vertex count.
    # This affects batch feedback only: the reusable reviewed context remains
    # independent of how many proposal figures are currently on the drawing.
    if len(candidates) * len(context["edges"]) > MAX_LIVE_SETBACK_COMPARISONS:
        context = {**context, "ready": False, "complete": False, "parcel": None, "edges": [],
                   "pending_reasons": [*context["pending_reasons"], "complexity"]}
    parcel = shape(context["parcel"]) if context["ready"] else None
    boundaries = [(edge, LineString(edge["points"])) for edge in context["edges"]]
    results = []
    for identifier, role, label, geometry in candidates:
        outside = geometry.difference(parcel).area if parcel is not None else None
        containment_status = ("pending" if outside is None else "conflict" if outside > 1e-6
                              else "within_reviewed_limits")
        edge_checks = []
        for edge, line in boundaries:
            actual = geometry.distance(line)
            required = edge["required_m"]
            status = ("pending" if required is None else "conflict" if actual + SETBACK_TOLERANCE_M < required
                      else "at_limit" if abs(actual - required) <= SETBACK_TOLERANCE_M else "within_reviewed_limits")
            edge_checks.append({key: edge[key] for key in ("polygon", "ring", "edge", "kind", "required_m")} |
                               {"actual_m": _rounded(actual), "shortfall_m": None if required is None else _rounded(max(0, required - actual)),
                                "status": status})
        status = ("conflict" if containment_status == "conflict" or any(edge["status"] == "conflict" for edge in edge_checks)
                  else "pending" if not context["complete"]
                  else "at_limit" if any(edge["status"] == "at_limit" for edge in edge_checks)
                  else "within_reviewed_limits")
        results.append({"id": identifier, "role": role, "label": label, "status": status,
                        "outside_parcel_m2": _rounded(outside), "containment_status": containment_status,
                        "setback_edges": edge_checks, "complete": context["complete"],
                        "pending_reasons": list(context["pending_reasons"])})
    return results
