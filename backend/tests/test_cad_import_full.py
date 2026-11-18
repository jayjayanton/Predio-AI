"""Synthetic CAD fixtures verify complete supported geometry and bounded imports."""
from concurrent.futures import ThreadPoolExecutor
from io import StringIO
import math
from threading import Event
from types import SimpleNamespace

import ezdxf
import pytest

from app import document_analysis, drawing_geometry
from app.document_analysis import analyze_document
from app.drawing_geometry import CadImportLimitError, extract_dxf_primitives


def dxf_bytes(doc):
    stream = StringIO()
    doc.write(stream)
    return stream.getvalue().encode("utf-8")


def test_more_than_3000_source_segments_remain_selectable():
    doc = ezdxf.new("R2007")
    model = doc.modelspace()
    handles = set()
    for y in range(3505):
        handles.add(model.add_line((0, y), (10, y)).dxf.handle)

    result = analyze_document(dxf_bytes(doc), "many-segments.dxf", "blueprint")
    view = result["drawing_views"][0]
    assert len(view["elements"]) == 3505
    assert len({e["id"] for e in view["elements"]}) == 3505
    assert {e["source_handle"] for e in view["elements"]} == handles
    assert view["extraction"]["omitted_entity_counts"] == {}
    assert view["extraction"]["limit_reached"] is False
    assert result["import_summary"]["budget_truncated"] is False
    assert view["measurements_available"] is False


def test_nested_nonuniform_circle_is_transformed_before_approximation():
    doc = ezdxf.new("R2007")
    inner = doc.blocks.new("INNER")
    source = inner.add_circle((0, 0), 2)
    outer = doc.blocks.new("OUTER")
    outer.add_blockref("INNER", (3, 4), dxfattribs={"xscale": 2, "rotation": 30})
    doc.modelspace().add_blockref("OUTER", (10, 20), dxfattribs={
        "yscale": 3, "rotation": 90, "layer": "CURVED",
    })
    elements, extraction = extract_dxf_primitives(doc.modelspace())

    assert len(elements) == 1
    curve = elements[0]
    assert curve["source_handle"] == source.dxf.handle
    assert curve["layer"] == "CURVED"
    assert len(curve["block_path"]) == 2
    assert curve["closed"] is True
    assert len(curve["points"]) > 20
    # Independently invert both affine transforms; every sample is on the
    # original circle to display-approximation precision.
    for x, y in curve["points"]:
        ox, oy = y - 20 - 3, (10 - x) / 3 - 4
        local_x = (math.cos(math.pi/6) * ox + math.sin(math.pi/6) * oy) / 2
        local_y = -math.sin(math.pi/6) * ox + math.cos(math.pi/6) * oy
        assert local_x**2 + local_y**2 == pytest.approx(4, abs=0.002)
    assert extraction["omission_reasons"] == {}


def test_arc_ellipse_and_spline_keep_source_shape_and_identity():
    doc = ezdxf.new("R2007")
    model = doc.modelspace()
    arc = model.add_arc((0, 0), 2, 0, 90)
    ellipse = model.add_ellipse((10, 0), major_axis=(4, 0), ratio=0.5)
    spline = model.add_open_spline([(0, 10), (1, 14), (3, 14), (4, 10)], degree=3)
    elements, extraction = extract_dxf_primitives(model)
    by_type = {e["source_type"]: e for e in elements}

    assert by_type["ARC"]["source_handle"] == arc.dxf.handle
    assert by_type["ARC"]["points"][0] == [2, 0]
    assert by_type["ARC"]["points"][-1] == [0, 2]
    assert by_type["ELLIPSE"]["source_handle"] == ellipse.dxf.handle
    assert max(p[1] for p in by_type["ELLIPSE"]["points"]) == pytest.approx(2)
    assert by_type["SPLINE"]["source_handle"] == spline.dxf.handle
    assert max(p[1] for p in by_type["SPLINE"]["points"]) == pytest.approx(13)
    assert by_type["SPLINE"]["approximation"]["method"] == "adaptive_bspline_flattening"
    assert extraction["omitted_entity_counts"] == {}


def test_minsert_grid_keeps_every_distinct_instance_and_its_transform():
    doc = ezdxf.new("R2007")
    block = doc.blocks.new("ITEM")
    source = block.add_line((0, 0), (1, 0))
    insert = doc.modelspace().add_blockref("ITEM", (10, 20), dxfattribs={
        "rotation": 90, "xscale": 2, "yscale": 3,
    })
    insert.grid(size=(2, 2), spacing=(5, 7))

    elements, extraction = extract_dxf_primitives(doc.modelspace())
    assert [e["points"] for e in elements] == [
        [[10, 20], [10, 22]], [[10, 27], [10, 29]],
        [[5, 20], [5, 22]], [[5, 27], [5, 29]],
    ]
    assert len({e["id"] for e in elements}) == 4
    assert {e["source_handle"] for e in elements} == {source.dxf.handle}
    assert len({e["block_path"] for e in elements}) == 4
    assert extraction["omitted_entity_counts"] == {}


