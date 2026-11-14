import assert from "node:assert/strict";
import fs from "node:fs";
import { initializeTestEnvironment, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { writeRemoteVehiclePhoto, findRemoteVehiclePhoto } from "../src/services/vehiclePhotoRepository";
import { rankingVehiclePhotoDocumentKey } from "../src/lib/vehiclePhotoIdentity";

const projectId = "demo-nvu-v36-4-staging";
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):\d+$/);
assert.equal(process.env.GCLOUD_PROJECT, projectId);
const env = await initializeTestEnvironment({ projectId, firestore: { rules: fs.readFileSync("firestore.rules", "utf8") } });
try {
  await env.withSecurityRulesDisabled(async (context) => {
    for (const uid of ["photo-owner", "photo-other"]) await setDoc(doc(context.firestore(), "users", uid), { role: "driver", name: uid });
  });
  const db = env.authenticatedContext("photo-owner").firestore() as any;
  const original = { userId: "photo-owner", simulatorId: "gto", vehicleId: "scania.g:120", vehicleName: "Scania G" };
  const second = { ...original, vehicleId: "iveco" };
  const anotherSimulator = { ...original, simulatorId: "ets2" };
  await writeRemoteVehiclePhoto(db, original, "https://test.invalid/gto-sc.webp");
  await writeRemoteVehiclePhoto(db, second, "https://test.invalid/gto-iv.webp");
  await writeRemoteVehiclePhoto(db, anotherSimulator, "https://test.invalid/ets-sc.webp");
  // The R8 projection is a flat document keyed by full identity.
  const reloaded = (await getDoc(doc(db, "rankingVehiclePhotos", rankingVehiclePhotoDocumentKey(original)))).data();
  assert.equal(findRemoteVehiclePhoto(reloaded, original), "https://test.invalid/gto-sc.webp");
  const reloadedSecond = (await getDoc(doc(db, "rankingVehiclePhotos", rankingVehiclePhotoDocumentKey(second)))).data();
  const reloadedSimulator = (await getDoc(doc(db, "rankingVehiclePhotos", rankingVehiclePhotoDocumentKey(anotherSimulator)))).data();
  assert.equal(findRemoteVehiclePhoto(reloadedSecond, second), "https://test.invalid/gto-iv.webp");
  assert.equal(findRemoteVehiclePhoto(reloadedSimulator, anotherSimulator), "https://test.invalid/ets-sc.webp");
  await writeRemoteVehiclePhoto(db, original, "https://test.invalid/gto-updated.webp");
  const replaced = (await getDoc(doc(db, "rankingVehiclePhotos", rankingVehiclePhotoDocumentKey(original)))).data();
  assert.equal(findRemoteVehiclePhoto(replaced, original), "https://test.invalid/gto-updated.webp");
  assert.equal(findRemoteVehiclePhoto(reloadedSecond, second), "https://test.invalid/gto-iv.webp");
  const otherDb = env.authenticatedContext("photo-other").firestore() as any;
  const visibleToOther = await getDoc(doc(otherDb, "rankingVehiclePhotos", rankingVehiclePhotoDocumentKey(original)));
  assert.equal(findRemoteVehiclePhoto(visibleToOther.data(), original), "https://test.invalid/gto-updated.webp");
  await assertFails(writeRemoteVehiclePhoto(db, { ...original, userId: "photo-other" }, "https://test.invalid/forbidden.webp"));
  const originalRef = doc(otherDb, "rankingVehiclePhotos", rankingVehiclePhotoDocumentKey(original));
  await assertFails(setDoc(originalRef, { ...original, userId: "photo-other", url: "https://test.invalid/takeover.webp" }));
  await assertFails(setDoc(doc(db, "rankingVehiclePhotos", "photo-other:gto:poisoned"), { ...original, url: "https://test.invalid/poisoned.webp" }));
  await assertFails(setDoc(doc(db, "rankingVehiclePhotos", rankingVehiclePhotoDocumentKey(original)), { ...original, simulatorId: "ats", url: "https://test.invalid/moved.webp" }));
  await assertFails(setDoc(doc(db, "rankingVehiclePhotos", "photo-owner:gto:empty"), { ...original, vehicleId: "", url: "https://test.invalid/empty.webp" }));
  console.log("PASS Firestore Emulator: scoped photos survive reassignment/reload; replacements preserve other photos; foreign-account writes denied.");
} finally { await env.cleanup(); }
