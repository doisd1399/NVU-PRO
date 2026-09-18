import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const dist = resolve(root, "dist");
const packageJson = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
);

// Netlify exposes DEPLOY_ID for every deploy. Local builds still receive a
// unique id so an Android WebView can detect a newly published web bundle.
const explicitId = String(process.env.NVU_BUILD_ID || "").trim();
const deployId = String(process.env.DEPLOY_ID || "").trim();
const commitRef = String(process.env.COMMIT_REF || "").trim();
const otaManifestUrl = String(
  process.env.VITE_NVU_OTA_MANIFEST_URL || packageJson.otaManifestUrl || "",
).trim();
const otaEnabled =
  String(
    process.env.VITE_NVU_SELF_HOSTED_OTA_ENABLE ||
      packageJson.selfHostedOtaEnabled ||
      false,
  ).trim().toLowerCase() === "true";
const otaBundleId = String(
  process.env.VITE_NVU_EMBEDDED_BUNDLE_ID || "",
).trim();
const buildId =
  explicitId ||
  [commitRef || "local", deployId || new Date().toISOString()].join("-");

await mkdir(dist, { recursive: true });
await writeFile(
  resolve(dist, "nvu-build.json"),
  `${JSON.stringify(
    {
      buildId,
      version: String(packageJson.version || "unknown"),
      stableReleaseName: String(packageJson.stableReleaseName || ""),
      officialStableRelease: Boolean(packageJson.officialStableRelease),
      generatedAt: new Date().toISOString(),
      source: "nvu-web",
      runtimeRevision: String(packageJson.gtoWebRuntimeRevision || "unknown"),
      capacitorRuntime: String(packageJson.capacitorRuntime || "remote"),
      otaEnabled,
      otaManifestUrl,
      otaBundleId,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
