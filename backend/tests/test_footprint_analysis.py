"""Scientific and boundary tests for the preliminary geometry study."""
import asyncio
import copy
import json

import httpx
import pytest
from pydantic import ValidationError
from pyproj import CRS, Transformer
from shapely.geometry import shape

from app.footprint_analysis import assess_planning, PlanningRequest, MAX_REQUEST_BYTES
from app.main import app


def polygon(x0=-5, y0=-5, x1=5, y1=5, holes=()):
    return {"type": "Polygon", "coordinates": [
        [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]], *holes]}


def geographic(local):
    projection = CRS.from_proj4("+proj=aeqd +lat_0=-0.2 +lon_0=-78.5 +datum=WGS84 +units=m +no_defs")
    inverse = Transformer.from_crs(projection, "EPSG:4326", always_xy=True)
    return {"type": local["type"], "coordinates": [
        [list(inverse.transform(x, y)) for x, y in ring] for ring in local["coordinates"]]}


def check(result, name):
    return next(item for item in result["checks"] if item["id"] == name)


def reviewed_request():
    return {"footprint": polygon(), "parcel": geographic(polygon(-10, -10, 10, 10)),
        "placement": {"latitude": -0.2, "longitude": -78.5, "rotation_degrees": 0, "confirmed": True},
        "irm": {"provided": True, "reviewed": True, "association_confirmed": True,
            "selected_predio": "12345", "irm_predio": "12345", "source_label": "IRM ficticio, p. 2",
            "property_regime": "individual", "single_zone_confirmed": True,
            "restrictions_reviewed": True, "has_special_restrictions": False,
            "constraints": {"area_terreno": 400, "cos_pb": 30, "cos_total": 80,
                "retiro_frontal": 5, "retiro_lateral": 3, "retiro_posterior": 3, "altura": 9, "pisos": 3}},
        "proposal": {"ground_floor_confirmed": True, "existing_footprint_complete": True,
            "footprint_is_counted_area": True,
            "height_m": 6, "floors": 2, "total_floor_area_m2": 200},
        "edges": [{"polygon": 0, "ring": 0, "edge": i, "kind": "front" if i == 0 else "rear" if i == 2 else "side"} for i in range(4)]}


def test_standalone_geometry_requires_no_irm_or_predio():
    result = assess_planning({"footprint": polygon()})
    assert result["metrics"]["existing_footprint_m2"] == 100
    assert result["metrics"]["combined_footprint_m2"] == 100
    assert result["metrics"]["coverage_percent"] is None
    assert result["placed"] is None
    assert all(item["status"] == "pending" for item in result["checks"])
    assert result["verified"] is False and result["regulatory_approval"] is False


def test_union_excludes_furniture_and_overlap_is_counted_once():
    result = assess_planning({"footprint": polygon(), "shapes": [
        {"id": "room", "label": "Ampliación", "role": "extension", "geometry": polygon(0, -5, 10, 5)},
        {"id": "duplicate", "role": "extension", "geometry": polygon(0, -5, 10, 5)},
        {"id": "table", "role": "furniture", "geometry": polygon(-20, -20, 20, 20)},
    ]})
    assert result["metrics"]["extension_added_m2"] == 50
    assert result["metrics"]["combined_footprint_m2"] == 150


def test_existing_holes_are_preserved_and_extension_can_fill_part():
    hole = [[-2, -2], [-2, 2], [2, 2], [2, -2], [-2, -2]]
    result = assess_planning({"footprint": polygon(holes=[hole]), "shapes": [
        {"id": "fill", "role": "extension", "geometry": polygon(-2, -2, 0, 2)}]})
    assert result["metrics"]["existing_footprint_m2"] == 84
    assert result["metrics"]["extension_added_m2"] == 8
    assert result["metrics"]["combined_footprint_m2"] == 92


def test_reviewed_checks_use_real_area_setbacks_and_complete_building_parameters():
    result = assess_planning(reviewed_request())
    assert result["status"] == "preliminary"
    assert result["regulatory_approval"] is False
    assert result["metrics"]["coverage_percent"] == 25
    assert result["metrics"]["max_footprint_m2"] == 120
    assert all(item["status"] == "within_reviewed_limits" for item in result["checks"])
    assert len(result["setback_edges"]) == 4
    assert all(item["actual_m"] == pytest.approx(5, abs=1e-5) for item in result["setback_edges"])
    assert {f["properties"]["role"] for f in result["placed"]["features"]} == {"existing", "combined"}


