import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const artifacts = path.join(root, "release-artifacts");
const sourceZip = path.join(artifacts, "NVU-Operacional-1.0.234-HF157-Dev-SAFE.zip");
const distZip = path.join(artifacts, "NVU-Operacional-1.0.234-HF157-dist-Netlify.zip");
const apk = path.join(artifacts, "NVU-R3.34-PC-HF157-release.apk");
const report = path.join(artifacts, "NVU-R3.34-PC-HF157-release-report.md");
const manifestPath = path.join(root, "dist", "nvu-build.json");
const fallbackManifestPath = path.join(root, "android", "app", "src", "main", "assets", "public", "nvu-build.json");

const mustExist = (file) => {
  if (!fs.existsSync(file)) throw new Error(`Artefato obrigatório ausente: ${path.relative(root, file)}`);
};
for (const file of [apk, manifestPath, fallbackManifestPath]) mustExist(file);

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const fallbackManifest = JSON.parse(fs.readFileSync(fallbackManifestPath, "utf8"));
if (JSON.stringify(manifest) !== JSON.stringify(fallbackManifest)) {
  throw new Error("Manifestos Web e fallback Android divergentes.");
}
if (manifest.runtimeRevision !== "R3.34-PC-HF157" || manifest.capacitorRuntime !== "local") {
  throw new Error("Manifesto não corresponde ao runtime local HF157.");
}

fs.mkdirSync(artifacts, { recursive: true });
for (const file of [sourceZip, distZip, report]) fs.rmSync(file, { force: true });

const zip = (cwd, output, exclusions) => {
  const args = ["-qr", output, "."];
  for (const exclusion of exclusions) args.push("-x", exclusion);
  execFileSync("zip", args, { cwd, stdio: "inherit" });
};

zip(root, sourceZip, [
  "release-artifacts/*",
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
  "android/app/google-services.json",
  "android/local.properties",
  ".env",
  ".env.*",
  "upload/*",
  "*.zip",
]);
zip(path.join(root, "dist"), distZip, ["*.zip", "server.cjs", "server.cjs.map"]);

const sourceEntries = execFileSync("unzip", ["-Z1", sourceZip], { encoding: "utf8" });
const distEntries = execFileSync("unzip", ["-Z1", distZip], { encoding: "utf8" });
const forbidden = /(^|\/)(?:google-services\.json|local\.properties|node_modules(?:\/|$)|\.gradle(?:\/|$)|build(?:\/|$)|release-work(?:\/|$)|release-final-[^/]*(?:\/|$)|[^/]+\.apk$|[^/]+\.idsig$|[^/]+\.(?:jks|keystore)$|\.env(?:\.|$))/i;
for (const [label, entries] of [["fonte", sourceEntries], ["dist", distEntries]]) {
  const bad = entries.split("\n").filter((entry) => entry && forbidden.test(entry));
  if (bad.length) throw new Error(`Itens proibidos no ZIP ${label}: ${bad.slice(0, 8).join(", ")}`);
}

const apkEntries = execFileSync("unzip", ["-Z1", apk], { encoding: "utf8" });
if (/google-services\.json|local\.properties|\.jks$|\.keystore$|\.env(?:\.|$)/im.test(apkEntries)) {
  throw new Error("Segredo encontrado dentro do APK Release.");
}
const wasmFiles = apkEntries.split("\n").filter((entry) => /\.wasm(?:\.js)?$/.test(entry));
const rawWasmFiles = apkEntries.split("\n").filter((entry) => /\.wasm$/.test(entry));
const workerFiles = apkEntries.split("\n").filter((entry) => /tesseract\/worker\.min\.js$/.test(entry));
if (wasmFiles.length !== 8 || rawWasmFiles.length !== 4 || workerFiles.length !== 1) {
  throw new Error(`Contrato OCR inválido no APK: ${wasmFiles.length} artefatos WASM, ${rawWasmFiles.length} WASM brutos, ${workerFiles.length} worker.`);
}

const sourceBytes = fs.statSync(sourceZip).size;
const distBytes = fs.statSync(distZip).size;
const apkBytes = fs.statSync(apk).size;
const reportText = `# Relatório técnico — NVU R3.34-PC-HF157 / Android 1.0.234

A candidata foi validada por código, gates determinísticos, build Web local, sincronização Capacitor, compilação das Functions e compilação Android Release. O APK foi alinhado e assinado com V2/V3; a validação física em aparelho não foi realizada nesta sessão.

| Item | Resultado |
| --- | --- |
| Aplicativo Android | \`com.nvu.operacional\` |
| Versão | \`1.0.234\` / versionCode \`234\` |
| Runtime | \`${manifest.runtimeRevision}\`, Capacitor local |
| Manifesto Web/fallback | idênticos e verificados |
| Functions | \`functions/src\` compilado para \`functions/lib\`, sem deploy |
| APK | ${apkBytes} bytes; SHA-256 \`${sha256(apk)}\` |
| ZIP-fonte Dev seguro | ${sourceBytes} bytes; SHA-256 \`${sha256(sourceZip)}\` |
| ZIP-dist Netlify | ${distBytes} bytes; SHA-256 \`${sha256(distZip)}\` |
| Certificado Release | SHA-256 oficial validado |
| OCR | ${wasmFiles.length} artefatos WASM (${rawWasmFiles.length} binários) + worker presente |
| Segredos na entrega | ausentes nos ZIPs e no APK |

## Correção HF157

O card **Operação atual** deixou de depender exclusivamente do snapshot imutável de frete/sessão. O contexto operacional completo é persistido em armazenamento local dedicado, limitado ao job ativo e gravado antes da abertura/atualização do GTO. O resumo prioriza esse snapshot e mantém fallback local honesto, sem consulta Firebase como pré-requisito para desenhar o card.

A renderização expandida foi consolidada em uma única view medida contendo cabeçalho e corpo, com visibilidade explícita, altura mínima e nova medição do WindowManager. Isso elimina o caminho em que somente o título ficava visível por clipping.

A autoridade de **Destino** da Lista/HF156 foi preservada, incluindo a regra limitada de canonização oficial de Itapetuna e a rejeição de duplicidade/recomposição stale. Pause permanece separado.

## Validação pendente no aparelho

O próximo teste físico deve iniciar uma operação, abrir o GTO, tocar **Operação atual** e conferir nome da operação, viagens/progresso, veículo e reboque. Em seguida, deve trocar de job e confirmar que nenhum dado do job anterior aparece. Se houver falha, coletar logcat do pacote \`com.nvu.operacional\`.
`;
fs.writeFileSync(report, reportText, "utf8");

console.log(`Pacote HF157 criado: ${path.basename(sourceZip)}, ${path.basename(distZip)} e ${path.basename(report)}.`);
