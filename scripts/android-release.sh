#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT"
NATIVE="$ROOT/android"
WORK="$ROOT/.release-work"
OUT="$ROOT/dist-apk"
NVU_RELEASE_VERSION_NAME="$(node -e 'const d=require(process.argv[1]);if(!/^\d+\.\d+\.\d+$/.test(d.androidVersion||""))process.exit(2);process.stdout.write(d.androidVersion)' "$ROOT/NVU_RELEASE_METADATA.json")"
NVU_RELEASE_VERSION_CODE="$(node -e 'const d=require(process.argv[1]);if(!Number.isInteger(d.androidVersionCode)||d.androidVersionCode<1)process.exit(2);process.stdout.write(String(d.androidVersionCode))' "$ROOT/NVU_RELEASE_METADATA.json")"
APK_NAME="NVU-PRO-${NVU_RELEASE_VERSION_NAME}-RELEASE.apk"
EXPECTED_CERT='806A03EA92B69E7F9A70526E9C4D6A4AE52EC4F9CF7CAC05DDB1AA28084246EA'
EXPECTED_PROJECT='vtc-frota-log'
# Release identity marker: 1.0.516 / versionCode 516. The authoritative values
# remain read from NVU_RELEASE_METADATA.json immediately above.

# Production release must use the canonical values validated by preflight;
# inherited shell/.env overrides must not redirect Firebase, OAuth or OTA.
unset VITE_FIREBASE_API_KEY VITE_FIREBASE_AUTH_DOMAIN VITE_FIREBASE_PROJECT_ID
unset VITE_FIREBASE_STORAGE_BUCKET VITE_FIREBASE_MESSAGING_SENDER_ID
unset VITE_FIREBASE_APP_ID VITE_FIREBASE_MEASUREMENT_ID
unset VITE_USE_FIREBASE_EMULATORS VITE_GOOGLE_WEB_CLIENT_ID
unset VITE_NVU_SELF_HOSTED_OTA_ENABLE VITE_NVU_OTA_MANIFEST_URL VITE_NVU_OTA_PUBLIC_KEY VITE_NVU_NETLIFY_URL
unset NVU_SELF_HOSTED_OTA_ENABLE NVU_OTA_MANIFEST_URL NVU_OTA_PUBLIC_KEY NVU_NATIVE_CHANNEL

for name in RELEASE_STORE_FILE RELEASE_STORE_PASSWORD RELEASE_KEY_ALIAS RELEASE_KEY_PASSWORD ANDROID_HOME; do
  if [[ -z "${!name:-}" ]]; then
    echo "BLOCKED: $name ausente; build release exige keystore original e Android SDK." >&2
    exit 2
  fi
done
if [[ ! -f "$RELEASE_STORE_FILE" || ! -s "$NATIVE/app/google-services.json" ]]; then
  echo 'BLOCKED: keystore original ou google-services.json de produção ausente.' >&2
  exit 2
fi
PROJECT_ID="$(node -e 'const d=require(process.argv[1]);process.stdout.write(d.project_info?.project_id||"")' "$NATIVE/app/google-services.json")"
if [[ "$PROJECT_ID" != "$EXPECTED_PROJECT" ]]; then
  echo 'BLOCKED: Firebase project no google-services.json difere do vtc-frota-log esperado.' >&2
  exit 2
fi
if grep -En '^[[:space:]]*(firebase[[:space:]]+deploy|gcloud[[:space:]]+(functions|run|app)[[:space:]]+deploy|netlify[[:space:]]+deploy)\b' "$ROOT/scripts/android-release.sh" >/dev/null; then
  echo 'BLOCKED: o build candidato não pode conter comandos de deploy.' >&2
  exit 2
fi

rm -rf "$WORK" "$OUT" "$WEB/dist" "$ROOT/build" "$ROOT/.gradle" "$NATIVE/.gradle" "$NATIVE/build" "$NATIVE/app/src/main/assets/public"
find "$NATIVE" -type d \( -name build -o -name .gradle \) -prune -exec rm -rf {} +
mkdir -p "$WORK" "$OUT" "$NATIVE/app/src/main/assets/public"

cd "$WEB"
python3 scripts/verify-source-516.py
node scripts/verify-android-source-integrity.mjs
node scripts/verify-ota-ready.mjs
node scripts/preflight-release.mjs

# Install locked dependencies with lifecycle scripts disabled. Project-specific
# build/test scripts are invoked explicitly below after dependency integrity check.
npm ci --ignore-scripts --no-audit --no-fund --prefer-offline --cache "$HOME/.npm" --registry=https://registry.npmjs.org/ --strict-ssl=true
npm --prefix functions ci --ignore-scripts --no-audit --no-fund --prefer-offline --cache "$HOME/.npm" --registry=https://registry.npmjs.org/ --strict-ssl=true
npm --prefix functions run build

# Tests in verify:release use only unit fixtures and Firebase Emulator Suite
# explicitly pinned to demo-nvu-v36-4-staging. No live production calls are made.
export FIREBASE_CLI_DISABLE_TELEMETRY=1
NVU_RELEASE_TEST_NODE_OPTIONS="${NODE_OPTIONS:-}"
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--import=\"$ROOT/scripts/guard-loopback-network.mjs\""
NVU_RELEASE_UI=true npm run verify:release-516
export NODE_OPTIONS="$NVU_RELEASE_TEST_NODE_OPTIONS"