def test_clockwise_rotation_preserves_dimensions_and_geographic_axis_order():
    request = reviewed_request()
    request["footprint"] = polygon(0, 0, 2, 10)
    request["placement"]["rotation_degrees"] = 90
    result = assess_planning(request)
    feature = result["placed"]["features"][0]
    ring = feature["geometry"]["coordinates"][0]
    # Original positive Y/north axis points east after clockwise 90 degrees.
    assert ring[3][0] > -78.5
    assert ring[3][1] == pytest.approx(-0.2, abs=1e-7)
    assert shape(feature["geometry"]).exterior.is_ccw
    assert result["metrics"]["existing_footprint_m2"] == 20


def test_declared_area_discrepancy_blocks_regulatory_green():
    request = reviewed_request()
    request["irm"]["constraints"]["area_terreno"] = 1000
    result = assess_planning(request)
    assert check(result, "area_consistency")["status"] == "pending"
    assert check(result, "coverage")["status"] == "pending"
    assert check(result, "height")["status"] == "pending"


def test_zero_cos_is_a_real_limit_not_missing():
    request = reviewed_request()
    request["irm"]["constraints"]["cos_pb"] = 0
    result = assess_planning(request)
    assert check(result, "coverage")["status"] == "conflict"
    assert result["metrics"]["max_footprint_m2"] == 0


def test_height_floors_and_total_coverage_are_not_inferred_from_plan():
    request = reviewed_request()
    request["proposal"] = {"ground_floor_confirmed": True, "existing_footprint_complete": True, "footprint_is_counted_area": True}
    result = assess_planning(request)
    for key in ("height", "floors", "total_coverage"):
        assert check(result, key)["status"] == "pending"
    assert check(result, "coverage")["status"] == "within_reviewed_limits"


def test_gross_footprint_does_not_silently_become_counted_municipal_area():
    request = reviewed_request()
    request["proposal"]["footprint_is_counted_area"] = False
    result = assess_planning(request)
    assert result["metrics"]["geometric_coverage_percent"] == 25
    assert result["metrics"]["coverage_percent"] is None
    assert check(result, "coverage")["status"] == "pending"


def test_reviewed_counted_area_can_exclude_open_gross_footprint():
    request = reviewed_request()
    request["proposal"].update(footprint_is_counted_area=False, ground_floor_counted_area_m2=50, total_floor_area_m2=80)
    result = assess_planning(request)
    assert result["metrics"]["geometric_coverage_percent"] == 25
    assert result["metrics"]["coverage_percent"] == 12.5
    assert check(result, "coverage")["status"] == "within_reviewed_limits"
    assert check(result, "total_coverage")["status"] == "within_reviewed_limits"


def test_zero_reviewed_counted_area_remains_explicit_zero():
    request = reviewed_request()
    request["proposal"].update(footprint_is_counted_area=False, ground_floor_counted_area_m2=0)
    result = assess_planning(request)
    assert result["metrics"]["coverage_percent"] == 0
    assert check(result, "coverage")["status"] == "within_reviewed_limits"


def test_competing_counted_area_references_are_rejected():
    request = reviewed_request()
    request["proposal"]["ground_floor_counted_area_m2"] = 50
    with pytest.raises(ValueError, match="referencias"):
        assess_planning(request)


def test_total_counted_area_cannot_be_below_counted_ground_area():
    request = reviewed_request()
    request["proposal"]["total_floor_area_m2"] = 80
    result = assess_planning(request)
    assert check(result, "total_coverage")["status"] == "pending"


def test_individual_parameter_excesses_are_reported_without_approval():
    request = reviewed_request()
    request["proposal"].update(height_m=12, floors=4, total_floor_area_m2=400)
    request["irm"]["constraints"]["retiro_frontal"] = 6
    result = assess_planning(request)
    assert all(check(result, key)["status"] == "conflict" for key in ("height", "floors", "total_coverage", "setbacks"))
    assert result["regulatory_approval"] is False


