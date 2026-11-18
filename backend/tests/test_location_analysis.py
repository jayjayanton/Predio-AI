"""Geographic references must retain provenance and never invent parcel identity."""
from io import StringIO
import json

import ezdxf
from ezdxf.entities.geodata import EPSG_3395, GeoData
import fitz
import pytest
from fastapi.testclient import TestClient
from pyproj import CRS

from app.document_analysis import analyze_document
from app.location_analysis import (
    SIRES_DMQ_WKT, cad_location, text_location, transform_coordinates,
)
from app.main import app


def dxf_bytes(doc):
    output = StringIO()
    doc.write(output)
    return output.getvalue().encode()


def pdf_bytes(*pages):
    doc = fitz.open()
    for text in pages:
        doc.new_page().insert_text((72, 72), text)
    result = doc.tobytes()
    doc.close()
    return result


def geodata_drawing():
    doc = ezdxf.new("R2010")
    doc.units = 4
    doc.modelspace().add_line((1000, -2000), (4000, 1000))
    geo = doc.modelspace().new_geodata()
    geo.setup_local_grid(design_point=(1000, -2000, 0), reference_point=(0, 0, 0))
    return doc, geo


def test_local_mm_cad_and_legacy_defaults_do_not_produce_a_map_location():
    doc = ezdxf.new("R2007")
    doc.units = 4
    doc.header["$LATITUDE"] = 37.795
    doc.header["$LONGITUDE"] = -122.394
    doc.modelspace().add_line((100, -300), (200, -100))
    result = analyze_document(dxf_bytes(doc), "987654_propuesta.dxf", "blueprint")
    location = result["location"]
    assert location["status"] == "unreferenced"
    assert location["geographic"] is None
    assert location["point"] is None
    assert location["crs"] is None
    assert not any(item["kind"] == "predio" for item in location["candidates"])
    assert any("LATITUDE/LONGITUDE" in warning for warning in location["warnings"])
    assert location["extents"] == {
        "min": [100.0, -300.0], "max": [200.0, -100.0],
        "source": "extracted_modelspace_geometry", "units_code": 4,
    }
    assert result["drawing_views"][0]["elements"][0]["points"] == [[100.0, -100.0], [200.0, -300.0]]


def test_stored_cad_extents_are_labeled_as_cached_and_not_geographic():
    doc = ezdxf.new("R2010")
    doc.units = 4
    doc.header["$EXTMIN"] = (-40, -20, 0)
    doc.header["$EXTMAX"] = (80, 60, 0)
    location = cad_location(doc)
    assert location["extents"]["source"] == "header_cached"
    assert location["extents"]["min"] == [-40, -20, 0]
    assert location["geographic"] is None
    assert any("desactualizadas" in warning for warning in location["warnings"])


def test_supported_geodata_preserves_reference_point_and_crs_provenance():
    doc, _ = geodata_drawing()
    location = analyze_document(dxf_bytes(doc), "survey.dxf", "blueprint")["location"]
    assert location["status"] == "geographic_available"
    assert location["cad_reference_point"] == [1000, -2000, 0]
    assert location["crs"]["id"] == "EPSG:3395"
    assert location["point"] == {"x": 0, "y": 0}
    assert location["geographic"]["latitude"] == pytest.approx(0)
    assert location["geographic"]["longitude"] == pytest.approx(0)
    assert location["geographic"]["provenance"] == "cad_geodata"
    assert location["geographic"]["point_role"] == "cad_geodata_reference_point"
    assert location["verified"] is False


@pytest.mark.parametrize("mutation", ["missing_anchor", "west_axis", "scale_correction", "xml_entity"])
def test_incomplete_or_unsupported_geodata_never_falls_back_to_default_zero(mutation):
    doc, geo = geodata_drawing()
    if mutation == "missing_anchor":
        geo.dxf.discard("reference_point")
    elif mutation == "west_axis":
        geo.coordinate_system_definition = geo.coordinate_system_definition.replace(
            "<AxisAbbreviation>E</AxisAbbreviation>", "<AxisAbbreviation>W</AxisAbbreviation>")
    elif mutation == "scale_correction":
        geo.dxf.sea_level_correction = 1
    else:
        geo.coordinate_system_definition = '<!DOCTYPE x [<!ENTITY a "expanded">]><x>&a;</x>'
    location = cad_location(doc)
    assert location["status"] == "unsupported"
    assert location["geographic"] is None


