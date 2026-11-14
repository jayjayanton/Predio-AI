from app.work_activities import validate_activities
import pytest


def test_paint_and_waterproof_multiple():
    result = validate_activities("maintenance", ["paint_walls", "waterproof"])
    assert [x["measurement_target"] for x in result] == ["wall_surface", "affected_surface"]
    assert all(x["measurement_status"] == "not_verified" for x in result)


def test_flooring_activity():
    assert validate_activities("remodel", ["replace_floor"])[0]["measurement_target"] == "floor_surface"


@pytest.mark.parametrize("work,activities", [
    ("repair", []),
    ("repair", ["paint_walls"]),
    ("maintenance", ["paint_walls", "paint_walls"]),
])
def test_invalid_selection(work, activities):
    with pytest.raises(ValueError):
        validate_activities(work, activities)
