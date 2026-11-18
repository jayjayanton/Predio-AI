"""Inspect one drawing from a bounded ZIP package without extracting the archive.

The package is a file inventory, not an assembled CAD/xref project. Only the
chosen member is decompressed and handed to the existing document importer.
"""
from __future__ import annotations

from io import BytesIO
import logging
import stat
import struct
import unicodedata
import zipfile
import zlib

from .document_analysis import MAX_BYTES, CadImportBusyError, analyze_document
from .dwg_conversion import DwgConversionError


MAX_PACKAGE_BYTES = 30 * 1024 * 1024
MAX_PACKAGE_ENTRIES = 1000
MAX_PACKAGE_DRAWINGS = 100
MAX_PACKAGE_UNCOMPRESSED_BYTES = 150 * 1024 * 1024
MAX_PACKAGE_PATH_CHARS = 1024
MAX_CENTRAL_DIRECTORY_BYTES = 8 * 1024 * 1024
MAX_COMPRESSION_RATIO = 200
RATIO_CHECK_MIN_BYTES = 1024 * 1024
READ_CHUNK_BYTES = 64 * 1024
DRAWING_FORMATS = {"pdf", "dxf", "dwg"}
ARCHIVE_FORMATS = {"zip", "7z", "rar", "tar", "gz", "bz2", "xz"}
logger = logging.getLogger(__name__)


class ProjectPackageError(ValueError):
    """A package-level failure; individual document errors retain the inventory."""


def _invalid_package() -> ProjectPackageError:
    return ProjectPackageError("No se pudo leer el ZIP. Revisa el archivo o crea una nueva copia del paquete.")


def _preflight_directory(data: bytes) -> None:
    """Cap central-directory records before ZipFile allocates ZipInfo objects.

    Counts in EOCD/ZIP64 alone are not sufficient: ZipFile walks the actual
    central directory even if a forged footer advertises fewer entries.
    """
    if not data or len(data) > MAX_PACKAGE_BYTES:
        raise ProjectPackageError("El ZIP está vacío o supera el límite de 30 MB.")
    if data[:4] not in {b"PK\x03\x04", b"PK\x05\x06", b"PK\x06\x06"}:
        raise _invalid_package()
    end = data.rfind(b"PK\x05\x06", max(0, len(data) - 65557))
    if end < 0 or end + 22 > len(data):
        raise _invalid_package()
    try:
        _, disk, directory_disk, disk_count, count, size, offset, comment_size = struct.unpack_from("<4s4H2LH", data, end)
    except struct.error as exc:
        raise _invalid_package() from exc
    if end + 22 + comment_size != len(data) or disk or directory_disk or disk_count != count:
        raise _invalid_package()
    directory_end = end
    locator = end - 20
    if locator >= 0 and data[locator:locator + 4] == b"PK\x06\x07":
        try:
            _, zip64_disk, zip64_offset, disks = struct.unpack_from("<4sLQL", data, locator)
            record = struct.unpack_from("<4sQ2H2L4Q", data, zip64_offset)
        except (struct.error, OverflowError) as exc:
            raise _invalid_package() from exc
        signature, record_size, _, _, disk64, directory_disk64, disk_count64, count64, size64, offset64 = record
        # Bounded packages do not require extensible ZIP64 metadata or volumes.
        if (zip64_disk or disks != 1 or signature != b"PK\x06\x06" or record_size != 44
                or zip64_offset + 56 != locator or disk64 or directory_disk64 or disk_count64 != count64):
            raise _invalid_package()
        if ((count != 0xFFFF and count != count64) or (size != 0xFFFFFFFF and size != size64)
                or (offset != 0xFFFFFFFF and offset != offset64)):
            raise _invalid_package()
        count, size, offset = count64, size64, offset64
        directory_end = zip64_offset
    elif count == 0xFFFF or size == 0xFFFFFFFF or offset == 0xFFFFFFFF:
        raise _invalid_package()
    if count > MAX_PACKAGE_ENTRIES:
        raise ProjectPackageError("El ZIP contiene más de 1.000 entradas. Divide el paquete en grupos más pequeños.")
    if size > MAX_CENTRAL_DIRECTORY_BYTES:
        raise ProjectPackageError("El ZIP contiene demasiados metadatos. Crea un paquete más pequeño con los planos necesarios.")
    if offset + size != directory_end or offset < 0:
        raise _invalid_package()
    position = offset
    actual_count = 0
    while position < directory_end:
        actual_count += 1
        if actual_count > MAX_PACKAGE_ENTRIES:
            raise ProjectPackageError("El ZIP contiene más de 1.000 entradas. Divide el paquete en grupos más pequeños.")
        if position + 46 > directory_end or data[position:position + 4] != b"PK\x01\x02":
            raise _invalid_package()
        name_size, extra_size, entry_comment_size = struct.unpack_from("<3H", data, position + 28)
        if name_size > MAX_PACKAGE_PATH_CHARS * 4:
            raise ProjectPackageError("El ZIP contiene una ruta demasiado larga. Acorta los nombres de carpetas o archivos.")
        position += 46 + name_size + extra_size + entry_comment_size
        if position > directory_end:
            raise _invalid_package()
    if position != directory_end or actual_count != count:
        raise _invalid_package()


