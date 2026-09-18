import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const manager = fs.readFileSync(path.join(root, "src/lib/otaManager.ts"), "utf8");
const main = fs.readFileSync(path.join(root, "src/main.tsx"), "utf8");
const config = fs.readFileSync(path.join(root, "capacitor.config.ts"), "utf8");
const assetPreparation = fs.readFileSync(
  path.join(root, "scripts/prepare-capacitor-assets.mjs"),
  "utf8",
);

const failures = [];
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

assert(
  /NATIVE_OPERATIONAL_BUNDLE_IMMUTABLE\s*=/.test(manager) &&
    /VITE_NVU_NATIVE_BUNDLE_IMMUTABLE/.test(manager),
  "o build precisa controlar explicitamente OTA assinado versus APK local-first.",
);
assert(
  /start\(\)[\s\S]{0,420}NATIVE_OPERATIONAL_BUNDLE_IMMUTABLE/.test(manager) &&
    /this\.started\s*=\s*true/.test(manager) &&
    /this\.check\("startup"\)/.test(manager) &&
    /setInterval\(\(\)\s*=>\s*void this\.check\("interval"\)/.test(manager),
  "start() deve permanecer disponível no Android com OTA habilitado.",
);
assert(
  /LiveUpdate\.ready\(\)\.catch/.test(manager) &&
    /signalReady\(\)[\s\S]{0,320}NATIVE_OPERATIONAL_BUNDLE_IMMUTABLE/.test(manager),
  "signalReady() deve usar LiveUpdate.ready() somente no runtime OTA habilitado.",
);
assert(
  /check\(reason:[\s\S]{0,360}NATIVE_OPERATIONAL_BUNDLE_IMMUTABLE/.test(manager) &&
    /!OTA_ENABLED/.test(manager),
  "check() deve consultar o manifesto somente quando OTA e identidade estiverem habilitados.",
);
assert(
  /autoUpdateStrategy:\s*[\"']none[\"']/.test(config),
  "Capacitor precisa manter autoUpdateStrategy none.",
);
assert(
  /autoBlockRolledBackBundles:\s*selfHostedOtaEnabled/.test(config) &&
    /readyTimeout:\s*selfHostedOtaEnabled\s*\?\s*10_000\s*:\s*0/.test(config),
  "OTA habilitado precisa bloquear bundles revertidos e usar timeout de prontidão de 10 s.",
);
assert(
  /nativeManifest\.otaEnabled\s*=\s*otaEnabled/.test(assetPreparation) &&
    /nativeManifest\.nativeBundleImmutable\s*=\s*!otaEnabled/.test(assetPreparation),
  "assets Android precisam refletir o flag OTA do build e manter fallback local.",
);
assert(
  !/LiveUpdate\.ready\(\)\.catch/.test(main),
  "main.tsx não pode chamar LiveUpdate.ready diretamente.",
);
assert(
  /startOtaManager\(\)/.test(main),
  "o entrypoint deve manter uma chamada única ao facade, que é no-op no Android.",
);

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("native-ota-enabled: PASS manager OTA habilitável por identidade, autoUpdateStrategy none, fallback local e entrypoint seguro");
