import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { JSDOM } from "jsdom";
import { createProfileCoverSync } from "../src/services/profileCoverSync";
import { cacheRemoteProfileCover, getProfileCover, listPendingProfileCovers, profileCoverKey, putProfileCover, type ProfileCoverRecord } from "../src/services/profileCoverStore";
import { isProfileCoverPage, resolveProfileCover } from "../src/lib/profileCover";

const dom = new JSDOM("", { url: "http://127.0.0.1/cover-test" });
for (const key of ["window", "localStorage", "navigator", "CustomEvent"]) Object.defineProperty(globalThis, key, { value: (dom.window as any)[key], configurable: true });
const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const target = { scope: "driver" as const, profileId: "driver" };
const make = (revision: string, scope: "driver" | "company" = "driver", profileId = "driver"): ProfileCoverRecord => ({ scope, profileId, viewerId: "driver", key: profileCoverKey("driver", { scope, profileId }), revision, updatedAt: Date.now(), imageDataUrl: image, remoteUrl: "", status: "pending" });
const results: string[] = [];
const check = async (name: string, run: () => Promise<void> | void) => { await run(); results.push(name); console.log("PASS", name); };
let uid = "driver", generation = 0, online = false, uploads = 0;
const published: { revision: string; url: string; scope: string; profileId: string }[] = [];
let uploadGate: ((record: ProfileCoverRecord) => Promise<void>) | undefined;
let publishGate: ((record: ProfileCoverRecord) => Promise<void>) | undefined;
let denyPublish = false;
const sync = createProfileCoverSync({ currentUserId: () => uid, sessionGeneration: () => generation, online: () => online,
  upload: async record => { uploads++; await uploadGate?.(record); return "https://example.test/cover-" + record.revision; },
  publish: async (record, url) => { await publishGate?.(record); if (denyPublish) throw new Error("permission-denied"); published.push({ revision: record.revision, url, scope: record.scope, profileId: record.profileId }); },
});
await check("Seleção offline persiste sem publicação e sem depender do cache HTTP", async () => {
  await putProfileCover(make("offline")); await sync.sync("driver", target);
  assert.equal(uploads, 0); assert.equal((await getProfileCover("driver", target))?.imageDataUrl, image);
  assert.equal((await listPendingProfileCovers("driver")).length, 1);
});
await check("Reinício do módulo recupera a edição pendente do IndexedDB", async () => {
  const cold = await import("../src/services/profileCoverStore.ts?cold-start");
  assert.equal((await cold.getProfileCover("driver", target))?.revision, "offline");
});
await check("Reconexão envia uma vez e aguarda confirmação antes de sincronizar", async () => {
  online = true; await Promise.all([sync.sync("driver", target), sync.sync("driver", target)]);
  assert.equal(uploads, 1); assert.equal(published.length, 1); assert.equal((await getProfileCover("driver", target))?.status, "synced");
});
await check("Upload antigo não substitui uma capa escolhida durante o envio", async () => {
  let started!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  await putProfileCover(make("old-upload")); uploadGate = async record => { if (record.revision === "old-upload") { started(); await gate; } };
  const task = sync.sync("driver", target); await ready; await putProfileCover(make("new-upload")); release(); await task; uploadGate = undefined;
  assert.equal(published.at(-1)?.revision, "new-upload"); assert(!published.some(row => row.revision === "old-upload"));
});
await check("Nova seleção durante confirmação também é publicada por último", async () => {
  let started!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  await putProfileCover(make("old-publish")); publishGate = async record => { if (record.revision === "old-publish") { started(); await gate; } };
  const task = sync.sync("driver", target); await ready; await putProfileCover(make("new-publish")); release(); await task; publishGate = undefined;
  assert.equal(published.at(-1)?.revision, "new-publish"); assert.equal((await getProfileCover("driver", target))?.revision, "new-publish");
});
await check("Falha de publicação preserva bytes e URL e repete sem reenviar o arquivo", async () => {
  denyPublish = true; await putProfileCover(make("denied")); await assert.rejects(sync.sync("driver", target));
  const before = uploads, local = await getProfileCover("driver", target);
  assert.equal(local?.status, "pending"); assert(local?.failure && local.remoteUrl && local.imageDataUrl);
  denyPublish = false; await sync.sync("driver", target); assert.equal(uploads, before); assert.equal((await getProfileCover("driver", target))?.status, "synced");
});
await check("Troca de conta durante upload impede publicação da sessão anterior", async () => {
  await putProfileCover(make("logout")); uploadGate = async () => { uid = "another"; generation++; };
  await assert.rejects(sync.sync("driver", target)); uploadGate = undefined;
  assert(!published.some(row => row.revision === "logout")); assert.equal((await getProfileCover("driver", target))?.status, "pending");
  assert.equal((await listPendingProfileCovers("another")).length, 0); uid = "driver"; generation++;
});
await check("Logout e login no mesmo UID invalidam a geração antiga", async () => {
  await putProfileCover(make("same-uid")); uploadGate = async () => { generation++; };
  await assert.rejects(sync.sync("driver", target)); uploadGate = undefined; assert(!published.some(row => row.revision === "same-uid"));
});
await check("Motorista não publica uma capa de outro motorista", async () => {
  await assert.rejects(sync.sync("driver", { scope: "driver", profileId: "other" }), /NOT_OWNER/);
});
await check("Empresa e motorista mantêm identidades e filas separadas", async () => {
  await putProfileCover(make("company", "company", "company-a")); await sync.syncPending("driver");
  assert(published.some(row => row.revision === "company" && row.scope === "company" && row.profileId === "company-a"));
  assert.equal((await getProfileCover("driver", target))?.revision, "same-uid");
});
await check("Download atrasado não apaga uma edição local ainda pendente", async () => {
  await putProfileCover(make("local-wins"));
  await cacheRemoteProfileCover({ ...make("stale"), status: "synced" }, () => true);
  assert.equal((await getProfileCover("driver", target))?.revision, "local-wins");
});
await check("Leitor de outro usuário mantém cópia offline isolada", async () => {
  const viewer = { ...make("public"), viewerId: "viewer", key: profileCoverKey("viewer", target), status: "synced" as const, remoteUrl: "https://example.test/public" };
  await cacheRemoteProfileCover(viewer, () => true);
  assert.equal((await getProfileCover("viewer", target))?.imageDataUrl, image);
  assert.equal((await getProfileCover("driver", target))?.revision, "local-wins");
});
await check("Remoção offline é persistida e sincroniza sem upload", async () => {
  online = false; const removed = { ...make("removed"), imageDataUrl: "", removed: true };
  await putProfileCover(removed); assert.equal((await getProfileCover("driver", target))?.removed, true);
  const before = uploads; online = true; await sync.sync("driver", target);
  assert.equal(uploads, before); assert.equal(published.at(-1)?.url, ""); assert.equal((await getProfileCover("driver", target))?.status, "synced");
});
await check("Fallback durável vence registro antigo após falha de escrita no IndexedDB", async () => {
  const open = indexedDB.open.bind(indexedDB); (indexedDB as any).open = () => { throw new Error("quota"); };
  try { await putProfileCover(make("durable-fallback")); } finally { (indexedDB as any).open = open; }
  assert.equal((await getProfileCover("driver", target))?.revision, "durable-fallback");
  assert((await listPendingProfileCovers("driver")).some(record => record.revision === "durable-fallback"));
  await sync.sync("driver", target); assert.equal(localStorage.getItem(profileCoverKey("driver", target)), null);
});
await check("Capa nunca é derivada da foto, do logo ou do veículo", () => {
  assert.equal(resolveProfileCover({ profilePhotoURL: "https://test/avatar", vehiclePhotoURL: "https://test/truck", logoUrl: "https://test/logo" }).url, "");
  assert.equal(resolveProfileCover({ profileCoverURL: "https://test/cover", profileCoverRevision: "rev" }).url, "https://test/cover");
});
await check("Escopo de páginas inclui somente Atividade, Resultados e Meu perfil", () => {
  for (const profileTab of ["activity", "operations", "results", "profile"]) assert(isProfileCoverPage("/driver/profile", { profileTab }));
  for (const activeTab of ["company", "history", "reports"]) assert(isProfileCoverPage("/admin/fleet", { activeTab }));
  for (const path of ["/admin/history", "/admin/reports", "/driver/history", "/driver/reports"]) assert(isProfileCoverPage(path));
  assert(!isProfileCoverPage("/driver/profile", { profileTab: "dashboard" }));
  for (const activeTab of ["operations", "fleet", "hr"]) assert(!isProfileCoverPage("/admin/fleet", { activeTab }));
  for (const path of ["/admin/senior", "/ranking", "/driver/news", "/admin/news"]) assert(!isProfileCoverPage(path));
});
await fs.mkdir("reports", { recursive: true });
await fs.writeFile("reports/profile-cover-498-sync.json", JSON.stringify({ suite: "profile-cover-498", checks: results, passed: results.length, scope: "local isolated transport; durable IndexedDB and real synchronization engine" }, null, 2) + "\n");
console.log(`PROFILE_COVER_498_PASS ${results.length} checks`);
dom.window.close();
