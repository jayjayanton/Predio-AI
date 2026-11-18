"""Project ZIP boundaries and lazy, source-preserving document inspection."""
from io import BytesIO
import stat
import struct
import warnings
import zipfile

import fitz
import pytest
from fastapi.testclient import TestClient

from app import project_package as package
from app.document_analysis import CadImportBusyError
from app.dwg_conversion import DwgConversionError
from app.main import app


client = TestClient(app)


def pdf(pages=1):
    document = fitz.open()
    for index in range(pages):
        page = document.new_page()
        page.insert_text((72, 72), f"Synthetic drawing page {index + 1}")
        page.draw_rect((72, 100, 172, 150))
    result = document.tobytes()
    document.close()
    return result


def archive(entries, compression=zipfile.ZIP_DEFLATED, comment=b""):
    output = BytesIO()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        with zipfile.ZipFile(output, "w", compression=compression) as result:
            for name, content in entries:
                result.writestr(name, content)
            result.comment = comment
    return output.getvalue()


def request(content, entry=None, *, work_type="remodel", activities="replace_floor", filename="project.zip"):
    data = {"building_type": "house", "work_type": work_type, "activities": activities}
    if entry is not None:
        data["package_entry"] = entry
    return client.post("/api/documents/analyze", data=data,
                       files={"blueprint": (filename, content, "application/zip")})


def zip64_footer(data, *, count_override=None):
    end = data.rfind(b"PK\x05\x06")
    signature, disk, directory_disk, disk_count, count, size, offset, comment_size = struct.unpack_from("<4s4H2LH", data, end)
    assert comment_size == 0
    if count_override is not None:
        count = disk_count = count_override
    record = struct.pack("<4sQ2H2L4Q", b"PK\x06\x06", 44, 45, 45, 0, 0, disk_count, count, size, offset)
    locator = struct.pack("<4sLQL", b"PK\x06\x07", 0, end, 1)
    footer = struct.pack("<4s4H2LH", signature, disk, directory_disk, 0xFFFF, 0xFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0)
    return data[:end] + record + locator + footer


def test_package_inspects_only_chosen_document_and_preserves_folder_identity(monkeypatch):
    content = archive([
        ("02 Sections/plan.pdf", pdf(2)), ("01 Floors/plan.pdf", pdf()),
        ("03 Future/invalid.dwg", b"not a valid DWG"),
        ("Notes/readme.txt", b"Notes"), ("Nested/more.zip", b"not traversed"),
        ("__MACOSX/._plan.pdf", b"metadata"), (".DS_Store", b"metadata"),
    ])
    seen = []
    original = package.analyze_document

    def record(data, filename, role):
        seen.append(filename)
        return original(data, filename, role)

    monkeypatch.setattr(package, "analyze_document", record)
    first = package.analyze_project_package(content, "project.zip")
    assert len(first["pages"]) == 1
    assert seen == ["plan.pdf"]
    manifest = first["package"]
    assert manifest["selected_entry"] == "01 Floors/plan.pdf"
    assert [entry["path"] for entry in manifest["entries"]] == ["01 Floors/plan.pdf", "02 Sections/plan.pdf", "03 Future/invalid.dwg"]
    assert manifest["skipped_counts"] == {"auxiliary": 2, "unsupported_format": 1, "nested_archive": 1}
    assert manifest["skipped_count"] == 4
    assert not manifest["stored"]
    assert "por separado" in manifest["warnings"][0]
    second = package.analyze_project_package(content, "project.zip", "02 Sections/plan.pdf")
    assert len(second["pages"]) == 2
    assert second["package"]["selected_entry"] == "02 Sections/plan.pdf"
    assert seen == ["plan.pdf", "plan.pdf"]


def test_windows_folders_and_zip64_metadata_have_a_stable_entry_path():
    content = archive([("Project\\Floors\\ground.pdf", pdf())], comment=b"A normal package comment")
    result = package.analyze_project_package(content, "project.zip", "Project/Floors/ground.pdf")
    assert result["package"]["entries"][0]["path"] == "Project/Floors/ground.pdf"
    zip64 = zip64_footer(archive([("plan.pdf", pdf())]))
    assert package.analyze_project_package(zip64, "project.zip")["format"] == "pdf"