@pytest.mark.parametrize("change", [
    {"reviewed": False}, {"association_confirmed": False}, {"irm_predio": None},
    {"selected_predio": None}, {"provided": False},
])
def test_missing_document_association_stays_pending(change):
    request = reviewed_request()
    request["irm"].update(change)
    result = assess_planning(request)
    assert check(result, "identity")["status"] == "pending"
    assert check(result, "coverage")["status"] == "pending"


def test_known_predio_mismatch_cannot_be_overridden_by_review_flags():
    request = reviewed_request()
    request["irm"]["drawing_predio"] = "98765"
    result = assess_planning(request)
    assert check(result, "identity")["status"] == "conflict"
    assert check(result, "coverage")["status"] == "pending"


@pytest.mark.parametrize("change", [
    {"property_regime": "horizontal"}, {"property_regime": "unknown"},
    {"single_zone_confirmed": False}, {"restrictions_reviewed": False},
    {"has_special_restrictions": True}, {"has_special_restrictions": None},
    {"evidence_flags": ["horizontal_property"]},
    {"evidence_flags": ["multiple_parameter_sets"]},
    {"evidence_flags": ["special_restrictions"]},
])
def test_unresolved_scope_cannot_be_overridden_by_manual_limits(change):
    request = reviewed_request()
    request["irm"].update(change)
    result = assess_planning(request)
    assert check(result, "scope")["status"] == "pending"
    assert check(result, "coverage")["status"] == "pending"


@pytest.mark.parametrize("field", ["ground_floor_confirmed", "existing_footprint_complete"])
def test_incomplete_ground_occupation_prevents_cos_comparison(field):
    request = reviewed_request()
    request["proposal"][field] = False
    result = assess_planning(request)
    assert check(result, "coverage")["status"] == "pending"


def test_preview_can_be_positioned_without_a_linked_predio():
    result = assess_planning({"footprint": polygon(), "placement": {
        "latitude": -0.2, "longitude": -78.5, "confirmed": True}})
    assert result["placed"]["features"]
    assert check(result, "containment")["status"] == "pending"


def test_placement_not_confirmed_never_passes_containment():
    request = reviewed_request()
    request["placement"]["confirmed"] = False
    result = assess_planning(request)
    assert result["metrics"]["outside_parcel_m2"] == 0
    assert check(result, "containment")["status"] == "pending"
    assert check(result, "coverage")["status"] == "pending"


def test_parcel_hole_is_outside_property_and_never_passes_setbacks():
    request = reviewed_request()
    request["parcel"] = geographic(polygon(-10, -10, 10, 10,
        holes=[[[-2, -2], [-2, 2], [2, 2], [2, -2], [-2, -2]]]))
    result = assess_planning(request)
    assert result["metrics"]["outside_parcel_m2"] == pytest.approx(16, abs=1e-5)
    assert check(result, "containment")["status"] == "conflict"
    assert check(result, "setbacks")["status"] == "pending"


def test_concave_parcel_does_not_use_only_bounding_box_containment():
    request = reviewed_request()
    request["parcel"] = geographic({"type": "Polygon", "coordinates": [[
        [-10, -10], [10, -10], [10, 10], [0, 10], [0, 0], [-10, 0], [-10, -10]]]})
    request["edges"] = []
    result = assess_planning(request)
    assert result["metrics"]["outside_parcel_m2"] == pytest.approx(25, abs=1e-5)
    assert check(result, "containment")["status"] == "conflict"


def test_unclassified_edges_never_produce_setback_pass():
    request = reviewed_request()
    request["edges"] = request["edges"][:1]
    result = assess_planning(request)
    assert check(result, "setbacks")["status"] == "pending"


def test_invalid_edge_identity_is_rejected():
    request = reviewed_request()
    request["edges"][0]["edge"] = 99
    with pytest.raises(ValueError, match="borde"):
        assess_planning(request)


def test_disjoint_extensions_survive_as_multipolygon():
    request = reviewed_request()
    request["shapes"] = [{"id": "remote", "label": "Anexo", "role": "extension", "geometry": polygon(7, 7, 8, 8)}]
    result = assess_planning(request)
    combined = next(f for f in result["placed"]["features"] if f["properties"]["role"] == "combined")
    assert combined["geometry"]["type"] == "MultiPolygon"
    assert result["metrics"]["extension_added_m2"] == 1


