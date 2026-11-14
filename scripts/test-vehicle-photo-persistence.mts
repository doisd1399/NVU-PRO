import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { vehiclePhotoKey, vehiclePhotoDocumentKey, resolveVehiclePhotoSimulatorId } from "../src/lib/vehiclePhotoIdentity";
import { getVehiclePhotoRecord, putVehiclePhotoRecord, readVehiclePhotoPoster, listPendingVehiclePhotos, type VehiclePhotoRecord } from "../src/services/vehiclePhotoStore";
import { createVehiclePhotoSync } from "../src/services/vehiclePhotoSync";
import { findRemoteVehiclePhoto } from "../src/services/vehiclePhotoRepository";

class MemoryStorage {
  values = new Map<string, string>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] || null; }
  getItem(key: string) { return this.values.get(key) || null; }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
  removeItem(key: string) { this.values.delete(key); }
}
Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });
const identity = { userId: "driver-photo-a", simulatorId: "gto", vehicleId: "scania.g:120", vehicleName: "Scania G" };
const record = (overrides: Partial<VehiclePhotoRecord> = {}): VehiclePhotoRecord => {
  const value = { ...identity, companyId: "company-a", revision: crypto.randomUUID(),
    imageDataUrl: "data:image/webp;base64,cGhvdG8=", posterDataUrl: "data:image/jpeg;base64,cG9zdGVy",
    contentType: "image/webp", status: "pending" as const, updatedAt: Date.now(), ...overrides };
  return { ...value, key: vehiclePhotoKey(value) };
};
let scenarios = 0;
async function test(name: string, run: () => unknown | Promise<unknown>) {
  await run(); scenarios++; console.log(`PASS ${name}`);
}

