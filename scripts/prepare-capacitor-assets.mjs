import fs from "node:fs";
import path from "node:path";

const dist = path.resolve(process.cwd(), "dist");
const packageJson = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"),
);
const androidWebAssets = path.resolve(
  process.cwd(),
  "android/app/src/main/assets/public",
);

const capacitorGeneratedFiles = ["cordova.js", "cordova_plugins.js"];
const bridgeSnapshots = capacitorGeneratedFiles
  .map((name) => ({
    name,
    path: path.join(androidWebAssets, name),
  }))
  .filter(({ path: bridgePath }) => fs.existsSync(bridgePath))
  .map(({ name, path: bridgePath }) => ({
    name,
    content: fs.readFileSync(bridgePath),
  }));

// Capacitor may overlay the new Vite output on top of an existing asset folder.
// Hashed chunks that disappeared from the latest manifest would then remain inside
// the APK. Remove the complete generated WebView tree before every copy so the
// embedded fallback is an exact, deterministic mirror of dist.
if (fs.existsSync(androidWebAssets)) {
  fs.rmSync(androidWebAssets, { recursive: true, force: true });
}

for (const name of ["server.cjs", "server.cjs.map"]) {
  const distTarget = path.join(dist, name);
  if (fs.existsSync(distTarget)) fs.rmSync(distTarget, { force: true });
}

fs.mkdirSync(path.dirname(androidWebAssets), { recursive: true });
fs.cpSync(dist, androidWebAssets, { recursive: true });

for (const name of ["server.cjs", "server.cjs.map"]) {
  const embeddedTarget = path.join(androidWebAssets, name);
  if (fs.existsSync(embeddedTarget)) fs.rmSync(embeddedTarget, { force: true });
}

for (const { name, content } of bridgeSnapshots) {
  fs.writeFileSync(path.join(androidWebAssets, name), content);
}

// Keep the Web bundle local-first, while making the embedded native manifest
// reflect whether this APK was built with the self-hosted OTA identity.
const otaEnabled = String(
  process.env.VITE_NVU_SELF_HOSTED_OTA_ENABLE ||
    process.env.NVU_SELF_HOSTED_OTA_ENABLE ||
    packageJson.selfHostedOtaEnabled ||
    "false",
).trim().toLowerCase() === "true";
const otaManifestUrl = String(
  process.env.VITE_NVU_OTA_MANIFEST_URL ||
    process.env.NVU_OTA_MANIFEST_URL ||
    packageJson.otaManifestUrl ||
    "",
).trim();
const embeddedBuildManifest = path.join(androidWebAssets, "nvu-build.json");
if (fs.existsSync(embeddedBuildManifest)) {
  const nativeManifest = JSON.parse(fs.readFileSync(embeddedBuildManifest, "utf8"));
  nativeManifest.otaEnabled = otaEnabled;
  nativeManifest.otaManifestUrl = otaEnabled ? otaManifestUrl : "";
  nativeManifest.nativeBundleImmutable = !otaEnabled;
  fs.writeFileSync(
    embeddedBuildManifest,
    `${JSON.stringify(nativeManifest, null, 2)}\n`,
  );
}

// Android/aapt2 stores the gzip asset under the same logical name without
// the `.gz` suffix. Keep the uncompressed model in the APK and remove only
// the compressed source copy to avoid a duplicate-resource collision.
const compressedAndroidModel = path.join(
  androidWebAssets,
  "tessdata/eng.traineddata.gz",
);
if (fs.existsSync(compressedAndroidModel)) {
  fs.rmSync(compressedAndroidModel, { force: true });
}

console.log("Capacitor assets preparados: fallback Android sincronizado com dist; modelo OCR Android descompactado e sem duplicidade.");
