import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const artifacts = path.join(root, "release-artifacts-hf171");
const sourceZip = path.join(artifacts, "NVU-Operacional-1.0.248-HF171-Dev-SAFE.zip");
const distZip = path.join(artifacts, "NVU-Operacional-1.0.248-HF171-dist-Netlify.zip");
const apk = path.join(artifacts, "NVU-R3.34-PC-HF171-release.apk");
const report = path.join(artifacts, "NVU-R3.34-PC-HF171-release-report.md");
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
if (manifest.runtimeRevision !== "R3.34-PC-HF171" || manifest.capacitorRuntime !== "local") {
  throw new Error("Manifesto não corresponde ao runtime local HF171.");
}

fs.mkdirSync(artifacts, { recursive: true });
for (const file of [sourceZip, distZip, apk, report, checksums]) fs.rmSync(file, { force: true });

const previousSignedApk = path.join(root, "release-artifacts-hf166", "NVU-R3.34-PC-HF166-release.apk");
if (!fs.existsSync(previousSignedApk)) {
  throw new Error("APK-base HF166 ausente; a origem do APK HF169 deve ser o Release recém-assinado.");
}
const generatedApk = path.join(root, "NVU-R3.34-PC-HF171-release.apk");
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
  "scripts/test-gto-r3-34-hf169-motecom-active-list.mjs",
  "scripts/test-gto-r3-34-hf170-list-count-destination.mjs",
  "scripts/test-gto-r3-34-hf171-performance-parity.mjs",
  "scripts/java-tests/com/nvu/operacional/GtoHf167FreightPauseTest.java",
  "scripts/java-tests/com/nvu/operacional/GtoHf168ListPauseRegressionTest.java",
  "scripts/java-tests/com/nvu/operacional/GtoHf169MotecomActiveListTest.java",
  "scripts/java-tests/com/nvu/operacional/GtoHf170DestinationAuthorityTest.java",
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
const reportText = `# Relatório técnico — NVU R3.34-PC-HF171 / Android 1.0.248

A HF171 corrige a lentidão observada no APK em comparação com o Web durante login, ações administrativas e Painel Sênior. O Android WebView agora evita trabalho especulativo não crítico, pausas curtas não reconstroem toda a sessão e o Painel Sênior exibe a primeira página sem aguardar hidratação relacional completa.



A candidata foi validada por código, fixtures determinísticas, build Web local, sincronização Capacitor, compilação das Functions e compilação Android Release. O APK foi alinhado e assinado com os esquemas V2/V3. **Não houve teste físico com ADB/aparelho nesta sessão**, portanto este relatório registra aprovação de código, build e empacotamento, não garantia de comportamento visual em hardware real.

| Item | Resultado |
| --- | --- |
| Aplicativo Android | \`com.nvu.operacional\` |
| Versão | \`1.0.248\` / versionCode \`248\` |
| Runtime | \`${manifest.runtimeRevision}\`, Capacitor local |
| \`verify:release\` | status integral \`0\` |
| Escopo | Login Google nativo compatível, RH server-authoritative, claim/escopo Sênior e não regressão GTO |
| Gates HF169/HF170/HF171 | Motecom, Lista ativa, contagem canônica, destino ponta a ponta e desempenho/paridade aprovados |
| Java nativo | \`70\` fontes validadas |
| Functions | sem alterações nesta HF; deploy HF166 já publicado |
| APK | ${apkBytes} bytes; SHA-256 \`${sha256(apk)}\` |
| ZIP-fonte Dev seguro | ${sourceBytes} bytes; SHA-256 \`${sha256(sourceZip)}\` |
| ZIP-dist Netlify | ${distBytes} bytes; SHA-256 \`${sha256(distZip)}\` |
| Certificado Release | SHA-256 oficial validado; V2/V3 válidos |
| OCR | ${coreArtifacts.length} artefatos: ${rawWasmFiles.length} binários WASM + ${wasmWrappers.length} wrappers; worker presente |
| Segredos na entrega | ausentes nos ZIPs e no APK |

## Causas-raiz e correções

A auditoria de desempenho identificou três custos que atingiam mais o APK: warm-ups de rotas/ranking/imagens competindo com callbacks de Auth/Firestore na thread limitada do WebView; refresh global de sessão após qualquer pausa curta do Android; e carregamento administrativo que podia aguardar relações ou baixar coleções grandes como fallback. HF171 limita apenas trabalho não crítico, mantém dados de identidade e operação prioritários e preserva recuperação após background real.



Na seleção direta, a causa nova comprovada era a combinação de uma leitura focalizada de empresa de destino ('Motecom') com um destino já completo da mesma linha ('Matecom Itapetuna'). A canonização aceitava o metadata divergente e o concatenava ao destino completo, produzindo 'Motecom Matecom Itapetuna'. HF169 agora colapsa somente um prefixo duplicado quando o restante contém localidade oficial, sem dicionário ortográfico ou fuzzy matching. A correção anterior do marcador de rota no fim da linha ('>') permanece preservada.

No ciclo de vida da Lista, a causa nova comprovada era tratar uma Lista semanticamente estável durante 'TRIP_IN_PROGRESS' como boundary de replacement sem um toque confirmado em 'Aceitar'. A reabertura simples podia iniciar 'Selecionei um novo frete', limpar o contexto da viagem e misturar sessões. HF169 separa observação de mutação: a Lista ativa publica a mensagem normal e o contador, mas só um 'replacementFreightPressedRow' correlacionado ao botão Aceitar pode permitir replacement. No Pause, o contrato anterior permanece separado: 'pauseCompanyTextField' identifica empresa/prefixo, 'pauseLocationTextField' extrai a localidade, e a Lista confirmada prevalece quando possui destino completo.

A certificação pós-toque também foi ajustada de forma limitada: quando o frame de transição perde o texto 'Aceitar', o row humano/geométrico usa a variante já existente de certificação pós-toque, ainda exigindo geometria do botão, valor válido e contexto mínimo da mesma linha. Uma leitura visual sem toque continua bloqueada. A autoridade literal da Carga foi preservada: 'Sojo' não pode sobrescrever 'Soja'; sem autoridade da Lista, o Pause exige duas leituras literais concordantes. O lock/snapshot continuam sendo a fonte durável.

As correções GTO HF159–HF170 permanecem cobertas pelos gates históricos; login Google, RH, Painel Sênior, Carga, Origem, Destino, Lista/Pause, snapshot, envio automático e card não foram rebaixados. HF171 adiciona a proteção de desempenho/paridade: Android nativo não executa warm-ups especulativos, pausas curtas não reconstroem a sessão global, métricas administrativas usam índices por empresa e o primeiro carregamento do SeniorPanel não baixa coleções completas como fallback.

## Não regressão

As regras de Origem HF159, conclusão HF160, seleção/Pause HF163/HF168, integridade HF164 e card Operação atual permanecem cobertas por gates históricos. HF171 não introduz fuzzy matching, dicionário ortográfico global, dependência de Firebase para desenho ou alteração da autoridade de Destino; apenas impede que metadata divergente ou uma reabertura sem toque altere a rota/sessão ativa.

## Validação física necessária

No aparelho, selecionar fretes diferentes e confirmar que Carga/Origem/Destino pertencem sempre à linha tocada. Testar uma Lista com \`Soja\`, uma leitura Pause que retorne \`Sojo\`, duas leituras literais \`Soja\`, troca rápida de frete, reinício e diferentes densidades/orientações. Se houver falha, coletar logcat com o job/linha, revisão e origem do candidato.

## Referências locais

[1]: android/app/src/main/java/com/nvu/operacional/GtoCargoAuthorityPolicy.java "Autoridade literal da Carga"
[2]: android/app/src/main/java/com/nvu/operacional/GtoFreightListTextAuthorityPolicy.java "Reconciliação da Lista"
[3]: android/app/src/main/java/com/nvu/operacional/GtoObserverService.java "Fluxo Lista/Pause e reset de seleção"
[4]: scripts/test-gto-r3-34-hf169-motecom-active-list.mjs "Gate HF169 de Motecom e Lista ativa"
[5]: scripts/test-gto-r3-34-hf170-list-count-destination.mjs "Gate HF170 de contagem e destino"
[6]: scripts/test-gto-r3-34-hf171-performance-parity.mjs "Gate HF171 de desempenho/paridade"
[7]: scripts/test-gto-r3-34-hf168-list-pause-regression.mjs "Gate HF168 de Lista e Pause"
[8]: scripts/test-gto-r3-34-hf171-performance-parity.mjs "Gate HF171 de desempenho e paridade"
`;
fs.writeFileSync(report, reportText, "utf8");

const checksumLines = [apk, sourceZip, distZip, report]
  .map((file) => `${sha256(file)}  ${path.basename(file)}`)
  .join("\n") + "\n";
fs.writeFileSync(checksums, checksumLines, "utf8");

console.log(`Pacote HF171 criado: ${path.basename(sourceZip)}, ${path.basename(distZip)}, ${path.basename(report)} e ${path.basename(checksums)}.`);
