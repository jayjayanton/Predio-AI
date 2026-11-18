"""Verify viewer primitives are source-linked and never imply measurements."""
import fitz
import pytest
import ezdxf

from app.document_analysis import analyze_document
from app import drawing_geometry


def test_pdf_vector_lines_are_selectable():
    doc = fitz.open()
    page = doc.new_page(width=300, height=200)
    shape = page.new_shape()
    shape.draw_line((20, 30), (220, 30))
    shape.finish(color=(0, 0, 0))
    shape.commit()
    result = analyze_document(doc.tobytes(), "drawing.pdf", "blueprint")
    doc.close()
    view = result["drawing_views"][0]
    assert view["bounds"] == [0, 0, 300, 200]
    assert len(view["elements"]) >= 1
    assert view["elements"][0]["classification"] == "unclassified"
    assert view["measurements_available"] is False
    assert view["units_verified"] is False


def test_scanned_pdf_has_no_invented_geometry():
    doc = fitz.open()
    doc.new_page()
    result = analyze_document(doc.tobytes(), "scan.pdf", "blueprint")
    doc.close()
    assert result["drawing_views"][0]["elements"] == []


def test_dxf_line_is_selectable():
    import ezdxf
    from io import StringIO

    doc = ezdxf.new()
    doc.modelspace().add_line((0, 0), (10, 0), dxfattribs={"layer": "A-WALL"})
    stream = StringIO()
    doc.write(stream)
    result = analyze_document(stream.getvalue().encode("utf-8"), "plan.dxf", "blueprint")
    view = result["drawing_views"][0]
    assert len(view["elements"]) == 1
    assert view["elements"][0]["layer"] == "A-WALL"
    assert view["measurements_available"] is False


def test_dxf_blocks_apply_placement_and_keep_instance_provenance():
    doc = ezdxf.new("R2007")
    block = doc.blocks.new("ROOM")
    source = block.add_line((0, 0), (2, 0))
    first = doc.modelspace().add_blockref("ROOM", (10, 20), dxfattribs={
        "rotation": 90, "xscale": 2, "yscale": 2, "zscale": 2, "layer": "A-WALL",
    })
    second = doc.modelspace().add_blockref("ROOM", (30, 40), dxfattribs={"layer": "I-WALL"})

    elements, extraction = drawing_geometry.extract_dxf_primitives(doc.modelspace())

    assert elements[0]["points"] == [[10.0, 20.0], [10.0, 24.0]]
    assert elements[1]["points"] == [[30.0, 40.0], [32.0, 40.0]]
    assert [e["layer"] for e in elements] == ["A-WALL", "I-WALL"]
    assert {e["source_handle"] for e in elements} == {source.dxf.handle}
    assert len({e["id"] for e in elements}) == 2
    assert first.dxf.handle in elements[0]["block_path"][0]
    assert second.dxf.handle in elements[1]["block_path"][0]
    assert extraction["status"] == "supported_geometry"
    assert drawing_geometry.extract_dxf_primitives(doc.modelspace())[0] == elements


def test_dxf_nested_blocks_preserve_parent_transform_and_layer_zero():
    doc = ezdxf.new("R2007")
    inner = doc.blocks.new("INNER")
    inner.add_line((0, 0), (2, 0))
    outer = doc.blocks.new("OUTER")
    outer.add_blockref("INNER", (3, 0))
    doc.modelspace().add_blockref("OUTER", (10, 20), dxfattribs={
        "rotation": 90, "xscale": 2, "yscale": 2, "zscale": 2, "layer": "A-WALL",
    })

    elements, extraction = drawing_geometry.extract_dxf_primitives(doc.modelspace())

    assert elements[0]["points"] == [[10.0, 26.0], [10.0, 30.0]]
    assert elements[0]["layer"] == "A-WALL"
    assert len(elements[0]["block_path"]) == 2
    assert extraction["omitted_entity_counts"] == {}