@pytest.mark.parametrize("path", [
    "../plan.pdf", "folder/../plan.pdf", "/plan.pdf", "C:/plan.pdf", "C:plan.pdf",
    "\\\\server\\share\\plan.pdf", "folder\\..\\plan.pdf", "folder//plan.pdf",
    "./plan.pdf", "folder/./plan.pdf", "plan\n.pdf", "plan\r.pdf", "plan\x7f.pdf",
])
def test_unsafe_paths_are_rejected_before_document_parsing(path, monkeypatch):
    monkeypatch.setattr(package, "analyze_document", lambda *args: pytest.fail("Unsafe inventory reached parser"))
    with pytest.raises(package.ProjectPackageError):
        package.analyze_project_package(archive([(path, pdf())]), "project.zip")


def test_nul_names_and_file_directory_aliases_are_rejected():
    data = archive([("abc.pdf", pdf())], compression=zipfile.ZIP_STORED).replace(b"abc.pdf", b"a\x00c.pdf")
    with pytest.raises(package.ProjectPackageError, match="nombre"):
        package.analyze_project_package(data, "project.zip")
    data = archive([("Plans", b"a file"), ("Plans/floor.pdf", pdf())])
    with pytest.raises(package.ProjectPackageError, match="archivo y carpeta"):
        package.analyze_project_package(data, "project.zip")


@pytest.mark.parametrize("names", [
    ("plan.pdf", "plan.pdf"), ("Plan.pdf", "plan.PDF"),
    ("Floors/plan.pdf", "Floors\\plan.pdf"), ("caf\u00e9.pdf", "cafe\u0301.pdf"),
])
def test_duplicate_normalized_paths_are_not_silently_overwritten(names):
    with pytest.raises(package.ProjectPackageError, match="duplicadas"):
        package.analyze_project_package(archive([(name, pdf()) for name in names]), "project.zip")


@pytest.mark.parametrize("file_type", [stat.S_IFLNK, stat.S_IFIFO, stat.S_IFCHR, stat.S_IFSOCK])
def test_symlinks_and_special_files_are_rejected_even_when_not_selected(file_type):
    special = zipfile.ZipInfo("support/link")
    special.create_system = 3
    special.external_attr = (file_type | 0o777) << 16
    data = archive([("plan.pdf", pdf()), (special, b"../outside")])
    with pytest.raises(package.ProjectPackageError, match="enlaces o archivos especiales"):
        package.analyze_project_package(data, "project.zip")


def test_encrypted_members_and_unbounded_compression_methods_are_rejected():
    data = bytearray(archive([("plan.pdf", pdf())]))
    central = data.find(b"PK\x01\x02")
    struct.pack_into("<H", data, 6, struct.unpack_from("<H", data, 6)[0] | 1)
    struct.pack_into("<H", data, central + 8, struct.unpack_from("<H", data, central + 8)[0] | 1)
    with pytest.raises(package.ProjectPackageError, match="cifrados"):
        package.analyze_project_package(bytes(data), "project.zip")
    with pytest.raises(package.ProjectPackageError, match="compresión no compatible"):
        package.analyze_project_package(archive([("plan.pdf", pdf())], compression=zipfile.ZIP_BZIP2), "project.zip")


def test_package_limits_reject_excess_entries_before_zipinfo_allocation(monkeypatch):
    data = archive([(f"notes/{index}.txt", b"") for index in range(package.MAX_PACKAGE_ENTRIES + 1)])
    lied = bytearray(data)
    end = lied.rfind(b"PK\x05\x06")
    struct.pack_into("<HH", lied, end + 8, 1, 1)
    zip64 = zip64_footer(archive([("plan.pdf", pdf())]), count_override=package.MAX_PACKAGE_ENTRIES + 1)
    monkeypatch.setattr(package.zipfile, "ZipFile", lambda *args, **kwargs: pytest.fail("Oversized directory allocated ZipInfo objects"))
    for candidate in [data, bytes(lied), zip64]:
        with pytest.raises(package.ProjectPackageError, match="1.000 entradas"):
            package.analyze_project_package(candidate, "project.zip")


