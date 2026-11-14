import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
async function sourceFiles(dir, prefix = "") {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) files.push(...await sourceFiles(resolve(dir, entry.name), `${name}/`));
    else if (entry.isFile()) files.push(name);
  }
  return files;
}

const inputs = ["package.json", "package-lock.json", "capacitor.config.ts", "vite.config.ts",
  ...(await sourceFiles(resolve(root, "src"), "src/"))].sort();
const hash = createHash("sha256");
for (const file of inputs) {
  hash.update(file).update("\0").update(await readFile(resolve(root, file))).update("\0");
}
const manifest = JSON.parse(await readFile(resolve(root, "android/app/src/main/assets/public/nvu-build.json"), "utf8"));
if (manifest.sourceSha256 !== hash.digest("hex") || manifest.nativeBundleImmutable !== true || manifest.otaEnabled !== false) {
  throw new Error("Bundle Android desatualizado ou mutável. Execute o script de release completo.");
}
await readFile(resolve(root, "android/app/google-services.json"));
execFileSync(process.execPath, ["scripts/verify-capacitor-assets.mjs"], { cwd: root, stdio: "inherit" });
console.log("RELEASE WEB SOURCE PASS: fonte, dist e assets nativos estão sincronizados.");
