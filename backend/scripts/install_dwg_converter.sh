#!/usr/bin/env bash
# Build a pinned upstream snapshot with post-0.14 security fixes.
# Invoked during deployment, never in response to an uploaded file.
set -euo pipefail

predio_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cad_install="${PREDIO_CAD_DIR:-${predio_root}/.cad}"
cad_version="0.14.9086"
cad_sha256="7bfce52b0dbcf68ac29ece4e0df82954aa3628c7f6863f8d4b4040a4e2f81bc7"
cad_source_url="https://github.com/LibreDWG/libredwg/releases/download/${cad_version}/libredwg-${cad_version}.tar.xz"

if [[ -x "${cad_install}/bin/dwg2dxf" ]] && \
   [[ "$("${cad_install}/bin/dwg2dxf" --version)" == "dwg2dxf ${cad_version}" ]]; then
  printf 'DWG converter %s is ready.\n' "${cad_version}"
  exit 0
fi

cad_build="$(mktemp -d "${TMPDIR:-/tmp}/predio-cad-build.XXXXXX")"
trap 'rm -rf "${cad_build}"' EXIT
cad_archive="${cad_build}/source.tar.xz"
printf 'Building DWG converter %s.\n' "${cad_version}"
curl --fail --location --silent --show-error --retry 2 --max-time 120 \
  "${cad_source_url}" --output "${cad_archive}"
printf '%s  %s\n' "${cad_sha256}" "${cad_archive}" | sha256sum --check --status
tar -xJf "${cad_archive}" -C "${cad_build}"
cd "${cad_build}/libredwg-${cad_version}"
./configure --disable-bindings --disable-docs --disable-shared
make -j2
mkdir -p "${cad_install}/bin" "${cad_install}/share/libredwg"
install -m 755 programs/dwg2dxf "${cad_install}/bin/dwg2dxf"
install -m 644 COPYING "${cad_install}/share/libredwg/COPYING"
printf 'GNU LibreDWG %s\nSource: %s\nSHA-256: %s\n' \
  "${cad_version}" "${cad_source_url}" "${cad_sha256}" \
  > "${cad_install}/share/libredwg/SOURCE.txt"
"${cad_install}/bin/dwg2dxf" --version
