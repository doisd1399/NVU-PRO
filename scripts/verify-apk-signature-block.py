from pathlib import Path
import sys
import zipfile

apk = Path(sys.argv[1])
with zipfile.ZipFile(apk) as archive:
    names = archive.namelist()
    v1_entries = [name for name in names if name.startswith("META-INF/") and (name.endswith(".RSA") or name.endswith(".DSA") or name.endswith(".EC"))]
    if not v1_entries:
        raise SystemExit("APK signature v1 certificate entry not found")
    start_dir = archive.start_dir

with apk.open("rb") as handle:
    handle.seek(start_dir - 24)
    footer = handle.read(24)

if len(footer) != 24 or footer[8:] != b"APK Sig Block 42":
    raise SystemExit("APK Signing Block v2 not found")

print(f"APK SIGNATURE PASS: v1={len(v1_entries)} certificate entry/entries; v2=present; central_directory={start_dir}")
