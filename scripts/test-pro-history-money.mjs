import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const service = fs.readFileSync("android/app/src/main/java/com/nvu/operacional/SimpleAutomationService.java", "utf8");
const extract = (name) => {
  const start = service.search(new RegExp(`private static [\\w<>]+ ${name}\\(`));
  assert.ok(start >= 0, `Missing service method ${name}`);
  const body = service.indexOf("{", start);
  let depth = 1, end = body + 1;
  while (depth && end < service.length) {
    if (service[end] === "{") depth++;
    if (service[end] === "}") depth--;
    end++;
  }
  assert.equal(depth, 0);
  return service.slice(start, end);
};

// Compile the actual adapter and renderer with minimal data-container fixtures.
// This reproduces the server snapshot that used to discard currency; it is not an APK test.
const methods = ["historyItemFromFirestore", "formatHistoryAmount", "firstText", "firstTimestamp",
  "timestampValue", "longValue", "doubleValue", "safe"].map(extract).join("\n");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-pro-history-money-"));
try {
  const harness = path.join(tmp, "ProHistoryAdapterHarness.java");
  fs.writeFileSync(harness, `package com.nvu.operacional;
import java.util.*;
final class ProHistoryAdapterHarness {
${methods}
static Map<String, Object> project(Map<String, Object> raw) {
    JSONObject item = historyItemFromFirestore(new DocumentSnapshot(raw), "job-1", "company-1", "driver-1");
    return item == null ? null : item.data;
}
static String render(Map<String, Object> raw) { return formatHistoryAmount(new JSONObject(raw)); }
}
final class DocumentSnapshot {
    private final Map<String, Object> data;
    DocumentSnapshot(Map<String, Object> data) { this.data = data; }
    Map<String, Object> getData() { return data; }
    String getId() { return "document-1"; }
}
final class Timestamp { java.util.Date toDate() { return new java.util.Date(1791492000000L); } }
final class JSONException extends Exception {}
final class JSONObject {
    final Map<String, Object> data = new LinkedHashMap<>();
    JSONObject() {}
    JSONObject(Map<String, Object> raw) { data.putAll(raw); }
    JSONObject put(String key, Object value) throws JSONException { data.put(key, value); return this; }
    Object opt(String key) { return data.get(key); }
    Iterator<String> keys() { return data.keySet().iterator(); }
    long optLong(String key, long fallback) { Object value = data.get(key); return value instanceof Number ? ((Number) value).longValue() : fallback; }
}
`);
  const run = (args) => {
    const result = spawnSync("java", args, { encoding: "utf8" });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    assert.equal(result.status, 0, result.error?.message || "Java regression command failed");
  };
  run(["-m", "jdk.compiler/com.sun.tools.javac.Main", "-encoding", "UTF-8", "-d", tmp,
    "android/app/src/main/java/com/nvu/operacional/ProHistoryMoney.java", harness,
    "scripts/java-tests/com/nvu/operacional/ProHistoryMoneyRegressionTest.java"]);
  run(["-cp", tmp, "com.nvu.operacional.ProHistoryMoneyRegressionTest"]);

  // Keep all shared registry aliases aligned, without requiring npm dependencies.
  const registry = fs.readFileSync("functions/src/simulatorCurrencyRegistry.ts", "utf8");
  const entries = [...registry.matchAll(/\{ simulator: "([^"]+)", currency: "([^"]+)", aliases: (\[[^\]]+\])/g)];
  assert.equal(entries.length, 4, "Shared simulator registry format changed");
  const fields = ["simulatorId", "simulatorCode", "simulatorKey", "simulatorName", "simulator",
    "simuladorId", "simuladorCodigo", "simuladorKey", "simuladorNome", "simulador",
    "gameId", "gameCode", "gameName", "packageId"];
  const cases = entries.flatMap(([, , currency, aliases]) => JSON.parse(aliases).flatMap(alias =>
    fields.map(field => `check(${JSON.stringify(field)}, ${JSON.stringify(alias)}, ${JSON.stringify(currency)});`)));
  const parity = path.join(tmp, "ProHistoryRegistryParityTest.java");
  fs.writeFileSync(parity, `package com.nvu.operacional;
import java.util.*;
public final class ProHistoryRegistryParityTest {
  public static void main(String[] args) {
    ${cases.join("\n")}
    System.out.println("PASS: ${cases.length} shared simulator registry aliases/fields match native history");
  }
  private static void check(String field, String alias, String expected) {
    Map<String, Object> row = new LinkedHashMap<>(); row.put(field, alias);
    ProHistoryMoney.Resolution actual = ProHistoryMoney.resolve(row);
    if (!expected.equals(actual.currency) || !"known".equals(actual.status))
      throw new AssertionError(field + "=" + alias + ": expected " + expected + ", got " + actual.currency);
  }
}
`);
  run(["-m", "jdk.compiler/com.sun.tools.javac.Main", "-encoding", "UTF-8", "-cp", tmp, "-d", tmp, parity]);
  run(["-cp", tmp, "com.nvu.operacional.ProHistoryRegistryParityTest"]);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
