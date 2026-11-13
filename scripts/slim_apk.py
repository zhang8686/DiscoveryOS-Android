"""Repack a signed NSH Android APK so its native libraries are stored compressed.

NSH emits `android:extractNativeLibs="false"` with `lib/<abi>/*.so` stored
uncompressed and page-aligned (loaded straight from the APK). Flipping the
flag to true and deflating those entries cuts the download size by roughly
60% at the cost of the installer unpacking the libraries onto the device.

Only two things change in the archive:
  * the boolean attribute `android:extractNativeLibs` (4 bytes in binary XML)
  * the ZIP storage method of `lib/<abi>/*.so` entries

Every other entry is copied byte-for-byte, so the app bundle, dex, resources
and capabilities are untouched. Old signature files are dropped; the output
MUST be zipaligned and re-signed before distribution.

Usage:
    python scripts/slim_apk.py <input.apk> <unsigned-output.apk>
    zipalign -f -p 4 <unsigned-output.apk> <aligned.apk>
    apksigner sign --ks <keystore> --ks-key-alias <alias> \
        --v2-signing-enabled true --v3-signing-enabled true \
        --out <final.apk> <aligned.apk>
"""
import struct
import sys
import zipfile
from pathlib import Path

SO_PREFIX = "lib/"
SO_SUFFIX = ".so"
MANIFEST = "AndroidManifest.xml"


def parse_string_pool(buf, off):
    ctype, hsize, csize = struct.unpack_from("<HHI", buf, off)
    assert ctype == 1, f"expected string pool, got {ctype:#x}"
    count, _styles, flags, str_start, _ = struct.unpack_from("<IIIII", buf, off + 8)
    offsets = struct.unpack_from("<" + "I" * count, buf, off + hsize)
    utf8 = bool(flags & 0x100)
    base = off + str_start
    out = []
    for o in offsets:
        p = base + o
        if utf8:
            def varint(q):
                v = buf[q]
                q += 1
                if v & 0x80:
                    v = ((v & 0x7F) << 8) | buf[q]
                    q += 1
                return v, q
            _, p = varint(p)
            n, p = varint(p)
            out.append(bytes(buf[p:p + n]).decode("utf-8", "replace"))
        else:
            n = struct.unpack_from("<H", buf, p)[0]
            p += 2
            if n & 0x8000:
                n = ((n & 0x7FFF) << 16) | struct.unpack_from("<H", buf, p)[0]
                p += 2
            out.append(bytes(buf[p:p + n * 2]).decode("utf-16-le", "replace"))
    return out, off + csize


def flip_extract_native_libs(axml):
    """Return (xml_bytes, changed). Idempotent: a manifest already set to true
    is returned unchanged."""
    buf = bytearray(axml)
    ctype, hsize, _total = struct.unpack_from("<HHI", buf, 0)
    assert ctype == 3, "not a binary AndroidManifest.xml"
    strings = []
    off = hsize
    while off + 8 <= len(buf):
        ct, hs, cs = struct.unpack_from("<HHI", buf, off)
        if cs < 8:
            break
        if ct == 1:
            strings, _ = parse_string_pool(buf, off)
        elif ct == 0x0102:  # RES_XML_START_ELEMENT_TYPE
            attr_start, attr_size, attr_count, _, _, _ = struct.unpack_from(
                "<HHHHHH", buf, off + hs + 8)
            attrs = off + hs + attr_start
            for i in range(attr_count):
                a = attrs + i * attr_size
                name = struct.unpack_from("<I", buf, a + 4)[0]
                label = strings[name] if name < len(strings) else "?"
                if label == "extractNativeLibs":
                    _size, _res0, dtype, data = struct.unpack_from("<HBBI", buf, a + 12)
                    assert dtype == 0x12, "extractNativeLibs is not a boolean"
                    if data != 0:
                        return bytes(axml), False  # already true
                    struct.pack_into("<I", buf, a + 16, 0xFFFFFFFF)
                    return bytes(buf), True
        off += cs
    raise SystemExit("error: extractNativeLibs attribute not found in manifest")


def repack(src, dst):
    zin = zipfile.ZipFile(src)
    manifest, changed = flip_extract_native_libs(zin.read(MANIFEST))
    so_names = [i.filename for i in zin.infolist()
                if i.filename.startswith(SO_PREFIX) and i.filename.endswith(SO_SUFFIX)]
    if not so_names:
        raise SystemExit("error: no native libraries found in APK")

    zout = zipfile.ZipFile(dst, "w", allowZip64=True)
    kept = 0
    for it in zin.infolist():
        if it.filename.startswith("META-INF/"):
            continue  # old signature is invalid after repacking
        data = zin.read(it.filename)
        if it.filename == MANIFEST:
            data = manifest
        zi = zipfile.ZipInfo(it.filename, date_time=it.date_time)
        zi.external_attr = it.external_attr
        zi.internal_attr = it.internal_attr
        zi.create_system = it.create_system
        zi.comment = it.comment
        if it.filename in so_names:
            zi.compress_type = zipfile.ZIP_DEFLATED
            zout.writestr(zi, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
        else:
            zi.compress_type = it.compress_type
            zout.writestr(zi, data, compress_type=it.compress_type)
        kept += 1
    zout.close()
    zin.close()
    return kept, len(so_names), changed


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: python scripts/slim_apk.py <input.apk> <unsigned-output.apk>")
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    if not src.is_file():
        raise SystemExit(f"error: {src} does not exist")
    dst.parent.mkdir(parents=True, exist_ok=True)
    kept, nso, changed = repack(src, dst)
    print(f"manifest extractNativeLibs -> true: {'changed' if changed else 'already true'}")
    print(f"native libraries deflated: {nso} | entries kept: {kept} (old signature dropped)")
    print(f"input : {src.stat().st_size:,} B")
    print(f"output: {dst.stat().st_size:,} B (unsigned — align and sign before distributing)")


if __name__ == "__main__":
    main()
