import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const config = read("capacitor.config.ts");
const packageJson = JSON.parse(read("package.json"));
const runtimeRevision = read("src/lib/gtoRuntimeRevision.ts");
const plugin = read("android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java");
const manifest = JSON.parse(read("dist/nvu-build.json"));
const androidManifest = JSON.parse(read("android/app/src/main/assets/public/nvu-build.json"));

if (/^\s*server\s*[:=]/m.test(config)) {
  throw new Error("Capacitor local inválido: server.url/server remoto ainda está configurado.");
}
if (!/webDir\s*:\s*["']dist["']/.test(config)) {
  throw new Error("Capacitor local inválido: webDir não é dist.");
}
if (!fs.existsSync(path.join(root, "android/app/src/main/assets/public/index.html"))) {
  throw new Error("Fallback Web não foi empacotado no Android.");
}
const revision = runtimeRevision.match(/GTO_WEB_RUNTIME_REVISION\s*=\s*["']([^"']+)["']/)?.[1] || "";
if (!revision || packageJson.gtoWebRuntimeRevision !== revision) {
  throw new Error("package.json e gtoRuntimeRevision.ts estão desalinhados.");
}
if (!plugin.includes(`EXPECTED_WEB_RUNTIME_REVISION = \"${revision}\"`)) {
  throw new Error("Bridge Android não espera a mesma revisão Web local.");
}
if (String(manifest.runtimeRevision || "") !== revision || String(androidManifest.runtimeRevision || "") !== revision) {
  throw new Error("Manifestos Web/fallback não têm a revisão Web local esperada.");
}
if (String(manifest.capacitorRuntime || "") !== "local" || String(androidManifest.capacitorRuntime || "") !== "local") {
  throw new Error("Manifestos não declaram capacitorRuntime local.");
}
console.log(`Capacitor local: PASS (${revision}; Web embutido no APK)`);
