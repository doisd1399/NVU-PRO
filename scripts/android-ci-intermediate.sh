#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${ANDROID_HOME:?Android SDK missing}"
: "${RUNNER_TEMP:?This intermediate stage requires an ephemeral CI runner}"
[[ "${GITHUB_REPOSITORY:-}" == 'doisd1399/NVU-PRO' && "${GITHUB_REF:-}" == 'refs/heads/codex/historico-apk-422' ]] || {
  echo 'Blocked: intermediate build is restricted to the isolated candidate branch.' >&2
  exit 2
}
WORK="$RUNNER_TEMP/nvu-intermediate-signing"
OUT="$ROOT/.ci-delivery"
mkdir -p "$WORK" "$OUT"
chmod 700 "$WORK"
# The real signing key/passwords are never sent to this runner. A temporary
# signer makes Gradle's guarded Release path available; local apksigner later
# replaces this signature with the original certificate before delivery.
node --input-type=module - "$WORK/password.txt" <<'JS'
import fs from 'node:fs';
import crypto from 'node:crypto';
fs.writeFileSync(process.argv[2], crypto.randomBytes(32).toString('hex'), {mode: 0o600});
JS
keytool -genkeypair -noprompt -alias intermediate -keystore "$WORK/intermediate.jks" \
  -storepass:file "$WORK/password.txt" -keypass:file "$WORK/password.txt" \
  -keyalg RSA -keysize 2048 -validity 2 -dname 'CN=NVU INTERMEDIATE NOT FOR INSTALL'
export RELEASE_STORE_FILE="$WORK/intermediate.jks"
export RELEASE_STORE_PASSWORD="$(cat "$WORK/password.txt")"
export RELEASE_KEY_ALIAS=intermediate
export RELEASE_KEY_PASSWORD="$RELEASE_STORE_PASSWORD"
cd "$ROOT/android"
chmod +x gradlew
./gradlew testReleaseUnitTest assembleRelease --no-daemon
cd "$ROOT"
mkdir -p dist-apk
cp android/app/build/outputs/apk/release/app-release.apk dist-apk/intermediate.apk
node scripts/verify-android-apk-integrity.mjs
cp dist-apk/intermediate.apk "$OUT/NVU-1.0.422.apk.intermediate"
TOOLS="$ANDROID_HOME/build-tools/36.0.0"
"$TOOLS/zipalign" -c -P 16 -v 4 dist-apk/intermediate.apk > .ci-evidence/zipalign.log
"$TOOLS/apksigner" verify --verbose dist-apk/intermediate.apk > .ci-evidence/intermediate-signature.log
"$TOOLS/aapt" dump badging dist-apk/intermediate.apk > .ci-evidence/badging.log
mkdir -p "$OUT/build-tools/lib" "$OUT/build-tools/lib64"
cp "$TOOLS/lib/apksigner.jar" "$OUT/build-tools/lib/"
cp "$TOOLS/zipalign" "$TOOLS/aapt" "$OUT/build-tools/"
if [[ -f "$TOOLS/lib64/libc++.so" ]]; then cp "$TOOLS/lib64/libc++.so" "$OUT/build-tools/lib64/"; fi
cp -R .ci-evidence "$OUT/evidence"
cp android/app/src/main/assets/public/nvu-build.json "$OUT/"
node --input-type=module - "$OUT" <<'JS'
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const out = process.argv[2];
const name = 'NVU-1.0.422.apk.intermediate';
const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(out, name))).digest('hex');
fs.writeFileSync(path.join(out, 'provenance.json'), JSON.stringify({
  repository: process.env.GITHUB_REPOSITORY, commit: process.env.GITHUB_SHA,
  runId: process.env.GITHUB_RUN_ID, androidVersion: '1.0.422', androidVersionCode: 422,
  artifact: name, sha256: sha, intermediateOnly: true, installableReleaseCertified: false,
  expectedFinalCertificateSha256: '806A03EA92B69E7F9A70526E9C4D6A4AE52EC4F9CF7CAC05DDB1AA28084246EA',
}, null, 2) + '\n');
fs.writeFileSync(path.join(out, 'DO-NOT-INSTALL.txt'), 'INTERMEDIATE ONLY. Final release requires local signing with the original keystore and verification of certificate, identity and payload.\n');
JS
rm -f dist-apk/intermediate.apk
