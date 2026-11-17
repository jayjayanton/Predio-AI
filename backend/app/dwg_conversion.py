"""Bounded, local DWG-to-DXF conversion using a server-managed LibreDWG CLI.

The converter is installed at deployment time, never from an upload. This is a
synchronous operation: async callers must use a worker thread. Resource limits
are applied by a fresh child interpreter, not by preexec_fn in the web process.
"""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import os
from pathlib import Path
import re
import selectors
import shutil
import signal
import stat
import subprocess
import sys
from tempfile import TemporaryDirectory
from threading import BoundedSemaphore
import time


MAX_INPUT_BYTES = 15 * 1024 * 1024
MAX_OUTPUT_BYTES = 15 * 1024 * 1024
MAX_LOG_BYTES = 64 * 1024
MEMORY_LIMIT_BYTES = 384 * 1024 * 1024
CPU_LIMIT_SECONDS = 25
CONVERSION_TIMEOUT_SECONDS = 30
_REPO_ROOT = Path(__file__).resolve().parents[2]
_CONVERSION_SLOT = BoundedSemaphore(1)

DWG_VERSIONS = {
    b"AC1012": "AutoCAD R13",
    b"AC1014": "AutoCAD R14",
    b"AC1015": "AutoCAD 2000–2002",
    b"AC1018": "AutoCAD 2004–2006",
    b"AC1021": "AutoCAD 2007–2009",
    b"AC1024": "AutoCAD 2010–2012",
    b"AC1027": "AutoCAD 2013–2017",
    b"AC1032": "AutoCAD 2018 format",
}

_MESSAGES = {
    "invalid_dwg": "El archivo no tiene una cabecera DWG compatible.",
    "dwg_size_limit": "El archivo DWG está vacío o supera el límite de 15 MB.",
    "dwg_converter_unavailable": "La conversión de DWG no está disponible en este momento. Intenta de nuevo más tarde.",
    "dwg_converter_busy": "Ya se está convirtiendo otro plano DWG. Intenta de nuevo en unos momentos.",
    "dwg_conversion_failed": "No se pudo convertir este DWG. Revisa el archivo original o prueba con una copia en DXF.",
    "dwg_conversion_timeout": "La conversión del DWG superó el tiempo disponible. Prueba con un plano más pequeño o una copia en DXF.",
    "dwg_output_limit": "El DXF generado supera el límite de 15 MB. Divide el plano en archivos más pequeños.",
}

# Only trusted constants and server-resolved executable paths enter this code.
# execv replaces the launcher while preserving its process group and limits.
_LIMITED_EXEC = """
import os, signal, sys
try:
    import resource
    limits = (
        (resource.RLIMIT_AS, int(sys.argv[1])),
        (resource.RLIMIT_CPU, int(sys.argv[2])),
        (resource.RLIMIT_FSIZE, int(sys.argv[3])),
        (resource.RLIMIT_NOFILE, 64),
        (resource.RLIMIT_CORE, 0),
    )
    for kind, requested in limits:
        _, hard = resource.getrlimit(kind)
        limit = requested if hard == resource.RLIM_INFINITY else min(requested, hard)
        ceiling = requested + 1 if kind == resource.RLIMIT_CPU else requested
        ceiling = ceiling if hard == resource.RLIM_INFINITY else min(ceiling, hard)
        resource.setrlimit(kind, (limit, ceiling))
    signal.signal(signal.SIGXCPU, signal.SIG_DFL)
    signal.signal(signal.SIGXFSZ, signal.SIG_DFL)
    os.execv(sys.argv[4], sys.argv[4:])
except (ImportError, OSError, ValueError):
    sys.exit(125)
"""


class DwgConversionError(Exception):
    """A public, path-free error suitable for an HTTP response."""

    def __init__(self, code: str, status_code: int):
        self.code = code
        self.status_code = status_code
        self.message = _MESSAGES[code]
        super().__init__(self.message)


@dataclass(frozen=True)
class DwgConversionResult:
    dxf_bytes: bytes
    metadata: dict


@dataclass(frozen=True)
class _ProcessResult:
    returncode: int
    log: bytes
    log_truncated: bool


def _find_converter() -> Path | None:
    configured = os.environ.get("DWG_CONVERTER_PATH", "").strip()
    if configured:
        path = Path(configured)
        # Relative deployment paths are anchored to this repo, never upload cwd.
        candidates = [path if path.is_absolute() else _REPO_ROOT / path]
    else:
        candidates = [_REPO_ROOT / ".cad/bin/dwg2dxf"]
        found = shutil.which("dwg2dxf")
        if found:
            candidates.append(Path(found))
    for path in candidates:
        try:
            resolved = path.resolve(strict=True)
            if resolved.is_file() and os.access(resolved, os.X_OK):
                return resolved
        except (OSError, RuntimeError):
            continue
    return None


def converter_available() -> bool:
    """Cheap readiness hint; does not execute a converter or validate a drawing."""
    return os.name == "posix" and _find_converter() is not None


def _kill_group(process: subprocess.Popen) -> None:
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait(timeout=2)


