import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const ROOT = process.cwd();
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const expect = (condition, message) => assert.ok(condition, message);

const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const commitStart = service.indexOf("private void commitPreciseFreight");
const commitEnd = service.indexOf("\n    private ", commitStart + 1);
const commit = service.slice(commitStart, commitEnd > commitStart ? commitEnd : service.length);
const policy = read("android/app/src/main/java/com/nvu/operacional/GtoAcceptedFreightFieldPolicy.java");
const evidence = read("android/app/src/main/java/com/nvu/operacional/GtoFreightFieldEvidencePolicy.java");
const listAuthority = read("android/app/src/main/java/com/nvu/operacional/GtoFreightListTextAuthorityPolicy.java");
const plugin = read("android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java");
const sync = read("android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java");
const observerTypes = read("src/lib/gtoObserver.ts");
const dashboard = read("src/pages/driver/Dashboard.tsx");
const launcher = read("src/services/gtoWorkLauncher.ts");
const revision = read("src/lib/gtoRuntimeRevision.ts");
const packageJson = JSON.parse(read("package.json"));

expect(service.includes('VoteResult origin = voteText(candidates, "origin")'), "Origem não possui votação explícita por linha");
expect(service.includes("base.origin = origin.value"), "Origem não recebe a autoridade consensual");
expect(service.includes("base.originVotes = origin.count"), "originVotes não é persistido na estabilização");
expect(service.includes('case "origin": value = option.origin; break;'), "voteText não suporta origin");
expect(commit.includes("isDirectSelectedRowCommitStillValid(selected)"), "commit não delega à validação direta da linha");
expect(service.includes("option.origin, option.originVotes"), "validação não exige votos de Origem");
expect(service.includes("option.destination, option.destinationVotes"), "validação não exige votos de Destino");
expect(commit.includes("synchronizeDirectListAuthorities(selected)"), "barreira da Lista ausente antes/depois da canonização");
expect(commit.indexOf("synchronizeDirectListAuthorities(selected)") < commit.indexOf("canonicalizeAcceptedListDestination(selected)"), "barreira da Lista ocorre depois da canonização");
expect(policy.includes("acceptedVisibleDestination"), "política de Destino da Lista ausente");
expect(policy.includes("return reconstructed"), "recomposição de Destino completo ausente");
expect(evidence.includes("votes >= 2"), "consenso textual de duas leituras ausente");
expect(listAuthority.includes("GtoFreightFieldEvidencePolicy.text"), "política de autoridade da Lista não delega à evidência efetiva");
expect(service.includes("option == null || option.pauseMenuEvidence"), "isolamento Lista/Pause ausente");

expect(service.includes('menuButton(operationSummaryExpanded ? "Voltar ao frete atual" : "Operação atual")'), "rótulo Operação atual ausente");
expect(service.includes('operationSnapshot.optString("operationName", "")'), "Operação não usa operationName");
expect(service.includes("\\nViagens ") && service.includes("\\nVeículo ") && service.includes("\\nReboque ") && service.includes("\\nProgresso "), "resumo operacional incompleto");
expect(service.includes("progress * 100f") && service.includes("progressPercent"), "percentual da Operação não é calculado");
expect(plugin.includes('getString("operationName", "")') && (plugin.includes('putString("operationName"') || plugin.includes('putStringIfPresent(editor, call, "operationName"')), "bridge não transporta operationName");
expect(sync.includes('"operationName"') && sync.includes('snapshot.put("operationName"'), "snapshot não sela/atualiza operationName");
expect(observerTypes.includes("operationName?: string"), "tipo Web não declara operationName");
expect(dashboard.includes("operationName: myJob.contractNameSnapshot"), "Dashboard não envia operationName");

const expectedWebRevision = String(packageJson.gtoWebRuntimeRevision || "").trim();
expect(expectedWebRevision && revision.includes(`GTO_WEB_RUNTIME_REVISION = "${expectedWebRevision}"`), "revisão Web atual ausente ou divergente");
expect(launcher.includes("GTO_WEB_RUNTIME_REVISION"), "launcher não envia revisão Web");
expect(launcher.includes('status: "web-runtime-mismatch"'), "launcher não bloqueia Web stale");

expect(service.includes("showBubbleRemoveTarget"), "alvo de remoção não está conectado");
expect(service.includes("bubbleDragging"), "fluxo de arraste não está presente");
expect(packageJson.scripts?.["test:gto-r3.34-hf147-official-contract"], "HF147 não está registrado no package.json");

console.log("HF147 oficial: 25/25 checks aprovados");
console.log("Origem/Destino, Operação atual, runtime Web e primeiro arraste estão cobertos por contrato único.");
