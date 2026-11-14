import assert from "node:assert/strict";
import { build } from "esbuild";

const saved = new Map();
globalThis.localStorage = {
  getItem: key => saved.get(key) ?? null,
  setItem: (key, value) => saved.set(key, value),
};

let reads = 0;
let response = null;
globalThis.__cityRead = async () => {
  reads += 1;
  return response();
};

const bundle = await build({
  entryPoints: ["src/services/simpleAutomationCityService.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  plugins: [{
    name: "stub-firestore",
    setup(build) {
      build.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: "firestore", namespace: "stub" }));
      build.onResolve({ filter: /^\.\.\/lib\/firebase$/ }, () => ({ path: "firebase", namespace: "stub" }));
      build.onLoad({ filter: /.*/, namespace: "stub" }, ({ path }) => ({
        contents: path === "firestore"
          ? "export const doc = (_db, _collection, key) => key; export const getDoc = key => globalThis.__cityRead(key);"
          : "export const db = {};",
        loader: "js",
      }));
    },
  }],
});
const cities = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const snapshot = (names, fromCache = false, exists = true) => ({
  exists: () => exists,
  data: () => ({ cities: names }),
  metadata: { fromCache },
});

response = () => snapshot(["Curitiba", "Lages"]);
await cities.loadSimpleAutomationCities("toe-3");
assert.deepEqual(cities.getCachedSimpleAutomationCities("toe-3").map(city => city.name), ["Curitiba", "Lages"]);
assert.deepEqual(cities.getCachedSimpleAutomationCities("wtds"), [], "simulator lists must stay isolated");

response = () => snapshot([], true, false);
const offline = await cities.loadSimpleAutomationCities("toe-3");
assert.deepEqual(offline.map(city => city.name), ["Curitiba", "Lages"], "unconfirmed offline empty data must not erase cities");
assert.deepEqual(JSON.parse(saved.get("nvu:pro-cities:v1:toe-3")), ["Curitiba", "Lages"]);

response = () => { throw new Error("network unavailable"); };
await assert.rejects(cities.loadSimpleAutomationCities("toe-3"), /network unavailable/);
assert.equal(cities.getCachedSimpleAutomationCities("toe-3").length, 2, "a failed refresh retains cities");

response = () => snapshot([], false, false);
assert.deepEqual(await cities.loadSimpleAutomationCities("toe-3"), [], "a confirmed server deletion clears old cities");
assert.deepEqual(JSON.parse(saved.get("nvu:pro-cities:v1:toe-3")), []);
assert.equal(reads, 4);
console.log("pro-cities-offline: PASS persistence, simulator isolation, offline retention and confirmed deletion");