def test_self_crossing_polygon_rejected_without_repair():
    with pytest.raises(ValueError, match="no válido"):
        assess_planning({"footprint": {"type": "Polygon", "coordinates": [[[0, 0], [4, 4], [0, 4], [4, 0], [0, 0]]]}})


@pytest.mark.parametrize("geometry", [
    {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1]]]},
    {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 0], [1, 1], [0, 0]]]},
    {"type": "Polygon", "coordinates": [[[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 0, 0]]]},
    {"type": "Polygon", "coordinates": [[[False, 0], [1, 0], [1, 1], [False, 0]]]},
    polygon(10001, 0, 10002, 2),
    polygon(holes=[[[20, 20], [21, 20], [21, 21], [20, 20]]]),
])
def test_malformed_geometry_is_rejected(geometry):
    with pytest.raises(ValueError):
        assess_planning({"footprint": geometry})


def test_vertex_and_shape_budgets_are_bounded():
    request = {"footprint": polygon(), "shapes": [{"id": str(i), "role": "extension", "geometry": polygon()} for i in range(101)]}
    with pytest.raises(ValidationError):
        assess_planning(request)
    request = {"footprint": {"type": "Polygon", "coordinates": [[[0, 0]] * 10001]}}
    with pytest.raises(ValueError):
        assess_planning(request)


def test_far_away_placement_is_rejected():
    request = reviewed_request()
    request["placement"]["longitude"] = -70
    with pytest.raises(ValueError, match="25 km"):
        assess_planning(request)


def api_post(content):
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            return await client.post("/api/planning/assess", content=content, headers={"Content-Type": "application/json"})
    return asyncio.run(run())


def test_api_returns_scientific_results_and_no_approval():
    response = api_post(json.dumps(reviewed_request()))
    assert response.status_code == 200
    assert response.json()["regulatory_approval"] is False
    assert response.json()["metrics"]["coverage_percent"] == 25


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), -float("inf")])
def test_api_rejects_nonfinite_json_without_serialization_500(bad):
    request = {"footprint": polygon()}
    request["footprint"]["coordinates"][0][0][0] = bad
    assert api_post(json.dumps(request)).status_code == 422


def test_api_rejects_oversized_payload_before_geometry():
    assert api_post(b" " * (MAX_REQUEST_BYTES + 1)).status_code == 413


def test_api_rejects_unknown_fields_and_bool_numbers():
    request = reviewed_request()
    request["irm"]["constraints"]["cos_pb"] = True
    assert api_post(json.dumps(request)).status_code == 422
    request = reviewed_request()
    request["automatically_approved"] = True
    assert api_post(json.dumps(request)).status_code == 422


def test_local_area_independent_of_zoom_and_arbitrary_global_translation():
    # API consumes only metric geometry; view pixels and zoom are not accepted.
    a = assess_planning({"footprint": polygon()})
    b = assess_planning({"footprint": polygon(95, 195, 105, 205)})
    assert a["metrics"]["existing_footprint_m2"] == b["metrics"]["existing_footprint_m2"]
    with pytest.raises(ValidationError):
        PlanningRequest.model_validate({"footprint": polygon(), "zoom": 2})


def shape_check(result, identifier):
    return next(item for item in result["shape_checks"] if item["id"] == identifier)


@pytest.mark.parametrize("right, status, shortfall", [
    (6.75, "within_reviewed_limits", 0),
    (7, "at_limit", 0),
    (7.25, "conflict", .25),
])
def test_each_extension_reports_clearance_and_allows_exact_minimum(right, status, shortfall):
    request = reviewed_request()
    request["shapes"] = [{"id": "room", "label": "Ampliación de prueba", "role": "extension", "geometry": polygon(5, -1, right, 1)}]
    result = assess_planning(request)
    feedback = shape_check(result, "room")
    assert feedback["status"] == status
    assert feedback["label"] == "Ampliación de prueba"
    assert feedback["containment_status"] == "within_reviewed_limits"
    edge = next(edge for edge in feedback["setback_edges"] if edge["edge"] == 1)
    assert edge["actual_m"] == pytest.approx(10 - right, abs=1e-5)
    assert edge["required_m"] == 3
    assert edge["shortfall_m"] == pytest.approx(shortfall, abs=1e-5)
    assert edge["status"] == status
    feature = next(feature for feature in result["placed"]["features"] if feature["properties"]["id"] == "room")
    assert feature["properties"]["setback_status"] == status


