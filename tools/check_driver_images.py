"""Check necessary PE properties for x64 HVCI driver development.

This checks image bytes only. Passing does not establish Windows compatibility,
signature trust, runtime memory behavior, or safe storage-filter behavior.
Targets are never loaded or executed. Python 3.10+; standard library only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import stat
import struct

MAX_IMAGE_BYTES = 64 * 1024 * 1024


class InvalidImage(ValueError):
    pass


def inspect_image(data: bytes) -> dict:
    def unpack(fmt: str, offset: int):
        size = struct.calcsize(fmt)
        if offset < 0 or offset + size > len(data):
            raise InvalidImage("Truncated PE headers")
        return struct.unpack_from(fmt, data, offset)

    if len(data) > MAX_IMAGE_BYTES:
        raise InvalidImage("Image exceeds the 64 MiB analysis limit")
    if data[:2] != b"MZ":
        raise InvalidImage("Missing DOS signature")
    pe_offset, = unpack("<I", 0x3C)
    if pe_offset < 64 or data[pe_offset:pe_offset + 4] != b"PE\0\0":
        raise InvalidImage("Invalid PE signature or header offset")
    machine, section_count, _, _, _, optional_size, _ = unpack("<HHIIIHH", pe_offset + 4)
    if not 1 <= section_count <= 96:
        raise InvalidImage("Invalid PE section count")
    optional = pe_offset + 24
    section_table = optional + optional_size
    if optional_size < 112 or section_table + section_count * 40 > len(data):
        raise InvalidImage("Truncated optional header or section table")
    magic, = unpack("<H", optional)
    if magic != 0x20B:
        raise InvalidImage("Expected PE32+ x64 driver image")
    alignment, = unpack("<I", optional + 32)
    subsystem, = unpack("<H", optional + 68)
    directory_count, = unpack("<I", optional + 108)
    if directory_count > (optional_size - 112) // 8:
        raise InvalidImage("Data directories exceed optional header")
    certificate_size = 0
    if directory_count >= 5:
        certificate_offset, certificate_size = unpack("<II", optional + 112 + 4 * 8)
        if bool(certificate_offset) != bool(certificate_size):
            raise InvalidImage("Incomplete certificate table location")
        if certificate_offset + certificate_size > len(data):
            raise InvalidImage("Certificate table extends beyond image")

    findings = []
    if machine != 0x8664:
        findings.append({"code": "wrong_architecture", "detail": "Expected AMD64 (0x8664)"})
    if subsystem != 1:
        findings.append({"code": "wrong_subsystem", "detail": "Expected native driver subsystem (1)"})
    if not alignment or alignment % 0x1000:
        findings.append({"code": "section_alignment", "detail": "Driver SectionAlignment must be a multiple of 0x1000"})

    sections = []
    for number in range(section_count):
        offset = section_table + number * 40
        name, virtual_size, rva, raw_size, raw_offset = unpack("<8sIIII", offset)
        flags, = unpack("<I", offset + 36)
        if raw_size and (not raw_offset or raw_offset + raw_size > len(data)):
            raise InvalidImage("Section data extends beyond image")
        section = {
            "name": name.rstrip(b"\0").decode("ascii", errors="replace"),
            "rva": rva,
            "virtual_size": virtual_size,
            "characteristics": f"0x{flags:08X}",
            "writable": bool(flags & 0x80000000),
            "executable": bool(flags & 0x20000000),
        }
        sections.append(section)
        if section["writable"] and section["executable"]:
            findings.append({"code": "writable_executable_section", "section": section["name"], "rva": rva})
        if rva % 0x1000:
            findings.append({"code": "section_rva_alignment", "section": section["name"], "rva": rva})

    return {
        "sha256": hashlib.sha256(data).hexdigest(),
        "machine": f"0x{machine:04X}",
        "subsystem": subsystem,
        "section_alignment": alignment,
        "embedded_certificate_bytes": certificate_size,
        "sections": sections,
        "blocking_findings": findings,
        "static_checks_passed": not findings,
        "windows_compatibility": "unverified",
        "signature_trust": "unverified; a separate catalog signature may apply",
        "runtime_checks": "not performed",
    }


def inspect_file(path: Path) -> dict:
    if not stat.S_ISREG(path.stat().st_mode):
        raise InvalidImage("Expected a regular image file, not a device")
    with path.open("rb") as file:
        data = file.read(MAX_IMAGE_BYTES + 1)
    return {"path": str(path), **inspect_image(data)}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("images", nargs="+", type=Path, help="Explicit .sys images to inspect")
    args = parser.parse_args(argv)
    reports = []
    exit_code = 0
    for path in args.images:
        try:
            report = inspect_file(path)
            if not report["static_checks_passed"]:
                exit_code = max(exit_code, 1)
        except (OSError, InvalidImage) as error:
            report = {"path": str(path), "error": str(error), "windows_compatibility": "unverified"}
            exit_code = 2
        reports.append(report)
    print(json.dumps({"images": reports}, ensure_ascii=False, indent=2))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
