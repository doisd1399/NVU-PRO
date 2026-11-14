/**
 * v43 — actions answer from São Paulo (where Firestore lives) instead of crossing to us-central1.
 *
 * Covers: (1) client list === server list, triggers never dual-deployed; (2) the routing/fallback rules, run against the
 * REAL Firebase Functions SDK with a fake `fetch` (so the error signatures the fallback relies on are the SDK's own);
 * (3) warm-up cost rules; (4) the server wake-up ping answers before any authorization.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { initializeApp } from "firebase/app";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
import {
  CALLABLE_FALLBACK_REGION, CALLABLE_PRIMARY_REGION, DUAL_REGION_CALLABLES, WARMABLE_CALLABLES, isDualRegionCallable,
} from "../src/lib/callableRegions.ts";
import { httpsCallable, nextCallableRegion, resetRegionalCallableState } from "../src/lib/regionalCallable.ts";
import { WARM_INTERVAL_MS, shouldWarm } from "../src/lib/warmPolicy.ts";
import { CALLABLE_REGIONS, isWarmPing } from "../functions/src/callableRegions.ts";

let checks = 0;
async function test(name: string, run: () => void | Promise<void>) { await run(); checks++; console.log("PASS", name); }

// ───────────────────────── 1. client list === server declarations ─────────────────────────
const sources = readdirSync("functions/src").filter(file => file.endsWith(".ts")).map(file => ({ file, text: readFileSync(`functions/src/${file}`, "utf8") }));
const declared = new Map<string, string>();
for (const { file, text } of sources) {
  for (const match of text.matchAll(/export const (\w+)\s*=\s*functions\s*\.region\(\.\.\.CALLABLE_REGIONS\)([\s\S]{0,200}?)(?:\.https\.onCall|\.firestore|\.pubsub|\.auth\.|\.storage|\.tasks|\.runWith)/g)) {
    declared.set(match[1], file);
  }
}
await test("Server declares exactly the callables the client routes to São Paulo", () => {
  const server = [...declared.keys()].sort(), client = [...DUAL_REGION_CALLABLES].sort();
  assert.deepEqual(server, client, `diferença: server-only=${server.filter(n => !client.includes(n))} client-only=${client.filter(n => !server.includes(n))}`);
  assert.equal(new Set(DUAL_REGION_CALLABLES).size, DUAL_REGION_CALLABLES.length, "nomes repetidos");
});
await test("Every dual-region declaration is an HTTPS callable (a trigger deployed twice would process each event twice)", () => {
  for (const { file, text } of sources) {
    for (const match of text.matchAll(/\.region\(\.\.\.CALLABLE_REGIONS\)([\s\S]{0,260})/g)) {
      const head = match[1].split(";")[0], at = head.indexOf(".https.onCall");
      assert.ok(at >= 0, `${file}: CALLABLE_REGIONS usado fora de https.onCall: ${head.slice(0, 80)}`);
      // Only the builder chain before onCall: the handler body may legitimately mention admin.firestore().
      assert.doesNotMatch(head.slice(0, at), /\.firestore\b|\.pubsub\b|\.auth\.|\.storage\b|\.tasks\b|\.https\.onRequest/, `${file}: gatilho em duas regiões`);
    }
  }
});
await test("Firestore triggers stay single-region", () => {
  for (const { file, text } of sources)
    for (const match of text.matchAll(/\.region\("([^"]+)"\)[\s\S]{0,160}?\.firestore\b/g))
      assert.equal(match[1], "us-central1", `${file}: gatilho Firestore em ${match[1]}`);
});
await test("Both regions are listed, São Paulo first, and the old region is kept for installed apps", () => {
  assert.deepEqual([...CALLABLE_REGIONS], ["southamerica-east1", "us-central1"]);
  assert.equal(CALLABLE_PRIMARY_REGION, CALLABLE_REGIONS[0]);
  assert.equal(CALLABLE_FALLBACK_REGION, CALLABLE_REGIONS[1]);
});
await test("Warm-up ping is answered before authorization in every warmable function", () => {
  for (const name of WARMABLE_CALLABLES) {
    assert.ok(isDualRegionCallable(name), `${name} precisa estar nas duas regiões`);
    const file = declared.get(name)!;
    const text = readFileSync(`functions/src/${file}`, "utf8");
    const at = text.search(new RegExp(`export const ${name}\\s*=`));
    const body = text.slice(at, at + 1400);
    const ping = body.indexOf("isWarmPing(");
    assert.ok(ping > 0, `${name}: sem resposta ao ping de aquecimento`);
    const auth = body.search(/context\.auth/);
    assert.ok(auth === -1 || ping < auth, `${name}: o ping precisa responder antes de context.auth`);
  }
  assert.equal(isWarmPing({ __warm: true }), true);
  for (const input of [null, undefined, {}, { __warm: false }, { __warm: "true" }, [], "x", 1, { trip: {} }]) assert.equal(isWarmPing(input), false);
});

// ───────────────────────── 2. routing against the real SDK ─────────────────────────
const app = initializeApp({ apiKey: "x", projectId: "demo-region-test", appId: "1:1:web:1" }, "region-test");
const fixture = () => getFunctions(app, "us-central1");
type Handler = (url: string) => Response | Promise<Response>;
const requests: string[] = [];
let handler: Handler = () => new Response("{}", { status: 200 });
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url || input);
  requests.push(`${init?.method || "GET"} ${url}`);
  return handler(url);
}) as typeof fetch;
const ok = (region: string) => new Response(JSON.stringify({ result: { region } }), { status: 200, headers: { "content-type": "application/json" } });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const host = (region: string) => `https://${region}-demo-region-test.cloudfunctions.net/`;
const calls = () => requests.filter(line => line.startsWith("POST"));
const reset = (next: Handler) => { requests.length = 0; handler = next; resetRegionalCallableState(); };
const setOnline = (value: boolean | undefined) => Object.defineProperty(globalThis, "navigator", { value: value === undefined ? undefined : { onLine: value }, configurable: true });

await test("São Paulo answers: one request, to São Paulo, nothing sent to us-central1", async () => {
  reset(url => url.startsWith(host("southamerica-east1")) ? ok("sp") : ok("us"));
  const result = await httpsCallable(fixture(), "operationalCommand")({ a: 1 });
  assert.deepEqual(result.data, { region: "sp" });
  assert.equal(calls().length, 1);
  assert.ok(calls()[0].includes(host("southamerica-east1") + "operationalCommand"));
});
await test("Function not deployed in São Paulo (HTTP 404, no JSON): falls back once, then skips São Paulo", async () => {
  reset(url => url.startsWith(host("southamerica-east1")) ? new Response("<html>Error 404</html>", { status: 404 }) : ok("us"));
  const call = httpsCallable(fixture(), "operationalCommand");
  assert.deepEqual((await call({})).data, { region: "us" });
  assert.deepEqual(calls().map(line => line.includes("southamerica-east1")), [true, false]);
  assert.equal(nextCallableRegion(fixture(), "operationalCommand"), "us-central1");
  requests.length = 0;
  assert.deepEqual((await call({})).data, { region: "us" });
  assert.equal(calls().length, 1, "depois do fallback não paga uma tentativa em SP a cada chamada");
  assert.ok(!calls()[0].includes("southamerica-east1"));
});
await test("Missing function seen by the browser as a blocked preflight (network error, nothing answered yet): falls back", async () => {
  reset(url => { if (url.startsWith(host("southamerica-east1"))) throw new TypeError("Failed to fetch"); return ok("us"); });
  assert.deepEqual((await httpsCallable(fixture(), "registerCanonicalSimpleTrip")({})).data, { region: "us" });
  assert.equal(calls().length, 2);
});
await test("After São Paulo answered once, a later network failure is NOT replayed in another region", async () => {
  let down = false;
  reset(url => { if (url.startsWith(host("southamerica-east1"))) { if (down) throw new TypeError("Failed to fetch"); return ok("sp"); } return ok("us"); });
  const call = httpsCallable(fixture(), "operationalCommand");
  await call({}); down = true; requests.length = 0;
  await assert.rejects(call({}), (error: any) => error.code === "functions/internal");
  assert.equal(calls().length, 1);
  assert.ok(!calls().some(line => line.includes("us-central1")), "uma resposta perdida nunca é reexecutada em outra região");
});
await test("Offline is not evidence that São Paulo is missing", async () => {
  reset(() => { throw new TypeError("Failed to fetch"); });
  setOnline(false);
  try {
    await assert.rejects(httpsCallable(fixture(), "operationalCommand")({}));
    assert.equal(calls().length, 1);
    assert.equal(nextCallableRegion(fixture(), "operationalCommand"), "southamerica-east1");
  } finally { setOnline(undefined); }
});
await test("Real server errors are never retried elsewhere (including a business 'not-found')", async () => {
  for (const [status, body, code] of [
    [404, { error: { status: "NOT_FOUND", message: "Empresa não encontrada." } }, "functions/not-found"],
    [403, { error: { status: "PERMISSION_DENIED", message: "Sem permissão." } }, "functions/permission-denied"],
    [412, { error: { status: "FAILED_PRECONDITION", message: "Você já possui uma operação em andamento." } }, "functions/failed-precondition"],
    [500, { error: { status: "INTERNAL", message: "INTERNAL" } }, "functions/internal"],
    [401, { error: { status: "UNAUTHENTICATED", message: "Faça login." } }, "functions/unauthenticated"],
  ] as const) {
    reset(url => url.startsWith(host("southamerica-east1")) ? json(status, body) : ok("us"));
    await assert.rejects(httpsCallable(fixture(), "operationalCommand")({}), (error: any) => error.code === code, String(status));
    assert.equal(calls().length, 1, `${status}: não pode ir para a outra região`);
    assert.equal(nextCallableRegion(fixture(), "operationalCommand"), "southamerica-east1");
  }
});
await test("Callables outside the list behave exactly like the SDK (us-central1 only)", async () => {
  reset(() => ok("us"));
  assert.equal(isDualRegionCallable("registerPushDevice"), false);
  await httpsCallable(fixture(), "registerPushDevice")({});
  assert.equal(calls().length, 1);
  assert.ok(calls()[0].includes(host("us-central1")));
  assert.equal(nextCallableRegion(fixture(), "registerPushDevice"), "us-central1");
});
await test("Emulator and other regions are never rerouted", async () => {
  reset(() => ok("emulator"));
  const emulated = getFunctions(app, "us-central1");
  connectFunctionsEmulator(emulated, "127.0.0.1", 5001);
  requests.length = 0;
  await httpsCallable(emulated, "operationalCommand")({});
  assert.deepEqual(calls().map(line => line.includes("127.0.0.1:5001/demo-region-test/us-central1/operationalCommand")), [true]);
  reset(() => ok("eu"));
  await httpsCallable(getFunctions(app, "europe-west1"), "operationalCommand")({});
  assert.ok(calls()[0].includes("europe-west1"));
  assert.equal(calls().length, 1);
});
await test("Options (timeout) and the payload reach São Paulo untouched", async () => {
  let body = "";
  globalThis.fetch = (async (input: any, init?: any) => { requests.push(`${init?.method} ${input}`); body = String(init?.body || ""); return ok("sp"); }) as typeof fetch;
  requests.length = 0; resetRegionalCallableState();
  await httpsCallable(fixture(), "manageFleetMembership", { timeout: 6_000 })({ action: "remove", companyId: "c1" });
  assert.deepEqual(JSON.parse(body), { data: { action: "remove", companyId: "c1" } });
});

// ───────────────────────── 3. warm-up cost rules ─────────────────────────
await test("Warm-up: only when visible, online, signed in, outside teardown, at most every 10 minutes", () => {
  const base = { now: 1_000_000, lastWarmAt: 0, online: true, hidden: false, signedIn: true, tearingDown: false };
  assert.equal(shouldWarm(base), true);
  for (const change of [{ online: false }, { hidden: true }, { signedIn: false }, { tearingDown: true }]) assert.equal(shouldWarm({ ...base, ...change }), false, JSON.stringify(change));
  assert.equal(shouldWarm({ ...base, lastWarmAt: base.now - WARM_INTERVAL_MS + 1 }), false);
  assert.equal(shouldWarm({ ...base, lastWarmAt: base.now - WARM_INTERVAL_MS }), true);
  assert.ok(WARM_INTERVAL_MS >= 5 * 60_000, "intervalo curto demais aumentaria o custo");
  assert.ok(WARMABLE_CALLABLES.length <= 6, "poucas funções aquecidas");
});

console.log(`\n${checks} checks passed`);
