"""Verify viewer primitives are source-linked and never imply measurements."""
import fitz

from app.document_analysis import analyze_document


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
