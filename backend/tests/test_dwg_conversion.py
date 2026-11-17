"""Exercise local conversion boundaries without adding private drawings to git."""
from io import StringIO
import json
import os
from pathlib import Path
import sys
import time

import pytest

from app import dwg_conversion as dwg


SOURCE = b"AC1021" + b"\x00" * 100
DXF = (b"0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1021\n"
       b"0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n")


@pytest.fixture
def converter(tmp_path, monkeypatch):
    """An executable supplied by the server, never by the uploaded document."""
    dwg._engine_version.cache_clear()

    def create(body):
        executable = tmp_path / "dwg2dxf"
        executable.write_text(
            f"#!{sys.executable}\n"
            "import os, sys, json, time\nfrom pathlib import Path\n"
            "if '--version' in sys.argv:\n"
            "    print('dwg2dxf 0.14.9086')\n    sys.exit(0)\n"
            + body + "\n"
        )
        executable.chmod(0o700)
        monkeypatch.setenv("DWG_CONVERTER_PATH", str(executable))
        return executable

    return create


def test_conversion_uses_fixed_files_cleans_up_and_limits_native_process(converter, tmp_path, monkeypatch):
    evidence = tmp_path / "invocation.json"
    monkeypatch.setenv("DWG_TEST_SECRET", "must-not-reach-parser")
    converter(
        "import resource\n"
        "assert 'DWG_TEST_SECRET' not in os.environ\n"
        f"Path({str(evidence)!r}).write_text(json.dumps({{"
        "'argv': sys.argv[1:], 'cwd': str(Path.cwd()),"
        "'input': Path('input.dwg').read_bytes().hex(),"
        "'memory': resource.getrlimit(resource.RLIMIT_AS)[0],"
        "'cpu': resource.getrlimit(resource.RLIMIT_CPU)[0],"
        "'file': resource.getrlimit(resource.RLIMIT_FSIZE)[0]}))\n"
        f"Path('output.dxf').write_bytes({DXF!r})"
    )

    result = dwg.convert_dwg_to_dxf(SOURCE)
    observed = json.loads(evidence.read_text())

    assert result.dxf_bytes == DXF
    assert observed["argv"] == ["--as", "r2007", "-o", "output.dxf", "input.dwg"]
    assert bytes.fromhex(observed["input"]) == SOURCE
    assert not Path(observed["cwd"]).exists()
    assert 0 < observed["memory"] <= dwg.MEMORY_LIMIT_BYTES
    assert 0 < observed["cpu"] <= dwg.CPU_LIMIT_SECONDS
    assert 0 < observed["file"] <= dwg.MAX_OUTPUT_BYTES
    assert result.metadata["engine"] == "LibreDWG"
    assert result.metadata["engine_version"] == "0.14.9086"
    assert result.metadata["source_version"] == "AC1021"
    assert result.metadata["geometry_verified"] is False
    assert observed["cwd"] not in json.dumps(result.metadata)


@pytest.mark.parametrize("data,code", [
    (b"", "dwg_size_limit"),
    (b"%PDF-1.4", "invalid_dwg"),
    (b"AC1009" + b"\x00" * 20, "invalid_dwg"),
    (b"AC9999" + b"\x00" * 20, "invalid_dwg"),
])
def test_rejects_empty_wrong_and_unsupported_headers_before_running_converter(data, code, monkeypatch):
    monkeypatch.setattr(dwg, "_find_converter", lambda: pytest.fail("converter should not run"))
    with pytest.raises(dwg.DwgConversionError) as raised:
        dwg.convert_dwg_to_dxf(data)
    assert (raised.value.code, raised.value.status_code) == (code, 422)


def test_missing_converter_is_retryable_and_does_not_disclose_configuration(monkeypatch):
    monkeypatch.setenv("DWG_CONVERTER_PATH", "/private/server/missing/dwg2dxf")
    assert dwg.converter_available() is False
    with pytest.raises(dwg.DwgConversionError) as raised:
        dwg.convert_dwg_to_dxf(SOURCE)
    assert raised.value.status_code == 503
    assert raised.value.code == "dwg_converter_unavailable"
    assert "/private" not in raised.value.message


def test_relative_deployment_path_is_anchored_to_repo_and_health_does_not_execute(converter, tmp_path, monkeypatch):
    executable = converter("raise RuntimeError('health must not execute this')")
    monkeypatch.setattr(dwg, "_REPO_ROOT", tmp_path)
    monkeypatch.setenv("DWG_CONVERTER_PATH", executable.name)
    monkeypatch.chdir(tmp_path.parent)
    monkeypatch.setattr(dwg.subprocess, "Popen", lambda *a, **kw: pytest.fail("readiness executed a process"))
    assert dwg.converter_available() is True
    assert dwg._find_converter() == executable


