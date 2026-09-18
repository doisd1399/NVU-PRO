import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const artifacts = path.join(root, "release-artifacts-hf165");
const sourceZip = path.join(artifacts, "NVU-Operacional-1.0.242-HF165-Dev-SAFE.zip");
const distZip = path.join(artifacts, "NVU-Operacional-1.0.242-HF165-dist-Netlify.zip");
const apk = path.join(artifacts, "NVU-R3.34-PC-HF165-release.apk");
const report = path.join(artifacts, "NVU-R3.34-PC-HF165-release-report.md");
const checksums = path.join(artifacts, "SHA256SUMS.txt");
const manifestPath = path.join(root, "dist", "nvu-build.json");
const fallbackManifestPath = path.join(root, "android", "app", "src", "main", "assets", "public", "nvu-build.json");

const mustExist = (file) => {
  if (!fs.existsSync(file) || !fs.statSync(file).size) {
    throw new Error(`Artefato obrigatório ausente ou vazio: ${path.relative(root, file)}`);
  }
};
for (const file of [
  manifestPath,
  fallbackManifestPath,
  path.join(root, ".env.example"),
  path.join(root, "package-lock.json"),
  path.join(root, "android", "gradlew"),
  path.join(root, "android", "gradle", "wrapper", "gradle-wrapper.jar"),
]) mustExist(file);

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const read = (file) => fs.readFileSync(file, "utf8");
const manifest = JSON.parse(read(manifestPath));
const fallbackManifest = JSON.parse(read(fallbackManifestPath));
if (JSON.stringify(manifest) !== JSON.stringify(fallbackManifest)) {
  throw new Error("Manifestos Web e fallback Android divergentes.");
}
if (manifest.runtimeRevision !== "R3.34-PC-HF165" || manifest.capacitorRuntime !== "local") {
  throw new Error("Manifesto não corresponde ao runtime local HF165.");
}

fs.mkdirSync(artifacts, { recursive: true });
for (const file of [sourceZip, distZip, apk, report, checksums]) fs.rmSync(file, { force: true });

const previousSignedApk = path.join(root, "release-artifacts-hf164", "NVU-R3.34-PC-HF164-release.apk");
if (!fs.existsSync(previousSignedApk)) {
  throw new Error("APK-base HF164 ausente; a origem do APK HF165 deve ser o Release recém-assinado.");
}
const generatedApk = "/tmp/nvu-hf165-release/NVU-R3.34-PC-HF165-release.apk";
mustExist(generatedApk);
fs.copyFileSync(generatedApk, apk);

const zip = (cwd, output, exclusions) => {
  const args = ["-qr", output, "."];
  for (const exclusion of exclusions) args.push("-x", exclusion);
  execFileSync("zip", args, { cwd, stdio: "inherit" });
};
zip(root, sourceZip, [
  "release-artifacts/*",
  "release-artifacts-*/*",
  "release-work/*",
  "dist/*",
  "node_modules/*",
  "*/node_modules/*",
  ".git/*",
  ".gradle/*",
  "android/.gradle/*",
  "android/app/build/*",
  "*/build/*",
  "release-final-*/*",
  "*.apk",
  "*.idsig",
  "*.jks",
  "*.keystore",
  "*.p12",
  "*.pem",
  "*.log",
  "android/app/google-services.json",
  "android/local.properties",
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  ".env.test",
  ".env.*.local",
  "upload/*",
  "*.zip",
]);
zip(path.join(root, "dist"), distZip, ["*.zip", "server.cjs", "server.cjs.map"]);

const entries = (file) => execFileSync("unzip", ["-Z1", file], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);
const sourceEntries = entries(sourceZip);
const distEntries = entries(distZip);

const isForbidden = (entry) => {
  const normalized = entry.replaceAll("\\", "/").toLowerCase();
  const segments = normalized.split("/").filter(Boolean);
  const base = segments.at(-1) || "";
  if (segments.some((segment) => ["node_modules", ".gradle", "build", "release-work"].includes(segment))) return true;
  if (segments.some((segment) => segment.startsWith("release-artifacts"))) return true;
  if (["google-services.json", "local.properties"].includes(base)) return true;
  if (/\.(apk|idsig|jks|keystore|p12|pem)$/.test(base)) return true;
  if (base === ".env") return true;
  if (base.startsWith(".env.") && base !== ".env.example") return true;
  return false;
};
for (const [label, list] of [["fonte", sourceEntries], ["dist", distEntries]]) {
  const bad = list.filter(isForbidden);
  if (bad.length) throw new Error(`Itens proibidos no ZIP ${label}: ${bad.slice(0, 8).join(", ")}`);
}

for (const required of [
  "package.json",
  "package-lock.json",
  ".env.example",
  "android/gradlew",
  "android/gradle/wrapper/gradle-wrapper.jar",
  "android/app/src/main/java/com/nvu/operacional/GtoCargoAuthorityPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoCargoConsensusPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoFreightTextGuard.java",
  "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java",
  "scripts/test-gto-r3-34-hf165-literal-authority-selection.mjs",
  "scripts/java-tests/com/nvu/operacional/GtoHf165LiteralFreightIntegrityTest.java",
]) {
  if (!sourceEntries.includes(required)) throw new Error(`Arquivo obrigatório ausente do ZIP-fonte: ${required}`);
}

