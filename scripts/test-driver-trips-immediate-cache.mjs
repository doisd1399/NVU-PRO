import assert from "node:assert/strict";
import fs from "node:fs";

const hook = fs.readFileSync(new URL("../src/hooks/useDriverTrips.ts", import.meta.url), "utf8");
const profile = fs.readFileSync(new URL("../src/pages/driver/Profile.tsx", import.meta.url), "utf8");
const repository = fs.readFileSync(new URL("../src/repositories/TripsRepository.ts", import.meta.url), "utf8");

assert.match(
  hook,
  /const persistedTrips = readPersistedTrips\(driverId\);[\s\S]*loading: persistedTrips\.length === 0,/,
  "a entrada do cache do motorista deve ser exibida imediatamente",
);
assert.match(
  hook,
  /const persistedTrips = readPersistedTrips\(normalizedId\);[\s\S]*loading: persistedTrips\.length === 0,/,
  "o primeiro estado do hook deve respeitar o cache não vazio",
);
assert.match(
  hook,
  /entry\.trips\.length === 0/,
  "falhas/retries não podem apagar histórico já pintado",
);
assert.match(
  profile,
  /const driverTripState = useDriverTrips\(currentUser\.id\);/,
  "o perfil do motorista deve usar a fonte única de histórico do motorista",
);
assert.match(
  repository,
  /includeMetadataChanges: true/,
  "a reconciliação Firestore deve continuar aceitando mudanças de metadata",
);
assert.match(
  repository,
  /areTripSourcesReady\(canonicalAuthoritative, legacyReady\)/,
  "a emissão autoritativa final deve continuar exigindo as duas fontes",
);

console.log("driver-trips-immediate-cache: PASS 6 checks");
console.log("Histórico cacheado pinta imediatamente e a reconciliação autoritativa permanece ativa.");