def test_attached_attributes_are_not_double_transformed_or_replaced_by_defaults():
    doc = ezdxf.new("R2007")
    block = doc.blocks.new("ROOM")
    block.add_attdef("ROOM_NAME", (1, 2), text="WRONG DEFAULT", height=1)
    block.add_attdef("CONST", (0, 0), text="CONSTANT", height=1, dxfattribs={"flags": 2})
    insert = doc.modelspace().add_blockref("ROOM", (10, 20), dxfattribs={"xscale": 2})
    attribute = insert.add_attrib("ROOM_NAME", "Cocina", (12, 22), dxfattribs={"height": 1})

    elements, _ = extract_dxf_primitives(doc.modelspace())
    texts = {e["text"]: e for e in elements if e["kind"] == "text"}
    assert set(texts) == {"Cocina", "CONSTANT"}
    assert texts["Cocina"]["position"] == [12, 22]
    assert texts["Cocina"]["source_handle"] == attribute.dxf.handle
    assert texts["CONSTANT"]["position"] == [10, 20]


def test_transformed_text_keeps_full_content_and_display_affine_matrix():
    doc = ezdxf.new("R2007")
    block = doc.blocks.new("LABEL")
    content = "A" * 180
    block.add_text(content, dxfattribs={"insert": (1, 2), "height": 2, "rotation": 30})
    doc.modelspace().add_blockref("LABEL", (10, 20), dxfattribs={
        "xscale": 2, "yscale": 3, "rotation": 90,
    })
    elements, extraction = extract_dxf_primitives(doc.modelspace())
    text = elements[0]
    assert text["text"] == content
    assert text["position"] == [4, 22]
    assert len(extraction["source_labels"][0]["text"]) == 120
    view = drawing_geometry.drawing_view(elements, invert_y=True, source_labels=extraction["source_labels"])
    shown = view["elements"][0]
    a, b, c, d = text["text_transform"]
    assert shown["text_transform"] == [a, -b, c, -d]
    assert shown["rotation"] == -text["rotation"]
    assert shown["source_label_id"] == view["source_labels"][0]["id"]


def test_dimension_imports_stored_lines_arrowheads_and_unverified_label():
    doc = ezdxf.new("R2007")
    dimension = doc.modelspace().add_linear_dim(base=(0, 3), p1=(0, 0), p2=(5, 0))
    dimension.render()

    elements, extraction = extract_dxf_primitives(doc.modelspace())
    assert any(e["kind"] == "text" for e in elements)
    assert any(e["source_type"] == "LINE" for e in elements)
    assert all(e.get("dimension_handle") == dimension.dimension.dxf.handle for e in elements)
    assert extraction["represented_entity_counts"]["DIMENSION"] == 1
    assert all(label["verified"] is False for label in extraction["source_labels"])
    assert extraction["omitted_entity_counts"] == {}


def test_solid_hatch_preserves_holes_as_one_evenodd_compound_element():
    doc = ezdxf.new("R2007")
    hatch = doc.modelspace().add_hatch(color=7)
    hatch.paths.add_polyline_path([(0, 0), (10, 0), (10, 10), (0, 10)], is_closed=True, flags=1)
    hatch.paths.add_polyline_path([(3, 3), (7, 3), (7, 7), (3, 7)], is_closed=True, flags=0)
    elements, extraction = extract_dxf_primitives(doc.modelspace())

    assert len(elements) == 1
    item = elements[0]
    assert item["filled"] is True
    assert item["fill_rule"] == "evenodd"
    assert len(item["rings"]) == 2
    assert item["points"] == []
    assert all(ring[0] == ring[-1] for ring in item["rings"])
    assert item["source_handle"] == hatch.dxf.handle
    assert extraction["rendered_segments"] == 8


def test_patterned_hatch_contains_boundaries_and_strokes_not_solid_fill():
    doc = ezdxf.new("R2007")
    hatch = doc.modelspace().add_hatch()
    hatch.set_pattern_fill("ANSI31", scale=0.1)
    hatch.paths.add_polyline_path([(0, 0), (10, 0), (10, 10), (0, 10)], is_closed=True)
    elements, extraction = extract_dxf_primitives(doc.modelspace())
    assert any(e.get("hatch_pattern") for e in elements)
    assert any(e["kind"] == "hatch_boundary" for e in elements)
    assert not any(e.get("filled") for e in elements)
    assert {e["source_handle"] for e in elements} == {hatch.dxf.handle}
    assert extraction["omission_reasons"] == {}