def test_existing_conflict_does_not_color_a_separate_extension_red():
    request = reviewed_request()
    request["irm"]["constraints"]["retiro_frontal"] = 6
    request["shapes"] = [
        {"id": "room", "role": "extension", "geometry": polygon(0, 5, 1, 6)},
        {"id": "table", "role": "furniture", "geometry": polygon(-20, -20, 20, 20)},
    ]
    result = assess_planning(request)
    assert check(result, "setbacks")["status"] == "conflict"
    assert shape_check(result, "existing-footprint")["status"] == "conflict"
    assert shape_check(result, "room")["status"] == "within_reviewed_limits"
    assert {item["id"] for item in result["shape_checks"]} == {"existing-footprint", "room"}
    furniture = next(feature for feature in result["placed"]["features"] if feature["properties"]["id"] == "table")
    assert "setback_status" not in furniture["properties"]


def test_context_remains_usable_when_a_proposal_crosses_the_parcel():
    request = reviewed_request()
    request["shapes"] = [
        {"id": "outside", "role": "extension", "geometry": polygon(9, -1, 11, 1)},
        {"id": "inside", "role": "extension", "geometry": polygon(0, 5, 1, 6)},
    ]
    result = assess_planning(request)
    assert result["setback_context"]["ready"] is True
    assert result["setback_context"]["complete"] is True
    assert shape_check(result, "outside")["status"] == "conflict"
    assert shape_check(result, "outside")["outside_parcel_m2"] == pytest.approx(2, abs=1e-5)
    assert shape_check(result, "outside")["containment_status"] == "conflict"
    assert shape_check(result, "inside")["status"] == "within_reviewed_limits"
    # Preserve the existing aggregate gate while exposing independent feedback.
    assert check(result, "setbacks")["status"] == "pending"


def test_context_is_independent_of_draft_extensions_and_counted_cos_area():
    request = reviewed_request()
    before = assess_planning(request)["setback_context"]
    request["shapes"] = [{"id": "room", "role": "extension", "geometry": polygon(5, -1, 8, 1)}]
    request["proposal"].update(footprint_is_counted_area=False, total_floor_area_m2=None)
    result = assess_planning(request)
    assert check(result, "coverage")["status"] == "pending"
    assert result["setback_context"] == before
    assert shape_check(result, "room")["status"] == "conflict"


@pytest.mark.parametrize("section, field, value, reason", [
    ("irm", "provided", False, "identity"),
    ("irm", "reviewed", False, "identity"),
    ("irm", "irm_predio", "98765", "identity"),
    ("irm", "restrictions_reviewed", False, "scope"),
    ("irm", "property_regime", "horizontal", "scope"),
    ("proposal", "ground_floor_confirmed", False, "scope"),
    ("proposal", "existing_footprint_complete", False, "scope"),
    ("placement", "confirmed", False, "placement"),
])
def test_unreviewed_context_never_exposes_usable_rules(section, field, value, reason):
    request = reviewed_request()
    request[section][field] = value
    result = assess_planning(request)
    context = result["setback_context"]
    assert context["ready"] is False and context["complete"] is False
    assert context["parcel"] is None and context["edges"] == []
    assert reason in context["pending_reasons"]
    assert shape_check(result, "existing-footprint")["status"] == "pending"
    assert result["placed"]["features"][0]["properties"]["setback_status"] == "pending"


def test_live_context_remains_pending_on_parcel_area_discrepancy():
    request = reviewed_request()
    request["irm"]["constraints"]["area_terreno"] = 1000
    context = assess_planning(request)["setback_context"]
    assert context["ready"] is False
    assert "area_consistency" in context["pending_reasons"]
    assert context["parcel"] is None