const apkEntries = entries(apk);
const isForbiddenInsideApk = (entry) => {
  const normalized = entry.replaceAll("\\", "/").toLowerCase();
  const base = normalized.split("/").filter(Boolean).at(-1) || "";
  if (["google-services.json", "local.properties"].includes(base)) return true;
  if (/\.(apk|idsig|jks|keystore|p12|pem)$/.test(base)) return true;
  if (base === ".env" || base.startsWith(".env.")) return true;
  return false;
};
if (apkEntries.some(isForbiddenInsideApk)) throw new Error("Arquivo sensível encontrado dentro do APK Release.");
const coreArtifacts = apkEntries.filter((entry) => /tesseract\/core\/tesseract-core.*\.wasm(?:\.js)?$/.test(entry));
const rawWasmFiles = apkEntries.filter((entry) => /tesseract\/core\/tesseract-core.*\.wasm$/.test(entry));
const wasmWrappers = apkEntries.filter((entry) => /tesseract\/core\/tesseract-core.*\.wasm\.js$/.test(entry));
const workerFiles = apkEntries.filter((entry) => /tesseract\/worker\.min\.js$/.test(entry));
if (coreArtifacts.length !== 8 || rawWasmFiles.length !== 4 || wasmWrappers.length !== 4 || workerFiles.length !== 1) {
  throw new Error(`Contrato OCR inválido: ${coreArtifacts.length} artefatos, ${rawWasmFiles.length} WASM, ${wasmWrappers.length} wrappers, ${workerFiles.length} worker.`);
}

const sourceBytes = fs.statSync(sourceZip).size;
const distBytes = fs.statSync(distZip).size;
const apkBytes = fs.statSync(apk).size;
const reportText = `# Relatório técnico — NVU R3.34-PC-HF165 / Android 1.0.242

A candidata foi validada por código, fixtures determinísticas, build Web local, sincronização Capacitor, compilação das Functions e compilação Android Release. O APK foi alinhado e assinado com os esquemas V2/V3. **Não houve teste físico com ADB/aparelho nesta sessão**, portanto este relatório registra aprovação de código, build e empacotamento, não garantia de comportamento visual em hardware real.

| Item | Resultado |
| --- | --- |
| Aplicativo Android | \`com.nvu.operacional\` |
| Versão | \`1.0.242\` / versionCode \`242\` |
| Runtime | \`${manifest.runtimeRevision}\`, Capacitor local |
| \`verify:release\` | status integral \`0\` |
| Escopo | Integridade literal de Carga, autoridade Lista/Pause, reset transacional e seleção |
| Gate HF165 | \`33\` verificações estruturais + fixture funcional aprovadas |
| Java nativo | \`70\` fontes validadas |
| Functions | compiladas pelo lockfile, sem deploy |
| APK | ${apkBytes} bytes; SHA-256 \`${sha256(apk)}\` |
| ZIP-fonte Dev seguro | ${sourceBytes} bytes; SHA-256 \`${sha256(sourceZip)}\` |
| ZIP-dist Netlify | ${distBytes} bytes; SHA-256 \`${sha256(distZip)}\` |
| Certificado Release | SHA-256 oficial validado; V2/V3 válidos |
| OCR | ${coreArtifacts.length} artefatos: ${rawWasmFiles.length} binários WASM + ${wasmWrappers.length} wrappers; worker presente |
| Segredos na entrega | ausentes nos ZIPs e no APK |

## Causas-raiz e correções

A OCR pode retornar literalmente uma variante incorreta, como \`Sojo\`. A HF165 não aplica correção ortográfica global. O texto operacional agora usa igualdade literal; \`Soja\`, \`Sojo\`, diferenças de caixa e diferenças de acento não são tratados como o mesmo valor. Sem autoridade independente da Lista, uma leitura Pause divergente fica somente no diagnóstico e o campo operacional permanece pendente; apenas duas leituras literais concordantes podem confirmar o valor.

A seleção direta preserva a evidência source-bound da Lista, vinculada a job/sessão/linha. Um novo toque invalida transações e callbacks OCR anteriores. A autoridade same-row só é promovida depois da prova completa e independente dos campos; o lock/snapshot transporta a proveniência sem recompor Origem/Destino já preenchidos.

O fallback do Pause deixou de transformar texto normalizado de detecção em valor operacional. O estado stale é removido no início de uma nova seleção e a Carga da Lista pode ser restaurada no Pause somente quando a identidade persistida confere.

## Não regressão

As regras de Origem HF159, conclusão HF160, seleção/Pause HF163, integridade HF164 e card Operação atual permanecem cobertas por gates históricos. Não foi introduzido fuzzy matching, dicionário ortográfico global, dependência de Firebase para desenho ou alteração da autoridade de Destino.

## Validação física necessária

No aparelho, selecionar fretes diferentes e confirmar que Carga/Origem/Destino pertencem sempre à linha tocada. Testar uma Lista com \`Soja\`, uma leitura Pause que retorne \`Sojo\`, duas leituras literais \`Soja\`, troca rápida de frete, reinício e diferentes densidades/orientações. Se houver falha, coletar logcat com o job/linha, revisão e origem do candidato.

## Referências locais

[1]: android/app/src/main/java/com/nvu/operacional/GtoCargoAuthorityPolicy.java "Autoridade literal da Carga"
[2]: android/app/src/main/java/com/nvu/operacional/GtoFreightListTextAuthorityPolicy.java "Reconciliação da Lista"
[3]: android/app/src/main/java/com/nvu/operacional/GtoObserverService.java "Fluxo Lista/Pause e reset de seleção"
[4]: scripts/test-gto-r3-34-hf165-literal-authority-selection.mjs "Gate HF165"
`;
fs.writeFileSync(report, reportText, "utf8");

const checksumLines = [apk, sourceZip, distZip, report]
  .map((file) => `${sha256(file)}  ${path.basename(file)}`)
  .join("\n") + "\n";
fs.writeFileSync(checksums, checksumLines, "utf8");

console.log(`Pacote HF165 criado: ${path.basename(sourceZip)}, ${path.basename(distZip)}, ${path.basename(report)} e ${path.basename(checksums)}.`);