def test_dxf_negative_extrusion_is_transformed_before_display():
    doc = ezdxf.new("R2007")
    block = doc.blocks.new("ROOM")
    block.add_line((0, 0), (2, 0))
    doc.modelspace().add_blockref("ROOM", (10, 20), dxfattribs={"extrusion": (0, 0, -1)})

    elements, _ = drawing_geometry.extract_dxf_primitives(doc.modelspace())

    assert elements[0]["points"] == [[-10.0, 20.0], [-12.0, 20.0]]


def test_curved_polylines_are_omitted_instead_of_replaced_with_chords():
    doc = ezdxf.new("R2007")
    doc.modelspace().add_lwpolyline([(0, 0, 1), (10, 0, 0)], format="xyb")
    block = doc.blocks.new("CURVE")
    block.add_lwpolyline([(0, 0, 1), (10, 0, 0)], format="xyb")
    doc.modelspace().add_blockref("CURVE", (20, 20))

    elements, extraction = drawing_geometry.extract_dxf_primitives(doc.modelspace())

    assert elements == []
    assert extraction["status"] == "partial"
    assert extraction["omitted_curved_polylines"] == 2
    assert extraction["omitted_entity_counts"] == {"LWPOLYLINE": 2}


def test_dxf_primitive_limit_preserves_top_level_before_block_detail(monkeypatch):
    monkeypatch.setattr(drawing_geometry, "MAX_PRIMITIVES", 3)
    doc = ezdxf.new("R2007")
    block = doc.blocks.new("DETAIL")
    for y in range(5):
        block.add_line((0, y), (1, y))
    doc.modelspace().add_blockref("DETAIL", (10, 10))
    first = doc.modelspace().add_line((0, 0), (20, 0))
    second = doc.modelspace().add_line((0, 0), (0, 20))

    elements, extraction = drawing_geometry.extract_dxf_primitives(doc.modelspace())

    assert [e["source_handle"] for e in elements[:2]] == [first.dxf.handle, second.dxf.handle]
    assert len(elements) == extraction["rendered_primitives"] == 3
    assert extraction["limit_reached"] is True
    assert extraction["primitive_limit"] == 3
    assert extraction["omitted_entity_counts"] == {"LINE": 4}
    assert extraction["status"] == "partial"


def test_dxf_cycle_and_depth_guards_report_partial_geometry(monkeypatch):
    doc = ezdxf.new("R2007")
    block = doc.blocks.new("CYCLE")
    block.add_line((0, 0), (1, 0))
    block.add_blockref("CYCLE", (0, 0))
    doc.modelspace().add_blockref("CYCLE", (0, 0))

    elements, extraction = drawing_geometry.extract_dxf_primitives(doc.modelspace())
    assert len(elements) == 1
    assert extraction["omitted_entity_counts"] == {"INSERT": 1}
    assert extraction["status"] == "partial"

    monkeypatch.setattr(drawing_geometry, "MAX_BLOCK_DEPTH", 1)
    _, extraction = drawing_geometry.extract_dxf_primitives(doc.modelspace())
    assert extraction["depth_limit_reached"] is True


def test_dxf_traversal_budget_does_not_claim_complete_counts(monkeypatch):
    monkeypatch.setattr(drawing_geometry, "MAX_DXF_VISITS", 4)
    doc = ezdxf.new("R2007")
    block = doc.blocks.new("DETAIL")
    for y in range(20):
        block.add_line((0, y), (1, y))
    doc.modelspace().add_blockref("DETAIL", (0, 0))
    doc.modelspace().add_line((0, 0), (2, 0))

    elements, extraction = drawing_geometry.extract_dxf_primitives(doc.modelspace())

    assert len(elements) == 3
    assert extraction["traversal_limit_reached"] is True
    assert extraction["limit_reached"] is False
    assert extraction["status"] == "partial"


def test_dxf_nonuniform_block_is_omitted_instead_of_flattening_curves():
    doc = ezdxf.new("R2007")
    block = doc.blocks.new("CURVE")
    block.add_lwpolyline([(0, 0, 1), (10, 0, 0)], format="xyb")
    doc.modelspace().add_blockref("CURVE", (0, 0), dxfattribs={"xscale": 2})

    elements, extraction = drawing_geometry.extract_dxf_primitives(doc.modelspace())

    assert elements == []
    assert extraction["omitted_entity_counts"] == {"INSERT": 1}
    assert extraction["status"] == "partial"