@pytest.mark.parametrize("style,hole_flags,expected_rings", [(0, 0, 2), (1, 16, 2), (2, 0, 1)])
def test_patterned_hatch_preserves_island_style_in_one_source_element(style, hole_flags, expected_rings):
    doc = ezdxf.new("R2007")
    hatch = doc.modelspace().add_hatch()
    hatch.set_pattern_fill("ANSI31", scale=0.1, style=style)
    hatch.paths.add_polyline_path([(0, 0), (10, 0), (10, 10), (0, 10)], is_closed=True, flags=1)
    hatch.paths.add_polyline_path([(3, 3), (7, 3), (7, 7), (3, 7)], is_closed=True, flags=hole_flags)

    elements, extraction = extract_dxf_primitives(doc.modelspace())
    boundaries = [item for item in elements if item["kind"] == "hatch_boundary"]
    strokes = [item for item in elements if item.get("hatch_pattern")]
    assert len(boundaries) == 1
    boundary = boundaries[0]
    assert boundary["id"] == f"dxf-l1-e0-{hatch.dxf.handle}"
    assert boundary["rings"] == [
        [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
        [[3, 3], [7, 3], [7, 7], [3, 7], [3, 3]],
    ][:expected_rings]
    assert boundary["points"] == []
    assert boundary["filled"] is False
    assert boundary["closed"] is True
    assert boundary["fill_rule"] == "evenodd"
    assert strokes
    assert {item["source_handle"] for item in elements} == {hatch.dxf.handle}
    assert extraction["rendered_segments"] == 4 * expected_rings + sum(len(item["points"]) - 1 for item in strokes)
    assert extraction["omission_reasons"] == {}


def test_patterned_hatch_block_instances_keep_distinct_compound_boundaries():
    doc = ezdxf.new("R2007")
    block = doc.blocks.new("PATTERNED_ITEM")
    hatch = block.add_hatch()
    hatch.set_pattern_fill("ANSI31", scale=0.1, style=0)
    hatch.paths.add_polyline_path([(0, 0), (10, 0), (10, 10), (0, 10)], is_closed=True, flags=1)
    hatch.paths.add_polyline_path([(3, 3), (7, 3), (7, 7), (3, 7)], is_closed=True, flags=0)
    doc.modelspace().add_blockref("PATTERNED_ITEM", (0, 0))
    doc.modelspace().add_blockref("PATTERNED_ITEM", (20, 0))

    elements, extraction = extract_dxf_primitives(doc.modelspace())
    boundaries = [item for item in elements if item["kind"] == "hatch_boundary"]
    assert len(boundaries) == 2
    assert len({item["id"] for item in boundaries}) == 2
    assert len({item["block_path"] for item in boundaries}) == 2
    assert {item["source_handle"] for item in boundaries} == {hatch.dxf.handle}
    assert all(len(item["rings"]) == 2 and item["filled"] is False for item in boundaries)
    assert [item["rings"][0][0] for item in boundaries] == [[0, 0], [20, 0]]
    assert extraction["omission_reasons"] == {}


def test_nonplanar_and_infinite_geometry_is_explicitly_omitted():
    doc = ezdxf.new("R2007")
    model = doc.modelspace()
    model.add_line((0, 0, 1), (10, 0, 1))
    model.add_ray((0, 0), (1, 0))
    model.add_line((0, 0), (1, 0))
    elements, extraction = extract_dxf_primitives(model)
    assert len(elements) == 1
    assert extraction["omitted_entity_counts"] == {"LINE": 1, "RAY": 1}
    assert extraction["omission_reasons"]["nonplanar_or_invalid_coordinates"] == 1
    assert extraction["omission_reasons"]["unsupported_entity_type"] == 1
    assert extraction["status"] == "partial"


def test_clipped_and_external_blocks_do_not_claim_their_contents_are_shown():
    from ezdxf.xclip import XClip
    doc = ezdxf.new("R2007")
    block = doc.blocks.new("CLIPPED")
    block.add_line((0, 0), (10, 0))
    insert = doc.modelspace().add_blockref("CLIPPED", (0, 0))
    XClip(insert).set_block_clipping_path([(0, 0), (1, 1)])
    xref = doc.blocks.new("EXTERNAL")
    xref.block.dxf.flags = 4
    doc.modelspace().add_blockref("EXTERNAL", (0, 0))

    elements, extraction = extract_dxf_primitives(doc.modelspace())
    assert elements == []
    assert extraction["omitted_entity_counts"] == {"INSERT": 2}
    assert extraction["unexpanded_container_instances"] == 2
    assert extraction["omission_reasons"] == {
        "clipped_block_not_rendered": 1, "external_reference_not_loaded": 1,
    }


def test_paper_viewport_omission_is_scoped_to_its_separate_layout():
    doc = ezdxf.new("R2007")
    doc.modelspace().add_line((0, 0), (10, 10))
    paper = doc.layout()
    paper.add_viewport(center=(5, 5), size=(10, 10), view_center_point=(0, 0), view_height=10)
    result = analyze_document(dxf_bytes(doc), "viewport.dxf", "blueprint")
    model, layout = result["drawing_views"]
    assert model["extraction"]["status"] == "supported_geometry"
    assert layout["extraction"]["omitted_entity_counts"] == {"VIEWPORT": 1}
    assert layout["extraction"]["omission_reasons"] == {"paper_viewport_contents_not_rendered": 1}
    assert result["cad_layouts"][1]["viewport_contents_displayed"] is False
    assert result["floor_identification"] == "unverified"


def test_whole_document_budget_is_shared_across_layouts(monkeypatch):
    monkeypatch.setattr(drawing_geometry, "MAX_CAD_PRIMITIVES", 3)
    doc = ezdxf.new("R2007")
    for layout in [doc.modelspace(), doc.layout()]:
        layout.add_line((0, 0), (10, 0))
        layout.add_line((0, 1), (10, 1))
    with pytest.raises(CadImportLimitError, match="demasiado complejo"):
        analyze_document(dxf_bytes(doc), "layouts.dxf", "blueprint")


def test_dense_hatch_is_rejected_before_intersection_allocation(monkeypatch):
    from ezdxf.render import hatching
    doc = ezdxf.new("R2007")
    hatch = doc.modelspace().add_hatch()
    hatch.set_pattern_fill("ANSI31", scale=0.001)
    hatch.paths.add_polyline_path([(0, 0), (100, 0), (100, 100), (0, 100)], is_closed=True)
    monkeypatch.setattr(drawing_geometry, "MAX_CAD_HATCH_BASELINE_WORK", 100)
    monkeypatch.setattr(hatching, "hatch_paths", lambda *a, **k: pytest.fail("allocated intersections"))
    with pytest.raises(CadImportLimitError, match="intersecciones"):
        extract_dxf_primitives(doc.modelspace())


def test_bulge_work_budget_rejects_before_path_allocation(monkeypatch):
    from ezdxf import path
    doc = ezdxf.new("R2007")
    doc.modelspace().add_lwpolyline([(x, 0, 1) for x in range(10)], format="xyb")
    monkeypatch.setattr(drawing_geometry, "MAX_CAD_CURVE_WORK", 100)
    monkeypatch.setattr(path, "make_path", lambda *a, **k: pytest.fail("allocated path"))
    with pytest.raises(CadImportLimitError, match="demasiado complejo"):
        extract_dxf_primitives(doc.modelspace())


def test_spline_preflight_rejects_before_construction(monkeypatch):
    doc = ezdxf.new("R2007")
    spline = doc.modelspace().add_spline(fit_points=[(x, x % 2) for x in range(8)])
    monkeypatch.setattr(drawing_geometry, "MAX_SPLINE_FIT_POINTS", 4)
    monkeypatch.setattr(type(spline), "construction_tool", lambda *a: pytest.fail("constructed spline"))
    with pytest.raises(CadImportLimitError, match="SPLINE"):
        extract_dxf_primitives(doc.modelspace())


def test_cad_slot_covers_conversion_and_extraction_and_releases_after_error(monkeypatch):
    entered = Event()
    release = Event()
    doc = ezdxf.new("R2007")
    doc.modelspace().add_line((0, 0), (1, 0))
    source = dxf_bytes(doc)
    real_parse = document_analysis._dxf

    def convert(_):
        assert not document_analysis._CAD_IMPORT_SLOT.acquire(blocking=False)
        return SimpleNamespace(dxf_bytes=source, metadata={"status": "converted", "warnings": []})

    def blocked_parse(_):
        entered.set()
        assert release.wait(2)
        raise CadImportLimitError("test budget exceeded")

    monkeypatch.setattr(document_analysis, "convert_dwg_to_dxf", convert)
    monkeypatch.setattr(document_analysis, "_dxf", blocked_parse)
    with ThreadPoolExecutor(max_workers=1) as executor:
        pending = executor.submit(analyze_document, b"AC1021" + b"0" * 100, "plan.dwg", "blueprint")
        assert entered.wait(2)
        try:
            with pytest.raises(document_analysis.CadImportBusyError):
                analyze_document(source, "another.dxf", "blueprint")
        finally:
            release.set()
        with pytest.raises(CadImportLimitError, match="test budget"):
            pending.result(timeout=2)
    monkeypatch.setattr(document_analysis, "_dxf", real_parse)
    assert len(analyze_document(source, "retry.dxf", "blueprint")["drawing_views"][0]["elements"]) == 1
