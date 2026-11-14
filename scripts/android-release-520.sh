#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
node scripts/qa/gate.mjs
for name in JAVA_HOME ANDROID_HOME RELEASE_STORE_FILE RELEASE_STORE_PASSWORD RELEASE_KEY_ALIAS RELEASE_KEY_PASSWORD; do
  if [[ -z "${!name:-}" ]]; then echo "Configure $name antes do release." >&2; exit 2; fi
done
if [[ ! -s android/app/google-services.json || ! -s "$RELEASE_STORE_FILE" ]]; then
  echo 'Restaure google-services.json e a chave original de produção.' >&2; exit 2
fi
unset VITE_USE_FIREBASE_EMULATORS NVU_SELF_HOSTED_OTA_ENABLE VITE_NVU_SELF_HOSTED_OTA_ENABLE
unset NVU_OTA_MANIFEST_URL VITE_NVU_OTA_MANIFEST_URL NVU_OTA_PUBLIC_KEY VITE_NVU_OTA_PUBLIC_KEY NVU_NATIVE_CHANNEL
unset VITE_FIREBASE_API_KEY VITE_FIREBASE_AUTH_DOMAIN VITE_FIREBASE_PROJECT_ID VITE_FIREBASE_STORAGE_BUCKET
unset VITE_FIREBASE_MESSAGING_SENDER_ID VITE_FIREBASE_APP_ID VITE_FIREBASE_MEASUREMENT_ID VITE_GOOGLE_WEB_CLIENT_ID
npm run lint
npm run build
npx --no-install cap sync android
npm run prepare:cap-assets
npm run verify:cap-assets
npm run verify:cap-local
node scripts/verify-release-web-source.mjs
(
  cd android
  bash ./gradlew :app:clean :app:testReleaseUnitTest :app:assembleRelease --no-daemon --no-build-cache
)
mkdir -p dist-apk
APK="dist-apk/NVU-PRO-1.0.520-RELEASE.apk"
cp android/app/build/outputs/apk/release/app-release.apk "$APK"
node scripts/verify-android-apk-integrity.mjs "$APK"
"$ANDROID_HOME/build-tools/35.0.0/zipalign" -c 4 "$APK"
CERT_REPORT="$("$ANDROID_HOME/build-tools/35.0.0/apksigner" verify --verbose --print-certs "$APK")"
printf '%s\n' "$CERT_REPORT"
if [[ "$CERT_REPORT" != *"SHA-256 digest: 806a03ea92b69e7f9a70526e9c4d6a4ae52ec4f9cf7cac05ddb1aa28084246ea"* ]]; then
  echo 'O certificado difere da chave original de release.' >&2; exit 2
fi
echo "APK: $ROOT/$APK"