def test_bare_geodata_object_has_no_location():
    doc = ezdxf.new("R2010")
    geo = doc.modelspace().new_geodata()
    geo.dxf.coordinate_type = GeoData.LOCAL_GRID
    geo.coordinate_system_definition = EPSG_3395
    assert cad_location(doc)["geographic"] is None


def test_disagreeing_text_and_geodata_references_are_not_silently_combined():
    doc, _ = geodata_drawing()
    location = cad_location(doc, text_fragments=[(1, "WGS84\nLatitud: -0.2 / Longitud: -78.4")])
    assert location["geographic"]["provenance"] == "cad_geodata"
    assert any("puntos distintos" in warning for warning in location["warnings"])


@pytest.mark.parametrize("label", ["SIRES-DMQ", "SIRES DMQ", "SIRES MDQ"])
def test_explicit_municipal_crs_extracts_reference_with_page_and_provenance(label):
    location = text_location([(2, f"Coordenadas {label}:\nX=500000 / Y=10000000\nAño de construcción")])
    assert location["status"] == "geographic_available"
    assert location["crs"]["id"] == "ESRI:103985"
    assert location["geographic"]["latitude"] == pytest.approx(0)
    assert location["geographic"]["longitude"] == pytest.approx(-78.5)
    assert location["geographic"]["page"] == 2
    assert location["geographic"]["provenance"] == "pdf_text_sires_dmq"
    assert location["verified"] is False
    assert all(candidate["status"] == "unverified_extraction" for candidate in location["candidates"])


def test_sires_is_pinned_to_municipal_definition_and_is_not_utm():
    assert CRS.from_wkt(SIRES_DMQ_WKT).equals(CRS.from_user_input("ESRI:103985"))
    result = transform_coordinates(500000, 10000000, "SIRES-DMQ")
    utm = transform_coordinates(500000, 10000000, "EPSG:32717")
    assert result["geographic"]["longitude"] == pytest.approx(-78.5)
    assert utm["geographic"]["longitude"] == pytest.approx(-81)


@pytest.mark.parametrize("text", [
    "X=500000 / Y=10000000",
    "Coordenadas SIRES:\nX=500000 / Y=10000000",
    "Latitud: -0.2 / Longitud: -78.4",
    "Coordenadas sin referencia\nX=500000 / Y=10000000\n\nOtro levantamiento: EPSG:32717",
])
def test_missing_or_unassociated_crs_stays_pending(text):
    location = text_location([(1, text)])
    assert location["status"] == "needs_crs"
    assert location["point"] is not None
    assert location["geographic"] is None
    assert location["crs"] is None


def test_coordinate_pairs_and_crs_do_not_cross_page_boundaries():
    location = text_location([(1, "SIRES-DMQ\nX=500000"), (2, "Y=10000000")])
    assert location["point"] is None
    assert location["geographic"] is None
    location = text_location([(1, "EPSG:32717"), (2, "X=500000 / Y=10000000")])
    assert location["point"] is not None
    assert location["geographic"] is None


def test_multiple_coordinates_require_selection_even_if_each_has_a_crs():
    location = text_location([(1, "SIRES-DMQ\nX=500000 / Y=10000000\n\nSIRES-DMQ\nX=500100 / Y=10000100")])
    assert location["status"] == "needs_crs"
    assert location["point"] is None
    assert location["geographic"] is None


@pytest.mark.parametrize("text", [
    "WGS84\nLatitud: 0.2 S / Longitud: 78.4 W",
    "WGS84 Latitud: 0.2 metros / Longitud: 78.4 metros",
    "WGS84 Latitud: -0.2 / Longitud: 7e-2",
    "WGS84 Latitud: -0.2 / Longitud: 78°30'",
    "WGS84 Latitud: -0.2 / Longitud: -78.4 N",
])
def test_unsupported_hemispheres_units_and_dms_never_lose_suffix_information(text):
    location = text_location([(1, text)])
    assert location["geographic"] is None
    assert location["point"] is None


