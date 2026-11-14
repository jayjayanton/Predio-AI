"""Tests for the extraction-only document analysis prototype."""
from io import BytesIO

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


def test_dwg_requires_conversion():
    with pytest.raises(ValueError, match="DWG requires"):
        analyze_document(b"AC1018" + b"x" * 20, "plan.dwg", "blueprint")


def test_rejects_fake_pdf():
    with pytest.raises(ValueError, match="signature"):
        analyze_document(b"not a pdf", "bad.pdf", "irm")


def test_rejects_wrong_role():
    with pytest.raises(ValueError, match="role"):
        analyze_document(b"%PDF-", "x.pdf", "other")
