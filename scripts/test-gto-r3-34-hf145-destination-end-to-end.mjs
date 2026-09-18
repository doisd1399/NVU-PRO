import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const servicePath = resolve(root, "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const policyPath = resolve(root, "android/app/src/main/java/com/nvu/operacional/GtoAcceptedFreightFieldPolicy.java");
const resolverPath = resolve(root, "android/app/src/main/java/com/nvu/operacional/GtoCityTextResolver.java");
const destinationAuthorityPath = resolve(root, "android/app/src/main/java/com/nvu/operacional/GtoDestinationTextAuthorityPolicy.java");
const service = await readFile(servicePath, "utf8");
const policy = await readFile(policyPath, "utf8");

const fail = (message) => {
  console.error(`HF145 FAIL: ${message}`);
  process.exit(1);
};
const pass = (message) => console.log(`HF145 PASS: ${message}`);
const required = (text, marker, label) => {
  if (!text.includes(marker)) fail(`${label}: marcador ausente: ${marker}`);
};

const commitStart = service.indexOf("private void commitPreciseFreight(FreightOption selected)");
const commitEnd = service.indexOf("private void clearUncommittedSelectedFreight()", commitStart);
if (commitStart < 0 || commitEnd <= commitStart) fail("não foi possível isolar o commit direto da Lista.");
const commit = service.slice(commitStart, commitEnd);
const syncBefore = commit.indexOf("synchronizeDirectListAuthorities(selected);");
const originCanonical = commit.indexOf("canonicalizeAcceptedListOrigin(selected);");
const destinationCanonical = commit.indexOf("canonicalizeAcceptedListDestination(selected);");
const syncAfter = commit.indexOf("synchronizeDirectListAuthorities(selected);", syncBefore + 1);
if (syncBefore < 0 || originCanonical < 0 || destinationCanonical < 0 || syncAfter < 0) {
  fail("commit não contém as duas barreiras de autoridade e as canonizações esperadas.");
}
if (!(syncBefore < originCanonical && originCanonical < destinationCanonical && destinationCanonical < syncAfter)) {
  fail("a autoridade da linha não é sincronizada antes e depois da canonização.");
}
const hasSelectedDestinationWriter = commit.includes('.putString("selectedDestination", selected.destination)')
  || commit.includes('.putString("selectedDestination", certified.optString("destination"')
  || commit.includes('GtoCertifiedFreight.applyToPrefs(certifiedEditor, certifiedFreight)');
if (!hasSelectedDestinationWriter) {
  fail("persistência selectedDestination: nem writer direto nem projeção certificada encontrada.");
}
const hasAcceptedDestinationWriter = commit.includes('.putString("selectedAcceptedListDestination", selected.acceptedListDestination)')
  || commit.includes('.putString("selectedAcceptedListDestination", certified.optString("acceptedListDestination"')
  || commit.includes('GtoCertifiedFreight.applyToPrefs(certifiedEditor, certifiedFreight)');
if (!hasAcceptedDestinationWriter) {
  fail("persistência acceptedListDestination: nem writer direto nem projeção certificada encontrada.");
}
const hasDestinationJsonWriter = service.includes('json.put("destination", option.destination)')
  || service.includes('json.put("destination", GtoDestinationTextAuthorityPolicy.canonicalizeListDestination(option.destination))');
if (!hasDestinationJsonWriter) fail("JSON destination: writer canônico ausente.");
const hasAcceptedDestinationJsonWriter = service.includes('json.put("acceptedListDestination", option.acceptedListDestination)')
  || service.includes('json.put("acceptedListDestination", GtoDestinationTextAuthorityPolicy.canonicalizeListDestination(option.acceptedListDestination))');
if (!hasAcceptedDestinationJsonWriter) fail("JSON acceptedListDestination: writer canônico ausente.");
required(service, 'GtoAcceptedFreightFieldPolicy.acceptedVisibleDestination(', "card/autoridade destination");
required(policy, 'String reconstructed = destination(currentDestination, company, rawText);', "recomposição completa do destino");
if (policy.includes('return target.substring(target.lastIndexOf(" ") + 1)')) {
  fail("política contém truncamento explícito para a última palavra do destino.");
}

const temp = await fsMkdir();
const source = `
package com.nvu.operacional;
public final class Hf145DestinationFixture {
  public static void main(String[] args) {
    String visible = GtoAcceptedFreightFieldPolicy.acceptedVisibleDestination(
      "Area Rural",
      "Area Rural",
      "Agro Grão",
      "Soja | Fazenda Areia Dourada › Agro Grão | Area Rural | 300Km | R$ 5.300,00",
      "Fazenda Areia Dourada › Agro Grão",
      "Fazenda Areia Dourada"
    );
    if (!"Agro Grão Area Rural".equals(visible)) {
      throw new AssertionError("Destino incompleto: " + visible);
    }
    String same = GtoAcceptedFreightFieldPolicy.acceptedVisibleDestination(
      visible,
      visible,
      "Agro Grão",
      "Soja | Fazenda Areia Dourada › Agro Grão | Area Rural | 300Km | R$ 5.300,00",
      "Fazenda Areia Dourada › Agro Grão",
      "Fazenda Areia Dourada"
    );
    if (!visible.equals(same)) throw new AssertionError("Destino não idempotente: " + same);
    System.out.println("HF145 fixture destination=Agro Grão Area Rural");
  }
}
`;
await (await import("node:fs/promises")).writeFile(path.join(temp, "Hf145DestinationFixture.java"), source, "utf8");
const javac = process.env.JAVAC || "javac";
try {
      execFileSync(javac, ["-encoding", "UTF-8", "-d", temp, path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoFreightTextGuard.java"), policyPath, destinationAuthorityPath, resolverPath, path.join(temp, "Hf145DestinationFixture.java")], {

    cwd: root,
    stdio: "pipe",
  });
  execFileSync("java", ["-cp", temp, "com.nvu.operacional.Hf145DestinationFixture"], {
    cwd: root,
    stdio: "pipe",
  });
} catch (error) {
  const detail = Buffer.isBuffer(error.stderr) ? error.stderr.toString("utf8") : String(error.message || error);
  fail(`fixture Java não passou: ${detail.trim()}`);
}
await (await import("node:fs/promises")).rm(temp, { recursive: true, force: true });
pass("barreira de Lista, persistência e fixture Agro Grão Area Rural aprovadas");
console.log("HF145: destination end-to-end checks passed");

async function fsMkdir() {
  return (await import("node:fs/promises")).mkdtemp(path.join(os.tmpdir(), "nvu-hf145-"));
}