def _member_path(info: zipfile.ZipInfo) -> tuple[str, bool]:
    original = info.orig_filename
    if not original or original != info.filename or any(ord(char) < 32 or ord(char) == 127 for char in original):
        raise ProjectPackageError("El ZIP contiene un nombre de archivo no válido.")
    name = unicodedata.normalize("NFC", original.replace("\\", "/"))
    if len(name) > MAX_PACKAGE_PATH_CHARS:
        raise ProjectPackageError("El ZIP contiene una ruta demasiado larga. Acorta los nombres de carpetas o archivos.")
    if name.startswith("/") or ":" in name:
        raise ProjectPackageError("El ZIP contiene una ruta absoluta o no segura. Crea el paquete desde su carpeta de proyecto.")
    mode = (info.external_attr >> 16) & 0xFFFF
    file_type = stat.S_IFMT(mode)
    if file_type not in {0, stat.S_IFREG, stat.S_IFDIR}:
        raise ProjectPackageError("El ZIP contiene enlaces o archivos especiales. Incluye copias normales de los planos.")
    directory = name.endswith("/") or file_type == stat.S_IFDIR
    path = name[:-1] if name.endswith("/") else name
    if any(part in {"", ".", ".."} for part in path.split("/")):
        raise ProjectPackageError("El ZIP contiene una ruta no segura. Revisa los nombres de sus carpetas y archivos.")
    if info.flag_bits & (0x1 | 0x40 | 0x2000):
        raise ProjectPackageError("El ZIP contiene archivos cifrados. Crea una copia sin contraseña.")
    if info.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}:
        raise ProjectPackageError("El ZIP utiliza una compresión no compatible. Crea un ZIP estándar con compresión normal.")
    return path, directory


def _inventory(archive: zipfile.ZipFile, filename: str) -> tuple[dict, dict[str, zipfile.ZipInfo]]:
    entries = []
    members = {}
    seen = set()
    regular_paths = set()
    skipped_entries = []
    skipped_counts = {"auxiliary": 0, "unsupported_format": 0, "nested_archive": 0}
    uncompressed = 0
    information = archive.infolist()
    if len(information) > MAX_PACKAGE_ENTRIES:
        raise ProjectPackageError("El ZIP contiene más de 1.000 entradas. Divide el paquete en grupos más pequeños.")
    for info in information:
        path, directory = _member_path(info)
        normalized_key = path.casefold()
        if normalized_key in seen:
            raise ProjectPackageError("El ZIP contiene rutas duplicadas o ambiguas. Asigna nombres diferentes a sus archivos.")
        seen.add(normalized_key)
        if not directory:
            regular_paths.add(normalized_key)
        if info.file_size < 0 or info.compress_size < 0:
            raise _invalid_package()
        uncompressed += info.file_size
        if uncompressed > MAX_PACKAGE_UNCOMPRESSED_BYTES:
            raise ProjectPackageError("El contenido del ZIP supera 150 MB sin comprimir. Divide el paquete.")
        if info.file_size >= RATIO_CHECK_MIN_BYTES and info.file_size > info.compress_size * MAX_COMPRESSION_RATIO:
            raise ProjectPackageError("El ZIP tiene una expansión excesiva al descomprimir. Crea un paquete más pequeño con los planos necesarios.")
        if directory:
            continue
        parts = path.split("/")
        basename = parts[-1]
        extension = basename.rsplit(".", 1)[-1].lower() if "." in basename else ""
        auxiliary = any(part.casefold() == "__macosx" for part in parts) or basename.casefold() == ".ds_store" or basename.startswith("._")
        reason = "auxiliary" if auxiliary else "nested_archive" if extension in ARCHIVE_FORMATS else "unsupported_format" if extension not in DRAWING_FORMATS else None
        if reason:
            skipped_counts[reason] += 1
            if len(skipped_entries) < 100:
                skipped_entries.append({"path": path, "reason": reason})
            continue
        if info.file_size > MAX_BYTES:
            raise ProjectPackageError(f"Un plano del ZIP supera 15 MB: {path}. Divide o reduce ese archivo.")
        entries.append({"path": path, "filename": basename, "format": extension, "size_bytes": info.file_size})
        members[path] = info
        if len(entries) > MAX_PACKAGE_DRAWINGS:
            raise ProjectPackageError("El ZIP contiene más de 100 planos compatibles. Divide el paquete.")
    # A regular file cannot also be a parent folder for another entry.
    for key in seen:
        parts = key.split("/")
        if any("/".join(parts[:index]) in regular_paths for index in range(1, len(parts))):
            raise ProjectPackageError("El ZIP utiliza la misma ruta como archivo y carpeta. Revisa su estructura.")
    if not entries:
        raise ProjectPackageError("El ZIP no contiene planos PDF, DXF o DWG compatibles. Los archivos comprimidos internos no se abren.")
    entries.sort(key=lambda item: (item["path"].casefold(), item["path"]))
    warnings = ["Los archivos del paquete se inspeccionan por separado. No se combinan automáticamente ni se ensamblan referencias CAD externas."]
    if skipped_counts["nested_archive"]:
        warnings.append("Se omitieron archivos comprimidos internos; coloca los planos directamente en las carpetas del ZIP.")
    if skipped_counts["unsupported_format"]:
        warnings.append("Algunos archivos tienen formatos no compatibles y no se inspeccionan.")
    skipped_count = sum(skipped_counts.values())
    package = {
        "filename": filename.rsplit("/", 1)[-1].rsplit("\\", 1)[-1],
        "entries": entries,
        "selected_entry": None,
        "skipped_count": skipped_count,
        "skipped_counts": skipped_counts,
        "skipped_entries": skipped_entries,
        "skipped_entries_truncated": skipped_count > len(skipped_entries),
        "uncompressed_bytes": uncompressed,
        "warnings": warnings,
        "stored": False,
        "limits": {
            "archive_bytes": MAX_PACKAGE_BYTES, "drawing_bytes": MAX_BYTES,
            "archive_entries": MAX_PACKAGE_ENTRIES, "drawings": MAX_PACKAGE_DRAWINGS,
            "uncompressed_bytes": MAX_PACKAGE_UNCOMPRESSED_BYTES,
            "inspection": "one_selected_document",
        },
    }
    return package, members