def test_only_one_conversion_can_run_per_api_process(converter):
    converter(f"Path('output.dxf').write_bytes({DXF!r})")
    assert dwg._CONVERSION_SLOT.acquire(blocking=False)
    try:
        with pytest.raises(dwg.DwgConversionError) as raised:
            dwg.convert_dwg_to_dxf(SOURCE)
        assert (raised.value.code, raised.value.status_code) == ("dwg_converter_busy", 503)
    finally:
        dwg._CONVERSION_SLOT.release()
    assert dwg.convert_dwg_to_dxf(SOURCE).dxf_bytes == DXF


@pytest.mark.parametrize("body", [
    "print('/private/owner/drawing.dwg: invalid entity'); sys.exit(7)",
    "pass",  # Converter reports success without producing a file.
    "Path('output.dxf').write_bytes(b'not a DXF')",
    f"Path('output.dxf').write_bytes({DXF.replace(b'AC1021', b'AC1032')!r})",
    f"Path('output.dxf').write_bytes({DXF[:-4]!r})",  # Truncated output.
    "Path('output.dxf').symlink_to('/etc/passwd')",
])
def test_failed_invalid_or_unexpected_output_is_rejected_without_leaking_logs(converter, body):
    converter(body)
    with pytest.raises(dwg.DwgConversionError) as raised:
        dwg.convert_dwg_to_dxf(SOURCE)
    assert raised.value.status_code == 422
    assert raised.value.code == "dwg_conversion_failed"
    assert "/private" not in raised.value.message
    assert "/etc" not in raised.value.message


def test_verbose_output_is_drained_but_only_generic_bounded_metadata_is_returned(converter, monkeypatch):
    monkeypatch.setattr(dwg, "MAX_LOG_BYTES", 128)
    converter(
        "print('WARNING /private/customer/plan.dwg ' + 'x' * 100000)\n"
        f"Path('output.dxf').write_bytes({DXF!r})"
    )
    result = dwg.convert_dwg_to_dxf(SOURCE)
    assert result.metadata["diagnostics_truncated"] is True
    assert result.metadata["converter_reported_warnings"] is True
    assert result.metadata["status"] == "converted_with_warnings"
    assert len(result.metadata["warnings"]) == 2
    assert "/private" not in json.dumps(result.metadata)
    assert len(json.dumps(result.metadata)) < 2000


def test_timeout_terminates_child_cleans_temporary_files_and_releases_slot(converter, tmp_path, monkeypatch):
    evidence = tmp_path / "timeout-cwd.txt"
    converter(f"Path({str(evidence)!r}).write_text(str(Path.cwd()))\ntime.sleep(20)")
    monkeypatch.setattr(dwg, "CONVERSION_TIMEOUT_SECONDS", 0.2)
    started = time.monotonic()
    with pytest.raises(dwg.DwgConversionError) as raised:
        dwg.convert_dwg_to_dxf(SOURCE)
    assert (raised.value.code, raised.value.status_code) == ("dwg_conversion_timeout", 504)
    assert time.monotonic() - started < 5
    assert not Path(evidence.read_text()).exists()
    assert dwg._CONVERSION_SLOT.acquire(blocking=False)
    dwg._CONVERSION_SLOT.release()


def test_native_file_size_limit_prevents_unbounded_output(converter, monkeypatch):
    monkeypatch.setattr(dwg, "MAX_OUTPUT_BYTES", 1024)
    converter("Path('output.dxf').write_bytes(b'x' * 1024 * 1024)")
    with pytest.raises(dwg.DwgConversionError) as raised:
        dwg.convert_dwg_to_dxf(SOURCE)
    assert raised.value.status_code == 422


@pytest.mark.skipif(not os.environ.get("PREDIOAI_TEST_DWG"),
                    reason="Real drawing is supplied privately via PREDIOAI_TEST_DWG")
def test_real_private_dwg_with_configured_converter():
    """Opt-in local integration; neither the drawing nor its contents enter git."""
    import ezdxf

    source = Path(os.environ["PREDIOAI_TEST_DWG"]).read_bytes()
    assert dwg.converter_available(), "Set DWG_CONVERTER_PATH to the tested native converter"
    converted = dwg.convert_dwg_to_dxf(source)
    document = ezdxf.read(StringIO(converted.dxf_bytes.decode("utf-8-sig"), newline=None))
    assert document.dxfversion == "AC1021"
    assert len(document.modelspace()) > 0
    assert converted.metadata["source_version"] == source[:6].decode("ascii")
    assert converted.metadata["geometry_verified"] is False