def _run_limited(args: list[str], cwd: Path, timeout: float) -> _ProcessResult:
    command = [sys.executable, "-I", "-c", _LIMITED_EXEC,
               str(MEMORY_LIMIT_BYTES), str(CPU_LIMIT_SECONDS),
               str(MAX_OUTPUT_BYTES), *args]
    # The native parser does not need credentials from the API's environment.
    env = {"PATH": os.environ.get("PATH", os.defpath), "LANG": "C.UTF-8",
           "LC_ALL": "C.UTF-8", "TMPDIR": str(cwd)}
    try:
        process = subprocess.Popen(
            command, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            start_new_session=True, shell=False,
        )
    except OSError as exc:
        raise DwgConversionError("dwg_converter_unavailable", 503) from exc
    deadline = time.monotonic() + timeout
    captured = bytearray()
    truncated = False
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            while selector.get_map():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise subprocess.TimeoutExpired(command, timeout)
                for key, _ in selector.select(min(remaining, 0.1)):
                    chunk = os.read(key.fd, 16 * 1024)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    room = max(0, MAX_LOG_BYTES - len(captured))
                    captured.extend(chunk[:room])
                    truncated |= len(chunk) > room
        code = process.wait(timeout=max(0.001, deadline - time.monotonic()))
        return _ProcessResult(code, bytes(captured), truncated)
    except subprocess.TimeoutExpired as exc:
        _kill_group(process)
        raise DwgConversionError("dwg_conversion_timeout", 504) from exc
    finally:
        if process.poll() is None:
            _kill_group(process)
        process.stdout.close()


@lru_cache(maxsize=8)
def _engine_version(executable: str, modified_ns: int) -> str | None:
    """A bounded optional version probe, refreshed when the binary changes."""
    try:
        with TemporaryDirectory(prefix="predioai-dwg-version-") as folder:
            result = _run_limited([executable, "--version"], Path(folder), 3)
        if result.returncode == 0:
            match = re.search(rb"\bdwg2dxf\s+([0-9]+(?:\.[0-9]+)+(?:[-+][A-Za-z0-9.]+)?)",
                              result.log[:4096])
            if match:
                return match.group(1).decode("ascii")
    except (DwgConversionError, OSError):
        pass
    return None


def _read_dxf(path: Path) -> bytes:
    try:
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_size == 0:
            raise DwgConversionError("dwg_conversion_failed", 422)
        if info.st_size > MAX_OUTPUT_BYTES:
            raise DwgConversionError("dwg_output_limit", 422)
        with path.open("rb") as handle:
            output = handle.read(MAX_OUTPUT_BYTES + 1)
    except OSError as exc:
        raise DwgConversionError("dwg_conversion_failed", 422) from exc
    if len(output) > MAX_OUTPUT_BYTES:
        raise DwgConversionError("dwg_output_limit", 422)
    # ASCII DXF R2007 is UTF-8 text and can contain non-ASCII annotations.
    header = output[:64 * 1024]
    if (output.startswith(b"AutoCAD Binary DXF")
            or not re.search(rb"\$ACADVER\s*\r?\n\s*1\s*\r?\nAC1021\s*\r?\n", header)
            or not output.rstrip().endswith(b"EOF")):
        raise DwgConversionError("dwg_conversion_failed", 422)
    return output


def convert_dwg_to_dxf(data: bytes) -> DwgConversionResult:
    """Convert a DWG locally; the result still requires document/geometry review."""
    if not data or len(data) > MAX_INPUT_BYTES:
        raise DwgConversionError("dwg_size_limit", 422)
    signature = data[:6]
    if signature not in DWG_VERSIONS:
        raise DwgConversionError("invalid_dwg", 422)
    executable = _find_converter()
    if os.name != "posix" or executable is None:
        raise DwgConversionError("dwg_converter_unavailable", 503)
    if not _CONVERSION_SLOT.acquire(blocking=False):
        raise DwgConversionError("dwg_converter_busy", 503)
    try:
        version = _engine_version(str(executable), executable.stat().st_mtime_ns)
        with TemporaryDirectory(prefix="predioai-dwg-") as folder:
            work = Path(folder)
            (work / "input.dwg").write_bytes(data)
            result = _run_limited(
                [str(executable), "--as", "r2007", "-o", "output.dxf", "input.dwg"],
                work, CONVERSION_TIMEOUT_SECONDS,
            )
            if result.returncode == 125:
                raise DwgConversionError("dwg_converter_unavailable", 503)
            if result.returncode == -signal.SIGXCPU:
                raise DwgConversionError("dwg_conversion_timeout", 504)
            if result.returncode == -signal.SIGXFSZ:
                raise DwgConversionError("dwg_output_limit", 422)
            if result.returncode != 0:
                raise DwgConversionError("dwg_conversion_failed", 422)
            output = _read_dxf(work / "output.dxf")
        reported = bool(re.search(rb"warn|error|unsupported|skipp|invalid|truncat",
                                  result.log, re.IGNORECASE))
        warnings = [
            "DWG convertido a DXF: revisa geometría, capas, bloques, cotas y unidades. La conversión no garantiza conservar todos los elementos.",
        ]
        if reported or result.log_truncated:
            warnings.append("El conversor emitió avisos. Comprueba el resultado con el plano original antes de utilizar medidas.")
        return DwgConversionResult(output, {
            "status": "converted_with_warnings" if reported or result.log_truncated else "converted",
            "engine": "LibreDWG", "engine_version": version,
            "source_format": "dwg", "source_version": signature.decode("ascii"),
            "source_version_label": DWG_VERSIONS[signature],
            "target_format": "dxf", "target_version": "AC1021",
            "converter_reported_warnings": reported,
            "diagnostics_truncated": result.log_truncated,
            "geometry_verified": False, "warnings": warnings,
        })
    except OSError as exc:
        raise DwgConversionError("dwg_converter_unavailable", 503) from exc
    finally:
        _CONVERSION_SLOT.release()
