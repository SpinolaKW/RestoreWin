"""Boundary tests: malformed input rejection and necessary HVCI image checks."""

import struct
import unittest

from tools.check_driver_images import InvalidImage, inspect_image


def image(*, flags=0x60000020, alignment=0x1000, rva=0x1000, subsystem=1):
    data = bytearray(0x400)
    data[:2] = b"MZ"
    struct.pack_into("<I", data, 0x3C, 0x80)
    data[0x80:0x84] = b"PE\0\0"
    struct.pack_into("<HHIIIHH", data, 0x84, 0x8664, 1, 0, 0, 0, 240, 0x22)
    optional = 0x98
    struct.pack_into("<H", data, optional, 0x20B)
    struct.pack_into("<I", data, optional + 32, alignment)
    struct.pack_into("<H", data, optional + 68, subsystem)
    struct.pack_into("<I", data, optional + 108, 16)
    section = optional + 240
    struct.pack_into("<8sIIII", data, section, b"INIT", 32, rva, 0x200, 0x200)
    struct.pack_into("<I", data, section + 36, flags)
    return bytes(data)


class DriverImagesTest(unittest.TestCase):
    def test_read_execute_image_does_not_claim_windows_compatibility(self):
        result = inspect_image(image())
        self.assertTrue(result["static_checks_passed"])
        self.assertEqual(result["windows_compatibility"], "unverified")
        self.assertEqual(result["runtime_checks"], "not performed")

    def test_writable_initialization_code_is_rejected(self):
        result = inspect_image(image(flags=0xE2000020))
        self.assertFalse(result["static_checks_passed"])
        self.assertEqual(result["blocking_findings"][0]["code"], "writable_executable_section")

    def test_writable_non_executable_data_is_allowed(self):
        self.assertTrue(inspect_image(image(flags=0xC0000040))["static_checks_passed"])

    def test_non_page_aligned_images_are_rejected(self):
        result = inspect_image(image(alignment=32, rva=0x120))
        self.assertEqual({x["code"] for x in result["blocking_findings"]}, {"section_alignment", "section_rva_alignment"})

    def test_application_is_not_mistaken_for_native_driver(self):
        self.assertEqual(inspect_image(image(subsystem=2))["blocking_findings"][0]["code"], "wrong_subsystem")

    def test_truncated_headers_and_section_data_are_rejected(self):
        data = image()
        for size in (0, 2, 63, 0x80, 0x98, 0x150, 0x190, 0x300):
            with self.subTest(size=size), self.assertRaises(InvalidImage):
                inspect_image(data[:size])

    def test_out_of_bounds_header_offset_is_rejected(self):
        data = bytearray(image())
        struct.pack_into("<I", data, 0x3C, 0xFFFFFFF0)
        with self.assertRaises(InvalidImage):
            inspect_image(bytes(data))

    def test_directory_array_cannot_escape_optional_header(self):
        data = bytearray(image())
        struct.pack_into("<I", data, 0x98 + 108, 17)
        with self.assertRaises(InvalidImage):
            inspect_image(bytes(data))

    def test_certificate_table_cannot_escape_file(self):
        data = bytearray(image())
        struct.pack_into("<II", data, 0x98 + 112 + 4 * 8, 0x300, 0x200)
        with self.assertRaises(InvalidImage):
            inspect_image(bytes(data))


if __name__ == "__main__":
    unittest.main()
