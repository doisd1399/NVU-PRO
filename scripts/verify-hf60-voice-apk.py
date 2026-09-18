from pathlib import Path
import hashlib
import sys
import zipfile

release_dir = Path("android/app/build/outputs/apk/release")
preferred = release_dir / "app-release-unsigned.apk"
candidates = [preferred] if preferred.is_file() else sorted(release_dir.glob("*.apk"))
if not candidates:
    raise SystemExit("ERROR: release APK not found")
apk = candidates[0]

expected = {
    "nvu_ready_voice_pt_br.mp3": {
        "size": 18576,
        "sha256": "b53a46523dbbe745ac0a9600637ffce7f1f9c34667c64b2b1730c0df32b60bf2",
    },
    "nvu_trip_completed_voice_pt_br.mp3": {
        "size": 39888,
        "sha256": "49c9c7fb8585b4385971cc3d19c59f8df0015e6e2c74ab1ae4bce7cd45fb7179",
    },
}

found = {}
print(f"Checking APK: {apk}")
with zipfile.ZipFile(apk) as zf:
    for info in zf.infolist():
        if info.is_dir():
            continue
        matching = [(label, spec) for label, spec in expected.items() if label not in found and info.file_size == spec["size"]]
        if not matching:
            continue
        data = zf.read(info.filename)
        digest = hashlib.sha256(data).hexdigest()
        for label, spec in matching:
            if digest == spec["sha256"]:
                found[label] = info.filename
                print(f"FOUND {label}: {info.filename} SHA256={digest}")

missing = [label for label in expected if label not in found]
if missing:
    for label in missing:
        print(f"ERROR: approved audio bytes missing from APK: {label}", file=sys.stderr)
    raise SystemExit(1)

print("HF60 approved voice assets verified byte-for-byte inside APK.")
