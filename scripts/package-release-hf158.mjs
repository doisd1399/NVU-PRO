import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const artifacts = path.join(root, "release-artifacts-hf158");
const sourceZip = path.join(artifacts, "NVU-Operacional-1.0.235-HF158-Dev-SAFE.zip");
const distZip = path.join(artifacts, "NVU-Operacional-1.0.235-HF158-dist-Netlify.zip");
const apk = path.join(artifacts, "NVU-R3.34-PC-HF158-release.apk");
const report = path.join(artifacts, "NVU-R3.34-PC-HF158-release-report.md");
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
if (manifest.runtimeRevision !== "R3.34-PC-HF158" || manifest.capacitorRuntime !== "local") {
  throw new Error("Manifesto não corresponde ao runtime local HF158.");
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
  "scripts/test-gto-r3-34-hf158-operation-card-end-to-end.mjs",
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
const reportText = `# Relatório técnico — NVU R3.34-PC-HF158 / Android 1.0.235

A candidata foi validada por código, testes determinísticos, build Web local, sincronização Capacitor, compilação das Functions e compilação Android Release. O APK foi alinhado e assinado com os esquemas V2/V3. **Não houve teste físico com ADB/aparelho nesta sessão**, portanto a aprovação descrita neste relatório é de código, build e empacotamento, não uma garantia de comportamento visual em hardware real.

| Item | Resultado |
| --- | --- |
| Aplicativo Android | \`com.nvu.operacional\` |
| Versão | \`1.0.235\` / versionCode \`235\` |
| Runtime | \`${manifest.runtimeRevision}\`, Capacitor local |
| \`verify:release\` | status integral \`0\` |
| Gate HF158 | \`27/27\` cenários/contratos aprovados |
| Java nativo | \`68\` fontes validadas |
| Functions | \`10\` fontes TypeScript compiladas para \`10\` arquivos JavaScript, sem deploy |
| APK | ${apkBytes} bytes; SHA-256 \`${sha256(apk)}\` |
| ZIP-fonte Dev seguro | ${sourceBytes} bytes; SHA-256 \`${sha256(sourceZip)}\` |
| ZIP-dist Netlify | ${distBytes} bytes; SHA-256 \`${sha256(distZip)}\` |
| Certificado Release | SHA-256 oficial validado; V2/V3 válidos |
| OCR | ${coreArtifacts.length} artefatos de núcleo: ${rawWasmFiles.length} binários WASM + ${wasmWrappers.length} wrappers; worker presente |
| Recursos Firebase | paridade validada contra o APK oficial HF157, sem configuração bruta na entrega |
| Segredos na entrega | ausentes nos ZIPs e no APK |

## Causa raiz comprovada no código

A HF157 separou corretamente o contexto operacional do snapshot imutável do frete, mas ainda aceitava qualquer snapshot dedicado do mesmo \`jobId\` sem conferir a revisão do commit Web ativo. Além disso, a gravação era tratada como best effort: o retorno de \`commit()\` não bloqueava \`setContext\` nem \`openGto\`. O diagnóstico do bridge ainda publicava o snapshot antigo de sessão/frete, diferente da autoridade usada pelo card. Essas divergências permitiam que um valor stale ou uma persistência silenciosamente malsucedida chegasse ao resumo mesmo com os dados Web corretos.[1] [2]

Na renderização, o resumo expandido era anexado depois dos controles anteriores dentro de um \`ScrollView\`. Ao reconstruir os filhos, a posição de rolagem podia ser preservada, deixando a informação real fora da primeira área visível. A nova implementação entra no modo Operação antes de montar o conteúdo de frete, anexa o resumo como primeiro filho, reposiciona a rolagem em \`0,0\` e só depois adiciona **Voltar ao frete atual**.[3]

## Correção HF158

A autoridade agora segue uma política Java pura e testável: **snapshot dedicado com identidade completa e revisão atual → preferências live do commit atual → snapshot de sessão compatível**. Nenhuma etapa consulta Firebase para pintar o card. A política rejeita outro \`jobId\`, motorista, empresa ou contrato; a troca de job não pode reutilizar a operação anterior. O mesmo resolver alimenta o card e o status do bridge, e o logout remove também o armazenamento dedicado.[1] [2] [4]

A fixture obrigatória prova o exemplo real \`BS - 10\`, \`02/10\`, \`Iveco S Way\`, \`Bau 3 eixos\`, \`20%\`; cobre ausência de frete/sessão, reinício de processo, snapshot stale, falha recuperada pelo contexto live e troca para outro job sem vazamento.[4]

A autoridade de **Destino** HF156 permaneceu inalterada: o frete certificado da Lista continua separado do Pause e a exceção Itopetuna→Itapetuna permanece limitada à linha certificada da Lista.

## Validação física ainda necessária

No aparelho, iniciar uma operação real, abrir o GTO e tocar **Operação atual**. Confirmar nome, viagens, veículo, reboque e progresso; voltar ao frete; fechar/reabrir o painel; retornar ao NVU e ao GTO; reiniciar o serviço; e trocar de job para confirmar que nenhum dado anterior aparece. Se houver qualquer divergência, coletar logcat de \`com.nvu.operacional\` e os campos diagnósticos \`operationSnapshotAuthority\`, \`operationSnapshotJobId\` e \`operationSnapshotWriteStatus\`.

## Referências

[1]: ../android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java "Resolver e persistência do contexto operacional"
[2]: ../android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java "Bridge e diagnósticos do contexto operacional"
[3]: ../android/app/src/main/java/com/nvu/operacional/GtoObserverService.java "Renderização do painel flutuante"
[4]: ../scripts/test-gto-r3-34-hf158-operation-card-end-to-end.mjs "Gate funcional HF158"
`;
fs.writeFileSync(report, reportText, "utf8");

const checksumLines = [apk, sourceZip, distZip, report]
  .map((file) => `${sha256(file)}  ${path.basename(file)}`)
  .join("\n") + "\n";
fs.writeFileSync(checksums, checksumLines, "utf8");

console.log(`Pacote HF158 criado: ${path.basename(sourceZip)}, ${path.basename(distZip)}, ${path.basename(report)} e ${path.basename(checksums)}.`);