def test_package_drawing_size_count_total_size_and_expansion_limits(monkeypatch):
    data = archive([(f"plan-{index}.pdf", b"%PDF-") for index in range(package.MAX_PACKAGE_DRAWINGS + 1)])
    with pytest.raises(package.ProjectPackageError, match="100 planos"):
        package.analyze_project_package(data, "project.zip")
    data = bytearray(archive([("plan.pdf", pdf())]))
    central = data.find(b"PK\x01\x02")
    struct.pack_into("<L", data, central + 24, package.MAX_BYTES + 1)
    # Disable ratio only to exercise the independent per-document limit.
    with monkeypatch.context() as scoped:
        scoped.setattr(package, "RATIO_CHECK_MIN_BYTES", package.MAX_BYTES + 2)
        with pytest.raises(package.ProjectPackageError, match="plano del ZIP supera 15 MB"):
            package.analyze_project_package(bytes(data), "project.zip")
    with monkeypatch.context() as scoped:
        scoped.setattr(package, "MAX_PACKAGE_UNCOMPRESSED_BYTES", 10)
        with pytest.raises(package.ProjectPackageError, match="150 MB"):
            package.analyze_project_package(archive([("plan.pdf", pdf())]), "project.zip")
    bomb = archive([("plan.dxf", b"A" * package.RATIO_CHECK_MIN_BYTES)])
    with pytest.raises(package.ProjectPackageError, match="expansión excesiva"):
        package.analyze_project_package(bomb, "project.zip")


def test_path_and_central_metadata_limits_precede_parsing(monkeypatch):
    with pytest.raises(package.ProjectPackageError, match="ruta demasiado larga"):
        package.analyze_project_package(archive([("a" * 1025 + ".pdf", pdf())]), "project.zip")
    data = archive([("a" * 4100 + ".pdf", pdf())])
    with monkeypatch.context() as scoped:
        scoped.setattr(package.zipfile, "ZipFile", lambda *args, **kwargs: pytest.fail("Overlong raw name reached ZipFile"))
        with pytest.raises(package.ProjectPackageError, match="ruta demasiado larga"):
            package.analyze_project_package(data, "project.zip")
    with monkeypatch.context() as scoped:
        scoped.setattr(package, "MAX_CENTRAL_DIRECTORY_BYTES", 10)
        with pytest.raises(package.ProjectPackageError, match="metadatos"):
            package.analyze_project_package(archive([("plan.pdf", pdf())]), "project.zip")


@pytest.mark.parametrize("content", [b"", b"not a zip", b"PK\x03\x04broken", archive([]), archive([("readme.txt", b"notes"), ("nested.zip", b"not opened")])])
def test_malformed_empty_or_drawing_free_archives_fail_clearly(content):
    with pytest.raises(package.ProjectPackageError):
        package.analyze_project_package(content, "project.zip")


def test_unsupported_zip_version_is_an_archive_error_not_a_server_error():
    data = bytearray(archive([("plan.pdf", pdf())]))
    central = data.find(b"PK\x01\x02")
    struct.pack_into("<H", data, central + 6, 255)
    response = request(bytes(data))
    assert response.status_code == 422
    assert "No se pudo leer el ZIP" in response.json()["detail"]


def test_archive_member_selection_requires_exact_inventory_membership():
    data = archive([("Floors/plan.pdf", pdf()), ("notes.txt", b"notes")])
    for selection in ["../Floors/plan.pdf", "/Floors/plan.pdf", "floors/plan.pdf", "notes.txt", "missing.pdf", ""]:
        with pytest.raises(package.ProjectPackageError, match="inventario"):
            package.analyze_project_package(data, "project.zip", selection)


