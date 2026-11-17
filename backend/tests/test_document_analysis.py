"""Tests for the extraction-only document analysis prototype."""
from io import BytesIO, StringIO

import fitz
import pytest

from app.document_analysis import analyze_document, analyze_pair


def make_pdf(text: str) -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), text)
    output = doc.tobytes()
    doc.close()
    return output


def test_irm_extracts_unverified_candidates():
    result = analyze_document(
        make_pdf("Numero de Predio: 627739 COS total: 200%"),
        "irm.pdf", "irm",
    )
    assert result["candidate_irm_fields"]["cos_total"]["raw"] == "200"
    assert result["compliance_checked"] is False


def test_blueprint_pdf_vector_metadata():
    result = analyze_document(make_pdf("PLANTA BAJA"), "plano.pdf", "blueprint")
    assert result["pages"][0]["text_characters"] > 0
    assert result["official_approval"] is False


def test_pair_remains_extraction_only():
    result = analyze_pair(make_pdf("IRM"), make_pdf("PLANO"))
    assert result["comparison_status"] == "extraction_only"


def test_dwg_conversion_preserves_source_identity_and_unverified_geometry(monkeypatch):
    from types import SimpleNamespace
    import ezdxf
    from app import document_analysis

    doc = ezdxf.new("R2007")
    doc.modelspace().add_line((0, 0), (3, 4))
    stream = StringIO()
    doc.write(stream)
    source = b"AC1021" + b"\0" * 100
    metadata = {"status": "converted_with_warnings", "engine": "LibreDWG",
                "warnings": ["Conversion requires source review"]}

    def convert(data):
        assert data == source
        return SimpleNamespace(dxf_bytes=stream.getvalue().encode(), metadata=metadata)

    monkeypatch.setattr(document_analysis, "convert_dwg_to_dxf", convert)
    result = analyze_document(source, "source-plan.DWG", "blueprint")
    assert result["format"] == "dwg"
    assert result["converted_format"] == "dxf"
    assert result["filename"] == "source-plan.DWG"
    assert result["conversion"] == metadata
    assert len(result["drawing_views"][0]["elements"]) == 1
    assert result["drawing_views"][0]["units_verified"] is False
    assert result["compliance_checked"] is False


def test_rejects_fake_pdf():
    with pytest.raises(ValueError, match="signature"):
        analyze_document(b"not a pdf", "bad.pdf", "irm")


def test_rejects_wrong_role():
    with pytest.raises(ValueError, match="role"):
        analyze_document(b"%PDF-", "x.pdf", "other")


def test_dxf_crlf_with_binary_record_preserves_geometry():
    """Windows line endings must not become part of hexadecimal DXF data."""
    import ezdxf

    doc = ezdxf.new("R2007")
    doc.modelspace().add_line((0, 0), (10, 5), dxfattribs={"layer": "A-WALL"})
    doc.rootdict.add_xrecord("BINARY_TEST").reset([(310, b"\x00\x01\xff\x10")])
    stream = StringIO()
    doc.write(stream)
    data = stream.getvalue().replace("\n", "\r\n").encode("utf-8")

    result = analyze_document(data, "windows-plan.dxf", "blueprint")

    assert result["entity_counts"] == {"LINE": 1}
    view = result["drawing_views"][0]
    assert len(view["elements"]) == 1
    assert view["elements"][0]["layer"] == "A-WALL"
    assert view["elements"][0]["points"] == [[0.0, 5.0], [10.0, 0.0]]
    assert view["units_verified"] is False
    assert view["measurements_available"] is False
    assert result["compliance_checked"] is False