@pytest.mark.parametrize("rotation", [0, 37, 90, -145])
def test_metric_context_inverse_rotation_matches_authoritative_edge_distances(rotation):
    from shapely.affinity import rotate
    from shapely.geometry import LineString

    request = reviewed_request()
    request["placement"]["rotation_degrees"] = rotation
    result = assess_planning(request)
    context = result["setback_context"]
    assert context["coordinate_space"] == "local_metres"
    assert context["version"] == 1
    assert context["tolerance_m"] == 1e-6
    expected = rotate(shape(polygon(-10, -10, 10, 10)), rotation, origin=(0, 0))
    assert shape(context["parcel"]).hausdorff_distance(expected) < 1e-6
    for edge in context["edges"]:
        actual = shape(request["footprint"]).distance(LineString(edge["points"]))
        authoritative = next(item for item in result["setback_edges"] if item["edge"] == edge["edge"])
        assert actual == pytest.approx(authoritative["actual_m"], abs=1e-6)


def test_partial_rules_can_detect_conflicts_but_never_all_clear():
    request = reviewed_request()
    request["edges"] = request["edges"][:1]
    request["shapes"] = [{"id": "front-room", "role": "extension", "geometry": polygon(-1, -6, 1, -4)}]
    result = assess_planning(request)
    context = result["setback_context"]
    assert context["ready"] is True and context["complete"] is False
    assert context["pending_reasons"] == ["unclassified_edges"]
    assert shape_check(result, "existing-footprint")["status"] == "pending"
    assert shape_check(result, "front-room")["status"] == "conflict"
    request = reviewed_request()
    request["irm"]["constraints"]["retiro_lateral"] = None
    result = assess_planning(request)
    assert result["setback_context"]["ready"] is True
    assert result["setback_context"]["complete"] is False
    assert "missing_limits" in result["setback_context"]["pending_reasons"]
    assert shape_check(result, "existing-footprint")["status"] == "pending"


def test_no_known_edge_limit_does_not_enable_live_checks():
    request = reviewed_request()
    request["irm"]["constraints"].update(retiro_frontal=None, retiro_lateral=None, retiro_posterior=None)
    context = assess_planning(request)["setback_context"]
    assert context["ready"] is False
    assert context["parcel"] is None
    assert context["edges"] == []
    assert "missing_limits" in context["pending_reasons"]


def test_parcel_holes_preserve_partial_review_and_report_actual_intrusion():
    request = reviewed_request()
    request["parcel"] = geographic(polygon(-10, -10, 10, 10,
        holes=[[[-1, -1], [-1, 1], [1, 1], [1, -1], [-1, -1]]]))
    result = assess_planning(request)
    assert result["setback_context"]["ready"] is True
    assert result["setback_context"]["complete"] is False
    assert "parcel_holes" in result["setback_context"]["pending_reasons"]
    feedback = shape_check(result, "existing-footprint")
    assert feedback["status"] == "conflict"
    assert feedback["outside_parcel_m2"] == pytest.approx(4, abs=1e-5)


def test_zero_setbacks_are_known_limits_and_parcel_contact_is_allowed():
    request = reviewed_request()
    request["irm"]["constraints"].update(retiro_frontal=0, retiro_lateral=0, retiro_posterior=0)
    request["shapes"] = [{"id": "touching", "role": "extension", "geometry": polygon(5, -1, 10, 1)}]
    result = assess_planning(request)
    assert result["setback_context"]["ready"] is True
    assert result["setback_context"]["complete"] is True
    assert shape_check(result, "touching")["status"] == "at_limit"


def test_batch_feedback_budget_preserves_reusable_context_and_aggregate(monkeypatch):
    monkeypatch.setattr("app.footprint_analysis.MAX_LIVE_SETBACK_COMPARISONS", 4)
    request = reviewed_request()
    before = assess_planning(request)
    assert shape_check(before, "existing-footprint")["status"] == "at_limit"
    request["shapes"] = [{"id": "room", "role": "extension", "geometry": polygon(5, -1, 8, 1)}]
    result = assess_planning(request)
    assert result["setback_context"] == before["setback_context"]
    assert check(result, "setbacks")["status"] == "conflict"
    assert all(item["status"] == "pending" and item["complete"] is False for item in result["shape_checks"])
    assert all(item["setback_edges"] == [] and "complexity" in item["pending_reasons"] for item in result["shape_checks"])
