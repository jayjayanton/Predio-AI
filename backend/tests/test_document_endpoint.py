"""Tests for integrated renovation document endpoint."""
from io import BytesIO

import fitz
import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


@pytest.mark.parametrize("code,status", [
    ("dwg_converter_unavailable", 503),
    ("dwg_converter_busy", 503),
    ("dwg_conversion_timeout", 504),
    ("dwg_conversion_failed", 422),
])
def test_dwg_conversion_errors_keep_their_actionable_status(monkeypatch, code, status):
    from app import document_analysis
    from app.dwg_conversion import DwgConversionError

    def fail(data):
        raise DwgConversionError(code, status)

    monkeypatch.setattr(document_analysis, "convert_dwg_to_dxf", fail)
    response = client.post(
        "/api/documents/analyze",
        data={"building_type": "house", "work_type": "remodel", "activities": "replace_floor"},
        files={"blueprint": ("plan.dwg", b"AC1021" + b"\0" * 100, "application/acad")},
    )
    assert response.status_code == status
    assert response.json()["detail"] == DwgConversionError(code, status).message


def pdf(text):
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), text)
    result = doc.tobytes()
    doc.close()
    return result


def test_repair_without_irm():
    response = client.post(
        "/api/documents/analyze",
        data={"building_type": "apartment", "work_type": "repair", "activities": "repair_wall", "predio_number": "627739"},
        files={"blueprint": ("plano.pdf", pdf("PLANO"), "application/pdf")},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["irm"] is None
    assert body["status"] == "extraction_only"
    assert body["measurements_available"] is False


def test_expansion_requires_irm():
    response = client.post(
        "/api/documents/analyze",
        data={"building_type": "house", "work_type": "expansion", "activities": "expand_room"},
        files={"blueprint": ("plano.pdf", pdf("PLANO"), "application/pdf")},
    )
    assert response.status_code == 422


def test_floor_finish_inspection_without_irm_or_predio():
    response = client.post(
        "/api/documents/analyze",
        data={"building_type": "house", "work_type": "remodel", "activities": "replace_floor"},
        files={"blueprint": ("plano.pdf", pdf("PLANO"), "application/pdf")},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["irm"] is None
    assert body["predio_number"] is None
    assert body["activities"][0]["id"] == "replace_floor"
    assert body["activities"][0]["measurement_status"] == "not_verified"
    assert body["status"] == "extraction_only"
    assert body["measurements_available"] is False
    assert body["compliance_checked"] is False
    assert body["report_available"] is False


@pytest.mark.parametrize("work,activities", [
    ("remodel", ["remodel_bathroom"]),
    ("remodel", ["replace_floor", "remodel_kitchen"]),
    ("remodel", ["change_layout", "replace_floor"]),
    ("structural", ["modify_structural_wall"]),
])
def test_other_or_mixed_work_keeps_irm_prerequisite(work, activities):
    response = client.post(
        "/api/documents/analyze",
        data={"building_type": "house", "work_type": work, "activities": activities},
        files={"blueprint": ("plano.pdf", pdf("PLANO"), "application/pdf")},
    )
    assert response.status_code == 422
    assert "IRM required" in response.json()["detail"]


def test_floor_finish_exemption_does_not_accept_invalid_activity_combinations():
    response = client.post(
        "/api/documents/analyze",
        data={"building_type": "house", "work_type": "remodel", "activities": ["replace_floor", "paint_walls"]},
        files={"blueprint": ("plano.pdf", pdf("PLANO"), "application/pdf")},
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "Activity does not belong to selected work category"


def test_expansion_with_irm():
    response = client.post(
        "/api/documents/analyze",
        data={"building_type": "house", "work_type": "expansion", "activities": "expand_room"},
        files={
            "blueprint": ("plano.pdf", pdf("PLANO"), "application/pdf"),
            "irm": ("irm.pdf", pdf("COS total: 200%"), "application/pdf"),
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["irm"]["candidate_irm_fields"]["cos_total"]["raw"] == "200"


def test_reject_invalid_predio():
    response = client.post(
        "/api/documents/analyze",
        data={"building_type": "house", "work_type": "repair", "predio_number": "abc"},
        files={"blueprint": ("plano.pdf", pdf("PLANO"), "application/pdf")},
    )
    assert response.status_code == 422


def test_cad_import_contention_is_retryable_503():
    from app import document_analysis

    assert document_analysis._CAD_IMPORT_SLOT.acquire(blocking=False)
    try:
        response = client.post(
            "/api/documents/analyze",
            data={"building_type": "house", "work_type": "remodel", "activities": "replace_floor"},
            files={"blueprint": ("plan.dxf", b"not parsed while busy", "application/dxf")},
        )
    finally:
        document_analysis._CAD_IMPORT_SLOT.release()
    assert response.status_code == 503
    assert "vuelve a intentar" in response.json()["detail"]


def test_large_document_response_compresses_without_changing_contract():
    from io import StringIO
    import ezdxf

    doc = ezdxf.new("R2007")
    for index in range(30):
        doc.modelspace().add_line((0, index), (10, index))
    stream = StringIO()
    doc.write(stream)
    arguments = {
        "data": {"building_type": "house", "work_type": "remodel", "activities": "replace_floor"},
        "files": {"blueprint": ("plan.dxf", stream.getvalue().encode(), "application/dxf")},
    }
    compressed = client.post("/api/documents/analyze", headers={"Accept-Encoding": "gzip"}, **arguments)
    plain = client.post("/api/documents/analyze", headers={"Accept-Encoding": "identity"}, **arguments)
    assert compressed.status_code == plain.status_code == 200
    assert compressed.headers["content-encoding"] == "gzip"
    assert "content-encoding" not in plain.headers
    assert compressed.json() == plain.json()
    assert int(compressed.headers["content-length"]) < int(plain.headers["content-length"])
    health = client.get("/api/health", headers={"Accept-Encoding": "gzip"})
    assert "content-encoding" not in health.headers