# Generate native Capacitor bridge files from the locally built web dist.
npx --no-install cap sync android
npm run prepare:cap-assets
npm run verify:cap-assets
npm run verify:cap-local

cd "$NATIVE"
chmod +x ./gradlew
./gradlew clean testReleaseUnitTest assembleRelease --no-daemon
APK="$(find app/build/outputs/apk -type f -name '*.apk' | grep '/release/' | head -1 || true)"
if [[ -z "$APK" ]]; then
  echo 'BLOCKED: Release APK não encontrado.' >&2
  exit 2
fi
cp "$APK" "$OUT/$APK_NAME"

cd "$WEB"
node scripts/verify-android-apk-integrity.mjs
APKSIGNER="$(find "$ANDROID_HOME/build-tools" -maxdepth 2 -type f -name apksigner | sort -V | tail -1)"
ZIPALIGN="$(find "$ANDROID_HOME/build-tools" -maxdepth 2 -type f -name zipalign | sort -V | tail -1)"
AAPT="$(find "$ANDROID_HOME/build-tools" -maxdepth 2 -type f -name aapt | sort -V | tail -1)"
for tool in APKSIGNER ZIPALIGN AAPT; do
  if [[ -z "${!tool:-}" ]]; then
    echo "BLOCKED: $tool ausente no Android Build Tools." >&2
    exit 2
  fi
done

"$ZIPALIGN" -c -v 4 "$OUT/$APK_NAME" >/dev/null
SIGN_VERIFY="$("$APKSIGNER" verify --verbose "$OUT/$APK_NAME")"
printf '%s\n' "$SIGN_VERIFY"
if ! printf '%s\n' "$SIGN_VERIFY" | grep -Eq 'Verified using v2 scheme.*true'; then
  echo 'BLOCKED: APK sem assinatura v2 válida.' >&2; exit 2
fi
if ! printf '%s\n' "$SIGN_VERIFY" | grep -Eq 'Verified using v3 scheme.*true'; then
  echo 'BLOCKED: APK sem assinatura v3 válida.' >&2; exit 2
fi
CERT_REPORT="$("$APKSIGNER" verify --verbose --print-certs "$OUT/$APK_NAME")"
{
  echo 'APK Signature Scheme verification:'
  printf '%s\n' "$SIGN_VERIFY"
  echo
  echo 'APK signer certificate report:'
  printf '%s\n' "$CERT_REPORT"
} > "$OUT/APKSIGNER_REPORT.txt"
ACTUAL_CERT="$(printf '%s\n' "$CERT_REPORT" | awk 'tolower($0) ~ /cert/ && tolower($0) ~ /sha-256/ { for (i=1; i<=NF; i++) { x=$i; gsub(/:/, "", x); if (length(x)==64 && x ~ /^[0-9a-fA-F]+$/) { print toupper(x); exit } } }')"
if [[ "$ACTUAL_CERT" != "$EXPECTED_CERT" ]]; then
  echo 'BLOCKED: o certificado do APK difere da chave de release original.' >&2
  exit 2
fi
BADGING="$("$AAPT" dump badging "$OUT/$APK_NAME")"
PACKAGE_LINE="$(printf '%s\n' "$BADGING" | grep '^package:' | head -1)"
if [[ "$PACKAGE_LINE" != *"name='com.nvu.operacional'"* \
   || "$PACKAGE_LINE" != *"versionCode='$NVU_RELEASE_VERSION_CODE'"* \
   || "$PACKAGE_LINE" != *"versionName='$NVU_RELEASE_VERSION_NAME'"* ]]; then
  echo 'BLOCKED: applicationId/version do APK release divergente.' >&2
  exit 2
fi
sha256sum "$OUT/$APK_NAME" | tee "$OUT/SHA256.txt"
cat > "$OUT/RELEASE_PROVENANCE.md" <<REPORT
# NVU PRO Android $NVU_RELEASE_VERSION_NAME — Membership, Receipts and Ranking Reliability

- Status: APK release assinado; não enviado à Play Store
- Build environment: ${NVU_BUILD_ENV:-local}
- Native version: $NVU_RELEASE_VERSION_NAME
- versionCode: $NVU_RELEASE_VERSION_CODE
- applicationId: com.nvu.operacional
- Firebase Android config project: $EXPECTED_PROJECT
- Scope: canonical membership/revocation, receipt authorization and offline retention, bounded ranking refresh and confirmed persistent snapshots; approved profile layout preserved
- Web/native source: no production deploy, backfill, replay, or production data writes
- APK: $APK_NAME
- Build identity: ${NVU_BUILD_ID:-local-release}
- Generated at: $(date -Iseconds)
- Signature: APK Signature Scheme v2 + v3
- Release certificate SHA-256: $EXPECTED_CERT
- OTA: disabled; no manifest published
- Firebase deploy: not executed
- Backend publication is handled separately under the requested selective-functions scope; this APK script does not deploy or write production data

This candidate passed local source-to-dist-to-assets-to-APK parity, package/version,
zip-alignment, signing-scheme and release-certificate checks. This APK pipeline does not
invoke remote Functions, mutate production data, or deploy Firebase rules/indexes.
Queue production audit and selective Functions publication are reported separately.
REPORT
rm -rf "$WORK"
echo "RELEASE APK: $OUT/$APK_NAME"