def test_failed_member_keeps_inventory_and_does_not_block_a_usable_drawing():
    data = archive([("01-corrupt.pdf", b"invalid PDF"), ("02-good.pdf", pdf())])
    result = package.analyze_project_package(data, "project.zip")
    assert result["inspection_status"] == "failed"
    assert result["inspection_error"]
    assert result["drawing_views"] == []
    assert len(result["package"]["entries"]) == 2
    valid = package.analyze_project_package(data, "project.zip", "02-good.pdf")
    assert valid["drawing_views"]
    assert "inspection_error" not in valid


def test_crc_failure_is_detected_before_selected_document_parsing(monkeypatch):
    data = bytearray(archive([("plan.pdf", pdf()), ("other.pdf", pdf())], compression=zipfile.ZIP_STORED))
    filename_size, extra_size = struct.unpack_from("<HH", data, 26)
    data[30 + filename_size + extra_size + 20] ^= 0x1
    monkeypatch.setattr(package, "analyze_document", lambda *args: pytest.fail("CRC-corrupted data reached parser"))
    result = package.analyze_project_package(bytes(data), "project.zip", "plan.pdf")
    assert result["inspection_error_code"] == "package_member_unreadable"
    assert result["drawing_views"] == []
    assert len(result["package"]["entries"]) == 2


@pytest.mark.parametrize("error,code", [
    (CadImportBusyError(), "cad_import_busy"),
    (DwgConversionError("dwg_converter_unavailable", 503), "dwg_converter_unavailable"),
    (DwgConversionError("dwg_converter_busy", 503), "dwg_converter_busy"),
    (DwgConversionError("dwg_conversion_timeout", 504), "dwg_conversion_timeout"),
])
def test_temporary_import_errors_remain_retryable_with_the_package_inventory(monkeypatch, error, code):
    def fail(*args):
        raise error
    monkeypatch.setattr(package, "analyze_document", fail)
    result = package.analyze_project_package(archive([("plan.dwg", b"AC1021")]), "project.zip")
    assert result["inspection_error_code"] == code
    assert result["inspection_retryable"] is True
    assert result["package"]["selected_entry"] == "plan.dwg"


@pytest.mark.parametrize("error_type", [OSError, type("NativeParserError", (Exception,), {})])
def test_internal_document_errors_do_not_expose_temporary_paths(monkeypatch, error_type):
    def fail(*args):
        raise error_type("Could not read /tmp/private-conversion/selected.dxf")
    monkeypatch.setattr(package, "analyze_document", fail)
    result = package.analyze_project_package(archive([("plan.dwg", b"AC1021")]), "project.zip")
    assert result["inspection_status"] == "failed"
    assert "private-conversion" not in result["inspection_error"]
    assert result["package"]["selected_entry"] == "plan.dwg"


def test_endpoint_selects_a_package_document_and_preserves_workflow_requirements():
    data = archive([("Plans/ground.pdf", pdf()), ("Sections/cut.pdf", pdf(2))])
    response = request(data, "Sections/cut.pdf")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["blueprint"]["package"]["selected_entry"] == "Sections/cut.pdf"
    assert len(body["blueprint"]["pages"]) == 2
    assert body["status"] == "extraction_only"
    assert body["measurements_available"] is False
    assert request(data, "missing.pdf").status_code == 422
    assert request(data, work_type="expansion", activities="expand_room").status_code == 422
    assert request(pdf(), "plan.pdf", filename="plan.pdf").status_code == 422


def test_endpoint_distinguishes_archive_failure_from_individual_document_failure(monkeypatch):
    response = request(archive([("bad.pdf", b"invalid"), ("good.pdf", pdf())]))
    assert response.status_code == 200
    assert response.json()["blueprint"]["inspection_status"] == "failed"
    assert len(response.json()["blueprint"]["package"]["entries"]) == 2
    assert request(b"broken ZIP").status_code == 422
    from app import main
    monkeypatch.setattr(main, "MAX_PACKAGE_BYTES", 100)
    response = request(b"x" * 101)
    assert response.status_code == 413
    assert "30 MB" in response.json()["detail"]
