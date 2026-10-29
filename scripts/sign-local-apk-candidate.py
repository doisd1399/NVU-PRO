"""Sign a trusted CI intermediate locally; no signing secret is uploaded."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile

EXPECTED_CERT = "806A03EA92B69E7F9A70526E9C4D6A4AE52EC4F9CF7CAC05DDB1AA28084246EA"
parser = argparse.ArgumentParser()
parser.add_argument("--input-dir", type=Path, required=True)
parser.add_argument("--source", type=Path, required=True)
parser.add_argument("--expected-commit", required=True)
parser.add_argument("--keystore", type=Path, required=True)
parser.add_argument("--store-password-file", type=Path, required=True)
parser.add_argument("--key-password-file", type=Path, required=True)
parser.add_argument("--alias", required=True)
parser.add_argument("--output-dir", type=Path, required=True)
args = parser.parse_args()
assert re.fullmatch(r"[0-9a-f]{40}", args.expected_commit), "A concrete trusted commit is required"
inputs = args.input_dir.resolve()
source = args.source.resolve()
provenance = json.loads((inputs / "provenance.json").read_text())
assert provenance["repository"] == "doisd1399/NVU-PRO"
assert provenance["commit"] == args.expected_commit
assert provenance["intermediateOnly"] is True
assert provenance["expectedFinalCertificateSha256"] == EXPECTED_CERT
intermediate = inputs / "NVU-1.0.421.apk.intermediate"
assert hashlib.sha256(intermediate.read_bytes()).hexdigest() == provenance["sha256"]
for private in [args.keystore, args.store_password_file, args.key_password_file]:
    assert private.is_file(), "Required local signing input is absent"
tools = inputs / "build-tools"
jar = tools / "lib/apksigner.jar"
env = dict(os.environ)
env["LD_LIBRARY_PATH"] = str(tools / "lib64") + ":" + env.get("LD_LIBRARY_PATH", "")


def run(command):
    result = subprocess.run(command, text=True, capture_output=True, env=env, timeout=180)
    if result.returncode:
        raise RuntimeError("Android verification/signing command failed; no release was certified")
    return result.stdout


def payload(apk):
    with zipfile.ZipFile(apk) as archive:
        assert archive.testzip() is None, "APK CRC failed"
        names = archive.namelist()
        assert len(names) == len(set(names)), "Duplicate APK ZIP entries"
        return {name: hashlib.sha256(archive.read(name)).hexdigest()
                for name in names if not name.startswith("META-INF/") and not name.endswith("/")}


with zipfile.ZipFile(intermediate) as archive:
    manifest = json.loads(archive.read("assets/public/nvu-build.json"))
assert manifest["nativeBundleImmutable"] is True and manifest["otaEnabled"] is False
assert manifest.get("otaManifestUrl", "") == ""
web_inputs = ["package.json", "package-lock.json", "capacitor.config.ts", "vite.config.ts"]
web_inputs += [p.relative_to(source).as_posix() for p in (source / "src").rglob("*") if p.is_file()]
digest = hashlib.sha256()
for name in sorted(web_inputs):
    digest.update(name.encode() + b"\0" + (source / name).read_bytes() + b"\0")
assert manifest["sourceSha256"] == digest.hexdigest(), "Intermediate does not contain this corrected source"
original_payload = payload(intermediate)
out = args.output_dir.resolve()
out.mkdir(parents=True, exist_ok=True)
candidate = out / "NVU-PRO-1.0.421-HISTORICO-RELEASE.building.apk"
final = out / "NVU-PRO-1.0.421-HISTORICO-RELEASE.apk"
assert not final.exists(), "An existing release will not be overwritten"
try:
    run([str(tools / "zipalign"), "-c", "-P", "16", "-v", "4", str(intermediate)])
    run(["java", "-jar", str(jar), "sign", "--ks", str(args.keystore.resolve()),
         "--ks-key-alias", args.alias,
         "--ks-pass", "file:" + str(args.store_password_file.resolve()),
         "--key-pass", "file:" + str(args.key_password_file.resolve()),
         "--v1-signing-enabled", "true", "--v2-signing-enabled", "true",
         "--v3-signing-enabled", "true", "--v4-signing-enabled", "false",
         "--out", str(candidate), str(intermediate)])
    verified = run(["java", "-jar", str(jar), "verify", "--verbose", "--print-certs", str(candidate)])
    cert = re.search(r"Signer #1 certificate SHA-256 digest:\s*([0-9a-fA-F]+)", verified)
    assert cert and cert.group(1).upper() == EXPECTED_CERT, "Original signing certificate did not match"
    assert re.search(r"Verified using v2 scheme.*true", verified)
    assert re.search(r"Verified using v3 scheme.*true", verified)
    assert "Number of signers: 1" in verified
    badging = run([str(tools / "aapt"), "dump", "badging", str(candidate)])
    package = badging.splitlines()[0]
    assert "name='com.nvu.operacional'" in package
    assert "versionCode='421'" in package and "versionName='1.0.421'" in package
    assert "application-debuggable" not in badging
    run([str(tools / "zipalign"), "-c", "-P", "16", "-v", "4", str(candidate)])
    assert payload(candidate) == original_payload, "Signing changed the application payload"
    candidate.rename(final)
except BaseException:
    candidate.unlink(missing_ok=True)
    raise
report = {
    "apk": final.name, "sha256": hashlib.sha256(final.read_bytes()).hexdigest(),
    "package": "com.nvu.operacional", "versionName": "1.0.421", "versionCode": 421,
    "certificateSha256": EXPECTED_CERT, "v2Verified": True, "v3Verified": True,
    "releaseDebuggable": False, "payloadUnchangedBySigning": True,
    "sourceSha256": manifest["sourceSha256"], "gitCommit": args.expected_commit,
    "productionDeploys": 0, "productionDataReads": 0, "productionDataMutations": 0,
    "installedOnDevice": False, "productionTotalsCertified": False,
}
(out / "APK-VERIFICATION.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
