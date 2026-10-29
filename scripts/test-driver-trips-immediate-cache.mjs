import assert from "node:assert/strict";
import fs from "node:fs";
const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const hook = read("src/hooks/useDriverTrips.ts");
const profile = read("src/pages/driver/Profile.tsx");
const queryService = read("src/application/trip/CanonicalTripQueryService.ts");
const adapter = read("src/application/trip/CanonicalTripRealtimeFirebaseAdapter.ts");
const rules = read("firestore.rules");

assert.match(hook, /const persisted = readPersistedTrips\(driverId\);[\s\S]*trips: persisted\.trips,[\s\S]*loading: !persisted\.historyReady,/, "a entrada usa imediatamente o snapshot válido do cache");
assert.match(hook, /const persisted = readPersistedTrips\(normalizedId\);[\s\S]*trips: persisted\.trips,[\s\S]*loading: !persisted\.historyReady,/, "o estado inicial respeita o marcador de cache válido");
assert.match(hook, /entry\.trips\.length === 0/, "falhas/retries não podem apagar histórico já pintado");
assert.match(profile, /const driverTripState = useDriverTrips\(currentUser\.id\);/, "perfil deve usar fonte única por motorista");
assert.ok(queryService.includes("listenDriverTrips") && queryService.includes("{ driverId: id }"), "consulta do hook deve carregar o escopo do motorista");
assert.ok(adapter.includes('for (const driverField of driverFields)') && adapter.includes('where(driverField, "==", driverId)') && adapter.includes('["driverId", "motoristaId"') && adapter.includes('"historico_viagens"'), "adapter deve observar aliases da coleção canônica usando consultas de owner por UID");
assert.ok(!adapter.includes('collection(db, "trips")'), "adapter não pode depender da coleção trips ausente/não autorizada");
assert.ok(rules.includes("existingTripDriverId() == request.auth.uid"), "regras precisam limitar leitura ao motorista autenticado");

console.log("driver-trips-immediate-cache: PASS 8 checks");
console.log("Histórico cacheado pinta imediatamente e o listener remoto usa a coleção canônica com escopo autenticado.");
