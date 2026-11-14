"""Tests for integrated renovation document endpoint."""
from io import BytesIO

import fitz
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


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
        data={"building_type": "apartment", "work_type": "repair", "predio_number": "627739"},
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
        data={"building_type": "house", "work_type": "expansion"},
        files={"blueprint": ("plano.pdf", pdf("PLANO"), "application/pdf")},
    )
    assert response.status_code == 422


def test_expansion_with_irm():
    response = client.post(
        "/api/documents/analyze",
        data={"building_type": "house", "work_type": "expansion"},
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