def _read_member(archive: zipfile.ZipFile, member: zipfile.ZipInfo) -> bytes:
    output = BytesIO()
    with archive.open(member, "r") as stream:
        while True:
            chunk = stream.read(min(READ_CHUNK_BYTES, MAX_BYTES + 1 - output.tell()))
            if not chunk:
                break
            output.write(chunk)
            if output.tell() > MAX_BYTES:
                raise ProjectPackageError("El plano descomprimido supera 15 MB. Reduce ese archivo.")
    if output.tell() != member.file_size:
        raise zipfile.BadZipFile("Member length mismatch")
    return output.getvalue()


def _document_failure(entry: dict, package: dict, message: str, *, code: str = "document_inspection_failed", retryable: bool = False) -> dict:
    return {
        "format": entry["format"], "role": "blueprint", "filename": entry["filename"],
        "drawing_views": [], "package": package,
        "inspection_status": "failed", "inspection_error": message,
        "inspection_error_code": code, "inspection_retryable": retryable,
        "warnings": [], "compliance_checked": False, "official_approval": False,
    }


def analyze_project_package(data: bytes, filename: str, selected_entry: str | None = None) -> dict:
    """Return the inventory plus one selected document, with no persistent files."""
    _preflight_directory(data)
    try:
        archive = zipfile.ZipFile(BytesIO(data), "r")
    except (zipfile.BadZipFile, zipfile.LargeZipFile, OSError, ValueError, NotImplementedError) as exc:
        raise _invalid_package() from exc
    with archive:
        package, members = _inventory(archive, filename)
        selected = selected_entry if selected_entry is not None else package["entries"][0]["path"]
        if selected not in members:
            raise ProjectPackageError("El plano elegido no pertenece al inventario del ZIP. Selecciona uno de la lista.")
        package["selected_entry"] = selected
        entry = next(item for item in package["entries"] if item["path"] == selected)
        try:
            content = _read_member(archive, members[selected])
        except (zipfile.BadZipFile, RuntimeError, OSError, ValueError, EOFError, zlib.error, struct.error):
            return _document_failure(entry, package,
                "No se pudo leer este plano del ZIP o no pasó la comprobación de integridad. Prueba otro archivo del paquete o solicita una copia nueva.",
                code="package_member_unreadable")
        try:
            result = analyze_document(content, entry["filename"], "blueprint")
        except DwgConversionError as exc:
            return _document_failure(entry, package, exc.message, code=exc.code, retryable=exc.status_code in {503, 504})
        except CadImportBusyError as exc:
            return _document_failure(entry, package, str(exc), code="cad_import_busy", retryable=True)
        except ValueError as exc:
            return _document_failure(entry, package, str(exc))
        except Exception:
            # Native PDF/CAD libraries may raise their own exception families.
            # This recovery is only for the chosen document, after ZIP checks.
            logger.exception("Selected project drawing inspection failed")
            return _document_failure(entry, package,
                "No se pudo inspeccionar este plano. Prueba otro archivo del paquete o solicita una copia nueva.")
        result["package"] = package
        return result
