import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const artifacts = path.join(root, "release-artifacts-hf159");
const sourceZip = path.join(artifacts, "NVU-Operacional-1.0.236-HF159-Dev-SAFE.zip");
const distZip = path.join(artifacts, "NVU-Operacional-1.0.236-HF159-dist-Netlify.zip");
const apk = path.join(artifacts, "NVU-R3.34-PC-HF159-release.apk");
const report = path.join(artifacts, "NVU-R3.34-PC-HF159-release-report.md");
const checksums = path.join(artifacts, "SHA256SUMS.txt");
const manifestPath = path.join(root, "dist", "nvu-build.json");
const fallbackManifestPath = path.join(root, "android", "app", "src", "main", "assets", "public", "nvu-build.json");

const mustExist = (file) => {
  if (!fs.existsSync(file)) throw new Error(`Artefato obrigatório ausente: ${path.relative(root, file)}`);
};
for (const file of [apk, manifestPath, fallbackManifestPath, path.join(root, ".env.example")]) mustExist(file);

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const fallbackManifest = JSON.parse(fs.readFileSync(fallbackManifestPath, "utf8"));
if (JSON.stringify(manifest) !== JSON.stringify(fallbackManifest)) {
  throw new Error("Manifestos Web e fallback Android divergentes.");
}
if (manifest.runtimeRevision !== "R3.34-PC-HF159" || manifest.capacitorRuntime !== "local") {
  throw new Error("Manifesto não corresponde ao runtime local HF159.");
}

fs.mkdirSync(artifacts, { recursive: true });
for (const file of [sourceZip, distZip, report, checksums]) fs.rmSync(file, { force: true });

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
  ".github/*/node_modules/*",
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
  "android/app/src/main/java/com/nvu/operacional/GtoOperationCardPolicy.java",
  "scripts/test-gto-r3-34-hf159-list-origin-text.mjs",
  "android/app/src/main/java/com/nvu/operacional/GtoListOriginTextPolicy.java",
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
  throw new Error(`Contrato OCR inválido no APK: ${coreArtifacts.length} artefatos, ${rawWasmFiles.length} WASM, ${wasmWrappers.length} wrappers, ${workerFiles.length} worker.`);
}

const sourceBytes = fs.statSync(sourceZip).size;
const distBytes = fs.statSync(distZip).size;
const apkBytes = fs.statSync(apk).size;
const reportText = `# Relatório técnico — NVU R3.34-PC-HF159 / Android 1.0.236

A candidata foi validada por código, testes determinísticos, build Web local, sincronização Capacitor, compilação das Functions e compilação Android Release. O APK foi alinhado e assinado com os esquemas V2/V3. **Não houve teste físico com ADB/aparelho nesta sessão**, portanto a aprovação descrita neste relatório é de código, build e empacotamento, não uma garantia de comportamento visual em hardware real.

| Item | Resultado |
| --- | --- |
| Aplicativo Android | \`com.nvu.operacional\` |
| Versão | \`1.0.236\` / versionCode \`236\` |
| Runtime | \`${manifest.runtimeRevision}\`, Capacitor local |
| \`verify:release\` | status integral \`0\` |
| Escopo | Correção exclusiva de Origem da Lista; Carga, Destino, Pause e Operação atual preservados |
| Gate HF159 | \`23/23\` verificações de Origem aprovadas |
| Java nativo | \`69\` fontes validadas |
| Functions | \`10\` fontes TypeScript compiladas para \`10\` arquivos JavaScript, sem deploy |
| APK | ${apkBytes} bytes; SHA-256 \`${sha256(apk)}\` |
| ZIP-fonte Dev seguro | ${sourceBytes} bytes; SHA-256 \`${sha256(sourceZip)}\` |
| ZIP-dist Netlify | ${distBytes} bytes; SHA-256 \`${sha256(distZip)}\` |
| Certificado Release | SHA-256 oficial validado; V2/V3 válidos |
| OCR | ${coreArtifacts.length} artefatos de núcleo: ${rawWasmFiles.length} binários WASM + ${wasmWrappers.length} wrappers; worker presente |
| Recursos Firebase | paridade validada contra o APK oficial HF157, sem configuração bruta na entrega |
| Segredos na entrega | ausentes nos ZIPs e no APK |

## Causa raiz comprovada no código

Na primeira leitura da linha selecionada, o OCR podia produzir \`Metalurgioa\`. O parser geométrico e \`GtoFreightReviewPolicy\` tratavam esse literal como texto plausível. Se o retry focado repetisse o mesmo erro, \`GtoFreightFieldConflictPolicy\` o considerava uma concordância válida e o campo era propagado para a autoridade da Lista, \`CertifiedFreight\`, snapshot, card e payload. A reprodução HF159 confirmou esse comportamento com a sequência \`Metalurgioa\` → consenso repetido → valor incorreto promovido.

## Correção HF159

Foi criada uma política Java pura e fechada, chamada somente no contrato de Origem da seleção direta da Lista. Ela aplica exclusivamente o alias comprovado \`Metalurgioa\` → \`Metalurgica\` antes de evidência, votação, retry e selo. Não usa fuzzy matching, distância de edição, dicionário global ou recomposição de rota. Qualquer outro nome de Origem permanece literal.

A mesma canonização é aplicada na extração geométrica, no parser da linha, no refinamento pós-toque, na fusão da linha congelada, no retry focado, na resolução de conflitos e na barreira do \`CertifiedFreight\`. Assim, o texto corrigido é o mesmo em seleção, registro, snapshot, card e payload. Destino, Carga e Pause não chamam a política e permanecem com seus contratos próprios.

A fixture HF159 cobre a primeira leitura, duas releituras, conflito com baseline correto, nomes de Origem não relacionados, variantes não exatas e prova explícita de que Destino não é alterado. O gate HF159 passou \`23/23\`; a cadeia integral \`verify:release\` também terminou com status \`0\`.

A autoridade de **Destino** HF156 permaneceu inalterada: o frete certificado da Lista continua separado do Pause e a exceção Itopetuna→Itapetuna permanece limitada à linha certificada da Lista.

## Validação física ainda necessária

No aparelho, selecionar um frete cuja tela mostre \`Metalurgica\` como Origem e confirmar que o card e o registro automático mantêm exatamente esse texto. Repetir com outros fretes, incluindo nomes diferentes, para confirmar que nenhum nome legítimo foi alterado. Se houver divergência, coletar logcat de \`com.nvu.operacional\` e os campos de evidência da seleção/autoridade. Não houve ADB ou aparelho conectado nesta sessão; a aprovação é de código, gates, build e empacotamento, não garantia absoluta em hardware real.

## Referências

[1]: ../android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java "Resolver e persistência do contexto operacional"
[2]: ../android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java "Bridge e diagnósticos do contexto operacional"
[3]: ../android/app/src/main/java/com/nvu/operacional/GtoObserverService.java "Renderização do painel flutuante"
[4]: ../scripts/test-gto-r3-34-hf159-list-origin-text.mjs "Gate funcional HF159"
`;
fs.writeFileSync(report, reportText, "utf8");

const checksumLines = [apk, sourceZip, distZip, report]
  .map((file) => `${sha256(file)}  ${path.basename(file)}`)
  .join("\n") + "\n";
fs.writeFileSync(checksums, checksumLines, "utf8");

console.log(`Pacote HF159 criado: ${path.basename(sourceZip)}, ${path.basename(distZip)}, ${path.basename(report)} e ${path.basename(checksums)}.`);