def test_dxf_nonempty_paper_layout_is_reported_as_omitted():
    from io import StringIO

    doc = ezdxf.new("R2007")
    doc.modelspace().add_line((0, 0), (10, 0))
    doc.layout().add_line((0, 0), (20, 0))
    stream = StringIO()
    doc.write(stream)

    result = analyze_document(stream.getvalue().encode("utf-8"), "layouts.dxf", "blueprint")

    extraction = result["drawing_views"][0]["extraction"]
    assert extraction["scope"] == "modelspace"
    assert extraction["rendered_primitives"] == 1
    assert extraction["omitted_nonempty_layouts"] == 1
    assert extraction["status"] == "partial"


def test_original_cad_text_and_block_labels_are_positioned_without_inventing_areas():
    """Original annotation content is evidence, not a computed measurement."""
    from io import StringIO

    doc = ezdxf.new("R2007")
    model = doc.modelspace()
    model.add_line((0, 0), (20, 0))
    model.add_line((0, 0), (0, 20))
    model.add_text("Cocina 17.40 m²", dxfattribs={
        "insert": (5, 5), "height": 0.5, "layer": "A-ANOT",
    })
    block = doc.blocks.new("LABEL_ROOM")
    block.add_mtext("Vestidor\\P10.19 m²", dxfattribs={
        "insert": (0, 1), "char_height": 0.4,
    })
    model.add_blockref("LABEL_ROOM", (10, 10), dxfattribs={"layer": "ROOM-LABEL"})
    stream = StringIO()
    doc.write(stream)

    result = analyze_document(stream.getvalue().encode("utf-8"), "source.dxf", "blueprint")
    view = result["drawing_views"][0]
    labels = view["source_labels"]
    assert len(labels) == 2
    by_text = {label["text"]: label for label in labels}
    assert by_text["Cocina 17.40 m²"]["position"] == [5.0, 15.0]
    assert by_text["Cocina 17.40 m²"]["kind"] == "source_area"
    assert by_text["Cocina 17.40 m²"]["layer"] == "A-ANOT"
    assert by_text["Vestidor 10.19 m²"]["position"] == [10.0, 9.0]
    assert by_text["Vestidor 10.19 m²"]["layer"] == "ROOM-LABEL"
    assert all(label["verified"] is False for label in labels)
    assert view["units_verified"] is False
    assert view["measurements_available"] is False
    assert result["floor_identification"] == "unverified"
    assert result["display_scope"] == "modelspace_only"


def test_paper_layout_is_listed_but_not_treated_as_another_floor():
    from io import StringIO

    doc = ezdxf.new("R2007")
    doc.modelspace().add_line((0, 0), (10, 10))
    doc.layout().add_text("PLANTA ALTA", dxfattribs={"insert": (5, 5)})
    stream = StringIO()
    doc.write(stream)

    result = analyze_document(stream.getvalue().encode("utf-8"), "layout.dxf", "blueprint")
    assert result["floor_identification"] == "unverified"
    assert result["cad_layouts"][0]["name"] == "Model"
    assert any(l["entity_count"] > 0 and not l["displayed"] for l in result["cad_layouts"])
    assert all(label["text"] != "PLANTA ALTA" for label in result["drawing_views"][0]["source_labels"])
    assert result["drawing_views"][0]["extraction"]["omitted_nonempty_layouts"] == 1


def test_cad_source_label_limit_reports_incomplete_text(monkeypatch):
    monkeypatch.setattr(drawing_geometry, "MAX_SOURCE_LABELS", 1)
    doc = ezdxf.new("R2007")
    model = doc.modelspace()
    model.add_line((0, 0), (10, 10))
    model.add_text("Cocina 17 m²", dxfattribs={"insert": (2, 2)})
    model.add_text("Comedor 11 m²", dxfattribs={"insert": (4, 4)})
    _, extraction = drawing_geometry.extract_dxf_primitives(model)
    assert len(extraction["source_labels"]) == 1
    assert extraction["source_label_limit_reached"] is True
    assert extraction["status"] == "partial"