await test("identidade por usuário/simulador/veículo, sem colisão e estável após catálogo", () => {
  assert.notEqual(vehiclePhotoKey(identity), vehiclePhotoKey({ ...identity, userId: "driver-photo-b" }));
  assert.notEqual(vehiclePhotoKey(identity), vehiclePhotoKey({ ...identity, simulatorId: "ets2" }));
  assert.notEqual(vehiclePhotoKey(identity), vehiclePhotoKey({ ...identity, vehicleId: "iveco" }));
  assert.notEqual(vehiclePhotoKey({ ...identity, userId: "a:b", vehicleId: "c" }), vehiclePhotoKey({ ...identity, userId: "a", vehicleId: "b:c" }));
  assert.equal(resolveVehiclePhotoSimulatorId({ simulatorId: "GTO", simulatorName: "Global Truck Online" }), "gto");
  assert.equal(resolveVehiclePhotoSimulatorId({ simulatorId: "GTO", simulatorName: "Global Truck Online" }, [{ id: "opaqueCatalogId", name: "Global Truck Online" }]), "gto");
  assert.equal(resolveVehiclePhotoSimulatorId({ currentRecruitmentSimulatorId: "OGCmLdZ6ZNkwMEzDbI9t" }, [{ id: "OGCmLdZ6ZNkwMEzDbI9t", name: "GTO" }]), "gto");
  assert.throws(() => vehiclePhotoKey({ ...identity, simulatorId: "" }), /IDENTITY_REQUIRED/);
});
await test("bytes reais persistem em IndexedDB para vários veículos e contas", async () => {
  for (const value of [record(), record({ vehicleId: "iveco", imageDataUrl: "data:image/png;base64,aXZlY28=" }), record({ simulatorId: "ets2" }), record({ userId: "driver-photo-b" })]) await putVehiclePhotoRecord(value);
  assert.equal((await getVehiclePhotoRecord(identity))?.imageDataUrl, "data:image/webp;base64,cGhvdG8=");
  assert.equal((await getVehiclePhotoRecord({ ...identity, vehicleId: "iveco" }))?.imageDataUrl, "data:image/png;base64,aXZlY28=");
  assert.equal((await getVehiclePhotoRecord({ ...identity, simulatorId: "wtds" })), null);
  assert.equal((await listPendingVehiclePhotos(identity.userId)).length, 3);
});
await test("poster síncrono contém imagem; IndexedDB permanece após limpar o cache de miniaturas", async () => {
  assert.match(readVehiclePhotoPoster(identity)!.src, /^data:image\//);
  assert.equal(readVehiclePhotoPoster({ ...identity, userId: "unrelated" }), null);
  (localStorage as unknown as MemoryStorage).values.clear();
  assert.equal(readVehiclePhotoPoster(identity), null);
  assert.match((await getVehiclePhotoRecord(identity))!.imageDataUrl, /^data:image\//);
});
await test("falha offline conserva a foto e uma nova sessão de sincronização recupera", async () => {
  const target = record({ vehicleId: "offline" }); await putVehiclePhotoRecord(target);
  await assert.rejects(createVehiclePhotoSync({ currentUserId: () => identity.userId, upload: async () => { throw new Error("offline"); }, writeMetadata: async () => { throw new Error("must not write"); } }).sync(target), /offline/);
  assert.equal((await getVehiclePhotoRecord(target))?.status, "pending");
  const restored = createVehiclePhotoSync({ currentUserId: () => identity.userId, upload: async () => "https://test.invalid/offline.webp", writeMetadata: async () => undefined });
  await restored.sync(target); assert.equal((await getVehiclePhotoRecord(target))?.status, "synced");
});
await test("falha de metadados permite retry sem reenviar a imagem já enviada", async () => {
  const target = record({ vehicleId: "retry" }); await putVehiclePhotoRecord(target);
  let uploads = 0, writes = 0;
  const engine = createVehiclePhotoSync({ currentUserId: () => identity.userId,
    upload: async () => { uploads++; return "https://test.invalid/retry.webp"; },
    writeMetadata: async () => { if (++writes === 1) throw new Error("permission-denied"); },
  });
  await assert.rejects(engine.sync(target), /permission-denied/);
  assert.equal((await getVehiclePhotoRecord(target))?.status, "pending");
  await engine.sync(target); assert.equal(uploads, 1); assert.equal(writes, 2);
  assert.equal((await getVehiclePhotoRecord(target))?.status, "synced");
});
await test("troca de conta bloqueia o envio de fotos da conta anterior", async () => {
  let uploads = 0;
  await assert.rejects(createVehiclePhotoSync({ currentUserId: () => "driver-photo-b", upload: async () => { uploads++; return "unused"; }, writeMetadata: async () => undefined }).sync(identity), /SESSION_CHANGED/);
  assert.equal(uploads, 0);
});
await test("substituição durante upload grava somente a foto mais recente", async () => {
  const first = record({ vehicleId: "race", revision: "old" }); await putVehiclePhotoRecord(first);
  let started!: () => void, release!: () => void;
  const start = new Promise<void>((resolve) => { started = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const written: string[] = [];
  const engine = createVehiclePhotoSync({ currentUserId: () => identity.userId,
    upload: async (value) => { if (value.revision === "old") { started(); await gate; } return `https://test.invalid/${value.revision}.webp`; },
    writeMetadata: async (value) => { written.push(value.revision); },
  });
  const oldUpload = engine.sync(first); await start;
  const newest = record({ vehicleId: "race", revision: "new", imageDataUrl: "data:image/png;base64,bmV3" }); await putVehiclePhotoRecord(newest);
  const newUpload = engine.sync(newest); release(); await Promise.all([oldUpload, newUpload]);
  assert.deepEqual(written, ["new"]); assert.equal((await getVehiclePhotoRecord(first))?.revision, "new");
});
await test("download antigo não substitui seleção local mais recente", async () => {
  const current = record({ vehicleId: "download-race", revision: "selected" }); await putVehiclePhotoRecord(current);
  const downloaded = record({ vehicleId: "download-race", revision: "downloaded", status: "synced" });
  assert.equal(await putVehiclePhotoRecord(downloaded, null), false);
  assert.equal((await getVehiclePhotoRecord(current))?.revision, "selected");
});
await test("metadados remotos selecionam somente a conta, simulador e veículo correspondentes", () => {
  const data = { vehiclePhotosV2: { [vehiclePhotoDocumentKey(identity)]: { ...identity, url: "https://test.invalid/scania.webp" } } };
  assert.equal(findRemoteVehiclePhoto(data, identity), "https://test.invalid/scania.webp");
  assert.equal(findRemoteVehiclePhoto(data, { ...identity, simulatorId: "ets2" }), null);
  assert.equal(findRemoteVehiclePhoto(data, { ...identity, userId: "driver-photo-b" }), null);
  assert.equal(findRemoteVehiclePhoto(data, { ...identity, vehicleId: "iveco" }), null);
});
await test("migração das fotos R3 mantém o veículo exato e recusa simulador explícito diferente", () => {
  const legacy = { vehiclePhotos: { [identity.vehicleId]: { vehicleId: identity.vehicleId, url: "https://test.invalid/r3.webp" } } };
  assert.equal(findRemoteVehiclePhoto(legacy, identity), null); // simulator not evidenced
  legacy.vehiclePhotos[identity.vehicleId] = { ...legacy.vehiclePhotos[identity.vehicleId], simulatorId: identity.simulatorId } as any;
  assert.equal(findRemoteVehiclePhoto(legacy, identity), "https://test.invalid/r3.webp");
  assert.equal(findRemoteVehiclePhoto(legacy, { ...identity, vehicleId: "other" }), null);
  legacy.vehiclePhotos[identity.vehicleId] = { ...legacy.vehiclePhotos[identity.vehicleId], simulatorId: "ets2" } as any;
  assert.equal(findRemoteVehiclePhoto(legacy, identity), null);
});
await test("storage indisponível não relata sucesso falso", async () => {
  const savedIdb = globalThis.indexedDB, savedStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, "indexedDB", { value: undefined, configurable: true });
  Object.defineProperty(globalThis, "localStorage", { value: { getItem() { return null; }, setItem() { throw new Error("QuotaExceededError"); } }, configurable: true });
  try { await assert.rejects(putVehiclePhotoRecord(record({ vehicleId: "quota" })), /VEHICLE_PHOTO_STORAGE_FULL_OR_UNAVAILABLE|QuotaExceededError/); }
  finally {
    Object.defineProperty(globalThis, "indexedDB", { value: savedIdb, configurable: true });
    Object.defineProperty(globalThis, "localStorage", { value: savedStorage, configurable: true });
  }
});
await test("falha ao atualizar storage interrompe retry e conserva o estado pendente", async () => {
  const savedIdb = globalThis.indexedDB, savedStorage = globalThis.localStorage as unknown as MemoryStorage;
  Object.defineProperty(globalThis, "indexedDB", { value: undefined, configurable: true });
  const target = record({ vehicleId: "quota-after-save" }); await putVehiclePhotoRecord(target);
  const originalSet = savedStorage.setItem;
  savedStorage.setItem = () => { throw new Error("QuotaExceededError"); };
  let uploads = 0, writes = 0;
  try {
    const engine = createVehiclePhotoSync({ currentUserId: () => identity.userId,
      upload: async () => { uploads++; return "https://test.invalid/quota.webp"; }, writeMetadata: async () => { writes++; },
    });
    await assert.rejects(engine.sync(target), /STORAGE_UPDATE_FAILED/);
    assert.equal(uploads, 1); assert.equal(writes, 0);
    assert.equal((await getVehiclePhotoRecord(target))?.status, "pending");
  } finally {
    savedStorage.setItem = originalSet;
    Object.defineProperty(globalThis, "indexedDB", { value: savedIdb, configurable: true });
  }
});
await test("logout durante upload não grava metadados com a nova sessão", async () => {
  const target = record({ vehicleId: "logout-during-upload" }); await putVehiclePhotoRecord(target);
  let uid = identity.userId, writes = 0;
  const engine = createVehiclePhotoSync({ currentUserId: () => uid,
    upload: async () => { uid = "new-account"; return "https://test.invalid/logout.webp"; }, writeMetadata: async () => { writes++; },
  });
  await assert.rejects(engine.sync(target), /SESSION_CHANGED/);
  assert.equal(writes, 0); assert.equal((await getVehiclePhotoRecord(target))?.status, "pending");
});
console.log(`${scenarios}/${scenarios} functional vehicle-photo scenarios passed.`);
