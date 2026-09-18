import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const artifacts = path.join(root, "release-artifacts-hf168");
const sourceZip = path.join(artifacts, "NVU-Operacional-1.0.245-HF168-Dev-SAFE.zip");
const distZip = path.join(artifacts, "NVU-Operacional-1.0.245-HF168-dist-Netlify.zip");
const apk = path.join(artifacts, "NVU-R3.34-PC-HF168-release.apk");
const report = path.join(artifacts, "NVU-R3.34-PC-HF168-release-report.md");
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
if (manifest.runtimeRevision !== "R3.34-PC-HF168" || manifest.capacitorRuntime !== "local") {
  throw new Error("Manifesto não corresponde ao runtime local HF168.");
}

fs.mkdirSync(artifacts, { recursive: true });
for (const file of [sourceZip, distZip, apk, report, checksums]) fs.rmSync(file, { force: true });

const previousSignedApk = path.join(root, "release-artifacts-hf166", "NVU-R3.34-PC-HF166-release.apk");
if (!fs.existsSync(previousSignedApk)) {
  throw new Error("APK-base HF166 ausente; a origem do APK HF168 deve ser o Release recém-assinado.");
}
const generatedApk = "/tmp/nvu-hf168-release/NVU-R3.34-PC-HF168-release.apk";
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
  "scripts/test-gto-r3-34-hf166-authz.mjs",
  "scripts/test-gto-r3-34-hf168-list-pause-regression.mjs",
  "scripts/java-tests/com/nvu/operacional/GtoHf167FreightPauseTest.java",
  "scripts/java-tests/com/nvu/operacional/GtoHf168ListPauseRegressionTest.java",
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
const reportText = `# Relatório técnico — NVU R3.34-PC-HF168 / Android 1.0.245

A candidata foi validada por código, fixtures determinísticas, build Web local, sincronização Capacitor, compilação das Functions e compilação Android Release. O APK foi alinhado e assinado com os esquemas V2/V3. **Não houve teste físico com ADB/aparelho nesta sessão**, portanto este relatório registra aprovação de código, build e empacotamento, não garantia de comportamento visual em hardware real.

| Item | Resultado |
| --- | --- |
| Aplicativo Android | \`com.nvu.operacional\` |
| Versão | \`1.0.245\` / versionCode \`245\` |
| Runtime | \`${manifest.runtimeRevision}\`, Capacitor local |
| \`verify:release\` | status integral \`0\` |
| Escopo | Login Google nativo compatível, RH server-authoritative, claim/escopo Sênior e não regressão GTO |
| Gate HF168 | \`12\` verificações estruturais de Lista/Pause aprovadas |
| Java nativo | \`70\` fontes validadas |
| Functions | sem alterações nesta HF; deploy HF166 já publicado |
| APK | ${apkBytes} bytes; SHA-256 \`${sha256(apk)}\` |
| ZIP-fonte Dev seguro | ${sourceBytes} bytes; SHA-256 \`${sha256(sourceZip)}\` |
| ZIP-dist Netlify | ${distBytes} bytes; SHA-256 \`${sha256(distZip)}\` |
| Certificado Release | SHA-256 oficial validado; V2/V3 válidos |
| OCR | ${coreArtifacts.length} artefatos: ${rawWasmFiles.length} binários WASM + ${wasmWrappers.length} wrappers; worker presente |
| Segredos na entrega | ausentes nos ZIPs e no APK |

## Causas-raiz e correções

Na seleção direta, a causa comprovada era o saneamento de cada linha OCR: quando o ML Kit emitia a rota como 'Fazenda Areia Dourada >' e colocava o destino na linha seguinte, a limpeza removia '>' no fim da linha. Sem esse marcador, o parser não criava a associação de Origem → Destino da mesma linha, o candidato ficava sem evidência operacional suficiente e o fluxo caía para revisão/Pause.

No Pause, a causa comprovada era contratual: a correção anterior havia usado o prefixo da rota como se fosse a localidade operacional, enquanto outro caminho exigia o sufixo. Isso confundia empresa e localidade e deixava a confirmação inconsistente. O contrato final separa os papéis: 'pauseCompanyTextField' identifica a empresa/prefixo da rota, 'pauseLocationTextField' extrai a localidade após o separador, e a Lista da sessão prevalece quando já possui destino completo. A recomposição empresa + localidade só ocorre quando o campo está ausente e com evidência do mesmo frete.

A autoridade literal da Carga foi preservada. Uma leitura 'Sojo' continua não podendo sobrescrever 'Soja' certificada pela Lista; sem autoridade da Lista, o Pause ainda exige duas leituras literais concordantes. A Lista conserva o destino completo em linhas quebradas e o lock/snapshot continuam sendo a fonte durável.

As correções GTO HF159–HF166 permanecem cobertas pelos gates históricos; login Google, RH, Painel Sênior, Carga, Origem, Destino, Lista/Pause, snapshot, envio automático e card não foram rebaixados.

## Não regressão

As regras de Origem HF159, conclusão HF160, seleção/Pause HF163, integridade HF164 e card Operação atual permanecem cobertas por gates históricos. Não foi introduzido fuzzy matching, dicionário ortográfico global, dependência de Firebase para desenho ou alteração da autoridade de Destino.

## Validação física necessária

No aparelho, selecionar fretes diferentes e confirmar que Carga/Origem/Destino pertencem sempre à linha tocada. Testar uma Lista com \`Soja\`, uma leitura Pause que retorne \`Sojo\`, duas leituras literais \`Soja\`, troca rápida de frete, reinício e diferentes densidades/orientações. Se houver falha, coletar logcat com o job/linha, revisão e origem do candidato.

## Referências locais

[1]: android/app/src/main/java/com/nvu/operacional/GtoCargoAuthorityPolicy.java "Autoridade literal da Carga"
[2]: android/app/src/main/java/com/nvu/operacional/GtoFreightListTextAuthorityPolicy.java "Reconciliação da Lista"
[3]: android/app/src/main/java/com/nvu/operacional/GtoObserverService.java "Fluxo Lista/Pause e reset de seleção"
[4]: scripts/test-gto-r3-34-hf168-list-pause-regression.mjs "Gate HF168 de Lista e Pause"
`;
fs.writeFileSync(report, reportText, "utf8");

const checksumLines = [apk, sourceZip, distZip, report]
  .map((file) => `${sha256(file)}  ${path.basename(file)}`)
  .join("\n") + "\n";
fs.writeFileSync(checksums, checksumLines, "utf8");

console.log(`Pacote HF168 criado: ${path.basename(sourceZip)}, ${path.basename(distZip)}, ${path.basename(report)} e ${path.basename(checksums)}.`);