def test_decimal_degrees_keep_axis_order_and_accept_decimal_comma():
    location = text_location([(1, "WGS84\nLatitud: -0,2 / Longitud: -78,4")])
    assert location["geographic"]["latitude"] == pytest.approx(-0.2)
    assert location["geographic"]["longitude"] == pytest.approx(-78.4)
    direct = transform_coordinates(-78.4, -0.2, "EPSG:4326")
    assert direct["geographic"]["longitude"] == pytest.approx(-78.4)
    assert direct["geographic"]["latitude"] == pytest.approx(-0.2)


def test_projected_conversion_has_a_known_independent_control_point():
    # EPSG:3857 equator, one degree of longitude in metres.
    result = transform_coordinates(111319.49079327357, 0, "EPSG:3857")
    assert result["geographic"]["longitude"] == pytest.approx(1, abs=1e-9)
    assert result["geographic"]["latitude"] == pytest.approx(0, abs=1e-9)
    assert result["geographic"]["provenance"] == "user_supplied_crs"


@pytest.mark.parametrize("x,y,crs", [
    (True, 0, "EPSG:4326"),
    (float("inf"), 0, "EPSG:4326"),
    (float("nan"), 0, "EPSG:4326"),
    (0, 95, "EPSG:4326"),
    (200, 0, "EPSG:4326"),
    (0, 0, "EPSG:4978"),
    (0, 0, "EPSG:4979"),
    (0, 0, "EPSG:999999"),
    (0, 0, "+proj=longlat +datum=WGS84"),
    (0, 0, "https://example.org/crs"),
    (0, 0, "ESRI:54004"),
    (0, 0, "SIRES-DMQ"),
    (500000, 11000000, "EPSG:32717"),
])
def test_invalid_or_out_of_area_coordinates_are_rejected(x, y, crs):
    with pytest.raises(ValueError):
        transform_coordinates(x, y, crs)


def test_irm_number_layout_is_bounded_and_does_not_expose_intervening_fields():
    text = "DATOS DEL PREDIO\nNombre o razón social:\nPERSONA DE PRUEBA\nNúmero:\n123456\nEstado predio:\nACTIVO\nCoordenadas SIRES MDQ:\nX=500000 / Y=10000000"
    result = analyze_document(pdf_bytes("PORTADA", text), "irm.pdf", "irm")
    assert result["candidate_irm_fields"]["predio"]["raw"] == "123456"
    predios = [c for c in result["location"]["candidates"] if c["kind"] == "predio"]
    assert predios[0]["value"] == "123456"
    assert predios[0]["evidence"] == "Número:\n123456"
    assert "PERSONA" not in json.dumps(predios)
    assert result["location"]["geographic"]["page"] == 2


def test_scanned_or_unlabeled_pdf_does_not_claim_a_location():
    result = analyze_document(pdf_bytes(""), "scan.pdf", "blueprint")
    assert result["location"]["status"] == "not_found"
    assert result["location"]["geographic"] is None


def test_coordinate_endpoint_and_irm_endpoint_expose_provenance():
    client = TestClient(app)
    converted = client.post("/api/coordinates/transform", json={"x": 500000, "y": 10000000, "source_crs": "SIRES-DMQ"})
    assert converted.status_code == 200
    assert converted.json()["verified"] is False
    assert converted.json()["geographic"]["point_role"] == "reference_point"
    extracted = client.post("/api/irm/extract", files={
        "file": ("irm.pdf", pdf_bytes("SIRES-DMQ\nX=500000 / Y=10000000"), "application/pdf"),
    })
    assert extracted.status_code == 200
    assert extracted.json()["location"]["crs"]["id"] == "ESRI:103985"
    assert extracted.json()["location"]["verified"] is False


@pytest.mark.parametrize("raw_value", ["NaN", "Infinity", "-Infinity", "true", '"NaN"', "1e309"])
def test_endpoint_rejects_nonfinite_json_and_booleans_with_serializable_422(raw_value):
    response = TestClient(app).post("/api/coordinates/transform", content=(
        '{"x":' + raw_value + ',"y":0,"source_crs":"EPSG:4326"}'
    ), headers={"Content-Type": "application/json"})
    assert response.status_code == 422
    assert response.json()["detail"]
